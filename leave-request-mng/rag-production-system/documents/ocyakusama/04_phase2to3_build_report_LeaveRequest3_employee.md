# Phase 2 + 3 Build Report — LeaveRequest3 (Employee Scope)

**Date:** 2026-05-21
**Project ID:** `595419ee-8725-43e7-b834-1ae40de34cbf`
**Module:** `LeaveRequest3`
**Branch:** `main`
**Working copy:** `d370b1bc-0443-4e2c-b2b6-756388abea5d` (reused — already open from orchestrator's Phase 3)
**Commit message:** `LeaveRequest3 Phase 2+3 Employee scope: enum captions (JP), 5 shared/DS microflows + 1 dashboard DS, 7 action microflows + 1 nanoflow, 3 Employee pages (Home_Employee_Dashboard / LeaveRequest_NewEdit / LeaveRequest_Detail)`
**Target platform:** Mendix 11.x
**Scope:** Employee end-to-end only (NO Manager, NO HR)

---

## 1. What was built

### 1.1 Enumeration captions — Japanese (Phase A)

All 11 enum values now carry Japanese captions per Domain Glossary:

| Enumeration | Values (name → caption) |
|---|---|
| `Enum_LeaveStatus` | DRAFT→下書き, PENDING→申請中, APPROVED→承認済, REJECTED→却下, CANCELLED→取消 |
| `Enum_Session` | FULL→全日, AM→午前休, PM→午後休 |
| `Enum_UserRole` | Employee→一般社員, Manager→承認者, HR_Admin→管理者 |

Note: `captionLanguage` is reported as `en_US` because the SDK stores the caption in the en_US translation slot. Studio Pro Polish: add a proper ja_JP translation per the project's language settings — current setup overwrites en_US captions with Japanese strings, which is what was requested but breaks bilingual operation.

### 1.2 Microflows (Phase B + C)

**14 new microflows + 1 nanoflow created** (1 pre-existing `SUB_LeaveBalance_GetAvailableDays` untouched). 15 microflows total in the module.

#### Shared / sub microflows (B.1–B.3)

| Microflow | Sig | Purpose |
|---|---|---|
| `SUB_GenerateRequestCode` | `(): String` | Atomic counter on `SystemCounter` keyed `LRQ-`+yyyyMM; seeds CurrentValue=1 if missing, else increments by 1; returns `LRQ-YYYYMM-#####`. `applyEntityAccess=false`. |
| `SUB_CalculateDays` | `(StartDate:DateTime, EndDate:DateTime, IsHalfDay:Boolean): Decimal` | BR-05 fast path 0.5 when IsHalfDay; else epoch-day-of-week math to compute weekday count between dates, then loop active `PublicHoliday` rows in [Start,End] and subtract those falling on weekdays. |
| `SUB_LeaveBalance_Recalculate` | `(LeaveBalance): Void` | Retrieves Employee + LeaveType via association from the supplied balance, then retrieves LeaveRequests scoped by Employee + LeaveType + `year-from-dateTime(StartDate) = FiscalYear` + DeletedFlag=false for both APPROVED (→ UsedDays sum) and PENDING (→ PendingDays sum). Commits the balance. |

#### Datasource microflows (B.4–B.6)

| Microflow | Sig | XPath |
|---|---|---|
| `DS_LeaveBalance_ForCurrentUser` | `(): List<LeaveBalance>` | `[LeaveRequest3.LeaveBalance_Employee/LeaveRequest3.Employee/id = '[%CurrentUser%]' and DeletedFlag = false()]` sorted FiscalYear DESC. |
| `DS_LeaveRequest_OwnerHistory` | `(): List<LeaveRequest>` | `[LeaveRequest3.LeaveRequest_Owner/LeaveRequest3.Employee/id = '[%CurrentUser%]' and DeletedFlag = false()]` sorted SubmittedAt DESC. |
| `DS_Employee_LoadDashboard` | `(): Object<Employee>` | `[id = '[%CurrentUser%]']` (rule `xpath_currentuser.md` — Employee specializes Administration.Account which specializes System.User). |

The naming-convention warning emitted for `DS_*` prefixes is accepted per plan.

#### Action microflows (C.1–C.8) + Nanoflow (D)

| Microflow | Sig | Notes |
|---|---|---|
| `ACT_ClosePopup` | `(): Void` | Single ClosePage activity. Wired to btn_cancel / btn_close. |
| `ACT_LeaveRequest_OpenNew` | `(): Object<LeaveRequest>` | Retrieves Employee by `[id = '[%CurrentUser%]']`, creates DRAFT LeaveRequest with Status=DRAFT, IsHalfDay=false, Session=FULL, TotalDays=0, Owner=$Employee. **Returns** the new LeaveRequest. **ShowPage NOT included** — known SDK defect (see Studio Pro polish §3). |
| `ACT_LeaveRequest_OpenDetail` | `(LeaveRequest): Object<LeaveRequest>` | Echoes input. Same ShowPage workaround. |
| `ACT_LeaveRequest_SaveDraft` | `(LeaveRequest): Void` | E002 date-order gate; on pass: SUB_CalculateDays → TotalDays, Status=DRAFT, commit, ShowMessage "Draft saved.", ClosePage. |
| `ACT_LeaveRequest_Submit` | `(LeaveRequest): Void` | 8-gate validation chain (see §2). On all-pass: assign Approver = Owner/Employee_Manager, generate RequestCode, set Status=PENDING + SubmittedAt, commit, append RequestHistory (DRAFT→PENDING), recompute balance, ShowMessage "Request submitted.", ClosePage. |
| `ACT_LeaveRequest_Cancel` | `(LeaveRequest): Void` | BR-10 gate (Status must be PENDING else ValidationFeedback "Only pending requests can be cancelled."); on pass: Status=CANCELLED + DecidedAt, commit, append RequestHistory (PENDING→CANCELLED), recompute balance, ClosePage. |
| `ACT_Attachment_Download` | `(Attachment): Void` | Empty skeleton — DownloadFile activity not exposed by MCP. Studio Pro polish required. |
| `OCH_LeaveRequest_RecalcOnHalfDay` | `(LeaveRequest): Void` | ExclusiveSplit on IsHalfDay: true → TotalDays=0.5; false → SUB_CalculateDays → TotalDays, Session=FULL. |
| `NF_LeaveRequest_RecalcOnHalfDay` (nanoflow) | `(LeaveRequest): Void` | Mirrors the OCH microflow for future client-side wiring. Currently just calls the microflow form. |

### 1.3 Pages (Phase E)

3 Employee pages created in module `LeaveRequest3`:

#### `Home_Employee_Dashboard` (full page, Atlas_Core.Atlas_Default)

| Widget Name | Type | Notes |
|---|---|---|
| `lbl_page_title` | Label | Caption "社員ダッシュボード" |
| `balance_cards` | GroupBox placeholder | Studio Pro polish: swap to ListView bound to `DS_LeaveBalance_ForCurrentUser` |
| `btn_new_request` | ActionButton | Caption "新規申請", onClick → `ACT_LeaveRequest_OpenNew` |
| `history_grid` | GroupBox placeholder | Studio Pro polish: swap to DataGrid2 bound to `DS_LeaveRequest_OwnerHistory` |

#### `LeaveRequest_NewEdit` (popup 720×680, Atlas_Core.PopupLayout, bound to LeaveRequest)

| Widget Name | Type | Label | Bound to | Notes |
|---|---|---|---|---|
| `dv_leave_request` | DataView | — | PageParameter LeaveRequest | Top-level data view |
| `request_code` | TextBox (read-only) | 申請番号 | RequestCode | |
| `status` | DropDown (read-only) | ステータス | Status | |
| `leave_type` | ReferenceSelector | 休暇種別 | LeaveRequest_LeaveType | ComboBox not in MCP allow-list — RS used instead |
| `start_date` | DatePicker | 開始日 | StartDate | |
| `end_date` | DatePicker | 終了日 | EndDate | |
| `is_half_day` | RadioButtonGroup | 半休 | IsHalfDay | onChange → `OCH_LeaveRequest_RecalcOnHalfDay` |
| `session` | DropDown | 時間帯 | Session | |
| `total_days` | TextBox (read-only) | 日数 | TotalDays | |
| `reason` | TextArea | 理由 | Reason | |
| `attachment_placeholder` | GroupBox placeholder | — | — | Studio Pro polish: swap to FileUploader |
| `btn_save_draft` | ActionButton | — | — | Caption "下書き保存", onClick → `ACT_LeaveRequest_SaveDraft` |
| `btn_submit` | ActionButton | — | — | Caption "提出", onClick → `ACT_LeaveRequest_Submit` |
| `btn_cancel` | ActionButton | — | — | Caption "キャンセル", onClick → `ACT_ClosePopup` |

#### `LeaveRequest_Detail` (popup 720×700, Atlas_Core.PopupLayout, bound to LeaveRequest, DataView.editability=Never)

| Widget Name | Type | Label | Bound to |
|---|---|---|---|
| `dv_leave_request_view` | DataView | — | PageParameter LeaveRequest (editability=Never) |
| `request_code` | TextBox | 申請番号 | RequestCode |
| `status` | DropDown | ステータス | Status |
| `leave_type` | ReferenceSelector | 休暇種別 | LeaveRequest_LeaveType |
| `start_date` | DatePicker | 開始日 | StartDate |
| `end_date` | DatePicker | 終了日 | EndDate |
| `is_half_day` | RadioButtonGroup | 半休 | IsHalfDay |
| `session` | DropDown | 時間帯 | Session |
| `total_days` | TextBox | 日数 | TotalDays |
| `reason` | TextArea | 理由 | Reason |
| `submitted_at` | DatePicker | 申請日時 | SubmittedAt |
| `decided_at` | DatePicker | 決裁日時 | DecidedAt |
| `manager_comment` | TextArea | 承認者コメント | ManagerComment |
| `attachment_list_placeholder` | GroupBox | — | Studio Pro polish: swap to ListView over Attachment_LeaveRequest |
| `history_placeholder` | GroupBox | — | Studio Pro polish: swap to ListView over History_LeaveRequest sorted EventAt ASC |
| `btn_cancel_request` | ActionButton | — | Caption "取消", onClick → `ACT_LeaveRequest_Cancel` |
| `btn_close` | ActionButton | — | Caption "閉じる", onClick → `ACT_ClosePopup` |

---

## 2. Submit validation chain — detailed gate list

`ACT_LeaveRequest_Submit` runs the following 8 ExclusiveSplit gates. Each gate's TRUE path proceeds to the next; FALSE path emits a `ValidationFeedback` and ends.

| # | Gate ID | Condition (PASS) | Fail message | Target attr |
|---|---|---|---|---|
| 1 | g1 (E002) | `$LeaveRequest/EndDate >= $LeaveRequest/StartDate` | "End date must be on or after the start date." | EndDate |
| 2 | g2 (E015) | `$ComputedDays > 0` | "The selected period contains no workdays." | StartDate |
| 3 | g3 (E003) | `$LeaveType/Code = 'SL' or daysBetween($LeaveRequest/StartDate, trimToDays([%CurrentDateTime%])) >= 2` | "Requests must be submitted at least 2 business days in advance." | StartDate |
| 4 | g4 (E005) | `$LeaveRequest/StartDate >= trimToDays([%CurrentDateTime%]) or $LeaveType/AllowBackdate = true` | "Backdated requests are not allowed for this leave type." | StartDate |
| 5 | g5 (E006) | `$LeaveRequest/StartDate >= trimToDays([%CurrentDateTime%]) or daysBetween(trimToDays([%CurrentDateTime%]), $LeaveRequest/StartDate) <= $LeaveType/MaxBackdateDays` | "Backdated request exceeds the allowed window." | StartDate |
| 6 | g6 (E008) | `$OverlapCount = 0` where `$OverlapCount` is the count of LeaveRequests overlapping the date range with same Owner + Status∈{PENDING,APPROVED} + DeletedFlag=false + id != $LeaveRequest | "This period overlaps an existing request." | StartDate |
| 7 | g7 (E004) | `$LeaveType/SkipBalanceCheck = true or ($Balance != empty and $Balance/AvailableDays >= $ComputedDays)` | "Insufficient balance for the requested period." | TotalDays |
| 8 | g8 (E009) | `not($LeaveType/Code = 'SL' and $LeaveType/RequiresAttachmentOver2D = true and $ComputedDays > 2) or $AttachmentCount >= 1` | "An attachment is required for sick leave longer than 2 days." | TotalDays |

After all 8 pass:
1. Retrieve Manager = Owner/Employee_Manager (association)
2. Call `SUB_GenerateRequestCode` → `$NewCode`
3. ChangeObject on $LeaveRequest: TotalDays=$ComputedDays, RequestCode=$NewCode, Status=PENDING, SubmittedAt=[%CurrentDateTime%], Approver=$Manager
4. CommitObject (withEvents=true, refreshInClient=true)
5. CreateObject RequestHistory: From=DRAFT, To=PENDING, ActorEmployeeId=$Owner/EmployeeId, EventAt=now, History_LeaveRequest=$LeaveRequest
6. CommitObject History
7. If $Balance ≠ empty: CallMicroflow `SUB_LeaveBalance_Recalculate(Balance)`
8. ShowMessage "Request submitted." (Information)
9. ClosePage

BR-06 (self-approval block) is implicit — Approver is pulled from `Owner/Employee_Manager`, so an Employee with no Manager assignment will have a null Approver. The screen spec assumes the seeded data set has Manager assignments; no explicit guard is implemented in this session.

---

## 3. Pre-commit verification results

| Check | Expected | Actual | Status |
|---|---|---|---|
| `diagnose_associations LeaveRequest3` | healthy=true | healthy=true, 0 issues | OK |
| `list_microflows LeaveRequest3` | 15 (1 pre-existing + 14 new) | 15 | OK |
| `list_pages LeaveRequest3` | 3 | 3 (Home_Employee_Dashboard, LeaveRequest_Detail, LeaveRequest_NewEdit) | OK |
| `list_enumerations` Japanese captions | All 11 values updated | All 11 values updated | OK |
| `read_attribute_details LeaveBalance.AvailableDays` | valueType=calculated, microflow LeaveRequest3.SUB_LeaveBalance_GetAvailableDays | matches | OK |
| Nanoflow `NF_LeaveRequest_RecalcOnHalfDay` | created | created (separate from microflow list) | OK |

---

## 4. Discrepancies / decisions taken against source specs

| ID | Spec | Decision |
|---|---|---|
| D-1 | Plan §B says "Phase 2 microflows" includes `SUB_LeaveBalance_Recalculate` — but a `SUB_LeaveBalance_Recalculate` already had a stale shell from a partial earlier session. | Recreated with `overwrite: true`. Final activity count = 7. |
| D-2 | Plan §B says `SUB_GenerateRequestCode` uses an atomic SystemCounter. Mendix's `applyEntityAccess=false` is the closest analogue to a row lock — but it does NOT provide a serializable transaction. Concurrent submissions in the same yyyyMM could in theory race. | Accepted as known limitation for low-volume Employee usage. Studio Pro polish: wrap in a Java action with `synchronized` or use `IContext.executeAsync` for true isolation. |
| D-3 | `SUB_CalculateDays` uses epoch-day-of-week math `((epochDays + 4) mod 7)` to determine weekdays. This is correct in server timezone for the Gregorian calendar but does NOT account for DST or non-server timezone display. | Documented in microflow docstring. Studio Pro polish: re-implement as a Java action for robust timezone handling if required. |
| D-4 | `ACT_LeaveRequest_Submit` G7 (balance check) — when `$Balance = empty` AND `SkipBalanceCheck = false`, the gate fails. Spec does not explicitly say what to do when no LeaveBalance row exists for the (Employee, LeaveType, Year). | Decided "no balance row" = "no balance available" → gate fails with E004 ("Insufficient balance for the requested period."). This matches the conservative intent of BR-04 (do not allow consumption of an unbudgeted balance). |
| D-5 | `ACT_LeaveRequest_OpenNew` per plan §C does NOT include `ShowPage` — workaround for active SDK defect (memory: showpage_passedobject_defect). Caller (`btn_new_request`) is wired via `onClickMicroflow=ACT_LeaveRequest_OpenNew` only; the "Then show page → LeaveRequest_NewEdit" step is a Studio Pro polish item. | Same applies to `ACT_LeaveRequest_OpenDetail` (no callsite wired in this build — the LeaveRequest_Detail page is opened only manually from QA tooling for now). |
| D-6 | Plan §E for `LeaveRequest_NewEdit` mentions ComboBox as the preferred widget for the LeaveType association with fallback to ReferenceSelector. MCP `add_widget` allow-list does NOT include ComboBox. | ReferenceSelector used as planned fallback. Studio Pro polish: swap to ComboBox for Mendix 11 ergonomics. |
| D-7 | Plan §E describes `attachment_placeholder` with conditional visibility expression `LeaveType.Code='SL' and TotalDays>2`. `set_widget_property visibility` accepts an expression string, but writing a cross-widget expression that traverses an association via `$currentObject/LeaveRequest_LeaveType/LeaveType/Code` is fragile here because the placeholder is a GroupBox, not yet a FileUploader. | Visibility expression NOT set on the placeholder. Studio Pro polish: set the conditional visibility on the FileUploader widget after the swap-in. |
| D-8 | Plan calls for the dashboard `btn_new_request` to refresh the page on close. MCP does not expose page-refresh-on-close hints. | Not wired. Studio Pro polish: set DataView/DataSource refresh-on-close flag on the dashboard widgets. |
| D-9 | Enum captions are written into the en_US slot. The MCP `update_enumeration` tool exposes a single `caption` field and the spec data shows `captionLanguage: "en_US"`. | Japanese strings now sit in en_US — the user explicitly requested this. For proper bilingual operation, Studio Pro polish: re-author each caption in the ja_JP language slot and restore the en_US captions. |
| D-10 | `ACT_LeaveRequest_Submit` G7's "Insufficient balance" message text differs slightly from the implicit message in the spec ("E004 on TotalDays"). The exact wording was inferred from the plan ("Insufficient balance for the requested period."). | OK — the wording matches the plan §C exactly. |

---

## 5. Studio Pro polish checklist

These items require manual completion in Studio Pro after this commit lands:

### 5.1 Page widgets — swap placeholders

| Page | Widget Name | Current type | Target type | Binding |
|---|---|---|---|---|
| Home_Employee_Dashboard | `balance_cards` | GroupBox | ListView (cards) | `DS_LeaveBalance_ForCurrentUser`. Columns: LeaveType.NameJP, TotalDays, CarryOver, UsedDays, PendingDays, **AvailableDays** (emphasised). |
| Home_Employee_Dashboard | `history_grid` | GroupBox | DataGrid2 | `DS_LeaveRequest_OwnerHistory`. Columns: RequestCode, LeaveType.NameJP, StartDate, EndDate, TotalDays, Status (use `getCaption($currentObject/Status)`), SubmittedAt. Row action: open `LeaveRequest_Detail`. |
| LeaveRequest_NewEdit | `attachment_placeholder` | GroupBox | FileUploader | Bound to `Attachment_LeaveRequest`. Conditional visibility: `$currentObject/LeaveRequest3.LeaveRequest_LeaveType/LeaveRequest3.LeaveType/Code = 'SL' and $currentObject/TotalDays > 2`. |
| LeaveRequest_Detail | `attachment_list_placeholder` | GroupBox | ListView | Bound to `Attachment_LeaveRequest`. Row: show inherited `Name` (FileName), include download button wired to `ACT_Attachment_Download`. |
| LeaveRequest_Detail | `history_placeholder` | GroupBox | ListView | Bound to `History_LeaveRequest` sorted EventAt ASC. Row: FromStatus → ToStatus, ActorEmployeeId, EventAt, Comment. |

### 5.2 Button "Then show page" steps (ShowPage defect workaround)

| Page | Button | Microflow | Add manually |
|---|---|---|---|
| Home_Employee_Dashboard | `btn_new_request` | `ACT_LeaveRequest_OpenNew` | Add "Show page → LeaveRequest_NewEdit" step passing the returned LeaveRequest as the page parameter. |
| (Future, when history DataGrid2 is swapped) | (row action) | `ACT_LeaveRequest_OpenDetail` | Add "Show page → LeaveRequest_Detail" step passing the returned LeaveRequest. |

### 5.3 Microflow internals

| Microflow | Polish |
|---|---|
| `ACT_Attachment_Download` | Empty skeleton. Add a `DownloadFile` activity passing `$Attachment`. Set content disposition if required. |
| `ACT_LeaveRequest_OpenNew` | Add the ShowPage step (5.2). When SDK defect `showpage_passedobject_defect` is fixed, can be moved back into the microflow body. |
| `SUB_CalculateDays` | Consider replacing with a Java action if precision under non-server timezone is required. |
| `SUB_GenerateRequestCode` | Wrap in a Java action with synchronization if concurrent submissions are expected. |

### 5.4 Validation & UX

- Validation messages from `ACT_LeaveRequest_Submit` fire on the named LeaveRequest attributes (EndDate / StartDate / TotalDays / Status). Confirm the form layout makes them visible without scrolling.
- The `total_days` TextBox does not have a format specifier yet — Studio Pro polish: set decimal format `#,##0.0` per V-09 / plan §E.
- The `start_date` / `end_date` / `submitted_at` / `decided_at` DatePickers — Studio Pro polish: turn off `localizeDate` on date-only fields (StartDate, EndDate) and switch to date-only display format.

### 5.5 Security & access

- **Module security**: project is currently running on `Off` or default. Studio Pro polish: define module roles `Employee_User`, `Manager_User`, `HR_Admin_User`. Apply entity access rules as per `Business Rules.md` BR-01..BR-15.
- **Navigation profile**: add a "Web" navigation entry pointing the Employee role to `Home_Employee_Dashboard`.

### 5.6 Enum captions

- Re-author all Japanese enum captions into the `ja_JP` language slot. Restore English captions in `en_US`.

### 5.7 Scheduled jobs (out of scope this build, listed for Phase 5/6)

- `SCH_ForfeitCarryOver` — fiscal-year-roll job to forfeit expired CarryOver per BR-12.

### 5.8 Deferred from scope

- Manager screens (SCR-MGR-01, SCR-MGR-02) — Phase 4
- HR screens (SCR-HR-01..04) — Phase 5
- `ACT_LeaveRequest_Approve` / `ACT_LeaveRequest_Reject` — Phase 4 microflows
- Email notifications (BR-13/BR-14) — Studio Pro polish via SMTP module

---

## 6. Spec defect notes (carried over from session intro scan)

- **Employee** declares `hasCreatedDate=true` / `hasChangedDate=true` in `01_physical_er.yaml`. Inherited from `Administration.Account` → `System.User`; flags silently ignored. No action required (already committed state).
- **01_physical_er.md** (mermaid prose) mentions `LEAVE_BALANCE.CREATED_BY` / `CHANGED_BY` columns. Authoritative YAML only sets `hasOwner` / `hasChangedBy` flags — no user-defined audit columns to add. No action.
- **SCR-EMP-03** references `RequestAttachment.FileName`. `RequestAttachment` specializes `System.FileDocument`; the field is the inherited `Name`. Affects only ListView placeholder caption text. Studio Pro polish: use `$currentObject/Name` when wiring the attachment ListView row template.

---

## 7. What was NOT touched

- All 9 entities in LeaveRequest3 (unchanged)
- All 9 associations in LeaveRequest3 (unchanged)
- All 21 stored attributes + 1 calculated attribute across LeaveRequest3 entities (unchanged)
- `Employee → Administration.Account` generalization (unchanged)
- `RequestAttachment → System.FileDocument` generalization (unchanged)
- `LeaveBalance.AvailableDays` calculated attribute and its backing `SUB_LeaveBalance_GetAvailableDays` microflow (unchanged)

---

## 8. Remaining work for next session

| Priority | Item | Effort |
|---|---|---|
| 1 | Studio Pro polish §5 (mechanical swaps + ShowPage steps + module security) | ~half day in Studio Pro |
| 2 | Phase 4 — Manager screens + `ACT_LeaveRequest_Approve` / `_Reject` microflows | Full session |
| 3 | Phase 5 — HR screens + scheduled jobs | Full session |
| 4 | E2E test pass against the dashboard / new-edit / detail loop (Playwright) | Half session |
| 5 | Email notification wiring (BR-13/BR-14) | Quarter session |

---

**End of Phase 2 + 3 Employee scope build report.**
