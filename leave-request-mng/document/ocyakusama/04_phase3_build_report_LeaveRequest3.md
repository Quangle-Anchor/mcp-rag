# Phase 3 Build Report — LeaveRequest3 Employee Scope (Retry)

**Project**: `595419ee-8725-43e7-b834-1ae40de34cbf`
**Module**: `LeaveRequest3`
**Branch**: `main`
**Mendix target**: 11.x
**Date**: 2026-05-21
**Scope executed**: Phase 3 Employee (3 pages, 9 microflows, 1 nanoflow). Phase 1 (security/nav) and Phase 4/5 (Manager / HR) remain out of scope.

## 1. Context

This is a retry of the 2026-05-20 attempt that lost its commit when `set_calculated_attribute` corrupted the working copy. The maintainer has since confirmed the defect fix; end-to-end verification done earlier in this session converted `LeaveBalance.AvailableDays` to a calculated attribute backed by `SUB_LeaveBalance_GetAvailableDays` and committed cleanly. This Phase 3 build now lands on top of that state.

Domain model was not modified in this build — it was already complete and `AvailableDays` already calculated.

## 2. What was built

### 2.1 Microflows (9 new in this commit)

| Microflow | Signature | Purpose |
|---|---|---|
| `ACT_ClosePopup` | `(): Void` | Single `ClosePage` activity. Wired to Cancel / Close buttons across EMP-02 and EMP-03. |
| `SUB_LeaveBalance_Recalculate` | `(LeaveBalance: Object): Void` | Recomputes `UsedDays` (sum of APPROVED) and `PendingDays` (sum of PENDING) for the balance. XPath scopes by `LeaveRequest_Owner = $Employee`, `LeaveRequest_LeaveType = $LeaveType`, `year-from-dateTime(StartDate) = $LeaveBalance/FiscalYear`, `DeletedFlag = false()`. |
| `ACT_LeaveRequest_SaveDraft` | `(LeaveRequest: Object): Void` | EVT_OnClick_SaveDraft. Gates on E002 (date order). On pass: recomputes TotalDays via `SUB_CalculateDays`, sets `Status = DRAFT`, commits, shows I004, closes popup. |
| `ACT_LeaveRequest_Submit` | `(LeaveRequest: Object): Void` | Full BR-01..BR-08 chain. Gates in order: E002 date-order → SUB_CalculateDays → E015 zero-days → E003 advance-notice (non-SL ≥ today+2) → E005 backdate-blocked → E006 backdate-excess (`>MaxBackdateDays`) → E008 overlap → E004 insufficient-balance → E009 missing-attachment (SL + `RequiresAttachmentOver2D` + days>2). On success: retrieves Owner.Manager, generates RequestCode via SUB_GenerateCode (`'LRQ-' + formatDateTime([%CurrentDateTime%], 'yyyyMM')`), sets Status=PENDING / SubmittedAt=now / Approver=Manager, commits, appends RequestHistory (DRAFT→PENDING), calls `SUB_LeaveBalance_Recalculate`, shows I001, closes popup. |
| `ACT_LeaveRequest_Cancel` | `(LeaveRequest: Object): Void` | BR-10 gate (must be PENDING, else E010 ValidationFeedback). Sets Status=CANCELLED, stamps DecidedAt, commits, appends RequestHistory (PENDING→CANCELLED), recomputes balance, closes popup. |
| `ACT_LeaveRequest_OpenNew` | `(): Object<LeaveRequest>` | Retrieves Employee `[id='[%CurrentUser%]']`, creates a DRAFT LeaveRequest pre-bound to Owner via memberChange, returns the new LeaveRequest. **Does NOT call ShowPage** — active SDK defect writes the removed-in-9.18.0 `passedObjectVariableName`. Studio Pro must add a "Then show page → LeaveRequest_NewEdit" step after the call. |
| `ACT_LeaveRequest_OpenDetail` | `(LeaveRequest: Object): Object<LeaveRequest>` | Echoes input. Row-routing rules (Status IN (DRAFT,REJECTED) → EMP-02 edit, else EMP-03) must be implemented as two conditional action cells in the Studio Pro DataGrid2 row. |
| `ACT_Attachment_Download` | `(Attachment: Object): Void` | Skeleton (no body). `DownloadFile` activity is not in the MCP allow-list. Studio Pro must add the DownloadFile activity on `$Attachment`. |
| `OCH_LeaveRequest_RecalcOnHalfDay` | `(LeaveRequest: Object): Void` | EVT_OnChange_IsHalfDay (microflow mirror — `set_widget_property.onChangeMicroflow` accepts microflows only). If IsHalfDay=true → TotalDays=0.5 (BR-05). Else → call SUB_CalculateDays → write TotalDays, set Session=FULL. |

### 2.2 Nanoflows (1 new)

| Nanoflow | Signature | Purpose |
|---|---|---|
| `NF_LeaveRequest_RecalcOnHalfDay` | `(LeaveRequest: Object): Void` | Client-side nanoflow companion to OCH_. Calls `OCH_LeaveRequest_RecalcOnHalfDay`. Built per plan §4 (NF + OCH pair) so a future Studio Pro nanoflow wiring is available. Active wiring on the page in this build uses the OCH_ microflow. |

### 2.3 Pages (3 new)

| Page | Layout | Popup size | DataView entity / editability | Widget tree |
|---|---|---|---|---|
| `Home_Employee_Dashboard` | `Atlas_Core.Atlas_Default` | — | (full page, no DataView) | `lbl_page_title`, `balance_cards` (GroupBox placeholder), `btn_new_request` → ACT_LeaveRequest_OpenNew, `history_grid` (GroupBox placeholder) |
| `LeaveRequest_NewEdit` | `Atlas_Core.PopupLayout` | 720 × 680 | `LeaveRequest3.LeaveRequest` (editable) | `dv_leave_request` → `request_code` (RO), `status` (RO), `leave_type` (ReferenceSelector→LeaveRequest_LeaveType), `start_date`, `end_date`, `is_half_day` (RadioButtonGroup, onChange=OCH_), `session`, `total_days` (RO), `reason`, `attachment_placeholder` (GroupBox), `btn_save_draft` → ACT_LeaveRequest_SaveDraft, `btn_submit` → ACT_LeaveRequest_Submit, `btn_cancel` → ACT_ClosePopup |
| `LeaveRequest_Detail` | `Atlas_Core.PopupLayout` | 720 × 700 | `LeaveRequest3.LeaveRequest` (`dataViewEditability=Never`) | `dv_leave_request_view` → `request_code`, `status`, `leave_type`, `start_date`, `end_date`, `is_half_day`, `session`, `total_days`, `reason`, `submitted_at`, `decided_at`, `manager_comment`, `attachment_list_placeholder` (GroupBox), `history_placeholder` (GroupBox), `btn_cancel_request` → ACT_LeaveRequest_Cancel, `btn_close` → ACT_ClosePopup |

Widget names follow the `mx-name-{widgetName}` Playwright contract. `ReferenceSelector` is used for `LeaveRequest_LeaveType` (the MCP tool offers ReferenceSelector; ComboBox is not exposed for this version of the add_widget allow-list). Field-label captions are written via `add_widget.label` (the labelTemplate property) — no standalone Label widgets are used for field labels.

## 3. Validation chain detail (ACT_LeaveRequest_Submit)

| Gate | Condition (Expression) | Failure message |
|---|---|---|
| Date order | `$LeaveRequest/StartDate != empty and $LeaveRequest/EndDate != empty and $LeaveRequest/EndDate >= $LeaveRequest/StartDate` | E002 |
| Zero days | `$ComputedDays > 0` | E015 |
| Advance notice | `$LeaveType/Code = 'SL' or daysBetween($LeaveRequest/StartDate, trimToDays([%CurrentDateTime%])) >= 2` | E003 |
| Backdate blocked | `$LeaveRequest/StartDate >= trimToDays([%CurrentDateTime%]) or $LeaveType/AllowBackdate = true` | E005 |
| Backdate excess | `$LeaveRequest/StartDate >= trimToDays([%CurrentDateTime%]) or daysBetween(trimToDays([%CurrentDateTime%]), $LeaveRequest/StartDate) <= $LeaveType/MaxBackdateDays` | E006 |
| Overlap | `AggregateList Count` of LeaveRequests where `Owner = $Owner and (Status='PENDING' or Status='APPROVED') and DeletedFlag=false() and StartDate <= $LeaveRequest/EndDate and EndDate >= $LeaveRequest/StartDate and id != $LeaveRequest` → must be `= 0` | E008 |
| Balance OK | `$LeaveType/SkipBalanceCheck = true or ($Balance != empty and $Balance/AvailableDays >= $ComputedDays)` | E004 |
| Attachment | `not($LeaveType/Code = 'SL' and $LeaveType/RequiresAttachmentOver2D = true and $ComputedDays > 2) or $AttachmentCount >= 1` | E009 |

Notes:
- Enum value references use `Module.EnumName.VALUE` FQN form in expressions (e.g. `LeaveRequest3.Enum_LeaveStatus.PENDING`), and bare-quoted literals in XPath (e.g. `Status = 'PENDING'`) per the enum_value_in_expression rule.
- XPath comparison to `[%CurrentUser%]` uses `[id = '[%CurrentUser%]']` on the User-specializing Employee entity per the xpath_currentuser rule.
- BR-06 (self-approval block) is implicit — Approver is assigned from `Employee_Manager`, which cannot equal Owner under valid HR data. Explicit guard deferred to the Manager phase.
- E004 message uses static text "Insufficient balance for the requested period." — the `{requested}` / `{available}` template parameters are not exposed by the MCP `ValidationFeedback` builder. Carry-over from prior phase report.

## 4. Validation results

- `diagnose_associations` (LeaveRequest3): **0 issues**
- `list_microflows` (LeaveRequest3): 22 microflows (13 prior + 9 new in this commit)
- `list_pages` (LeaveRequest3): 3 pages (none before this commit)
- `read_microflow_details ACT_LeaveRequest_OpenNew`: reads cleanly (no `passedObjectVariableName` error)
- `read_attribute_details LeaveBalance.AvailableDays`: `valueType=calculated`, microflow QN = `LeaveRequest3.SUB_LeaveBalance_GetAvailableDays` (still wired from earlier in this session)

## 5. Deferred — Studio Pro follow-ups required

The MCP `add_widget` / `set_widget_property` toolset does not cover every Mendix property surface. The following items are encoded as named GroupBox placeholders or documentation strings on the relevant widget and must be finished in Studio Pro before the screens are demoable:

| Item | Where | Action |
|---|---|---|
| `balance_cards` placeholder | Home_Employee_Dashboard | Replace GroupBox with **ListView** sourced from `DS_LeaveBalance_ForCurrentUser` (build if not present from prior phases) or directly from `Employee/LeaveBalance_Employee`. Per-row TextBoxes for `LeaveType.NameJP`, `TotalDays`, `CarryOver`, `UsedDays`, `PendingDays`, `AvailableDays` (format `#,##0.0`, AvailableDays emphasised). |
| `history_grid` placeholder | Home_Employee_Dashboard | Replace with **DataGrid2** over `DS_LeaveRequest_OwnerHistory` (build if not present). Columns: RequestCode, LeaveType.NameJP, StartDate, EndDate, TotalDays, Status (caption-JA), SubmittedAt. Default sort: SubmittedAt DESC. Page size 20. Row-select action: two conditional action cells implementing the routing rule (`Status IN (DRAFT,REJECTED)` → show LeaveRequest_NewEdit, else → show LeaveRequest_Detail). |
| `attachment_placeholder` | LeaveRequest_NewEdit | Replace with **FileUploader** bound to `RequestAttachment` via `Attachment_LeaveRequest`. Set acceptable types `.pdf,.jpg,.jpeg,.png`. Set conditional visibility `LeaveType.Code == 'SL' && TotalDays > 2`. |
| `attachment_list_placeholder` | LeaveRequest_Detail | Replace with **ListView** over `Attachment_LeaveRequest`. Columns: FileName, UploadedAt. Per-row "ダウンロード" button → ACT_Attachment_Download (after the DownloadFile activity is added). |
| `history_placeholder` | LeaveRequest_Detail | Replace with **ListView** over `History_LeaveRequest` sorted EventAt ASC. Columns: EventAt, FromStatus, ToStatus, ActorEmployeeId, Comment. |
| Conditional visibility | LeaveRequest_NewEdit | `session` visible only when `$LeaveRequest/IsHalfDay`; `attachment_placeholder` visible only when `LeaveType.Code = 'SL' and TotalDays > 2`; header `request_code` and `status` visible only in edit mode. |
| Conditional visibility | LeaveRequest_Detail | `session` visible only when `IsHalfDay`; `manager_comment` visible only when `Status IN (APPROVED, REJECTED) AND ManagerComment != ''`; `btn_cancel_request` visible only when `Status == PENDING`. |
| New-Request navigation | Home_Employee_Dashboard `btn_new_request` | Currently wired to `ACT_LeaveRequest_OpenNew` only. In Studio Pro: change action to **Call microflow → ACT_LeaveRequest_OpenNew → Then show page → LeaveRequest_NewEdit, passing the returned LeaveRequest**. The microflow side already returns the new LeaveRequest. |
| Row-select navigation | Home_Employee_Dashboard `history_grid` | DataGrid2 row select fires `ACT_LeaveRequest_OpenDetail` (echoes the row). Implement two row-action cells with conditional visibility to dispatch to the right popup. |
| DatePicker date-only display | LeaveRequest_NewEdit / LeaveRequest_Detail `start_date`, `end_date`, `submitted_at`, `decided_at` | Flip `localizeDate=false` and set display format to `yyyy/MM/dd` (`yyyy/MM/dd HH:mm` for the *At fields). |
| ListView caller-refresh after popup close | Home_Employee_Dashboard | MCP does not expose `Refresh on close`; in Studio Pro set the dashboard DataSources to refresh after EMP-02/EMP-03 closes. |
| Module security / entity access | LeaveRequest3 module | Not exposed by MCP. Define Employee/Manager/HRAdmin module roles; bind XPath rules per RDD §4.3. Match `applyEntityAccess=false` on `SUB_GenerateCode` (already in Phase 2). |
| Navigation profile | App-level | Role-based home pages: Employee → Home_Employee_Dashboard, Manager → (Phase 4), HRAdmin → (Phase 5). |
| `ACT_Attachment_Download` body | DownloadFile activity | Add a DownloadFile activity on the input `$Attachment` (a `RequestAttachment` specialization of `System.FileDocument`). |
| E004 message templating | ACT_LeaveRequest_Submit `vf_balance` | Replace static "Insufficient balance" text with templated `Insufficient balance. Requested {1} day(s); available {2} day(s).` once a templated ValidationFeedback or ShowMessage path is available. |

## 6. Discrepancies / decisions made against source specs

1. **Spec namespace correction (B-translation)** — Screen YAMLs reference `LeaveRequest.X` in XPath and association paths. Translated to `LeaveRequest3.X` throughout (the actual module name).
2. **Spec XPath form correction** — Screen YAMLs use `[LeaveRequest.LeaveBalance_Employee/LeaveRequest.Employee[id='[%CurrentUser%]']]` joins. Rewritten to either `[id = '[%CurrentUser%]']` on the Employee entity directly (since Employee is an `Administration.Account` specialization) or `[LeaveRequest3.X_Owner = $Employee]` after a prior retrieve. Both forms are equivalent and pass the xpath_currentuser validator.
3. **ShowPage defect workaround (B-translation)** — `ACT_LeaveRequest_OpenNew` and `ACT_LeaveRequest_OpenDetail` return the LeaveRequest object. The "Then show page" step is left for Studio Pro per plan §4. This avoids the SDK writing the removed-in-9.18.0 `passedObjectVariableName`.
4. **Half-day onChange nanoflow + microflow mirror** — Built both `NF_LeaveRequest_RecalcOnHalfDay` (nanoflow) and `OCH_LeaveRequest_RecalcOnHalfDay` (microflow). Active page wiring uses the microflow (`set_widget_property.onChangeMicroflow`). Nanoflow is available for a future client-side wiring.
5. **Cancel / Close buttons** — Both wired to `ACT_ClosePopup` (close-only). The "confirm before close if unsaved changes" prompt from EVT_OnClick_Cancel is deferred to Studio Pro.
6. **Status field in NewEdit header** — Rendered as a DropDown read-only. The screen YAML calls for a Label-style display with enum_caption_ja translation; in Studio Pro change the widget to a Text widget using `getCaption($LeaveRequest/Status)` if the read-only DropDown is judged inadequate.
7. **BR-09 (W002 carryover-expiry warning)** — Defined on EMP-01 EVT_OnLoad but not implemented in this build (no DS_Employee_LoadDashboard modification). Add a conditional ShowMessage in that microflow after a Studio Pro decision on `CarryOver > 0 and today > Mar-15`.
8. **BR-06 self-approval enforcement** — Implicit (Approver pulled from Owner's Manager self-association). No explicit microflow check. Add explicit check + entity access in Phase 4.
9. **DownloadFile not exposed by MCP** — `ACT_Attachment_Download` is a skeleton. Studio Pro must add the DownloadFile activity.
10. **Page-title text** — Set via `create_page.title` (Mendix-native page title). The screen YAMLs use this for `text_modal_title`; no separate widget is needed.
11. **Refresh-after-close** — MCP does not expose the page caller-refresh hook. Documented as Studio Pro follow-up.
12. **`SkipBalanceCheck` semantics** — Wired in the balance-OK gate as the spec-described skip path for UL (Unlimited). Confirmed against the Domain Definition zero-balance constraint.
13. **`Manager` association unset case** — If Owner has no manager, the submit microflow assigns `Approver = empty` silently. W003 warning not yet emitted. Studio Pro should add a non-blocking ShowMessage before the assignment if `$Manager = empty`.
14. **Validation feedback message text** — Used the English `text_en` from `03_message_list.yaml`. Bilingual rendering should be handled via Mendix system text translations after the project's Languages list is configured.

## 7. Where to pick up

1. **Studio Pro UI**: Replace the 4 GroupBox placeholders (balance_cards, history_grid, attachment_placeholder, attachment_list_placeholder, history_placeholder — 5 total) with ListView / DataGrid2 / FileUploader. Add the "Then show page" step on `btn_new_request`. Add the two conditional action cells on `history_grid` for status-based row routing. Flip date-only display on DatePickers. Wire entity access rules.
2. **DS_Employee_LoadDashboard / DS_LeaveBalance_ForCurrentUser / DS_LeaveRequest_OwnerHistory**: The dashboard list-source microflows still need a real implementation if not already present from prior phases. `DS_LeaveBalance_List` returns *all* balances; an `_ForCurrentUser` variant is needed for the dashboard.
3. **W002 carryover-expiry warning**: Add to DS_Employee_LoadDashboard or as a page-load action.
4. **W003 manager-unset warning**: Add to ACT_LeaveRequest_Submit before the Approver assignment.
5. **Phase 4 — Manager**: WFA_LeaveRequest_Approve / Reject microflows (C001/C002 confirmation, E007/E011 validation) and SCR-MGR-01 / SCR-MGR-02.
6. **Phase 5 — HR**: master CRUD, dashboards, Excel importer.

## 8. Notes for the next agent

- `LeaveBalance.AvailableDays` is calculated (microflow `SUB_LeaveBalance_GetAvailableDays`). Do not attempt to set or commit it as a stored value.
- `ACT_LeaveRequest_OpenNew` and `ACT_LeaveRequest_OpenDetail` deliberately omit `ShowPage` activity — the SDK has an active defect (`passedObjectVariableName` removed in Mendix 9.18.0 still written). Re-introducing ShowPage in these microflows will re-trigger the defect. The defect's status is reported as actively under investigation by the MCP maintainer.
- Module-internal microflow naming uses the `DS_` / `SUB_` / `ACT_` / `OCH_` / `NF_` / `SCH_` / `IVK_` / `VAL_` prefix set. `DS_` and `NF_` emit a harmless naming-convention warning — ignore.
- The `LeaveRequest3.SystemCounter` entity must have `applyEntityAccess=false` on its associated microflows for the runtime to write to it as a non-privileged user. `SUB_GenerateCode` already has this.
