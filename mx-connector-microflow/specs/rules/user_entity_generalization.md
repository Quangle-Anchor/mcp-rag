---
audiences: [spec-scan, tool-call]
triggers:
  spec-scan: "spec models a person- or account-like entity with an FK or GUID that points at System.User / Administration.Account"
  tool-call: "before creating any entity whose source spec connects it to System.User / Administration.Account via FK or GUID"
status: advisory
---

# User-Entity Generalization — Planning Guidance

When a source artefact (ER diagram, domain definition, data dictionary, schema
dump, etc.) models a **person- or account-like entity** with an FK or GUID that
points at `System.User` / `Administration.Account`, **stop and flag the
Mendix-idiomatic alternative to the user _before_ calling the entity builders**.

The literal-FK reading of the spec is almost always the wrong default in
Mendix. The idiomatic pattern is **specialization** (the entity inherits from
`Administration.Account`, which itself inherits from `System.User`). Pick the
literal interpretation only when the user explicitly opts in.

---

## When this rule fires

Any one of these conditions in the source spec triggers the prompt:

| Trigger                                                                                              | Examples                                                                                                    |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Column named like a user FK                                                                          | `AccountGuid`, `UserId`, `AccountId`, `OwnerGuid`, `CreatorId`, `LoginId`, `SamlSubject`, `Sub`             |
| Column annotation says "FK to System.User / Administration.Account / [%CurrentUser%]"                | `string ACCOUNT_GUID "FK to System.User"`                                                                   |
| The entity already carries `FullName` / `Email` / `LastLogin` alongside such an FK                   | `Employee { AccountGuid, FullName, Email, … }`                                                              |
| The entity's semantic role is a system actor                                                         | `Employee`, `Customer` (when it logs in), `Member`, `Agent`, `Person` used for sign-in                      |
| The spec marks audit columns (`hasOwner`, `hasChangedBy`) on the same entity that also has a user FK | redundancy red flag — `hasOwner` is ignored on specializations and duplicates the FK on non-specializations |

> Heuristic: if Studio Pro's sign-in flow could plausibly _resolve to a row of
> this entity_, treat it as a candidate for `Administration.Account`
> generalization. Look-up tables that merely _reference_ a user (e.g. an
> `Audit_AssignedTo` column on a non-user entity like `Ticket`) do **not**
> trigger this rule — those legitimately use an association.

---

## The trade-off the user must decide

Phrase the prompt as a choice, **not** a recommendation buried in code. Surface
both costs explicitly:

| Option                                                               | Pros                                                                                                                                                                                 | Cons                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Specialization** (`Entity` extends `Administration.Account`)       | `[id = '[%CurrentUser%]']` XPath works out-of-the-box; inherits `Name`/`FullName`/`Email`/`LastLogin`/`Password`; sign-in resolves directly to this entity; no parallel-state drift. | Entity rows are tied to the auth/user store; deleting a user deletes the business entity; harder to import historical user data without auth records.                                                                                                                                               |
| **Literal FK** (string `AccountGuid` / association to `System.User`) | Entity is decoupled from auth; can exist without a corresponding User row; supports importing legacy data with raw GUIDs.                                                            | Every security XPath needs an extra join (`Account_Entity[id = '[%CurrentUser%]']`); `Name`/`Email` duplicated and must be kept in sync; `hasOwner`/`hasChangedBy` flags become redundant or, on specializations, silently ignored; common source of "I can see other people's rows" security bugs. |

Suggested phrasing:

> "The spec models `Employee.AccountGuid` as a String FK to System.User. The
> idiomatic Mendix option is to make `Employee` a specialization of
> `Administration.Account`. That removes `AccountGuid` / `FullName` / `Email`
> (inherited) and lets security XPath use `[id = '[%CurrentUser%]']` directly.
> The literal FK keeps the entity decoupled from auth but every security
> constraint needs an `Account_Employee` join.
> Which do you want?"

Wait for the answer before calling `create_entity` / `create_multiple_entities`.

---

## Skip the prompt when…

- The user has already stated a session-wide preference (e.g. "use generalization for all user entities", "follow the ER literally for this run").
- The trigger column lives on a clearly non-user entity that just _references_ a user (`Ticket.AssignedToUserId`, `Order.SalesAgentId`) — these are legitimate associations to `System.User` and should be modelled as such, subject to `system_members.md` (don't accidentally re-create `System.owner`).
- The artefact explicitly states the entity is read-only / imported / disconnected from auth (e.g. "historical employee snapshot — no login").

---

## What this looks like in practice

On `LeaveRequest2`, the `01_physical_er.md` source had:

```
EMPLOYEE { string ACCOUNT_GUID "FK to System.User" … }
```

The literal-FK reading produced an `Employee` entity with:

- `AccountGuid` (String) — duplicates `System.User.id`
- `FullName` / `Email` — duplicates `Administration.Account.FullName` / `Email`
- `hasOwner` / `hasChangedBy` — would be ignored if the entity were a specialization

The intended idiomatic shape is:

```
Employee  specializes Administration.Account
  + EmployeeId   String   (business code, EMP-YYYY-#####)
  + Role         Enumeration
  + HireDate     DateTime
  + ActiveFlag   Boolean
  + DeletedFlag  Boolean
  + Version      Long
```

Inherited from `Administration.Account` / `System.User`:
`id`, `createdDate`, `changedDate`, `Name`, `FullName`, `Email`, `LastLogin`,
`Password`, `IsAnonymous`, `WebServiceUser`, `Active`, `UserRoles`, …

Note that `hasCreatedDate` / `hasChangedDate` / `hasOwner` / `hasChangedBy`
flags are **inherited from the root ancestor** on a specialization — passing
them in `create_entity` is silently ignored. See `system_members.md` for
details.

---

## Interaction with the existing security rule

The `xpathValidator` (in `mx-connect/src/xpathValidator.ts`) hard-blocks
`Account = '[%CurrentUser%]'` and requires `[id = '[%CurrentUser%]']`. That
guard only works cleanly when the entity that owns the constraint is itself a
`System.User` specialization (directly or transitively) — i.e. when the
generalization choice above has been made. Picking the literal-FK option means
every user-scoped XPath constraint must traverse an association
(`Account_Entity[id = '[%CurrentUser%]']`) and is easy to get wrong.

---

## See also

- `system_members.md` — `hasCreatedDate` / `hasChangedDate` / `hasOwner` / `hasChangedBy` flags are inherited on specializations.
- `system_specialization.md` — the direct `System.FileDocument` / `System.Image` / `System.User` path (allow-list, inherited fields, MCP's raw-value workaround). Reach for `Administration.Account` over `System.User` unless the project is built without the Administration module. **Note: the Administration module is a Mendix Marketplace module that is included in every Mendix project by default, so `Administration.Account` is available in virtually all projects.**
- `xpath_currentuser.md` — the canonical `[id = '[%CurrentUser%]']` rule that this generalization choice enables.
- `../tools/domain_model.md` — Tool 5 (`create_entity`), Tool 6 (`create_multiple_entities`), Tool 12 (`set_entity_generalization`).
- `mx-connect/src/xpathValidator.ts` — the `[%CurrentUser%]` form enforcement.
