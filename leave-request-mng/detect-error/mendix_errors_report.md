# Báo cáo Lỗi Mendix (Mendix Errors Report)

Dưới đây là danh sách chi tiết và phân tích nguyên nhân gốc rễ cho 14 lỗi hiển thị trên Mendix Studio Pro (như trong ảnh chụp):

## 1. Module `SUB_CalculateDays`
*   **Lỗi 5 (CE0161): Error(s) in XPath constraint.**
    *   **Vị trí:** `Retrieve object(s) activity 'Retrieve...'`
    *   **Nguyên nhân:** XPath dùng để query bảng `PublicHoliday` chứa kiểm tra `ActiveFlag = true()`, nhưng Entity `PublicHoliday` trong Domain Model thực tế không có thuộc tính này (chỉ có thuộc tính `RecurringFlag`). Việc query một cột không tồn tại sẽ gây lỗi XPath.

## 2. Module `ACT_LeaveRequest_Approve`
*   **Lỗi 21 (CE0117): Error(s) in expression.**
    *   **Vị trí:** `Decision 'Is Self-Approve?'`
    *   **Nguyên nhân:** Biểu thức `$CurrentEmployee = $OwnerEmployee` so sánh trực tiếp hai Object bằng toán tử `=`. Lỗi này xảy ra do `$CurrentEmployee` lấy từ biến hệ thống `[%CurrentUser%]` nên type gốc là `System.User`, trong khi `$OwnerEmployee` lấy từ Association nên là type `LeaveManagement.Employee`. Khác type nên Mendix báo lỗi expression.
*   **Lỗi 22 (CE0161): Error(s) in XPath constraint.**
    *   **Vị trí:** `Retrieve object(s) activity 'Get Leave Balance'`
    *   **Nguyên nhân:** Biểu thức XPath có chứa `$LeaveRequest/LeaveManagement.LeaveType_LeaveRequest` ở vế bên phải của toán tử `=`. Mendix XPath KHÔNG cho phép tính toán đường dẫn qua Association ở vế phải.
*   **Lỗi 23 (CE0854): Association 'LeaveManagement.LeaveRequest_History' is not reachable from entity 'LeaveManagement.LeaveRequestHistory'.**
    *   **Vị trí:** `Member 'LeaveManagement.LeaveRequest_History'`
    *   **Nguyên nhân:** Khi tạo object mới (`CreateObject`), việc set trực tiếp một association từ Child (Many) lên Parent (One) bị Mendix chặn do Association Name không có hướng tương thích (Owner direction) để cập nhật thông qua SDK.

## 3. Module `ACT_LeaveRequest_Submit`
*   **Lỗi 24, 25, 26 (CE0127): Missing argument for parameter...**
    *   **Vị trí:** `Call microflow activity 'Call SUB_CalculateDays'`
    *   **Nguyên nhân:** Tool gọi SDK khi sinh file JSON đã cấu hình các biến truyền vào (như StartDate, EndDate, IsHalfDay) dưới key `arguments`. Tuy nhiên schema chuẩn của Mendix SDK yêu cầu key khác (ví dụ: `parameterMappings`). Hậu quả là SDK đã lờ đi mảng biến này, làm cho cục Call Microflow bị rỗng tham số.
*   **Lỗi 27 (CE0115): The arguments that are passed to microflow 'LeaveManagement.VAL_LeaveRequest' do not match the expected parameters...**
    *   **Vị trí:** `Call microflow activity 'Call VAL_LeaveRequest'`
    *   **Nguyên nhân:** Cùng lý do với CE0127, payload định nghĩa biến bị lờ đi nên không match với input đầu vào của `VAL_LeaveRequest`.
*   **Lỗi 28 (CE0136): Retrieve object must specify the 'Entity' property.**
    *   **Vị trí:** `Retrieve object(s) activity`
    *   **Nguyên nhân:** Activity Retrieve Database thiếu property khai báo tên Entity (`entityQualifiedName`).
*   **Lỗi 29 (CE0019): Variable used as start point must be of type 'Object'.**
    *   **Vị trí:** `Retrieve object(s) activity` (Retrieve qua Association)
    *   **Nguyên nhân:** Điểm neo để thực hiện query (Start Variable) có thể đã bị lờ đi hoặc các activity sinh lỗi phía trên làm đứt gãy luồng, biến bị null hoặc không được khai báo đúng kiểu Object.
*   **Lỗi 30 (CE0854): Association 'LeaveManagement.LeaveRequest_History' is not reachable...**
    *   **Vị trí:** `Member 'LeaveManagement.LeaveRequest_History'`
    *   **Nguyên nhân:** Tương tự lỗi 23. Do cấu hình chiều (Direction) của CreateObject không đúng với Owner của association.

## 4. Module `VAL_LeaveRequest`
*   **Lỗi 40 (CE0117): Error(s) in expression.**
    *   **Vị trí:** `Decision '$LeaveType/RequiresAttachmentOver2D'`
    *   **Nguyên nhân:** Việc lấy `$LeaveType` thông qua Retrieve Association trước đó bị lỗi cú pháp, khiến biến `$LeaveType` không hợp lệ, dẫn đến biểu thức Decision phía dưới bị báo lỗi dây chuyền.
*   **Lỗi 41, 42 (CE0161): Error(s) in XPath constraint.**
    *   **Vị trí:** `Retrieve object(s) activity`
    *   **Nguyên nhân:** Lỗi khi truy vấn Overlaps/Balance bằng XPath do dùng `id != $LeaveRequest` hoặc dùng Association path sai quy chuẩn ở vế phải dấu `=`.
