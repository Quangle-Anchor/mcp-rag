# Kiến Trúc & Hướng Giải Quyết Ingestion Nâng Cao (PDF, OCR, Excel)

Tài liệu này chi tiết hóa thiết kế kỹ thuật và lộ trình giải quyết các bài toán ingestion tài liệu phức tạp: PDF hỗn hợp (Digital/Scan), OCR Tiếng Việt có bảng biểu và con dấu, Dual-mode OCR Pool (Bảo mật vs Chi phí), và xử lý file Excel nhiều sheet.

---

## 1. Tổng Quan Kiến Trúc Pipeline Ingestion

```
                 [ Tài liệu Đầu Vào: PDF / DOCX / EXCEL ]
                                    │
               ┌────────────────────┴────────────────────┐
               ▼                                         ▼
        [ FILE: EXCEL ]                           [ FILE: PDF / DOCX ]
               │                                         │
     • Tách từng Sheet                         • Tách từng Trang (Page-by-Page)
     • Xử lý Sheet ẩn/rỗng                               │
     • Convert row → Markdown/JSON                       ▼
               │                            [ 1. Page Classifier (Text Density) ]
               │                            Đo mật độ ký tự & tỷ lệ diện tích ảnh
               │                                         │
               │               ┌─────────────────────────┼─────────────────────────┐
               │               ▼                         ▼                         ▼
               │       [ Digital Text ]            [ Hybrid Page ]          [ Scanned / Image ]
               │       (Text > 50 ký tự,           (Có text + bảng          (Text < 10 ký tự,
               │        ảnh < 30% trang)            phức tạp/ảnh)            ảnh > 70% trang)
               │               │                         │                         │
               │       Extract trực tiếp                 │                         ▼
               │       bằng PyMuPDF                      │                  Render ảnh 300 DPI
               │       (0 cost, <10ms)                   │                         │
               │               │                         └────────────┬────────────┘
               │               │                                      ▼
               │               │                        [ 2. OCR / Vision Router ]
               │               │                           (Kiểm tra Security Tag)
               │               │                                      │
               │               │                     ┌────────────────┴────────────────┐
               │               │                     ▼                                 ▼
               │               │             [ Confidential: LOCAL ]           [ Standard: CLOUD ]
               │               │             • Qwen2.5-VL / MinerU             • Gemini Flash Vision
               │               │             • 100% On-premise, 0 leak         • Siêu rẻ, đọc bảng chuẩn
               │               │                     │                                 │
               │               │                     └────────────────┬────────────────┘
               │               │                                      │
               │               │                                      ▼
               │               │                            [ Trả về Clean Markdown ]
               │               │                            (Giữ bảng biểu, bỏ mộc đỏ)
               │               │                                      │
               └───────────────┼──────────────────────────────────────┘
                               ▼
            [ 3. Structure-Aware Chunking ]
            • MarkdownHeaderTextSplitter (theo heading / sheet)
            • 200-300 words/chunk + Context Headers
                               ▼
                    [ Vector DB + BM25 Sync ]
```

---

## 2. Chi Tiết 4 Trụ Cột Giải Pháp

---

### Trụ Cột 1: Phân Loại Trang PDF & Text Density Routing
**Vấn đề:** PDF có nhiều định dạng: PDF digital (văn bản vector), PDF scan (ảnh chụp/scan), và PDF lai (vài trang text, vài trang scan biểu đồ/hợp đồng đóng dấu). Nếu extract mù sẽ gặp lỗi "Index thành công 0 ký tự".

**Thuật toán phân luồng từng trang (Page-by-page Analyzer):**
Duyệt qua từng trang bằng thư viện `PyMuPDF (fitz)` và tính toán các chỉ số:
1. `char_count`: Số lượng ký tự text có thể trích xuất trực tiếp.
2. `image_area_ratio`: $\frac{\text{Tổng diện tích bounding box ảnh}}{\text{Diện tích toàn trang}}$.
3. `has_vector_drawings`: Kiểm tra đường kẻ bảng biểu vector.

**Quy tắc định tuyến (Routing Logic):**
- **Trang Digital Text (`char_count > 50` & `image_area_ratio < 0.3`):**
  - Trích xuất trực tiếp bằng `fitz.get_text("markdown")`.
  - **Hiệu năng:** Tốc độ < 10ms, chi phí 0 VNĐ, không làm sai lệch text gốc.
- **Trang Scanned/Ảnh (`char_count < 10` & `image_area_ratio >= 0.7`):**
  - Render trang sang ảnh chuẩn 300 DPI (`page.get_pixmap(dpi=300)`).
  - Gửi ảnh sang **Vision Engine** để đọc nội dung.
- **Trang Lai Hybrid (Có cả text và hình ảnh/bảng phức tạp):**
  - Đẩy toàn bộ trang sang Vision Engine để giữ trọn vẹn ngữ cảnh cấu trúc (layout context), hoặc bóc tách riêng vùng ảnh để xử lý bổ trợ.

---

### Trụ Cột 2: Vision Model Thay Thế OCR Cổ Điển
**Vấn đề:** OCR truyền thống (Tesseract/EasyOCR) thường:
- Nhận diện sai dấu tiếng Việt phức tạp (`ơ` thành `o`, mất dấu hỏi/ngã).
- Làm vỡ hoàn toàn cấu trúc bảng (hàng cột bị xáo trộn thành chuỗi text vô nghĩa).
- Bị nhiễu bởi con dấu mộc đỏ, chữ ký mực xanh đè lên nội dung.

**Giải pháp: Vision Layout Parsing bằng Multimodal LLM**
Thay vì nhận diện từng ký tự rời rạc, Vision LLM đọc toàn bộ trang như con người nhìn tài liệu và xuất ra **Markdown chuẩn**:

**Prompt System Mẫu Cho Vision Engine:**
```text
Bạn là một hệ thống trích xuất tài liệu độ chính xác cao.
Hãy đọc hình ảnh trang tài liệu tiếng Việt này và chuyển đổi thành văn bản Markdown chuẩn:
1. Độ chính xác: Giữ nguyên 100% nội dung chữ, không tự ý tóm tắt hoặc thêm bớt.
2. Bảng biểu (Tables): Nhận diện toàn bộ hàng/cột và định dạng thành bảng Markdown (| Cột 1 | Cột 2 |).
3. Con dấu & Chữ ký: Tự động bỏ qua các con dấu mộc đỏ công ty, chữ ký tay đè lên văn bản; chỉ đọc nội dung văn bản in bên dưới.
4. Tiêu đề: Đánh dấu tiêu đề các cấp (#, ##, ###) đúng theo cấp bậc thị giác trên trang.
```

---

### Trụ Cột 3: Dual-Mode OCR Pool (Bảo Mật vs Tối Ưu Chi Phí)
**Vấn đề:** Không thể gửi tài liệu mật/nhạy cảm (hợp đồng kinh tế, bảng lương, CCCD) lên Cloud API công cộng; nhưng nếu chạy 100% bằng Local Model thì sẽ tốn chi phí phần cứng (GPU) và chậm.

**Giải pháp: Xây dựng OCR Pool 2 chế độ + Cost Tracking**

#### 1. Cơ chế phân loại cấp độ bảo mật (Security Tiering):
- **Phân loại qua Metadata / Namespace:** Khi sync/upload, chỉ định flag `confidential: true` hoặc chỉ định namespace bí mật.
- **Tự động quét PII (Rule-based):** Sử dụng regex nhận diện nhanh các mẫu dữ liệu nhạy cảm (Số CMND/CCCD, "BẢNG LƯƠNG", "HỢP ĐỒNG KINH TẾ", "MẬT").

#### 2. Bảng so sánh 2 chế độ:
| Tiêu chí | ☁️ Cloud Tier (Tài liệu thường) | 🔒 Local Tier (Tài liệu Confidential) |
| :--- | :--- | :--- |
| **Model** | `Gemini 1.5 Flash` / `Gemini 2.0 Flash` | `Qwen2.5-VL-7B-Instruct` (Ollama/vLLM) hoặc `MinerU / Surya OCR` |
| **Vị trí** | Google Cloud API | Server On-premise / Local Docker Container |
| **Bảo mật** | Phụ thuộc chính sách API Cloud | **Air-gapped 100%**, dữ liệu không bao giờ ra ngoài |
| **Chi phí** | ~$0.00002 / trang (rất rẻ) | 0 USD API, tốn tài nguyên GPU/CPU local |
| **Tốc độ** | 1–2s / trang | 2–5s / trang (tùy GPU) |

#### 3. Bộ đếm chi phí từng trang (Cost & Token Tracker):
Ghi log định lượng tài nguyên tiêu thụ:
```json
{
  "file_name": "hop_dong_dich_vu.pdf",
  "page_index": 4,
  "engine_used": "gemini-flash-vision",
  "security_tier": "standard",
  "tokens_in": 1150,
  "tokens_out": 380,
  "estimated_cost_usd": 0.000028,
  "latency_ms": 1420
}
```

---

### Trụ Cột 4: Xử Lý File Excel Đa Sheet (Multi-Sheet Excel)
**Vấn đề:** File Excel gồm nhiều Sheet chứa các bảng dữ liệu dạng lưới. Nếu đọc dạng phẳng thì mất tên Sheet, mất tiêu đề cột, và khi cắt chunk sẽ bị đứt ngang giữa các dòng dữ liệu liên quan.

**Giải pháp:**
1. **Duyệt qua từng Sheet bằng `pandas` / `openpyxl`:**
   - Bỏ qua các sheet rỗng hoặc sheet ẩn (`sheet.sheet_state == 'hidden'`).
2. **Bảo toàn ngữ cảnh Sheet và Cột (Header Preservation):**
   - Đưa thông tin `[SHEET: Tên_Sheet]` vào đầu mỗi chunk.
   - Đối với bảng dài, cắt chunk theo từng nhóm **10–20 dòng dữ liệu** và **luôn lặp lại dòng Header** ở đầu mỗi chunk.
3. **Mẫu format chunk Excel tối ưu cho Retrieval:**
   ```markdown
   [FILE: Bang_Gia_Dich_Vu_2025.xlsx]
   [SHEET: Goi_Doanh_Nghiep]
   [COLUMNS: Mã Gói | Tên Dịch Vụ | Dung Lượng | Đơn Giá (VNĐ) | Ghi Chú]

   | G-01 | Cloud Storage Pro | 1TB SSD  | 500,000  | Tặng kèm backup |
   | G-02 | Cloud Storage Max | 5TB SSD  | 2,000,000| Hỗ trợ 24/7     |
   | G-03 | AI Gateway Ent    | Không GH | 5,000,000| Dedicated IP    |
   ```
   *Lợi ích:* Khi tìm kiếm query `"G-02"` hoặc `"Cloud Storage Max"`, BM25 và Vector Search đều tìm thấy chính xác dòng tương ứng và hiểu trọn vẹn ngữ cảnh của Sheet đó.

---

## 3. Cấu Trúc Mã Nguồn Đề Xuất Cho Dự Án

Khi triển khai thực tế vào thư mục `core/ingestion/`, cấu trúc mã nguồn sẽ được phân tách như sau:

```
rag-production-system/
├── core/
│   ├── ingestion/
│   │   ├── parsers/
│   │   │   ├── __init__.py
│   │   │   ├── pdf_classifier.py    # Phân tích text density & bóc tách trang
│   │   │   ├── vision_ocr.py        # Adapter gọi Gemini Vision / Local Qwen2-VL
│   │   │   ├── excel_parser.py      # Đọc đa sheet & format table chunk
│   │   │   └── docx_parser.py       # Đọc tài liệu Word
│   │   ├── embeddings.py            # Batched Gemini Embeddings + Pacing
│   │   └── loader.py                # Main Ingestion Orchestrator
```
