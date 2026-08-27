# 📚 RAG Production System

> **Hệ thống RAG (Retrieval-Augmented Generation) production-ready, xây dựng bằng FastAPI.**
>
> **Stack:** Google Gemini (Embedding + LLM + Vision OCR) · Qdrant (Local Vector DB) · LangChain · Celery · FastAPI

---

## ⚖️ Quy tắc vận hành

### 🔴 GOLDEN RULE — Bảo mật thao tác Sync
AI Agent / Admin **cần xác nhận** trước khi gọi lệnh Re-index (`POST /api/v1/sync`).
- Lệnh Sync sẽ **xoá toàn bộ collection** trong Qdrant và upload lại từ đầu — **DESTRUCTIVE**.
- **Bắt buộc:** Yêu cầu `{"confirmed": true}` trong request body.

---

## 🗂️ Cấu trúc thư mục

```
rag-production-system/
├── main.py                              # FastAPI app (Web Server Entrypoint)
├── cli.py                               # CLI tool — sync, scan-code, query
├── mcp_server.py                        # MCP Server cho AI Agent (Cursor, Claude...)
├── config.py                            # Centralized config (Pydantic Settings v2)
├── requirements.txt                     # Dependencies
├── .env / .env.example                  # Environment variables
│
├── documents/                           # Tài liệu input (.md, .yaml, .pdf, .png...)
│
├── api/
│   ├── chat_router.py                   # POST /api/v1/chat — Retrieve + Generate
│   ├── ingest_router.py                 # POST /api/v1/sync, /upload-doc
│   └── code_router.py                   # POST /api/v1/scan-code
│
├── core/
│   ├── ingestion/
│   │   ├── embeddings.py                # Gemini Embeddings (batch 50, tenacity retry)
│   │   ├── loader.py                    # Document discovery + chunking pipeline
│   │   ├── code_loader.py               # Source code scanner
│   │   └── parsers/
│   │       └── vision_parser.py         # PDF/Image → Markdown (Gemini Vision OCR)
│   ├── retrieval/
│   │   ├── retriever.py                 # Hybrid search (Dense + BM25 + RRF + Rerank)
│   │   ├── query_optimizer.py           # ID detection, query expansion, self-reflection
│   │   └── bm25_index.py               # In-memory BM25 keyword index
│   └── generation/
│       ├── chain.py                     # Gemini RAG generation chain
│       └── prompt_templates.py          # Prompt templates
│
├── db/
│   ├── vector_db.py                     # Qdrant vector store wrapper
│   └── relational_db.py                # Async SQLAlchemy ORM
│
├── models/
│   └── pydantic_schemas.py              # API Request / Response schemas
│
├── workers/
│   └── celery_tasks.py                  # Background ingest + sync tasks
│
└── web/                                 # Frontend (Vite + React)
```

---

## 🔄 Pipeline hoạt động

### Ingestion Pipeline (Sync)
```
Tài liệu (.md, .yaml, .pdf, .png, .jpg)
         │
         ├── Text files (.md, .yaml) → Đọc trực tiếp
         │
         └── Visual files (.pdf, .png, .jpg) → Vision Parser
                │
                ├── PDF: Phân loại từng trang (Text Density)
                │     ├── Digital page (text > 50 chars) → Extract trực tiếp (0 cost)
                │     └── Scanned/Hybrid page → Render 300 DPI → Gemini Vision OCR
                │
                └── Image: Gemini Vision OCR trực tiếp
         │
         ▼
MarkdownHeaderTextSplitter → RecursiveCharacterTextSplitter (chunk_size=900)
         │
         ├── Gemini Embedding (models/gemini-embedding-2, 3072D)
         │     └── Batch 50/call + tenacity retry (min=16s, 6 attempts)
         │
         ├── Qdrant Vector Store (local Docker, cosine similarity)
         │
         └── BM25 In-memory Index (persisted to disk)
```

### Retrieval Pipeline (Query)
```
User Query
    │
    ├── 1. Query Optimization: ID detection + bare ID expansion
    │
    ├── 2. Dense Search: Qdrant vector similarity (top_k × 2)
    │
    ├── 3. BM25 Search: Keyword index (top_k × 2)
    │
    ├── 4. RRF Fusion: Reciprocal Rank Fusion (dense + BM25)
    │
    ├── 5. Keyword Reranking: Exact ID match boost (+10.0)
    │
    ├── 6. Deduplicate + Trim → final top_k
    │
    └── 7. Self-Reflection: Nếu < 2 chunks → rewrite query + retry (max 2 attempts)
```

---

## 🚀 Khởi động nhanh

### Prerequisites
- Python 3.12+
- Docker (cho Qdrant)
- Google API Key (Gemini)

### Setup

```bash
# 1. Tạo và kích hoạt môi trường ảo
python3 -m venv .venv
source .venv/bin/activate

# 2. Cài đặt thư viện
pip install -r requirements.txt

# 3. Cấu hình .env
cp .env.example .env
# → Thêm GOOGLE_API_KEY vào .env

# 4. Khởi động Qdrant (Docker)
docker run -d --name qdrant -p 6333:6333 -p 6334:6334 \
  -v $(pwd)/qdrant_storage:/qdrant/storage \
  qdrant/qdrant

# 5. Thêm tài liệu
mkdir -p documents
# Copy các file .md / .yaml / .pdf / .png vào documents/

# 6. Sync tài liệu vào Qdrant
python cli.py --sync documents --namespace doc

# 7. Quét source code (optional)
python cli.py --scan-code <folder_name> --namespace <ns>

# 8. Chạy Web Server
python cli.py --serve --namespace doc
```

---

## 📦 CLI Reference

> **Lưu ý:** `--namespace` là bắt buộc cho tất cả lệnh.

```bash
# Sync tài liệu
python cli.py --sync [FOLDER] --namespace <ns>

# Quét source code
python cli.py --scan-code <folder_name> --namespace <ns>

# Query trực tiếp
python cli.py --query "BR-02" --namespace <ns>

# Chạy API server
python cli.py --serve --namespace <ns>
```

---

## 🔗 API Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| `POST` | `/api/v1/chat` | Chat + Retrieve context |
| `POST` | `/api/v1/sync` | Re-index (Celery, cần `confirmed: true`) |
| `POST` | `/api/v1/sync-direct` | Re-index trực tiếp (không cần Celery) |
| `POST` | `/api/v1/upload-doc` | Upload file đơn lẻ |
| `GET`  | `/api/v1/upload-doc/status/{task_id}` | Kiểm tra trạng thái task |
| `GET`  | `/api/v1/docs/list` | Liệt kê tài liệu đã phát hiện |
| `POST` | `/api/v1/scan-code` | Quét và index source code |

Swagger UI: `http://localhost:8000/docs`

---

## ⚙️ Cấu hình chính (config.py)

| Biến | Mặc định | Mô tả |
|------|----------|-------|
| `GOOGLE_API_KEY` | — | Google Gemini API key |
| `llm_model` | `gemini-3.5-flash` | Model cho LLM generation |
| `embedding_model` | `models/gemini-embedding-2` | Model cho embedding (3072D) |
| `vision_model` | `gemini-2.0-flash` | Model cho Vision OCR |
| `qdrant_url` | `http://localhost:6333` | Qdrant server URL |
| `chunk_size` | `900` | Kích thước chunk (ký tự) |
| `chunk_overlap` | `120` | Overlap giữa chunks |
| `top_k_retrieval` | `8` | Số chunks trả về mỗi query |
| `bm25_weight` | `0.4` | Trọng số BM25 trong RRF fusion |
| `dense_weight` | `0.6` | Trọng số Dense vector trong RRF fusion |
| `keyword_boost` | `10.0` | Bonus score cho exact ID match |

---

## 📂 Định dạng file hỗ trợ
   
| Loại | Extensions | Phương pháp xử lý |
|------|-----------|-------------------|
| Markdown | `.md` | Đọc trực tiếp + MarkdownHeaderTextSplitter |
| YAML | `.yaml` | Đọc trực tiếp + chunking |
| PDF (digital) | `.pdf` | PyMuPDF text extraction (0 cost) |
| PDF (scanned) | `.pdf` | Render 300 DPI → Gemini Vision OCR |
| Ảnh | `.png`, `.jpg`, `.jpeg`, `.webp` | Gemini Vision OCR |
