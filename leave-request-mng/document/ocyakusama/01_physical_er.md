# 01. Physical ER Diagram — Mendix Leave Management System

**Source RD**: `Requirement Defination Document.md §3.2`, `Domain Definition.md`, `Code Definition.md`, `Domain Glossary.md`
**Target stack**: Mendix Studio Pro (Internal Database). Entity names are PascalCase singular per `Code Definition.md §5`.
**Audit columns**: Every business entity carries `createdDate`, `changedDate`, `createdBy`, `changedBy`, `version` (optimistic locking). Audit trail mandated by `Requirement Defination Document.md §4.3`.
**Soft delete**: Applied to transactional / master entities that require historical retention (`LeaveRequest`, `LeaveBalance`, `Employee`).

---

## 1. Mermaid ER Diagram

```mermaid
erDiagram
    EMPLOYEE ||--o{ LEAVE_BALANCE      : "holds"
    EMPLOYEE ||--o{ LEAVE_REQUEST      : "submits (Owner)"
    EMPLOYEE ||--o{ LEAVE_REQUEST      : "approves (Approver)"
    EMPLOYEE }o--|| DEPARTMENT         : "belongs_to"
    EMPLOYEE }o--o| EMPLOYEE           : "reports_to (Manager)"
    LEAVE_TYPE ||--o{ LEAVE_BALANCE    : "categorizes"
    LEAVE_TYPE ||--o{ LEAVE_REQUEST    : "typed_as"
    LEAVE_REQUEST ||--o{ REQUEST_ATTACHMENT : "has_proof"
    LEAVE_REQUEST ||--o{ REQUEST_HISTORY    : "has_audit_trail"
    SYSTEM_COUNTER ||..|| LEAVE_REQUEST     : "issues_id_for"
    PUBLIC_HOLIDAY }o..o{ LEAVE_REQUEST     : "excluded_from_count"

    EMPLOYEE {
        string  EMPLOYEE_ID         PK  "EMP-YYYY-#####"
        enum    ROLE                    "Employee/Manager/HR_Admin"
        string  DEPARTMENT_ID       FK
        string  MANAGER_EMPLOYEE_ID FK  "self-ref, nullable"
        date    HIRE_DATE
        bool    ACTIVE_FLAG
        bool    DELETED_FLAG
        long    VERSION
    }
    DEPARTMENT {
        string  DEPARTMENT_ID       PK  "DEP-###"
        string  DEPARTMENT_NAME
        bool    ACTIVE_FLAG
    }
    LEAVE_TYPE {
        string  LEAVE_TYPE_ID       PK  "LTP-### / business code AL,SL,UL,SPL,COM"
        string  CODE                    "AL/SL/UL/SPL/COM"
        string  NAME_EN
        string  NAME_JP
        bool    IS_PAID
        decimal DEFAULT_YEARLY_ALLOCATION
        bool    REQUIRES_ATTACHMENT_OVER_2D
        bool    SKIP_BALANCE_CHECK
        bool    ALLOW_BACKDATE
        int     MAX_BACKDATE_DAYS
        bool    ACTIVE_FLAG
    }
    LEAVE_BALANCE {
        long    LEAVE_BALANCE_ID    PK
        string  EMPLOYEE_ID         FK
        string  LEAVE_TYPE_ID       FK
        int     FISCAL_YEAR
        decimal TOTAL_DAYS              "Entitlement (付与日数)"
        decimal USED_DAYS
        decimal PENDING_DAYS
        decimal CARRY_OVER
        date    CARRY_OVER_EXPIRY       "Default: YYYY-03-31"
        decimal AVAILABLE_DAYS          "computed: TOTAL+CARRY-USED-PENDING"
        bool    DELETED_FLAG
        string  CREATED_BY
        string  CHANGED_BY
        long    VERSION
    }
    LEAVE_REQUEST {
        long    LEAVE_REQUEST_ID    PK
        string  REQUEST_CODE            "LRQ-YYYYMM-##### (unique, immutable)"
        string  OWNER_EMPLOYEE_ID   FK
        string  APPROVER_EMPLOYEE_ID FK "nullable until routed"
        string  LEAVE_TYPE_ID       FK
        date    START_DATE
        date    END_DATE
        bool    IS_HALF_DAY
        enum    SESSION                 "FULL/AM/PM"
        decimal TOTAL_DAYS              "calc by ACT_LeaveRequest_CalculateDays"
        string  REASON
        enum    STATUS                  "DRAFT/PENDING/APPROVED/REJECTED/CANCELLED"
        string  MANAGER_COMMENT
        datetime SUBMITTED_AT
        datetime DECIDED_AT
        bool    DELETED_FLAG
        string  CREATED_BY
        string  CHANGED_BY
        long    VERSION
    }
    REQUEST_ATTACHMENT {
        string  CONTENT_TYPE
        datetime UPLOADED_AT
        string  UPLOADED_BY
    }
    REQUEST_HISTORY {
        long    HISTORY_ID          PK
        long    LEAVE_REQUEST_ID    FK
        enum    FROM_STATUS
        enum    TO_STATUS
        string  ACTOR_EMPLOYEE_ID
        string  COMMENT
        datetime EVENT_AT
    }
    PUBLIC_HOLIDAY {
        long    HOLIDAY_ID          PK
        date    HOLIDAY_DATE            "unique per year"
        string  NAME_EN
        string  NAME_JP
        bool    RECURRING
        bool    ACTIVE_FLAG
    }
    SYSTEM_COUNTER {
        string  COUNTER_KEY         PK  "e.g., LRQ-202605"
        long    CURRENT_VALUE
    }
```

---

## 2. Table Catalog

| Physical Table         | Type        | Purpose                                                    | Source |
|------------------------|-------------|------------------------------------------------------------|--------|
| `EMPLOYEE`             | Master      | User profile extending `Administration.Account`            | RDD §3.2 |
| `DEPARTMENT`           | Master      | Organisational unit. Required by `DEP-###` ID format        | Code Def §1 |
| `LEAVE_TYPE`           | Master      | Leave categories (AL/SL/UL/SPL/COM)                         | Domain Def §2.A |
| `LEAVE_BALANCE`        | Transaction | Per-employee per-type entitlement / usage                   | RDD §3.2 |
| `LEAVE_REQUEST`        | Transaction | Workflow record (Draft → Approved/Rejected)                 | RDD §3.2 |
| `REQUEST_ATTACHMENT`   | Transaction | Medical Cert proof when SL > 2d (BR-08)                     | Business Rules BR-08 |
| `REQUEST_HISTORY`      | Audit       | Mandatory state-transition log                              | RDD §4.3 |
| `PUBLIC_HOLIDAY`       | Master      | Used by day-count exclusion (BR-04)                         | Business Rules BR-04 |
| `SYSTEM_COUNTER`       | System      | Issues sequential numbers for `LRQ-YYYYMM-#####`            | Code Def §4 |

---

## 3. Index Recommendations

| Table            | Index                                                | Rationale                                            |
|------------------|------------------------------------------------------|------------------------------------------------------|
| `EMPLOYEE`       | UQ(`ACCOUNT_GUID`), IX(`DEPARTMENT_ID`), IX(`MANAGER_EMPLOYEE_ID`) | Login lookup, dept filter, team retrieval. |
| `LEAVE_BALANCE`  | UQ(`EMPLOYEE_ID`,`LEAVE_TYPE_ID`,`FISCAL_YEAR`), IX(`EMPLOYEE_ID`) | One row per emp/type/year; dashboard query.  |
| `LEAVE_REQUEST`  | UQ(`REQUEST_CODE`), IX(`OWNER_EMPLOYEE_ID`,`STATUS`), IX(`APPROVER_EMPLOYEE_ID`,`STATUS`), IX(`START_DATE`,`END_DATE`) | History list, manager queue, overlap check (BR-07). |
| `REQUEST_HISTORY`| IX(`LEAVE_REQUEST_ID`)                              | Trace lookup.                                        |
| `PUBLIC_HOLIDAY` | UQ(`HOLIDAY_DATE`)                                  | BR-04 day-count exclusion.                           |
| `SYSTEM_COUNTER` | PK(`COUNTER_KEY`)                                   | Atomic increment (lock row in `SUB_GenerateCode`).   |

---

## 4. Notes for SA Review

- **`EMPLOYEE` specializes `Administration.Account`**: `AccountGuid`, `FullName`, `Email` are inherited from `Administration.Account`/`System.User` and must NOT be re-declared. XPath for current-user scoping on this entity uses `[id = '[%CurrentUser%]']` directly (no association join needed).
- **`REQUEST_ATTACHMENT` specializes `System.FileDocument`**: `FileName` (→ `Name`), `FileBlob` (→ `Contents`), `SizeBytes` (→ `Size`), `AttachmentId` (→ built-in `id`) are all inherited and must NOT be re-declared. `LeaveRequestId` FK is replaced by the `Attachment_LeaveRequest` association.
- **`createdDate` / `changedDate` / `owner` / `changedBy` on all entities**: managed by Mendix system flags (`hasCreatedDate=true` / `hasChangedDate=true` / `hasOwner=true` / `hasChangedBy=true`) — do not declare `CreatedBy`, `ChangedBy`, or their synonyms as user attributes. All four flags are set on every non-specialization business entity (`LeaveBalance`, `LeaveRequest`). Specialization entities (`Employee`) inherit these from the root ancestor and must not redeclare them.
- `LEAVE_BALANCE.AVAILABLE_DAYS` may be **stored derived** (kept in sync via `ACT_LeaveBalance_Recalculate`) **OR** **computed-at-read** via Calculated attribute. Decision deferred to SA — see `99_gap_report.md`.
- Soft delete (`DELETED_FLAG`) vs. hard delete on `LEAVE_REQUEST` cancellation: per `Code Definition.md §2`, `CANCELLED` is "Logical delete (record remains for audit)" → use status, not `DELETED_FLAG`.
- M:N between `LEAVE_REQUEST` and `PUBLIC_HOLIDAY` is **not materialised** — exclusion is computed in `SUB_CalculateDays` (BR-04).
