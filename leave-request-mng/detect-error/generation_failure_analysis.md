# Phân Tích Nguyên Nhân Sinh Code Lỗi (Generation Failure Analysis)

Tại sao AI Agent lại sinh ra các Microflow chứa 14 lỗi như vậy? Lỗi này xuất phát từ bản thân AI Agent (LLM) hay do thiết kế của MCP Tool (`mx-sdk-connect`)? 

Thực tế, nguyên nhân là sự kết hợp của **2 lỗ hổng lớn** từ cả hai phía. Dưới đây là phân tích chi tiết:

---

## 1. Lỗ hổng từ phía Tool `mx-sdk-connect` (Mendix SDK MCP Server)

Tool `mx-sdk-connect` đóng vai trò là cầu nối dịch JSON từ AI thành mã nguồn Mendix. Tuy nhiên, nó đang mắc phải 2 khiếm khuyết lớn trong thiết kế:

### A. Thiếu Strict JSON Schema Validation (Bỏ qua lỗi một cách âm thầm)
*   **Trường hợp:** Lỗi **CE0127** (Missing arguments khi CallMicroflow).
*   **Vấn đề:** Khi AI gửi payload chứa danh sách tham số bằng key `"arguments"`, tool `mx-sdk-connect` đáng lẽ phải báo lỗi *"Key 'arguments' không hợp lệ, hãy dùng 'parameterMappings'"*. Nhưng thay vì vậy, tool lại **âm thầm bỏ qua** (silent drop) cái key lạ đó và vẫn tạo ra một cục Call Microflow rỗng (không có tham số). 
*   **Hậu quả:** Microflow vẫn được commit lên `main`, AI lầm tưởng đã tạo thành công 100%, cho đến khi user mở Studio Pro ra mới thấy báo lỗi CE0127.

### B. Mendix-Validator quá nông (Shallow Validation)
*   **Trường hợp:** Các lỗi XPath (**CE0161**) và lỗi Expression (**CE0117**).
*   **Vấn đề:** Mặc dù tool có các file như `expressionValidator.ts` hay `xpathValidator.ts` (đã quét qua trước khi commit), nhưng các file này chỉ validate ở mức độ **Cú pháp bề mặt (Syntax / Regex)** (ví dụ: cấm dùng hàm lạ như `split()`, cấm dùng hàm XPath `year-from-dateTime` trong expression). 
*   **Điểm mù:** Tool KHÔNG có bộ Type-Checker hay Semantic-Checker. 
    *   Nó không hề biết Entity `PublicHoliday` có cột `ActiveFlag` hay không.
    *   Nó không hề biết biến `$CurrentEmployee` và `$OwnerEmployee` đang lệch Type (System.User vs Employee).
    *   Nó không bắt được lỗi cấm dùng đường dẫn Association ở vế phải XPath.
*   **Hậu quả:** Tool tự tin báo *"Microflow created successfully"* và đẩy toàn bộ mã rác vào project, phó mặc cho Mendix Studio Pro gánh trách nhiệm báo lỗi.

---

## 2. Lỗ hổng từ phía AI Agent (Logic Hallucination & Kiến thức Mendix)

Bản thân AI cũng gặp những hạn chế khi thao tác "mù" (không có giao diện kéo thả IDE):

### A. Tự suy diễn Domain Model (Hallucination)
*   Trong quá trình generate `SUB_CalculateDays`, AI tự cho rằng bảng `PublicHoliday` phải có cột `ActiveFlag` (bởi vì đây là một pattern thiết kế CSDL quá phổ biến trong thực tế). Dù trước đó AI đã đọc cấu trúc Domain Model, nhưng trong lúc code logic, AI lại không check lại kĩ mà viết luôn `$HolidayDate ... and ActiveFlag = true()`.

### B. Lỗ hổng về Ngữ pháp Mendix (Mendix Syntax Quirks)
*   **XPath không giống SQL:** AI áp dụng tư duy viết SQL hoặc OData thông thường vào Mendix XPath (ví dụ: `[LeaveType_LeaveBalance = $LeaveRequest/LeaveManagement.LeaveType_LeaveRequest]`). Mendix có luật rất cứng nhắc: *Vế phải của phép so sánh XPath phải là một giá trị tường minh, không được phép là một Navigation Path.* AI đã vi phạm luật ngầm này.
*   **Mendix Ownership Association:** AI dùng thẳng SDK để map association vào phía `LeaveRequestHistory` mà không kiểm tra xem Parent/Child owner của association đó có cho phép set từ hướng này qua SDK hay không, dẫn tới lỗi **CE0854**.

---

### Tổng kết
Lỗi sinh ra là hệ quả của việc **AI viết code sai luật ngầm của Mendix**, cộng thêm việc **Tool `mx-sdk-connect` quá dễ dãi**, không có cơ chế chặn lỗi chặt chẽ (Schema Strictness & Metamodel Type Checking) mà cứ thế ném thẳng vào project Mendix. 

