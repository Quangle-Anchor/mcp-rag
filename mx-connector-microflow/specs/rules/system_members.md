---
audiences: [spec-scan, tool-call]
triggers:
  spec-scan: "spec includes audit-style columns or relationships (createdAt / updatedAt / createdBy / changedBy attributes, or 'creator' / 'modifier' associations to a User-like entity)"
  tool-call: "before adding any audit-style attribute (DateTime createdAt/updatedAt, Reference to a User-like entity for createdBy/changedBy) via add_attribute / create_entity / create_association / create_multiple_associations"
status: advisory
---

# System Members — Planning Guidance

Mendix entities expose four built-in **system members** that the platform manages
automatically at runtime. They are surfaced on an entity by setting boolean flags on
`NoGeneralization`. They do not need (and **must not** be re-created as) user-defined
attributes or associations.

---

## The four system members

| Member | SDK type | Enabled by flag | Auto-set on… | When stored |
|---|---|---|---|---|
| `createdDate` | `DateTime` attribute | `hasCreatedDate=true` | first commit (insert) | every persistable entity row |
| `changedDate` | `DateTime` attribute | `hasChangedDate=true` | every commit | every persistable entity row |
| `System.owner` | Association → `System.User` | `hasOwner=true` | first commit (insert) | every persistable entity row |
| `System.changedBy` | Association → `System.User` | `hasChangedBy=true` | every commit | every persistable entity row |

Flags accepted by `create_entity` (Tool 5), `create_multiple_entities` (Tool 6),
`create_domain_model` (Tool 7), and the entity entries inside `create_multiple_entities`.

**Specialization entities inherit all four flags from the root ancestor.** Setting
the flags on a specialization is ignored — and adding a user-defined attribute called
`CreatedAt` on a specialization is doubly wrong because it shadows nothing while still
duplicating the inherited member.

---

## Decision rule (apply this before calling a tool)

Before adding an attribute or association whose intent is "track who/when this row
was created or last changed", check the synonym lists below.

- **If the proposed name matches a synonym → DO NOT create the attribute/association.**
  Set the corresponding flag on the entity instead, and explain to the user why
  (auto-managed, no microflow needed, free of consistency errors at project load).
- **Only override** when the user has explicitly stated they need a *separate*
  column distinct from Mendix's built-in (e.g. importing pre-existing timestamps
  that should not be touched on subsequent edits). Even then, prefer a PascalCase
  variant like `ImportedAt` over a synonym of the system name.

The exact reserved names — `id`, `createdDate`, `changedDate`, `owner`, `changedBy`
(case-sensitive) — are **hard-blocked** by the attribute builders. The synonyms
below are softer signals that emit a warning in the tool response.

---

## Attribute name synonyms

Case-insensitive. If a user asks for any of these as a `DateTime` (or `String` that
will hold a date), suggest the flag instead.

| Synonym pattern | Examples | Recommendation |
|---|---|---|
| `created` / `create` / `creation` + optional `_date`/`_at`/`_on`/`_time` | `CreatedAt`, `CreatedOn`, `CreatedDate`, `CreatedTime`, `CreateDate`, `DateCreated`, `CreationDate` | `hasCreatedDate=true` |
| `changed` / `modified` / `updated` / `last_modified` / `last_updated` / `last_changed` + optional `_date`/`_at`/`_on`/`_time` | `ChangedAt`, `ModifiedAt`, `ModifiedDate`, `UpdatedAt`, `UpdatedDate`, `LastModified`, `LastUpdated`, `LastChanged`, `DateModified` | `hasChangedDate=true` |

User-supplied strings that happen to differ only by underscore or casing
(`created_at`, `CREATEDAT`, `created  at`) still match.

---

## Association name synonyms

Case-insensitive. Only flag the association when its **target** is `System.User`
or a known specialization of it (e.g. `Administration.Account`).

| Synonym pattern | Examples | Recommendation |
|---|---|---|
| `owner` / `created_by` / `creator` / `author` | `Owner`, `CreatedBy`, `Creator`, `Author`, association `MyEntity_CreatedBy` → `System.User` | `hasOwner=true` |
| `changed_by` / `modified_by` / `updated_by` / `last_edited_by` | `ChangedBy`, `ModifiedBy`, `UpdatedBy`, `LastEditedBy`, association `MyEntity_ChangedBy` → `System.User` | `hasChangedBy=true` |

Mendix-style association names (`Parent_Child`) match when either side of the
underscore satisfies the synonym pattern.

Note: an association to `System.User` for a domain reason that is **not**
ownership/audit (e.g. "AssignedTo", "Reviewer", "Approver", "Manager") is
legitimate — those names do not match the synonym list. Build the association
normally.

---

## What this looks like at runtime

`create_entity` / `create_multiple_entities` / `add_attribute` and the three
association builders run the synonym check after their pre-flight validation. A
match appends a non-fatal entry to the response's `warnings` field, e.g.:

```
Attribute 'CreatedAt' (DateTime) on entity 'LeaveRequest3.Request' looks like
Mendix's built-in 'createdDate' system member. Prefer: set hasCreatedDate=true
on the entity instead of creating this attribute — Mendix populates createdDate
automatically on insert and surfaces it via NoGeneralization.hasCreatedDate.
Set the input flag `allowSystemMemberSynonym: true` to silence this warning.
```

```
Association 'Request_CreatedBy' from 'LeaveRequest3.Request' to 'System.User'
looks like Mendix's built-in 'System.owner' system member. Prefer:
set hasOwner=true on entity 'LeaveRequest3.Request' instead of creating this
association — Mendix manages System.owner automatically.
```

The tool still creates the requested element — the warning surfaces in the
response so the planner (and the user) can decide whether to undo the call and
flip the flag instead.

---

## See also

- `system_specialization.md` — specializing `System.FileDocument` / `System.Image` / `System.User` (audit flags are inherited from those parents too).
- `user_entity_generalization.md` — when to reach for `Administration.Account` instead of a literal user FK.
- `../tools/domain_model.md` — Tool 5 (`create_entity`), Tool 6 (`create_multiple_entities`)
- `../tools/attributes.md` — Tool 15 (`add_attribute`)
- `../tools/associations.md` — Tool 7 / 8 (`create_association`, `create_multiple_associations`), `create_cross_module_association`
