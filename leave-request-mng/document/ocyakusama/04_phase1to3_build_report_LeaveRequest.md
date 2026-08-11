# Phase 1-3 Build Report — LeaveRequest module

**Project**: `595419ee-8725-43e7-b834-1ae40de34cbf`
**Module**: `LeaveRequest`
**Branch**: `main` (committed — `develop` did not exist on this app; user authorized fallback)
**Mendix target**: 11.x
**Date**: 2026-05-18
**Scope executed**: Phase 1 (domain model + scaffold), Phase 2 (shared microflows), Phase 3 (Employee screens + action microflows). Phases 4/5 (Manager / HR) deferred per session scope.

One MCP commit was pushed to `main` covering all three phases. A second standalone-script commit (`mx-sdk-connect/scripts/set_availabledays_calculated_lr.mjs`) is queued to convert `LeaveBalance.AvailableDays` to a calculated attribute (workaround for the persistent SDK defect on `set_calculated_attribute`).

---

## 0. Spec defect corrections applied during build

Per the mendix-implementation skill, the spec was scanned against `mx-sdk-connect/specs/rules/*` before any MCP call. The user chose option **B** (proceed and apply corrections inline) for the items below.

| # | Source defect | Rule | Correction |
|---|---|---|---|
| 1 | `Employee` listed `AccountGuid`, `FullName`, `Email`, plus all four audit columns as user attributes despite `extends: "Administration.Account"` | user_entity_generalization.md / system_members.md | Dropped — these are inherited from Administration.Account / System.User. Employee now contains only its own business attributes (`EmployeeId`, `Role`, `DepartmentId`, `HireDate`, `ActiveFlag`, `DeletedFlag`, `Version`). |
| 2 | `RequestAttachment` listed `AttachmentId`, `FileName`, `FileBlob`, `SizeBytes` despite `extends: "System.FileDocument"` | system_specialization.md | Dropped — inherited from System.FileDocument as `id`, `Name`, `Contents`, `Size`. Kept `ContentType`, `UploadedAt`, `UploadedBy`. |
| 3 | `Department`, `LeaveType`, `LeaveBalance`, `LeaveRequest`, `SystemCounter` declared user-defined `CreatedDate`/`ChangedDate`/`CreatedBy`/`ChangedBy` attributes matching system-member synonyms | system_members.md | Replaced with `hasCreatedDate=true`, `hasChangedDate=true`, `hasOwner=true`, `hasChangedBy=true` flags. |
| 4 | XPath constraints in `SCR-EMP-01.yaml` and `SCR-EMP-03.yaml` used `…Module.Employee = '[%CurrentUser%]'` (missing `/id`) | xpath_currentuser.md | Rewrote as `[LeaveRequest.LeaveBalance_Employee/LeaveRequest.Employee/id = '[%CurrentUser%]' …]` and `[LeaveRequest.LeaveRequest_Owner/LeaveRequest.Employee/id = '[%CurrentUser%]' …]`. Wired into `DS_LeaveBalance_ForCurrentUser` and `DS_LeaveRequest_OwnerHistory`. |
| 5 | Spec module name `LeaveManagement` | naming choice | Substituted `LeaveRequest` throughout. |
| 6 | Surrogate `Long` PKs (`LeaveBalanceId`, `LeaveRequestId`, `HistoryId`, `AttachmentId`) | Mendix convention | Dropped — Mendix provides `id` (GUID) automatically. Business codes (`EmployeeId`, `RequestCode`, `LeaveTypeId`, `DepartmentId`) are kept as user String attributes. |

---

## 1. What was built

### 1.1 Module
`LeaveRequest` — newly created (project was bare apart from `MyFirstModule`).

### 1.2 Enumerations (Phase 1)
| Enumeration | Values (in spec order) |
|---|---|
| `Enum_LeaveStatus` | DRAFT, PENDING, APPROVED, REJECTED, CANCELLED |
| `Enum_Session` | FULL, AM, PM |
| `Enum_UserRole` | Employee, Manager, HR_Admin |

Japanese captions written on each value.

### 1.3 Entities (Phase 1)

All 9 entities created with the spec-defect corrections applied.

| Entity | Generalization | System member flags | Notes |
|---|---|---|---|
| `Employee` | `Administration.Account` | (inherited from root System.User ancestor) | Carries `EmployeeId`, `Role`, `DepartmentId`, `HireDate`, `ActiveFlag`, `DeletedFlag`, `Version` only. `FullName` / `Email` / sign-in fields come from Administration.Account. |
| `Department` | — | `hasCreatedDate`, `hasChangedDate` | `DepartmentId` (business code), `DepartmentName`, `ActiveFlag` |
| `LeaveType` | — | `hasCreatedDate`, `hasChangedDate` | All BR-aware flags: `RequiresAttachmentOver2D`, `SkipBalanceCheck`, `AllowBackdate`, `MaxBackdateDays`. |
| `LeaveBalance` | — | `hasCreatedDate`, `hasChangedDate`, `hasOwner`, `hasChangedBy` | `AvailableDays` initially stored (decimal=0); converted to calculated via the post-commit script (see §4). |
| `LeaveRequest` | — | `hasCreatedDate`, `hasChangedDate`, `hasOwner`, `hasChangedBy` | State machine attribute `Status` defaults `DRAFT`. |
| `RequestAttachment` | `System.FileDocument` | (inherited) | Kept `ContentType`, `UploadedAt`, `UploadedBy` only. |
| `RequestHistory` | — | (none — audit table) | Immutable per row. `FromStatus`/`ToStatus` default `DRAFT` so the SDK accepts the create call. |
| `PublicHoliday` | — | (none) | BR-04 holiday calendar. |
| `SystemCounter` | — | `hasChangedDate` | Atomic counter for `LRQ-YYYYMM-#####`. |

### 1.4 Associations (Phase 1)
| Association | Type | Notes |
|---|---|---|
| `Employee_Department` | N:1 Department | Department parent. |
| `Employee_Manager` | N:1 Employee (self-ref) | BR-06 routing target. |
| `LeaveBalance_Employee` | N:1 Employee | |
| `LeaveBalance_LeaveType` | N:1 LeaveType | |
| `LeaveRequest_Owner` | N:1 Employee | |
| `LeaveRequest_Approver` | N:1 Employee | |
| `LeaveRequest_LeaveType` | N:1 LeaveType | |
| `Attachment_LeaveRequest` | N:1 LeaveRequest | parentDelete=DeleteMeAndReferences (cascade with request). |
| `History_LeaveRequest` | N:1 LeaveRequest | parentDelete=DeleteMeAndReferences. |

`diagnose_associations` on the module returned `healthy: true` (0 issues).

### 1.5 Navigation stub pages (Phase 1)
Three empty role-scoped pages created on `Atlas_Core.Atlas_Default` so the navigation profile (still configured in Studio Pro) can route to them:
- `LeaveRequest.Home_Employee`
- `LeaveRequest.Home_Manager`
- `LeaveRequest.Home_HRAdmin`

The real Employee landing is `Home_Employee_Dashboard` (built in Phase 3).

### 1.6 Shared microflows (Phase 2)

| Microflow | Signature | Purpose |
|---|---|---|
| `SUB_GenerateRequestCode` | `(): String` | Atomic counter on SystemCounter keyed by `'LRQ-' + formatDateTime([%CurrentDateTime%], 'yyyyMM')`. Seeds with `CurrentValue=1` if missing, otherwise increments. Returns `LRQ-YYYYMM-#####`. `applyEntityAccess=false`. |
| `SUB_CalculateDays` | `(StartDate, EndDate, IsHalfDay): Decimal` | BR-05 fast path returns 0.5 when `IsHalfDay`. Otherwise gross days = `trunc(daysBetween(EndDate, StartDate)) + 1`. **Weekend / public-holiday exclusion deferred** (see §3 discrepancy 1). |
| `SUB_LeaveBalance_Recalculate` | `(LeaveBalance): Void` | Retrieves LeaveRequests for the same Employee + LeaveType, sums `TotalDays` per status (APPROVED → `UsedDays`, PENDING → `PendingDays`), commits. FiscalYear scoping deferred. |
| `SUB_LeaveBalance_GetAvailableDays` | `(LeaveBalance): Decimal` | Returns `TotalDays + CarryOver - UsedDays - PendingDays`. Backs the `AvailableDays` calculated attribute (post-commit script). |
| `DS_LeaveBalance_ForCurrentUser` | `(): List<LeaveBalance>` | XPath `[LeaveRequest.LeaveBalance_Employee/LeaveRequest.Employee/id = '[%CurrentUser%]' and DeletedFlag = false]`. |
| `DS_LeaveRequest_OwnerHistory` | `(): List<LeaveRequest>` | XPath `[LeaveRequest.LeaveRequest_Owner/LeaveRequest.Employee/id = '[%CurrentUser%]' and DeletedFlag = false]` sorted `SubmittedAt` desc. |

### 1.7 Action microflows (Phase 3)

| Microflow | Signature | Purpose |
|---|---|---|
| `ACT_LeaveRequest_OpenNew` | `(): Void` | Retrieves current Employee via `[id = '[%CurrentUser%]']`, creates draft LeaveRequest pre-bound to Owner (Status=DRAFT, IsHalfDay=false, Session=FULL, TotalDays=0), then `ShowPage LeaveRequest_NewEdit` passing the new object via `pageSettings.parameterMappings`. |
| `ACT_LeaveRequest_SaveDraft` | `(LeaveRequest): Void` | Recomputes `TotalDays` via `SUB_CalculateDays`, sets `Status=DRAFT`, commits, closes page. Skips business validations. |
| `ACT_LeaveRequest_Submit` | `(LeaveRequest): Void` | E002 (date order), E015 (zero days). On success: retrieves Owner & Manager (Approver), calls `SUB_GenerateRequestCode`, sets Status=PENDING / SubmittedAt / RequestCode / Approver, commits, appends RequestHistory row. |
| `ACT_LeaveRequest_Cancel` | `(LeaveRequest): Void` | BR-10 gate (Status ∈ {DRAFT, PENDING}, else E010). Sets Status=CANCELLED, DecidedAt, commits, appends RequestHistory, closes page. |

`list_microflows` shows 10 microflows in the module (6 shared + 4 action).

### 1.8 Pages (Phase 3)

| Page | Layout | Popup size | DataView entity / editability | Widgets |
|---|---|---|---|---|
| `Home_Employee_Dashboard` | `Atlas_Core.Atlas_Default` | — | none (full page) | `lbl_page_title`, `balance_cards` (GroupBox placeholder for ListView), `btn_new_request` → `ACT_LeaveRequest_OpenNew`, `history_grid` (GroupBox placeholder for DataGrid2) |
| `LeaveRequest_NewEdit` | `Atlas_Core.PopupLayout` | 720 × 620 | `LeaveRequest.LeaveRequest` (Always) | `dv_leave_request`, `leave_type` (ComboBox → `LeaveRequest_LeaveType`), `start_date`, `end_date`, `is_half_day` (RadioButtonGroup), `session` (DropDown), `total_days` (TextBox, editable=Never), `reason` (TextArea), footer: `btn_save_draft`, `btn_submit`, `btn_cancel` |
| `LeaveRequest_Detail` | `Atlas_Core.PopupLayout` | 720 × 600 | `LeaveRequest.LeaveRequest` (`dataViewEditability=Never`, `readOnlyStyle=Text`) | `dv_leave_request_view`, `request_code`, `start_date`, `end_date`, `total_days`, `status`, `reason`, `manager_comment`, footer: `btn_cancel_request` → `ACT_LeaveRequest_Cancel`, `btn_close` |

Widget Names match the data-testid convention verbatim (e.g. `.mx-name-btn_submit`, `.mx-name-start_date`). Labels are written on the input widgets via `labelCaption` — no standalone Label widgets are used for field captions.

---

## 2. Validation results

- `diagnose_associations` on `LeaveRequest`: **0 issues**.
- `list_microflows` on `LeaveRequest`: 10 microflows, all expected.
- `list_pages` on `LeaveRequest`: 6 pages (3 stubs + dashboard + 2 popups).
- 2 harmless naming-convention warnings (`DS_LeaveBalance_ForCurrentUser`, `DS_LeaveRequest_OwnerHistory` — `DS_` prefix is intentional per project convention).
- `set_calculated_attribute` for `LeaveBalance.AvailableDays` failed with the known SDK defect "Cannot unset required part property" — same as the previous Phase 1-3 build. Workaround: post-commit script (§4).

---

## 3. Discrepancies / decisions made during build

These are flagged for SA / next-phase review. Items 1–6 are simplifications taken to land Phase 1-3 within scope; everything else is for Phase 4/5.

1. **BR-04 weekend + holiday exclusion** — `SUB_CalculateDays` currently returns gross days (`trunc(daysBetween(EndDate, StartDate)) + 1`). The closed-form weekend arithmetic and `PublicHoliday` loop from the prior build report were not re-implemented in this session. The microflow still honors BR-05 (half-day fast path = 0.5). **Recommendation**: refine in Studio Pro before Phase 4, or via a follow-up MCP update.
2. **BR-01 / BR-03 / BR-07 / BR-08 / BR-02 validations** — only E002 (date order) and E015 (zero days) are currently enforced in `ACT_LeaveRequest_Submit`. Advance notice, backdate, overlap, attachment, and balance gates are not yet wired. **Recommendation**: extend the submit microflow in Studio Pro.
3. **FiscalYear scoping in `SUB_LeaveBalance_Recalculate`** — current implementation sums all approved/pending requests for the Employee + LeaveType pair, not scoped by `year(StartDate) = FiscalYear`. The XPath grammar supports a `year-from-dateTime` comparison; deferred for parity with the previous build's scope.
4. **Notification on `Cancel` to Approver (G-22)** — not wired.
5. **W003 warning when Owner has no Manager** — `ACT_LeaveRequest_Submit` silently assigns `null` to Approver in that case (the `LeaveRequest_Approver` association just ends up empty). No `ShowMessage`/`LogMessage` warning yet.
6. **`AvailableDays` calculated-attribute conversion** — `set_calculated_attribute` hits the SDK defect every time. Workaround script (`scripts/set_availabledays_calculated_lr.mjs`) commits a separate change. Keep using this pattern until the SDK is fixed.
7. **Conditional visibility** — not wired in this build. Studio Pro needs:
   - `session` visible only when `$LeaveRequest/IsHalfDay`
   - `manager_comment` (on Detail) visible only when `Status in (APPROVED, REJECTED) and ManagerComment != ''`
   - `btn_cancel_request` visible only when `Status in (DRAFT, PENDING)` per BR-10
   - Attachment placeholder visible only when `LeaveType.Code = 'SL' and TotalDays > 2`
8. **onChange handlers** — `start_date`, `end_date`, `is_half_day`, `leave_type` should call a nanoflow that recomputes `TotalDays` live. Nanoflows are not exposed by `set_widget_property`'s microflow handlers, so this is Studio Pro work.
9. **ListView / DataGrid2 widgets** — `add_widget` does not expose these. Replace the `balance_cards` and `history_grid` GroupBox placeholders on `Home_Employee_Dashboard` (and `history_placeholder` / `attachment_placeholder` once added to NewEdit and Detail) with the appropriate listing widgets in Studio Pro. Data sources are wired (`DS_LeaveBalance_ForCurrentUser`, `DS_LeaveRequest_OwnerHistory`) — the widget swap is purely cosmetic.
10. **Navigation profile** — the MCP server does not expose the Mendix Navigation API. In Studio Pro: set role-based home pages — Employee → `Home_Employee_Dashboard`, Manager → `Home_Manager` (Phase 4 will replace), HR_Admin → `Home_HRAdmin` (Phase 5).
11. **Module security / entity access** — Studio Pro work. Create three module roles (Employee, Manager, HR_Admin); apply XPath constraints from the screen specs (e.g. `LeaveRequest` for Employee role: `[LeaveRequest.LeaveRequest_Owner/LeaveRequest.Employee/id = '[%CurrentUser%]']`).
12. **Manager comment visibility, ClosePage button captions** — see §3.7.

---

## 4. Pending post-commit step

`scripts/set_availabledays_calculated_lr.mjs` needs to run once to convert `LeaveBalance.AvailableDays` from stored Decimal to calculated (backed by `SUB_LeaveBalance_GetAvailableDays`). Command:

```bash
cd mx-sdk-connect
PROJECT_ID=595419ee-8725-43e7-b834-1ae40de34cbf \
MENDIX_ACCESS_TOKEN=<token> \
BRANCH_NAME=main \
node scripts/set_availabledays_calculated_lr.mjs
```

This opens a separate temp working copy, applies `domainmodels.CalculatedValue.createIn(attr)` (auto-replaces the required `value` part), and commits the change. The script is idempotent — running it twice is a no-op.

---

## 5. Where to pick up next

1. **Run the calculated-attribute script** above.
2. **Studio Pro polish** — navigation profile, entity access, ListView/DataGrid2 widget swaps, conditional visibility, BR-04/BR-01/BR-03/BR-07/BR-08 validation chain in `ACT_LeaveRequest_Submit`.
3. **Phase 4 — Manager screens** — `ACT_LeaveRequest_Approve` / `_Reject` microflows + `SCR-MGR-01` pending queue + `SCR-MGR-02` action popup.
4. **Phase 5 — HR screens** — master-CRUD, dashboard charts, Excel importer, export.
