## search tên folder docs
hiện tại đang search đúng case "documents" nhưng thực tế có thể là"documents" hoặc "Documents", cần xử lý case insensitive
## cần làm
 RETRIEVAL CHUẨN KHÔNG PHẢI LÀ MỘT CÂU LỆNH SEARCH — NÓ LÀ MỘT PIPELINE
Kiến trúc mình đang chạy trong Mochi Flow, mỗi tầng sinh ra để vá một lỗi có thật:
→ Chunking đúng trước đã. Cắt tài liệu sai là mọi thứ phía sau vô nghĩa. Hợp đồng, slide, báo cáo tài chính - không thể cắt cùng một kiểu. Mình phải làm 6 chiến lược (semantic, parent-child, hierarchical...) tùy loại tài liệu.
→ Hybrid Search, không phải vector thuần. BM25 (keyword) bắt được "NĐ 13", dense vector bắt được ngữ nghĩa, rồi RRF fusion trộn 2 kết quả. Thiếu 1 trong 2 là hụt.
→ Reranking. Top-5 của vector search thường dính 2-3 đoạn lạc đề. Thêm tầng rerank chấm điểm lại trước khi đưa vào prompt — chất lượng câu trả lời nhảy vọt.
→ Query classification. Câu tra cứu, câu so sánh, câu tổng hợp cần chiến lược retrieval khác nhau. Hệ thống phải phân loại intent trước rồi mới đi tìm.
→ Multi-hop reasoning. Câu hỏi phức tạp thì tự động tách thành các sub-query nhỏ, trả lời từng phần rồi tổng hợp.
→ Self-reflection. Retrieval kém thì AI phải tự viết lại query và tìm lại, không được trả lời liều.
→ Grounding verification. Tầng cuối: dùng model NLI kiểm tra từng câu AI trả lời có thật sự nằm trong tài liệu không, tô màu độ tin cậy cho user thấy.
Bài học: 80% chất lượng RAG nằm ở ingestion + retrieval, không phải ở model. Đổi lên model xịn hơn không cứu được dữ liệu đầu vào tồi. Garbage in - confident garbage out.

￼
 CHỌN MODEL: KHÔNG CÓ "MODEL TỐT NHẤT" - CHỈ CÓ MODEL ĐÚNG VIỆC CHO TỪNG TẦNG
Sai lầm phổ biến: nghĩ RAG = 1 con LLM to. Thực tế một câu hỏi trong Mochi Flow đi qua 4-5 model khác nhau, mỗi tầng một con chuyên dụng:
→ Embedding: model local qua Ollama hoặc embedding API của cloud provider - tùy chế độ triển khai. Bài học đắt giá nhất: đổi embedding model giữa chừng = re-index lại toàn bộ kho tài liệu (vector dimension khác nhau là không query được). Chọn kỹ từ đầu, đây là quyết định khó đảo ngược nhất trong cả kiến trúc.
→ Reranking - chạy 2 tầng để tiết kiệm: tầng lọc thô dùng bi-encoder multilingual nhỏ (MiniLM) quét nhanh hàng trăm ứng viên, tầng tinh mới dùng cross-encoder (Qwen3-Reranker 0.6B) chấm kỹ top còn lại. Cross-encoder chính xác nhưng chậm - cho nó chấm cả trăm đoạn là user ngồi đợi mòn mỏi.
→ Grounding (NLI): mình chọn mDeBERTa-v3 multilingual - không phải vì nó "xịn nhất", mà vì nó là model hiếm hoi có số đo cụ thể trên tiếng Việt và rất nhẹ, chạy local thoải mái. Và vẫn đang tìm model xịn hơn thay thế.
→ Generation (LLM): tầng DUY NHẤT cần model to - và phải hot-swap được: dữ liệu mật chạy LLM local qua Ollama, việc thường gọi cloud (Gemini/GPT/Claude) cho nhanh. User không cần biết, hệ thống tự route.
→ OCR/Vision: pool 2 chế độ như phần 1.
Nguyên tắc rút ra: model nhỏ chuyên dụng ở mọi tầng giữa, model to chỉ đứng ở tầng cuối. Tầng nào cũng gọi LLM to thì mỗi câu hỏi vừa chậm vừa đốt tiền gấp 10 - mà chất lượng không hơn.
VÀ NỖI ĐAU MANG TÊN TIẾNG VIỆT 
Mọi benchmark bạn đọc trên mạng đều đo bằng tiếng Anh. Đem về chạy tiếng Việt là lộ ra ngay:
→ BM25 mặc định tách từ theo khoảng trắng - với tiếng Anh thì ổn, nhưng tiếng Việt "khách hàng", "học máy" là MỘT từ gồm hai âm tiết. Tách rời ra là ra nghĩa khác, ranking sai hết. Mình phải thêm tầng word segmentation (underthesea, fallback sang pyvi) trước khi cho BM25 chạy.
→ Model nào cũng phải hỏi lại một câu: "có multilingual không, và có SỐ ĐO trên tiếng Việt không?" Embedding, reranker, NLI - mỗi lựa chọn trong Mochi Flow đều lọc qua câu hỏi đó. Thậm chí reranker mình để config được: corpus thuần Việt thì swap sang model reranker chuyên tiếng Việt.
→ OCR tiếng Việt có dấu - như phần 1, Qwen OCR, VietOCR và Vision model đã cứu.
Bài học: stack RAG chuẩn quốc tế chưa chắc chạy tốt ở Việt Nam. Tiếng Việt không khó - nhưng nó hay bị bỏ quên.


 RAG KHÔNG CHỈ LÀ "AI SEARCH TÀI LIỆU"
Trả lời câu hỏi mới là mức 1. Mức 2 là Agentic RAG: gắn kho tri thức vào AI Agent.
Agent kiểu ReAct tự lập kế hoạch: câu này cần tìm ở collection nào, cần search mấy vòng, thiếu dữ liệu thì gọi tool gì. Trong Mochi Flow, mình gắn RAG vào workflow engine — và lúc đó tri thức bắt đầu hành động:
* Đọc tài liệu → tự sinh báo cáo, slides mindmap, quiz
* 
* Nhận câu hỏi từ Telegram/Slack/Zalo → tra kho tri thức → trả lời khách kèm nguồn
* 
* Hành động rủi ro (gửi mail, cam kết với khách) → dừng lại chờ người duyệt (human-in-the-loop)
* 
Search là tính năng. Agent + tri thức + quy trình mới là giải pháp.
