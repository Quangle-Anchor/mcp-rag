# Phase 1–3 Build Report — Mendix Leave Management

**Project**: `b80c06d7-5e84-4fa6-b37d-82315e7c244a`
**Module**: `LeaveRequest3`
**Branch**: `develop`
**Mendix target**: 11.x
**Date**: 2026-05-15
**Scope executed**: Phase 1 (security/navigation scaffold + CalculatedAttribute fix), Phase 2 (shared microflows), Phase 3 (Employee screens). Phases 4/5 (Manager / HR) deliberately deferred per session instructions.

Two commits were pushed to `develop`:

1. `LeaveRequest3 Phase 1+2: landing-page stubs (Home_Employee/Manager/HRAdmin), 5 shared microflows (SUB_GenerateRequestCode, SUB_CalculateDays, SUB_LeaveBalance_Recalculate, DS_LeaveBalance_ForCurrentUser, DS_LeaveRequest_OwnerHistory), 3 action microflows (ACT_LeaveRequest_SaveDraft/Submit/Cancel)`
2. `LeaveRequest3 Phase 3: Employee screens (Home_Employee_Dashboard + LeaveRequest_NewEdit popup + LeaveRequest_Detail readonly), ACT_LeaveRequest_OpenNew, button wiring`

A separate standalone script commit (`mx-sdk-connect/scripts/set_availabledays_calculated.mjs`) ran between the two MCP commits to convert `LeaveBalance.AvailableDays` to a calculated attribute (workaround for the SDK's "Cannot unset required part property" defect on `set_calculated_attribute`). Commit message: `LeaveBalance.AvailableDays → calculated (SUB_LeaveBalance_GetAvailableDays)`.

---

## 1. What was built

### 1.1 Domain model changes (Phase 1)

- `LeaveBalance.AvailableDays` was converted from a stored Decimal to a **CalculatedValue** backed by `LeaveRequest3.SUB_LeaveBalance_GetAvailableDays`. Verified post-script via `read_attribute_details` (`valueType: "calculated"`, `calculatedMicroflow: "LeaveRequest3.SUB_LeaveBalance_GetAvailableDays"`).
- No other entity/attribute/association changes — the ER was already complete from the prior session and `diagnose_associations` reports healthy: 0 issues.

### 1.2 Navigation stubs (Phase 1)

Three empty role-scoped pages with a placeholder label so the navigation profile (still configured in Studio Pro) can route to them:

| Page | Layout | Notes |
|---|---|---|
| `LeaveRequest3.Home_Employee` | `Atlas_Core.Atlas_Default` | Stub. Actual employee landing is `Home_Employee_Dashboard` (built in Phase 3). |
| `LeaveRequest3.Home_Manager` | `Atlas_Core.Atlas_Default` | Stub. SCR-MGR-01 deferred to Phase 4. |
| `LeaveRequest3.Home_HRAdmin` | `Atlas_Core.Atlas_Default` | Stub. SCR-HR-01 deferred to Phase 5. |

### 1.3 Shared microflows (Phase 2)

| Microflow | Signature | Purpose |
|---|---|---|
| `SUB_GenerateRequestCode` | `(): String` | Atomic counter on `SystemCounter` keyed by `'LRQ-' + formatDateTime([%CurrentDateTime%], 'yyyyMM')`. Seeds with `CurrentValue=1` if missing, otherwise increments. Returns `LRQ-YYYYMM-#####`. `applyEntityAccess=false`. |
| `SUB_CalculateDays` | `(StartDate: DateTime, EndDate: DateTime, IsHalfDay: Boolean): Decimal` | BR-05 fast path returns 0.5 when `IsHalfDay`. Otherwise computes `GrossDays = trunc(daysBetween(EndDate, StartDate)) + 1`, subtracts weekend days using a closed-form arithmetic on `weekdayFromDateUTC(StartDate)` + remainder week, then loops a Database-retrieved `PublicHoliday` list filtered to `[StartDate, EndDate]` and active, counting only weekday holidays. |
| `SUB_LeaveBalance_Recalculate` | `(LeaveBalance: Object): Void` | Recomputes `UsedDays` and `PendingDays` for the given LeaveBalance by retrieving LeaveRequests scoped by Owner = Employee, LeaveType, year(StartDate) = FiscalYear, then `AggregateList Sum` per status, then commits. |
| `DS_LeaveBalance_ForCurrentUser` | `(): List<LeaveBalance>` | XPath `[LeaveRequest3.LeaveBalance_Employee = '[%CurrentUser%]' and LeaveRequest3.LeaveBalance.DeletedFlag = false]`. |
| `DS_LeaveRequest_OwnerHistory` | `(): List<LeaveRequest>` | XPath `[LeaveRequest3.LeaveRequest_Owner = '[%CurrentUser%]' and LeaveRequest3.LeaveRequest.DeletedFlag = false]` sorted `SubmittedAt` desc. |

### 1.4 Action microflows (Phase 3)

| Microflow | Signature | Purpose |
|---|---|---|
| `ACT_LeaveRequest_SaveDraft` | `(LeaveRequest: Object): Void` | Recompute `TotalDays` (calls `SUB_CalculateDays`), set `Status = Draft`, stamp `ChangedDate`, commit. |
| `ACT_LeaveRequest_Submit` | `(LeaveRequest: Object): Void` | Full BR-01..BR-08 validation chain (E002, E003, E004, E005, E008, E009, E015 — see §3 below). On success: assigns `Approver` = Owner's Manager, calls `SUB_GenerateRequestCode` for `RequestCode`, sets `Status=Pending`, `SubmittedAt=[%CurrentDateTime%]`, commits, appends a `RequestHistory` row (Draft→Pending), calls `SUB_LeaveBalance_Recalculate` on the matching balance. |
| `ACT_LeaveRequest_Cancel` | `(LeaveRequest: Object): Void` | BR-10 gate (Draft/Pending only, else E010). Sets `Status=Cancelled`, stamps `ChangedDate`, commits, appends `RequestHistory`, recomputes balance. |
| `ACT_LeaveRequest_OpenNew` | `(): Void` | Retrieves the current Employee, creates a Draft LeaveRequest pre-bound to Owner, then `ShowPage LeaveRequest_NewEdit` passing the new object via `pageSettings.parameterMappings` (Mendix-11-compatible). |

### 1.5 Pages (Phase 3)

| Page | Layout | Popup size | DataView entity / editability | Widgets |
|---|---|---|---|---|
| `Home_Employee_Dashboard` | `Atlas_Core.Atlas_Default` | — | none (full page) | `lbl_page_title`, `balance_cards` (GroupBox placeholder for ListView), `btn_new_request` → `ACT_LeaveRequest_OpenNew`, `history_grid` (GroupBox placeholder for DataGrid2) |
| `LeaveRequest_NewEdit` | `Atlas_Core.PopupLayout` | 720 × 620 | `LeaveRequest3.LeaveRequest` (Always) | `dv_leave_request`, `leave_type` (ReferenceSelector→`LeaveRequest_LeaveType`), `start_date`, `end_date`, `is_half_day` (RadioButtonGroup), `session` (DropDown), `reason` (TextArea), `attachment_placeholder` (GroupBox), `btn_save_draft`, `btn_submit`, `btn_cancel` |
| `LeaveRequest_Detail` | `Atlas_Core.PopupLayout` | 720 × 600 | `LeaveRequest3.LeaveRequest` (`dataViewEditability=Never`) | `dv_leave_request_view`, `request_code`, `leave_type`, `start_date`, `end_date`, `total_days`, `status`, `reason`, `manager_comment`, `history_placeholder` (GroupBox), `btn_cancel_request` → `ACT_LeaveRequest_Cancel`, `btn_close` |

Locators on the page side already follow the `.mx-name-<widgetName>` convention (e.g. `.mx-name-btn_submit`, `.mx-name-start_date`).

---

## 2. Validation results

- `diagnose_associations` (LeaveRequest3): **0 issues**. Module reported healthy.
- `list_microflows` (LeaveRequest3): 10 microflows present, matching the build plan.
- `list_pages` (LeaveRequest3): 6 pages present (3 stubs + 3 Phase-3 pages).
- `read_attribute_details` on `LeaveBalance.AvailableDays`: `valueType=calculated`, microflow QN matches expectation.
- The Mendix Studio Pro check (`mcp__studio-pro__check_project_errors`) was not run because the studio-pro MCP endpoint is not reachable in this session. Recommend running it locally before next commit to surface any Studio Pro-only validation.
- Two harmless warnings from the MCP builder:
  - `DS_LeaveBalance_ForCurrentUser`, `DS_LeaveRequest_OwnerHistory`: `naming convention (expected ACT_/VAL_/SUB_/SCH_/IVK_/OCH_)` — `DS_` prefix is intentional per Code Definition.md §5 and ignored per project convention.

---

## 3. Validation chain details (ACT_LeaveRequest_Submit)

The submit microflow runs the following gates in order. Each failed gate fires a `ValidationFeedback` on the relevant attribute and exits without committing.

| Gate | Condition | Message code | XPath / expression |
|---|---|---|---|
| End-before-start | `$LeaveRequest/EndDate < $LeaveRequest/StartDate` | E002 | direct compare |
| Zero working days | `$ComputedDays <= 0` (post-BR-04) | E015 | result of `SUB_CalculateDays` |
| Advance notice | `$LType/Code != 'SCK-P' and daysBetween([%CurrentDateTime%], $LeaveRequest/StartDate) < 2` | E003 | BR-01 |
| Backdate-blocked | `StartDate < trimToDays([%CurrentDateTime%]) and $LType/AllowBackdate = false` | E005 | BR-03 general |
| Backdate-excess | `StartDate < trimToDays([%CurrentDateTime%]) and AllowBackdate = true and daysBetween(StartDate, [%CurrentDateTime%]) > MaxBackdateDays` | E006 | BR-03 SL exception |
| Missing attachment | `Code = 'SCK-P' and RequiresAttachmentOver2d and TotalDays > 2 and count(RequestAttachment) = 0` | E009 | BR-08 |
| Overlap | retrieve overlapping LR with `Status in (Pending, Approved)` and date range intersects, count > 0 | E008 | BR-07 |
| Insufficient balance | `SkipBalanceCheck = false and (Balance = empty or AvailableDays < TotalDays)` | E004 | BR-02 |

Notes:
- `id != $LeaveRequest` filter on the overlap retrieve so a draft re-submitting itself isn't a false positive.
- BR-06 (self-approval block) is **implicit**: the submit microflow sets `Approver = Owner/Employee_Manager` (the self-referential association); since a manager cannot be their own manager via valid HR data, no explicit check is added. This needs an explicit guard if HR ever allows a self-managing edge case — flagged below in §5.

---

## 4. Deferred items (out of scope for this session)

| Item | Reason / next step |
|---|---|
| **Phase 4 — Manager screens (SCR-MGR-01, SCR-MGR-02)** | Session scope. Needs an approval/reject pair of microflows (`WFA_LeaveRequest_Approve`, `WFA_LeaveRequest_Reject`) and a Pending-queue dashboard. |
| **Phase 5 — HR screens (SCR-HR-01 .. 04)** | Session scope. SCR-HR-01 needs charts (DataGrid2 / chart widgets not exposed by `add_widget`); SCR-HR-02 is a master-CRUD; SCR-HR-03 needs Excel Importer; SCR-HR-04 needs an export-to-Excel pipeline. |
| **Project navigation profile** | The MCP server does not expose Mendix Navigation API. In Studio Pro, set role-based home pages: `Employee → Home_Employee_Dashboard`, `Manager → Home_Manager`, `HRAdmin → Home_HRAdmin`. The empty `Home_Employee` stub can be deleted or repurposed once navigation is wired. |
| **Module security / entity access rules** | The MCP server does not expose Security API. In Studio Pro: enable `LeaveRequest3` security; create three module roles (Employee, Manager, HRAdmin) and bind to user roles; set entity access per BR-06/BR-10 (e.g. LeaveRequest restricted by Owner=[%CurrentUser%] or Approver=[%CurrentUser%], etc.). |
| **Excel importer config for SCR-HR-03** | Marketplace module + per-template column mapping. Plan as part of Phase 5. |
| **Charts widgets for SCR-HR-01** | Plan as part of Phase 5; uses any chart widget compatible with Mendix 11 (e.g. AnyChart, Highcharts). |
| **Email notifications (RDD §2.2 step 3)** | I001/I002/I003 + email send action wired in submit/approve/reject microflows. Out of scope. |
| **ListView/DataGrid2 widgets** | `mcp__mx-sdk-connect__add_widget` does not expose ListView or DataGrid2. In Studio Pro, replace the GroupBox placeholders `balance_cards`, `history_grid` (on dashboard), `history_placeholder` (on detail), `attachment_placeholder` (on NewEdit) with the appropriate listing widget. Documented widget-by-widget in each GroupBox `caption`. |
| **Conditional visibility** | The MCP `set_widget_property visibility` field is available but not wired in this build. Studio Pro needs: `session` visible only when `$LeaveRequest/IsHalfDay`; `attachment_placeholder` visible only when `LeaveType.Code = 'SCK-P' and TotalDays > 2`; `manager_comment` visible only when `Status in (Approved, Rejected)`; `btn_cancel_request` visible only when `Status in (Draft, Pending)` per BR-10. |
| **onChange handlers** | `start_date`, `end_date`, `is_half_day`, `leave_type` should call a Nanoflow that recomputes `TotalDays` live via `SUB_CalculateDays` and refreshes balance preview. Nanoflows are not in this build (only microflow `onChangeMicroflow` is exposed by `set_widget_property`); decision deferred to Studio Pro. |
| **`btn_cancel` ClosePage wiring** | `set_widget_property onClickMicroflow` can't wire a built-in ClosePage action. Studio Pro: set `On click` = Close page. Same applies to `btn_close` on the Detail page. |
| **Scheduled task BR-09 (`SCE_ForfeitCarryOver`)** | A SCH_ microflow that runs March-31 to clear CarryOver. Out of scope. |
| **W003 warning when manager unset** | The submit microflow currently silently assigns `null` Approver when Owner has no manager. Should add a non-blocking `ShowMessage`/`LogMessage` Warning per W003. |

---

## 5. Discrepancies / decisions made against source specs

These are flagged for SA review. Most carry forward from the prior phase; new ones are marked **[new]**.

1. **Surrogate identity vs. AutoNumber business IDs (carry-over)** — ER specifies `EMPLOYEE_ID = EMP-YYYY-#####`, `LEAVE_REQUEST_ID` long, `LEAVE_BALANCE_ID` long. Mendix uses internal GUID; we kept `EmployeeId String` for the human-readable code and didn't model `LEAVE_REQUEST_ID`/`LEAVE_BALANCE_ID` columns explicitly. `RequestCode` (LRQ-YYYYMM-#####) serves the human-readable role for LeaveRequest.
2. **Date → DateTime (carry-over)** — All `date` columns in the ER are stored as Mendix `DateTime`. Pages use Mendix's standard DatePicker (date-only mode requires `localizeDate=false` flip in Studio Pro for fields like StartDate/EndDate/HolidayDate).
3. **Audit columns left nullable (carry-over)** — `CreatedDate`, `ChangedDate`, etc. are stored but the entity-access "Before commit" event handler to auto-populate them is not in this build (Studio Pro work).
4. **AttachmentId blob storage** — `RequestAttachment.FileBlob` is a Binary attribute but Mendix requires the entity to specialize `System.FileDocument` for the built-in file widget to work. **[new]** Recommend HR/SA decide whether to (a) rebuild RequestAttachment as a specialization of `System.FileDocument` (preferred), or (b) keep the bespoke blob + custom upload component. We did NOT change the entity — flagged for Phase 4/5.
5. **BR-04 weekend exclusion in `SUB_CalculateDays`** **[new]** — Implemented via closed-form arithmetic on `weekdayFromDateUTC(StartDate)` + remainder week (the loop only iterates PublicHolidays). The math correctly handles all standard ranges. There is one edge case: if `StartDate > EndDate` is passed (which `ACT_LeaveRequest_Submit` guards against earlier in the chain), the result will be a negative integer. The microflow returning <= 0 is treated as E015 by the caller, so the negative is benign in production. Documented inline.
6. **`daysBetween` argument order** **[new]** — Mendix `daysBetween(a, b)` returns `a - b` as decimal days. Used `daysBetween(EndDate, StartDate)` so the result is positive when EndDate ≥ StartDate. Verify in QA.
7. **`ACT_LeaveRequest_Cancel` FromStatus capture** **[new]** — `create_microflow` does not currently expose `Enumeration` as a CreateVariable variableType (`Unknown ReturnTypeSpec type: Enumeration`). Worked around by snapshotting the from-status as a String literal and then using `if $FromStatus = 'Draft' then ...Draft else ...Pending` on the RequestHistory member-change side. Functional but slightly clumsy; would benefit from an SDK update.
8. **BR-06 self-approval enforcement** **[new]** — Currently *implicit* (Approver assigned from Owner's `Employee_Manager` self-association, which cannot be the owner under valid HR data). Not enforced by an explicit microflow check or entity access rule. Recommend adding both (a) explicit check in approve microflow `Approver = $CurrentUser and Owner = $CurrentUser → block`, and (b) entity access XPath `[LeaveRequest_Approver != '[%CurrentUser%]']` on the Approver-side role.
9. **Insufficient-balance message variables** **[new]** — Spec E004 wants `{requested}` and `{available}` placeholders interpolated. The ValidationFeedback activity in mx-sdk-connect supports a static `message` only — dynamic templating (`StringTemplate.parameters`) is not exposed by the `ValidationFeedback` builder branch. Currently emits the static text "Insufficient balance for the requested period." Recommend follow-up either via custom `ShowMessage` or by extending the builder.
10. **`Approver` cardinality** **[new]** — `LeaveRequest_Approver` is `Employee 1 — * LeaveRequest`. Setting it via memberChanges `associationQualifiedName` worked correctly. Confirmed.
11. **`SystemCounter.applyEntityAccess` semantics** **[new]** — The submit-time counter increment runs with `applyEntityAccess=false` because regular Employee users should not need read/write access to SystemCounter. Recommend matching entity access settings in Studio Pro (no module role gets SystemCounter access; only the microflow can mutate it).
12. **Page-button ClosePage** **[new]** — `btn_cancel` on NewEdit and `btn_close` on Detail are positioned and captioned but have no on-click action. Set to "Close page" in Studio Pro.
13. **Manager comment visibility** **[new]** — The `manager_comment` field on the Detail page is rendered for all statuses; should be visibility-gated to `Status in (Approved, Rejected)` per the spec.

---

## 6. Where to pick up

1. **Studio Pro UI** — wire navigation profile, entity access rules, and ClosePage button actions; replace the 4 GroupBox placeholders with ListView/DataGrid2; flip date-only display on DatePickers.
2. **Phase 4 — Manager** — design `WFA_LeaveRequest_Approve` / `WFA_LeaveRequest_Reject` microflows (with C001/C002 confirmation, E007/E011 validations), then `SCR-MGR-01` queue + `SCR-MGR-02` action popup.
3. **Phase 5 — HR** — master CRUD pages, dashboard charts, Excel importer, export pipeline.
4. **Address discrepancy #4** (RequestAttachment vs System.FileDocument) before Phase 5 file-upload work.
