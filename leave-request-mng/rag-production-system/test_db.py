from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams

# 1. Khởi tạo model biến chữ thành vector (chạy offline trên máy)
print("Đang tải model embedding...")
embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"  # Model này siêu nhẹ, tầm 80MB
)

# 2. Kết nối tới Qdrant bạn vừa bật bằng Docker
client = QdrantClient(url="http://localhost:6333")
collection_name = "test_collection"

# 3. Tạo bảng (collection) nếu chưa có
if not client.collection_exists(collection_name):
    client.create_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(size=384, distance=Distance.COSINE),
    )
    print("Đã tạo bảng lưu trữ mới!")

# 4. Gắn kết nối vào LangChain
vector_store = QdrantVectorStore(
    client=client,
    collection_name=collection_name,
    embedding=embeddings,
)

# 5. Thêm 3 câu mẫu vào DB
texts = [
    "Hôm nay trời nhiều mây và có thể có mưa rào vào buổi chiều.",
    "Docker giúp đóng gói ứng dụng chạy đồng nhất trên mọi máy tính.",
    "Mèo là loài động vật thích ngủ nhiều và leo trèo."
]
print("Đang lưu dữ liệu vào Qdrant...")
vector_store.add_texts(texts)
print("Lưu thành công!")