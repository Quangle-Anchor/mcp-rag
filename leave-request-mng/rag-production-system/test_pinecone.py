from config import get_settings
from pinecone import Pinecone

settings = get_settings()
pc = Pinecone(api_key=settings.pinecone_api_key)
index = pc.Index(settings.pinecone_index_name)
stats = index.describe_index_stats()
print(stats)
