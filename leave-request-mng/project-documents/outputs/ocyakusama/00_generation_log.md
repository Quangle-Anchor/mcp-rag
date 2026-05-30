# 00. Generation Log

**Run date**: 2026-05-15
**Operator**: Nam Vu Le (via Claude / `rd-to-bd` skill)
**System**: Mendix Leave Management System
**Output location**: `C:\000_NAMVL\02. Working\01.AI\leave-request-mng\Outputs\`

---

## 1. Inputs Inventory

| File                                  | Classification (IPA)         | Status      |
|---------------------------------------|------------------------------|-------------|
| `Requirement Defination Document.md`  | 業務要件定義書 / 機能一覧     | Mandatory ✓ |
| `Domain Definition.md`                | 概念ER図 + Enum / 値リスト    | Mandatory ✓ |
| `Screen Flow Specification.md`        | 業務フロー / 画面遷移         | Mandatory ✓ |
| `Screen List.md`                      | 画面一覧                      | Supporting ✓ |
| `Business Rules.md`                   | 業務ルール一覧                | Supporting ✓ |
| `Code Definition.md`                  | コード定義                    | Supporting ✓ |
| `Domain Glossary.md`                  | 用語集                        | Supporting ✓ |

All mandatory IPA inputs are present. No fabrication of mandatory inputs required.

## 2. Outputs Generated

| File                                  | Purpose                                                         |
|---------------------------------------|-----------------------------------------------------------------|
| `01_physical_er.md`                   | Physical ER (Mermaid + table catalog + index recommendations).  |
| `01_physical_er.yaml`                 | Machine-readable physical ER (entities, attributes, indexes).   |
| `02_screen_list.yaml`                 | All screens + role + transitions + function matrix.             |
| `03_message_list.yaml`                | E/W/I/C messages with JP+EN, cross-referenced from validations. |
| `screens/SCR-EMP-01.yaml`             | Employee Dashboard                                              |
| `screens/SCR-EMP-02.yaml`             | Leave Request Form (entry, popup)                               |
| `screens/SCR-EMP-03.yaml`             | Request Detail View (read-only popup)                           |
| `screens/SCR-MGR-01.yaml`             | Manager Approval Dashboard                                      |
| `screens/SCR-MGR-02.yaml`             | Approval Action Dialog                                          |
| `screens/SCR-HR-01.yaml`              | HR Overview Dashboard                                           |
| `screens/SCR-HR-02.yaml`              | Leave Type Master Data                                          |
| `screens/SCR-HR-03.yaml`              | Employee Balance Manager                                        |
| `screens/SCR-HR-04.yaml`              | Audit & Export Reports                                          |
| `99_gap_report.md`                    | 30 gap items grouped 6 categories.                              |

## 3. Key Decisions Made

1. **Mendix-aware naming** — Entities `PascalCase` per `Code Definition.md §5`. Physical table names `UPPER_SNAKE_CASE` (DB convention) while attribute names follow Mendix `PascalCase`.
2. **Audit columns added** — Every business entity carries `createdDate/changedDate/createdBy/changedBy/version` (RDD §4.3).
3. **Soft delete** — Applied to `LeaveRequest`, `LeaveBalance`, `Employee`. `CANCELLED` status used instead of `DeletedFlag` on requests (per Code Def §2 wording).
4. **SystemCounter table** — Introduced to implement `LRQ-YYYYMM-#####` immutable sequence (Code Def §4).
5. **`AvailableDays` persistence** — Modeled as stored attribute; recalc on every state change. Marked as gap (G-05) for SA confirmation.
6. **State machine** — Encoded on `LeaveRequest` entity to reflect Domain Def §3 (`DRAFT → PENDING → APPROVED/REJECTED`, `CANCELLED only from PENDING`).
7. **Screen ID scheme** — Preserved the RD-provided IDs (`SCR-EMP-01` … `SCR-HR-04`) rather than re-coining; downstream traceability is cleaner.
8. **Glossary mapping** — Used Japanese `caption_ja` keys on labels while keeping English attribute names per Glossary "Implementation Guidelines".
9. **Message codes** — Generated 16 errors (E), 3 warnings (W), 6 information (I), 4 confirmation (C). Each tied to a `source:` BR-## or RDD section.
10. **No-fabrication compliance** — Items that could not be derived (4 master maintenance screens, holiday seed, email body, etc.) are listed in `99_gap_report.md` rather than invented in the BD.

## 4. Coverage Check

### 4.1 Function → Screen
| Function (RDD §3.1)              | Covered Screen(s)                                  | Status |
|----------------------------------|----------------------------------------------------|--------|
| UC-01 View Leave Dashboard       | SCR-EMP-01                                         | ✓ |
| UC-02 Submit Leave Request       | SCR-EMP-01 (entry), SCR-EMP-02 (form), SCR-EMP-03 (view) | ✓ |
| UC-03 Process Leave Request      | SCR-MGR-01 (queue), SCR-MGR-02 (decide)           | ✓ |
| UC-04 Automated Balance Calc     | *No UI screen — invoked by SCR-EMP-02 Submit & SCR-MGR-02 Approve* | ✓ (background) |
| HR Master Data                   | SCR-HR-02                                          | ✓ |
| HR Balance Admin                 | SCR-HR-03                                          | ✓ |
| HR Audit Export                  | SCR-HR-04                                          | ✓ |
| HR Analytics                     | SCR-HR-01                                          | ✓ |

### 4.2 Entity → CRUD Coverage
| Entity              | Created       | Read              | Updated              | Deleted          | Status |
|---------------------|---------------|-------------------|----------------------|------------------|--------|
| Employee            | (Admin module / G-04) | SCR-MGR-02, SCR-HR-03/04 | (Admin module)       | *soft via flag*  | ⚠ G-04 |
| Department          | (G-02)        | SCR-HR-03/04      | (G-02)               | (G-02)           | ⚠ G-02 |
| LeaveType           | SCR-HR-02     | many              | SCR-HR-02            | SCR-HR-02 (soft) | ✓ |
| LeaveBalance        | SCR-HR-03     | SCR-EMP-01, SCR-MGR-02, SCR-HR-03 | SCR-MGR-02, SCR-HR-03 | (none direct)    | ✓ |
| LeaveRequest        | SCR-EMP-02    | SCR-EMP-01/03, SCR-MGR-01/02, SCR-HR-04 | SCR-EMP-02/03, SCR-MGR-02 | (status only) | ✓ |
| RequestAttachment   | SCR-EMP-02    | SCR-EMP-02/03, SCR-MGR-02 | SCR-EMP-02       | SCR-EMP-02       | ✓ |
| RequestHistory      | SCR-EMP-03, SCR-MGR-02 | SCR-EMP-03, SCR-HR-04 | (immutable)       | (none)           | ✓ |
| PublicHoliday       | (G-03)        | SUB_CalculateDays | (G-03)               | (G-03)           | ⚠ G-03 |
| SystemCounter       | bootstrap     | (SUB_GenerateCode)| ACT_LeaveRequest_Submit | (none)         | ✓ |

### 4.3 Reference Integrity
- Every `table_column` in screen YAMLs resolves to an attribute in `01_physical_er.yaml`. ✓
- Every message code (E/W/I/C) referenced in screen events exists in `03_message_list.yaml`. ✓ (E001-E016, W001-W003, I001-I006, C001-C004 — all defined and all referenced at least once.)
- Every screen-to-screen transition in `02_screen_list.yaml` corresponds to an event in the source screen YAML. ✓

## 5. Open Items / Hand-off

- **For BA**: review `99_gap_report.md §1, §3` (data + UX gaps).
- **For SA**: review `99_gap_report.md §2, §5` (workflow + security).
- **For HR stakeholder**: confirm fiscal year (G-06), email templates (G-21), Compensatory/Special Leave scope (G-11, G-12).
- **Next phase**: Mx-AI-Harness page generation can consume `screens/*.yaml` directly. Recommended order: `SCR-EMP-02` → `SCR-EMP-01` → `SCR-MGR-02` → `SCR-MGR-01` → HR screens.
