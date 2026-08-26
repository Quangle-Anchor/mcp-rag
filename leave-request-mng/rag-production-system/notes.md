# Overall system
## PDF, PNG
có thể upgrade tool để xử lý ui của bảng thông số phức tạp bằng cách đưa context vào LLM để xử lý sau đó sẽ trả về kết quả định dạng markdown nhằm trực quan hơn trong việc đọc bảng
### Case cầm xem xét
case 1 : input image phong cảnh, không có chữ hoặc màn hình vô nghĩa thì tool tự động bắt ngữ cảnh là phong cảnh và không xử lý gì thêm, chỉ trả về metadata của file. Có thể throw error luôn là "không tìm thấy context".

case 2 : input pdf có bảng thông số phức tạp -> dùng OCR để extract text, nếu xử lý không ra bảng và bị lỗi thì fallback về chế độ chỉ xử lý text. Hoặcthrow lỗi là "không thể xử lý file này".