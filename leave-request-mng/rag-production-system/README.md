# 📚 RAG Production System (v2.0.0)

> **Mô tả:** Hệ thống RAG (Retrieval-Augmented Generation) dạng modular, production-ready, xây dựng bằng FastAPI.
>
> **Stack:** Google Gemini (Embedding + LLM) · Pinecone (Vector DB) · LangChain · Celery · FastAPI

---

## ⚖️ Quy tắc vận hành hệ thống

### 🔴 GOLDEN RULE #1 — Bảo mật thao tác Sync
AI Agent / Admin **cần xác nhận** trước khi gọi lệnh Re-index (`POST /api/v1/sync`).
- Lệnh Sync sẽ xoá toàn bộ namespace cũ trong Pinecone và upload lại từ đầu — **DESTRUCTIVE**.
- **Bắt buộc:** Yêu cầu `{"confirmed": true}` trong request body.

---

## 🗂️ Cấu trúc thư mục

```
rag-production-system/
├── main.py                              # FastAPI app factory (Web Server Entrypoint)
├── cli.py                               # CLI tool cho sync và test query
├── mcp_server.py                        # MCP Server cho AI Agent (Cursor, Claude, Archon...)
├── config.py                           # Centralized config (Gemini + Pinecone)
├── requirements.txt                    # Dependencies
├── .env.example                        # Env template
├── README.md                           # File này
│
├── documents/                           # Thư mục chứa tài liệu (.md, .yaml, .txt)
│
├── api/
│   ├── chat_router.py                  # POST /api/v1/chat — Retrieve context
│   └── ingest_router.py               # POST /api/v1/sync, /upload-doc
│
├── core/
│   ├── ingestion/
│   │   ├── embeddings.py              # CustomGeminiEmbeddings (batched, tenacity-backed)
│   │   └── loader.py                  # fetch_project_context_documents()
│   ├── retrieval/
│   │   ├── retriever.py               # retrieve_chunks()
│   │   └── query_optimizer.py         # Query optimization & Guardrail helpers
│   └── generation/
│       ├── chain.py                   # Gemini RAG generation chain
│       └── prompt_templates.py        # CQR rewrite prompt templates
│
├── db/
│   ├── vector_db.py                   # Pinecone vector store wrapper
│   └── relational_db.py              # Async SQLAlchemy ORM
│
├── models/
│   └── pydantic_schemas.py            # API Contracts (Request / Response schemas)
│
└── workers/
    └── celery_tasks.py                # Background ingest + sync tasks
```

---

## 📄 Mô tả các file chính

### 🔧 Entrypoints

#### `main.py` ⭐ **(Server chính)**
FastAPI application entrypoint. CORS, timing middleware, Prometheus metrics, router mounting.
- Chạy: `.venv/bin/python main.py` hoặc `uvicorn main:app --reload`
- Swagger UI tại: `http://localhost:8000/docs`

#### `mcp_server.py`
MCP Server kết nối RAG với các AI Client (Cursor / Claude Desktop / Archon).
- Tool `sync_documents(namespace)`
- Tool `retrieve_context(query, namespace)`

#### `cli.py`
Công cụ dòng lệnh phụ dùng để test nhanh:
- Đồng bộ tài liệu: `.venv/bin/python cli.py --sync`
- Query trực tiếp: `.venv/bin/python cli.py --query "Nội dung cần tìm"`

---

## 🔄 Quy trình hoạt động

1. **Khởi tạo & Nạp tài liệu (`documents/`)**:
   Tài liệu `.md`, `.yaml`, `.txt` đặt trong thư mục `documents/` (hoặc thư mục tương ứng với namespace).
2. **Chunking**:
   `loader.py` dùng `MarkdownHeaderTextSplitter` để tách theo các thẻ tiêu đề (`#`, `##`, `###`), sau đó dùng `RecursiveCharacterTextSplitter` chia nhỏ chunk.
3. **Embedding**:
   `embeddings.py` gửi batch vector lên Gemini (`models/gemini-embedding-2`) với cơ chế retry tự động.
4. **Vector Store**:
   Lưu trữ vector và metadata vào Pinecone (namespace mặc định: `documents`).
5. **Retrieval**:
   `retriever.py` thực hiện truy vấn thông tin chính xác từ Pinecone vector database.

---

## 🚀 Khởi động nhanh

```bash
# 1. Tạo và kích hoạt môi trường ảo Python
python3 -m venv .venv
source .venv/bin/activate

# 2. Cài đặt thư viện
pip install -r requirements.txt

# 3. Thêm tài liệu vào thư mục documents/bằng cấp với tools
mkdir -p documents
# (thêm các file .md / .yaml vào đây)

# 4. Sync tài liệu vào Pinecone
python cli.py --sync

# 5. Chạy Web Server
python3 main.py
```

### Test API sau khi chạy:
```bash
# Sync tài liệu lên Pinecone (cần confirmed=true)
curl -X POST http://localhost:8000/api/v1/sync \
  -H "Content-Type: application/json" \
  -d '{"confirmed": true}'

# Query lấy context
curl -X POST http://localhost:8000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "Nội dung cần tìm kiếm"}'
```
