# Ingestion
## Xử lý docs, pdf, excel
→ PDF không phải là MỘT loại file. Có PDF text, PDF scan, và loại lai - vài trang có chữ, vài trang là ảnh. Giải pháp: phân tích text density từng trang (đếm mật độ ký tự) rồi phân loại: trang text → extract thẳng, trang scan → đẩy qua OCR, trang lai → chạy cả hai rồi merge. Bỏ bước này là dính ngay ca "index thành công 0 ký tự" ở trên.
----------
→ OCR truyền thống chết với tài liệu Việt. Dấu tiếng Việt nhận sai (ơ thành o là nghĩa khác luôn), bảng biểu vỡ cấu trúc hàng-cột, mộc đỏ và chữ ký đè lên text. Đây là lúc Vision model vào việc: thay vì "nhận diện ký tự", nó đọc cả trang như con người - hiểu layout, đọc được bảng, tự bỏ qua con mộc. Chất lượng khác hẳn OCR cổ điển.
----------
→ Nhưng không phải tài liệu nào cũng được phép gửi ra ngoài. Hợp đồng mật mà đẩy lên API bên thứ ba là vi phạm chính sách dữ liệu. Nên mình build OCR pool 2 chế độ: tài liệu confidential → chạy Vision model local/self-hosted, tài liệu thường → gọi API vision cho nhanh và rẻ. Kèm cost tracking từng trang - vì Vision model không miễn phí, đốt vô tội vạ là hết budget.

# Retrieval Chuẩn 
## Cắt Chunk 
Độ dài chunk: 200-300 từ (khoảng 1000-1500 ký tự), overlap 20-30% (50-90 từ).

Nguyên tắc cắt:ưu tiên cắt theo cấu trúc tài liệu (theo đoạn văn, mục lớn/nhỏ, bảng, list), không cắt giữa chừng câu hoặc bảng.

Phương pháp: dùng LangChain RecursiveCharacterTextSplitter với paragraph, markdown, latex, table, code, html separators.

Cắt tài liệu sai là mọi thứ phía sau vô nghĩa. Hợp đồng, slide, báo cáo tài chính - không thể cắt cùng một kiểu. Mình phải làm 6 chiến lược (semantic, parent-child, hierarchical...) tùy loại tài liệu.