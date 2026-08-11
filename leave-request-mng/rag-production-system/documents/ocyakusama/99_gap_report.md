# 99. Gap Report — Items Requiring BA / SA Decision

**System**: Mendix Leave Management System
**Generated**: 2026-05-15
**Purpose**: Items in the BD that could NOT be auto-derived from the RD with sufficient confidence. These are deliverables for the 中間レビュー gate — they are NOT failures.

Legend:
- **Type**: `MISSING` (no RD info), `INFERRED` (one plausible interpretation chosen), `AMBIGUOUS` (conflicting RD signals), `NON-FUNCTIONAL` (RD lists policy but no implementation), `OUT-OF-SCOPE` (likely future scope).

---

## 1. Domain / Data Model

| # | Type | Item | RD Source / Trigger | Decision Needed | Recommended Default |
|---|------|------|---------------------|-----------------|---------------------|
| G-01 | INFERRED | `Department` master entity inferred from ID format `DEP-###`. | `Code Definition.md §1` | Confirm `Department` is in V1 scope; otherwise drop `Employee.DepartmentId` FK. | Keep — Excel import requires dept tagging. |
| G-02 | MISSING  | No screen to maintain `Department` master. | Implied by G-01 | Add `SCR-HR-05 Department Master` OR seed via Excel only. | Add SCR-HR-05 in V1.1; seed in V1 via Excel. |
| G-03 | MISSING  | No screen to maintain `PublicHoliday` master, yet BR-04 depends on it. | `Business Rules BR-04` | Add `SCR-HR-06 Public Holiday Master` OR seed only. | Add SCR-HR-06 — recurring annual data load. |
| G-04 | MISSING  | No screen to onboard `Employee` master (RDD says it extends `Administration.Account`). | `RDD §3.2` | Either reuse Mendix `Administration.Account_Overview` snippet OR build `SCR-HR-07 Employee Master`. | Reuse `Administration` snippet + extend with extra attributes. |
| G-05 | AMBIGUOUS | `LeaveBalance.AvailableDays` — stored vs computed. | `RDD §3.2 / Glossary` | SA decides: persisted (faster read, recalc risk) vs Mendix calculated attribute (always correct). | Persist; recalc inside `ACT_LeaveBalance_Recalculate` triggered by every state change. |
| G-06 | INFERRED | `LeaveBalance.FiscalYear` granularity assumed to be calendar year (Jan-Dec). | `Domain Def §2.A 'yearly'` | Confirm fiscal-year convention with HR (April-March in JP is common). | Choose April-March if Japanese fiscal-year is standard for the client. |
| G-07 | INFERRED | `LeaveBalance` is keyed by `(Employee, LeaveType, FiscalYear)`. | Inferred from BR-09 carry-over | Confirm uniqueness; one row per type per year OR cumulative. | One row per (Emp, Type, Year). |
| G-08 | MISSING  | Approver routing when employee has no `ManagerEmployeeId` (e.g., CEO, contractors). | `BR-06` | Default fallback to HR group or first HR_Admin user? | Route to HR_Admin role inbox (warn via W003). |

## 2. Workflow / Microflows

| # | Type | Item | RD Source | Decision Needed | Recommended Default |
|---|------|------|-----------|-----------------|---------------------|
| G-09 | INFERRED | `Cancellation` event (PENDING → CANCELLED) is enabled on `SCR-EMP-03` but not in Screen List. | `Domain Def §3 Status Transition Rule` | Confirm employee can self-cancel a PENDING request. | Allow self-cancel (matches transition rule). |
| G-10 | MISSING  | `Carry-over expiry` scheduled task (BR-09). | `Business Rules BR-09` | Where to run — Mendix scheduled event? Time of day? Notification? | Daily 02:00 JST; mail summary to HR_Admin. |
| G-11 | MISSING  | `Compensatory Leave` earning logic — "Earned via weekend work logic". | `Code Definition.md §3 COM-P` | Is COM earning in scope for V1? Source data (timesheet?) is unspecified. | Out of scope for V1; manual adjustment via SCR-HR-03 only. |
| G-12 | MISSING  | `Special Leave` workflow (`SPL-P` requires manual HR approval). | `Code Definition.md §3 SPL-P` | Same manager approval flow + extra HR step? Or HR-only approval? | Treat as manager → HR two-stage approval; deferred to V1.1. |
| G-13 | AMBIGUOUS | "Manager Comment required on REJECT" — RDD says yes; also implied for APPROVE (good practice)? | `RDD UC-03 / Code Def §2` | Make comment optional on APPROVE? | Optional on APPROVE; required on REJECT (current spec). |
| G-14 | NON-FUNCTIONAL | Optimistic locking strategy — `version` column proposed but not explicit in RDD. | `RDD §4.3 audit only` | Confirm SA wants optimistic locking. | Yes — required for concurrent manager actions. |

## 3. UI / UX

| # | Type | Item | RD Source | Decision Needed | Recommended Default |
|---|------|------|-----------|-----------------|---------------------|
| G-15 | INFERRED | `SCR-EMP-01` "Balance Cards" layout — number of cards = number of LeaveTypes? | `RDD §3.3 Data View` | Cards for ALL active types or top N + "show more"? | All active types, sorted by `LeaveType.Code`. |
| G-16 | INFERRED | `SCR-HR-01` charts (trend / type distribution / department absence) — inferred from "visual analytics". | `Screen List.md SCR-HR-01` | UX wireframe needed; chart library (Mendix Charts vs custom JS)? | Use Mendix Charts widget; defer final chart list to UX gate. |
| G-17 | INFERRED | `Excel Importer` template column set for SCR-HR-03 (Balance Import). | `RDD §5` | Define the column mapping spec (template). | EmployeeId, LeaveTypeCode, FiscalYear, TotalDays, CarryOver. |
| G-18 | MISSING  | Mobile-specific layouts — RDD says responsive but no mobile mocks. | `RDD §3.3 Atlas UI` | Confirm desktop-first; Atlas responsive defaults acceptable. | Yes — Atlas default responsive. |
| G-19 | INFERRED | Confirmation popups (C001-C004) — count/text is inferred. | None | UX writes final copy. | Use generated `text_ja` as placeholder. |
| G-20 | AMBIGUOUS | Glossary term inconsistency: "Manager" vs "Approver" (`承認者`). | `Glossary / RDD §2.1` | Pick canonical UI term. | Use `承認者` in JP UI; "Approver" in code (per glossary). |

## 4. Notifications / Integration

| # | Type | Item | RD Source | Decision Needed | Recommended Default |
|---|------|------|-----------|-----------------|---------------------|
| G-21 | MISSING | Email template body & subject for `Submit`, `Approve`, `Reject`, `Cancel`. | `RDD §2.2 / §5 SMTP` | Provide JP + EN templates. | Use Mendix Email Module templates; placeholder spec attached as TBD. |
| G-22 | MISSING | Notification on `Cancel` by Owner to Approver — is it required? | Not stated in RDD | Confirm scope. | Send concise notice to current Approver. |
| G-23 | MISSING | Reminder for stale `PENDING` requests (e.g., > 3 days). | Not stated | Add scheduled reminder? | Out of scope V1; revisit if SLA proves needed. |

## 5. Security / Audit

| # | Type | Item | RD Source | Decision Needed | Recommended Default |
|---|------|------|-----------|-----------------|---------------------|
| G-24 | INFERRED | `LeaveBalance` adjustment audit (SCR-HR-03 manual adjust) — log to `RequestHistory` or a new `BalanceAdjustmentLog`? | `RDD §4.3` | Designate audit target. | Add `BalanceAdjustmentLog` entity in V1.1; for V1 reuse `System.Log`. |
| G-25 | INFERRED | HR_Admin bypass of XPath constraints on `LeaveBalance` / `LeaveRequest`. | `RDD §4.3` | Confirm HR_Admin has unrestricted read/write. | Yes — module security HR_Admin module role has full access. |
| G-26 | NON-FUNCTIONAL | Performance: BR-07 overlap retrieval for 500 concurrent users. | `RDD §4.2` | Index `IX_LR_DATES` proposed; load test needed. | Validate during PT phase. |

## 6. Out of Scope (for V1, recorded for completeness)

| # | Item | Reason |
|---|------|--------|
| G-27 | Mobile push notifications. | RDD only requires email. |
| G-28 | Multi-level approval (manager → HR → exec). | RDD describes single-level only. |
| G-29 | Calendar integration (Outlook / Google). | Not in RDD scope. |
| G-30 | Leave forecasting / what-if simulator. | Not in RDD scope. |

---

## Review Gate Summary

- **Mandatory before BD sign-off**: G-05, G-06, G-08, G-10, G-13, G-14, G-17, G-21.
- **Recommended additions**: G-02, G-03, G-04 (additional master screens).
- **Defer to V1.1**: G-11, G-12, G-24, G-27..G-30.
