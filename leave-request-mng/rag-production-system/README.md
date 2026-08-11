# 📚 RAG Production System — Tài liệu dự án (Tiếng Việt)

> **Vị trí:** `leave-request-mng/rag-production-system/`
>
> **Mô tả:** Hệ thống RAG (Retrieval-Augmented Generation) dạng modular, production-ready,
> xây dựng bằng FastAPI. Dựa trên `rag_system.py` + toàn bộ luật từ `ai_instruction.instructions.md`.
>
> **Stack:** Google Gemini (Embedding + LLM) · Pinecone (Vector DB) · LangChain · Celery · FastAPI

---

## ⚖️ Luật vận hành hệ thống (từ `ai_instruction.instructions.md`)

> **Đây là những rule không thể phá vỡ. Toàn bộ code được thiết kế để enforce những rule này.**

### 🔴 GOLDEN RULE #1 — Không đọc file trực tiếp
AI Agent **TUYỆT ĐỐI BỊ CẤM** dùng filesystem tools để đọc file `.md` / `.yaml`.
- **Cách duy nhất** để lấy context: gọi `retrieve_mendix_context` (API: `POST /api/v1/chat`).

### 🔴 GOLDEN RULE #2 — Không tự ý sync
AI Agent **TUYỆT ĐỐI BỊ CẤM** gọi `sync_mendix_context` mà không có xác nhận của user.
- Sync xóa toàn bộ Pinecone namespace và upload lại từ đầu — **DESTRUCTIVE**.
- **Bắt buộc:** Hỏi user trước, chỉ thực hiện khi user trả lời **YES** rõ ràng.
- API: `POST /api/v1/sync` với body `{"confirmed": true}`.

### 🟡 QOL Pipeline — MAX 2 retrieve calls per request
- **Call #1:** Deep Targeted Search với CQR-optimized query.
- **Call #2:** Chỉ khi Call #1 trả về empty/insufficient — phải dùng query khác (pivot/broaden).
- **HARD STOP sau 2 lần** — không gọi thêm dù context thiếu.
- Nếu thiếu → trả về `[TOKEN GUARDRAIL TRIGGERED]` message.

### 🟡 Empty Layer Guardrail
Nếu Pinecone trả về 0 chunk cho layer được filter → trả về `[EMPTY LAYER GUARDRAIL TRIGGERED]`.
Không đoán mò, không generate code.

---

## 🗂️ Cấu trúc thư mục

```
rag-production-system/
├── main.py                              # FastAPI app factory
├── cli.py                               # CLI tool for syncing (doc / tool)
├── config.py                           # Centralized config (Gemini + Pinecone)
├── requirements.txt                    # Dependencies
├── .env.example                        # Env template
├── README.md                           # File này
│
├── api/
│   ├── chat_router.py                  # POST /chat — QOL Pipeline wired
│   └── ingest_router.py               # POST /sync, /upload-doc
│
├── core/
│   ├── ingestion/
│   │   ├── embeddings.py              # CustomGeminiEmbeddings (batched, no-sleep)
│   │   ├── classifier.py              # 5-layer hybrid classifier
│   │   ├── loader.py                  # fetch_project_context_documents()
│   │   └── tool_loader.py             # 3-layer chunking cho Tool Specifications
│   ├── retrieval/
│   │   ├── retriever.py               # retrieve_chunks() với QOL Pipeline
│   │   └── query_optimizer.py         # CQR, Call Counter, Guardrails, Phase 5
│   └── generation/
│       ├── chain.py                   # Gemini RAG chain + Mendix rules
│       └── prompt_templates.py        # STROT, Error Taxonomy, CQR prompts
│
├── db/
│   ├── vector_db.py                   # Pinecone singleton wrapper
│   └── relational_db.py              # SQLAlchemy async ORM
│
├── models/
│   └── pydantic_schemas.py            # All API contracts
│
├── workers/
│   └── celery_tasks.py                # Background ingest + sync tasks
│
└── rag_eval/
    ├── generate_testset.py            # RAGAS testset generator
    └── run_eval.py                    # Faithfulness/Relevancy/Precision/Recall
```

---

## 📄 Mô tả chi tiết từng file

### 🔧 Root files

#### `cli.py` ⭐ NEW
CLI hỗ trợ đồng bộ dữ liệu tĩnh lên Pinecone trực tiếp từ Terminal. Hỗ trợ 2 pipeline:
- `python cli.py --sync doc`: Đồng bộ Requirement Documents (5-layer pipeline) qua `loader.py`.
- `python cli.py --sync tool`: Đồng bộ Mendix Model SDK Tool Specifications (3-layer pipeline) qua `tool_loader.py`.
Có UI menu cho phép chọn hoặc tạo mới Namespace.

#### `main.py`
FastAPI application factory. CORS, timing middleware, Prometheus metrics, router mounting. **Không có AI logic.**

#### `config.py`
Pydantic Settings v2 singleton. Tất cả cấu hình: Gemini models, Pinecone index/namespace, chunk_size=900, overlap=120, top_k=8 (từ rag_system.py), rate limits (1.5s embed sleep, 4s LLM classifier sleep).

#### `requirements.txt`
Stack: FastAPI · `langchain-google-genai` · `langchain-pinecone` · `pinecone-client` · Celery · Ragas · SQLAlchemy.

#### `.env.example`
Template chứa `GOOGLE_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX_NAME=mendix-rag`, `PINECONE_NAMESPACE=mendix-docs`.

---

### 📡 `api/` — HTTP Adapter Layer

#### `api/chat_router.py`
`POST /api/v1/chat` — Endpoint RAG chính với **QOL Pipeline đầy đủ**:
1. Nhận `ChatRequest` (query + layer tùy chọn + history).
2. Gọi `retrieve_chunks()` → tối đa 2 lần Pinecone.
3. **Guardrail check:** Nếu `guardrail_msg != None` → trả về message ngay, **không generate code**.
4. Nếu đủ context → gọi Gemini với Mendix coding rules.
5. Trả về `ChatResponse` kèm `retrieve_calls_used`, `context_blocks` (format ╔══ SOURCE ══╗).

**Hỗ trợ `layer` filter:** `foundation | api | behavior | ui | cross-cutting` (auto-detect nếu không chỉ định).

#### `api/ingest_router.py`
- `POST /api/v1/sync` — **[ADMIN]** Full re-index. Yêu cầu `{"confirmed": true}` — **consent guard** giống `sync_mendix_context` MCP tool.
- `POST /api/v1/upload-doc` — Upload file đơn lẻ → Celery task.
- `GET /api/v1/upload-doc/status/{task_id}` — Poll trạng thái task.

---

### 🧠 `core/` — Business Logic Layer

#### `core/ingestion/embeddings.py`
**Tối ưu hóa rate-limit API cho Gemini (Batching + Tenacity):**
- Override `embed_documents` để gọi theo batch (BATCH_SIZE=50), tăng tốc x10 lần.
- **Loại bỏ hoàn toàn** hardcoded `time.sleep()`.
- Dùng `tenacity` exponential-backoff retry (chỉ catch `429 Rate Limit` và `503 Service Unavailable`).
- Truncate vector → 1024 chiều (Pinecone dimensionality cap).
- Singleton `get_embeddings()`.

#### `core/ingestion/classifier.py`
**Port của hybrid classifier từ rag_system.py:**
- `FILENAME_CLASSIFICATION_MAP`: keyword → `{layer, doc_type}` cho 5 layer Mendix.
- **Bước 1 (free):** Match keyword trong filename → ~80% files.
- **Bước 2 (LLM fallback):** Gọi Gemini Flash Lite với `CLASSIFIER_PROMPT` → sleep 4s sau mỗi call.
- `LAYER_MAP`: string → int (`"foundation"→1, "api"→2, "behavior"→3, "ui"→4, "cross-cutting"→5`).

#### `core/ingestion/loader.py`
**Port của `fetch_project_context_documents()` từ rag_system.py:**
- Auto-discover thư mục `Output`/`Outputs`: scan xuống (unlimited depth) + lên (3 cấp cha).
- Glob `*.md` và `*.yaml`.
- Exclude: `node_modules`, `.git`, `.vscode`, `__pycache__`, và files có "instruction"/"generation_log"/"gap_report".
- Classify → `MarkdownHeaderTextSplitter` (H1-H4) → `RecursiveCharacterTextSplitter` (size=900, overlap=120).
- Prefix mỗi chunk: `[FILE: ... | TYPE: ... | LAYER: ...]\n[SECTION: ...]`.

#### `core/ingestion/tool_loader.py` ⭐ NEW
**Pipeline 3-layer chunking dành riêng cho Tool Specifications:**
- Tự động scan đệ quy tìm thư mục `tool-specs` và `tools`.
- Phân tích cú pháp thẻ `<!-- BEGIN TOOL id: name -->` bằng Regex.
- **Layer 1 (Category):** Lấy từ tên file (vd: `pages.md` → metadata: `Pages`).
- **Layer 2 (Tool):** Cắt theo từng thẻ tool comment độc lập (`chunk_type="full_tool"`).
- **Layer 3 (Section):** Các tool quá lớn (≥1000 tokens) sẽ tự động bị chẻ nhỏ (sub-chunk) theo các thẻ `###` (`chunk_type="tool_section"` hoặc `"general"` cho đoạn giới thiệu).

#### `core/retrieval/query_optimizer.py` ⭐ NEW
**QOL Pipeline từ ai_instruction.instructions.md Phase 1 & 2:**
- `detect_mendix_layer(query)`: scan keyword → trả về layer string.
- `detect_microflow_prefix(query)`: tìm `VAL_`, `ACT_`, `SUB_`, `WFA_`.
- `rewrite_query_for_retrieval(query, attempt)`:
  - Attempt 1: CQR deep targeted — normalize tiếng Việt + inject GAR metadata.
  - Attempt 2: Broaden pivot — bỏ microflow name, focus vào entity/schema.
- `sort_chunks_by_priority(chunks)`: Phase 5 — CR_ > Log_ > others; YAML > MD.
- `build_empty_layer_message(layer)`: format `[EMPTY LAYER GUARDRAIL TRIGGERED]`.
- `build_token_guardrail_message(ctx)`: format `[TOKEN GUARDRAIL TRIGGERED: INSUFFICIENT CONTEXT]`.
- `QueryContext`: dataclass theo dõi call count, queries used, detected layer.

#### `core/retrieval/retriever.py`
**retrieve_chunks() với full QOL Pipeline:**
1. Auto-detect layer từ query.
2. CQR rewrite (attempt=1) → Call #1 Pinecone.
3. Nếu empty + layer filter → trả `build_empty_layer_message()`.
4. Nếu ≥ 2 chunks → **STOP** (không gọi thêm).
5. Nếu < 2 chunks → CQR rewrite (attempt=2) → Call #2 Pinecone (no layer filter).
6. Merge + deduplicate + `sort_chunks_by_priority()`.
7. Nếu vẫn < 2 chunks → `build_token_guardrail_message()`.
8. Format context blocks `╔══ SOURCE ══╗` như rag_system.py.

#### `core/generation/chain.py`
**Gemini RAG chain với Mendix rules embedded (Phase 3-6):**

System prompt bao gồm:
- **Phase 3:** Naming conventions (`VAL_`, `ACT_`, `SUB_`, `WFA_`), Enum Guard, error-aware refinement.
- **Phase 4:** Error Taxonomy table (7 categories).
- **Phase 5:** Conflict resolution (CR_ > others; YAML > MD).
- **Phase 6:** STROT instruction — không tạo Entity mới nếu đã tồn tại.
- **Output format:** Query Log + Code + Traceability Note.

#### `core/generation/prompt_templates.py` ⭐ NEW
Tập trung tất cả prompt templates:
- `STROT_INTROSPECTION_PROMPT`: kiểm tra entity/attribute đã tồn tại → JSON response.
- `ERROR_TAXONOMY_PROMPT`: phân loại lỗi Mendix SDK → CoT fix steps.
- `CQR_REWRITE_PROMPT`: LLM-based query rewriting (dùng khi heuristic không đủ).

---

### 🗄️ `db/` — Data Layer

#### `db/vector_db.py`
Pinecone singleton wrapper. `get_vector_store()` kết nối index đã tồn tại — **không** re-upload khi start. `get_retriever(top_k, layer_filter)` tạo retriever động với metadata filter.

#### `db/relational_db.py`
Async SQLAlchemy ORM. 3 bảng: `chat_sessions`, `chat_messages`, `document_records`. `init_db()` tạo bảng idempotent khi app start. `get_db()` FastAPI dependency.

---

### 📐 `models/pydantic_schemas.py`

| Schema | Mô tả |
|--------|-------|
| `MendixLayer` | Enum: `foundation / api / behavior / ui / cross-cutting` |
| `MendixErrorCategory` | Enum Phase 4: `SDK_SYNTAX / MAPPING_ERROR / DATA_TYPE_MISMATCH / ...` |
| `ChatRequest` | query + layer (auto-detect) + top_k=8 + history |
| `ChatResponse` | answer + sources + `retrieve_calls_used` + `context_blocks` |
| `SourceChunk` | chunk với `layer`, `doc_type`, `score`, `snippet` |
| `SyncResponse` | task_id + status (consent-required endpoint) |
| `ErrorTaxonomyResponse` | Phase 4 structured error + CoT fix |
| `HealthResponse` | version + Pinecone info + `max_retrieve_calls=2` |

---

### ⚙️ `workers/celery_tasks.py`

- **`ingest_document_task`:** Single file → classify → chunk → embed → Pinecone upsert (batched 20/batch, retry 3 lần).
- **`sync_all_documents_task`:** Full re-sync mirroring `sync_mendix_context()`:
  1. `fetch_project_context_documents()` — auto-discover Output dirs.
  2. `index.delete(delete_all=True, namespace=...)` — xóa namespace.
  3. Batch upload: 20 chunks/batch, retry exponential 5s → 10s.

---

### 🧪 `rag_eval/`

| File | Mô tả |
|------|-------|
| `generate_testset.py` | RAGAS testset từ tài liệu. CLI: `python -m rag_eval.generate_testset --test-size 20` |
| `run_eval.py` | Chạy 4 metrics: Faithfulness · Answer Relevancy · Context Precision · Context Recall |

---

## 🔄 Luồng hoạt động đầy đủ

### Luồng Chat (Query) — với QOL Pipeline

```
Client
  → POST /api/v1/chat {query, layer?, top_k=8, history}
  → chat_router.py
      ↓
  retrieve_chunks(query, layer)
      ↓
  query_optimizer.py
    ├─ detect_mendix_layer(query)      # auto-detect layer nếu chưa chỉ định
    ├─ rewrite_query(query, attempt=1) # CQR: normalize VN + inject GAR
    ├─ Pinecone Call #1
    │   ├─ Empty + layer → [EMPTY LAYER GUARDRAIL] → return ←─────────────┐
    │   └─ ≥2 chunks → sort_chunks_by_priority() → ─────────────────────┐ │
    ├─ <2 chunks → rewrite_query(attempt=2) # broaden pivot              │ │
    ├─ Pinecone Call #2 (no layer filter)                                 │ │
    │   └─ merge + deduplicate + sort                                     │ │
    └─ <2 chunks → [TOKEN GUARDRAIL] → return ←──────────────────────────┘ │
                                                                            │
  guardrail_msg != None → ChatResponse(answer=guardrail_msg) → Client       │
  guardrail_msg == None ──────────────────────────────────────────────────┘
      ↓
  generate_answer(query, chunks, history)  # chain.py với Mendix rules
      ↓
  ChatResponse {
    answer,
    sources [{file_name, layer, doc_type, score, snippet}],
    retrieve_calls_used: 1|2,
    context_blocks: "╔══ SOURCE ══╗..."
  } → Client
```

### Luồng Sync (Admin) — với Consent Guard

```
Client → POST /api/v1/sync {confirmed: true}
       → Guard: confirmed=false → 403 Forbidden ←─────────────┐
       → confirmed=true                                        │
       → sync_all_documents_task.delay()                      │
       → 202 Accepted {task_id}                                │
         ↓ (Background Celery Worker)                          │
       → loader.py: fetch_project_context_documents()          │
       → Pinecone: delete namespace                            │
       → Batched embed + upsert (20/batch, retry 3x)          │
       → Task complete: {chunks_synced, total_chunks}          │
Client → GET /api/v1/upload-doc/status/{task_id} → status ────┘
```

---

## 🚀 Khởi động nhanh

```bash
#1 Tạo và kích hoạt môi trường ảo Python
python3 -m venv .venv
source .venv/bin/activate

# 2. Cài đặt các thư viện phụ thuộc
pip install -r requirements.txt

# 3. Redis (cho Celery)
docker run -p 6379:6379 redis:7-alpine

# 4. API server
python main.py   # http://localhost:8000

# 6. Swagger UI
# http://localhost:8000/docs
```

### Test nhanh sau khi sync:
```bash
# Sync (yêu cầu confirmed=true)
curl -X POST http://localhost:8000/api/v1/sync \
  -H "Content-Type: application/json" \
  -d '{"confirmed": true}'

# Query với layer filter
curl -X POST http://localhost:8000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "LeaveRequest approval business rules", "layer": "behavior"}'

# Query bằng tiếng Việt (CQR sẽ tự normalize)
curl -X POST http://localhost:8000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "màn hình duyệt nghỉ phép gồm những gì"}'
```

---

## 🌐 API Endpoints

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/health` | Liveness + Pinecone info + max_retrieve_calls=2 |
| `GET` | `/metrics` | Prometheus metrics |
| `POST` | `/api/v1/chat` | RAG Q&A với QOL Pipeline + Mendix rules |
| `POST` | `/api/v1/sync` | [ADMIN] Full re-index (cần `confirmed: true`) |
| `POST` | `/api/v1/upload-doc` | Upload file đơn lẻ |
| `GET` | `/api/v1/upload-doc/status/{id}` | Poll task status |
| `GET` | `/docs` | Swagger UI |

---

## 🏗️ Bảng quyết định thiết kế

| Vấn đề | Quyết định | Nguồn |
|--------|-----------|-------|
| Tối đa 2 retrieve calls | `QueryContext.calls_exhausted` guard trong `retriever.py` | `ai_instruction.md` Phase 2 |
| CQR query rewriting | `rewrite_query_for_retrieval()` heuristic + LLM prompt | `ai_instruction.md` Phase 1 |
| Empty layer → stop | `build_empty_layer_message()` → router short-circuits | `ai_instruction.md` Phase 2 |
| Conflict resolution | `sort_chunks_by_priority()` CR_ > YAML > MD | `ai_instruction.md` Phase 5 |
| STROT introspection | System prompt + `STROT_INTROSPECTION_PROMPT` | `ai_instruction.md` Phase 6 |
| Mendix naming rules | System prompt enforces VAL_/ACT_/SUB_/WFA_ | `ai_instruction.md` Phase 3 |
| Error taxonomy | `ErrorTaxonomyResponse` + `ERROR_TAXONOMY_PROMPT` | `ai_instruction.md` Phase 4 |
| Consent guard sync | `/sync` requires `confirmed: true` | `rag_system.py` + `ai_instruction.md` |
| Rate-limited embed | 1.5s sleep, 3→6→12s retry, 1024-dim truncate | `rag_system.py` CustomGeminiEmbeddings |
| Batch upload | 20 chunks/batch, 5→10s retry | `rag_system.py` sync_mendix_context |
