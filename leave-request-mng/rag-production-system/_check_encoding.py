with open(r'c:\Users\quang\Downloads\mcp-rag 1\mcp-rag\mcp-rag\leave-request-mng\project-documents\outputs\Inputs\Business Rules.md', 'rb') as f:
    data = f.read(50)
    print("BYTES:", data)
    
import chardet
print("DETECTED:", chardet.detect(data))
