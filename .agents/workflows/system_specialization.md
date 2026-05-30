---
audiences: [spec-scan, tool-call]
triggers:
  spec-scan: "spec annotates an entity with `extends: System.FileDocument`, `extends: System.Image`, or similar System-module parent"
  tool-call: "before creating any entity whose spec carries an `extends: System.X` annotation"
status: advisory
---

# System.\* Specialization — Planning Guidance

Mendix's runtime ships a handful of built-in concrete entities (`System.FileDocument`, `System.Image`, `System.User`) that user entities are expected to specialize when they take on the corresponding role (binary upload, image upload, sign-in account). The source ER spec usually flags these with an `extends: "System.X (Mendix)"` line.

Specializing a System entity is **not optional decoration** — Mendix runtime APIs (e.g. the file-upload widget, image download URLs, the sign-in flow) only operate on subtypes of these concrete types. A plain persistable entity with a `Binary` attribute called `Contents` looks identical at first glance but is not a `FileDocument` and will not work with the runtime's file-handling code paths.

---

## Why this rule needs to exist at all

`mendixmodelsdk ^4.110` deliberately does NOT expose the implicit `System` module to user code: `model.allModules()`, `model.findModuleByQualifiedName("System")`, `model.findEntityByQualifiedName("System.FileDocument")`, and `model.allModuleDocuments()` all return null/empty for `System.*`. System types live in a separate `isSystemProject=true` project that ships with Studio Pro / the runtime and is never transmitted to the Platform SDK.

The typed setter `gen.generalization = parentEntity` therefore can't be used here — there is no `IEntity` to assign. `mx-connect` handles the workaround internally (see "How the MCP handles it" below), so callers can pass `System.X` as a regular parent FQN. **The planner does not need to write the workaround by hand**; the planner just needs to know that the `extends` line in the source spec is **honoured** and what comes with it.

---

## When this rule fires

Any of these signals in the source spec means a System.\* parent is in play:

| Trigger                                                                                                                   | Examples                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Spec line `extends: "System.FileDocument (Mendix)"` (or `Image`, `User`)                                                  | `RequestAttachment.extends: "System.FileDocument (Mendix)"`                                                                |
| The entity holds a file payload: columns named `FileBlob`, `Contents`, `FileName`, `SizeBytes`, `ContentType`, `MimeType` | Any "attachment", "document", "upload", "report PDF" entity                                                                |
| The entity holds an image: columns named `ImageBlob`, `Thumbnail`, `Width`, `Height`                                      | Any "avatar", "logo", "photo" entity                                                                                       |
| The entity is a sign-in actor that the spec models with `AccountGuid` / `UserId`                                          | See `user_entity_generalization.md` — `System.User` parents are normally reached transitively via `Administration.Account` |

---

## Supported parents (allow-list)

Only the FQNs in `KNOWN_SYSTEM_PARENT_ENTITIES` (`src/sharedResolvers.ts`) are accepted. Passing anything else throws at pre-flight — this is intentional, because an unknown `System.*` FQN would still commit successfully but break Studio Pro at project load with a "Broken reference" error that is hard to attribute.

| Parent FQN            | Use it when…                                                                                                                                                                | Inherits (do NOT re-declare these as user attributes)                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `System.FileDocument` | The entity stores an uploaded file or generated document.                                                                                                                   | `Name` (String, file name), `Contents` (Binary, the payload), `Size` (Long, byte size), `HasContents` (Boolean, auto-managed), `DeleteAfterDownload` (Boolean). Also `createdDate` / `changedDate` flags are inherited from the root System ancestor. |
| `System.Image`        | The entity stores an uploaded image (specialized FileDocument; Studio Pro's image widgets check for this subtype).                                                          | Everything from `System.FileDocument` plus image-specific runtime handling.                                                                                                                                                                           |
| `System.User`         | Rare — users normally specialize the intermediate `Administration.Account` instead. Reach for this only when explicitly told and the Administration module is not in scope. | `id` (GUID), `Name` (login), `Password` (HashedString), `Active` (Boolean), `LastLogin` (DateTime), `IsAnonymous`, `WebServiceUser`, `UserRoles`.                                                                                                     |

When a future Mendix version adds another specialization-eligible System entity, append it to `KNOWN_SYSTEM_PARENT_ENTITIES`. Until that edit ships, the planner cannot route around the allow-list.

---

## What NOT to redeclare as user attributes

A literal reading of an ER spec for a `FileDocument` subtype typically lists `FileName`, `FileBlob`, `SizeBytes`, `ContentType`, `UploadedAt`, `UploadedBy`. Drop the first three:

| Spec column                                                 | Action                                                                                                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FileName`                                                  | **Drop.** Use inherited `System.FileDocument.Name`.                                                                                                                                                 |
| `FileBlob` / `Contents`                                     | **Drop.** Use inherited `System.FileDocument.Contents`.                                                                                                                                             |
| `SizeBytes` / `FileSize`                                    | **Drop.** Use inherited `System.FileDocument.Size`.                                                                                                                                                 |
| `HasContents`                                               | **Drop.** Always available; auto-managed at commit.                                                                                                                                                 |
| `ContentType` / `MimeType`                                  | **Keep** — not inherited (Mendix only tracks the binary payload, not its declared MIME type).                                                                                                       |
| `UploadedAt`                                                | **Keep** as an explicit attribute if domain semantics require it (e.g. for audit display). The inherited `createdDate` is close but is only set on insert and may not be queryable in the same way. |
| `UploadedBy`                                                | **Keep** — the inherited `System.owner` association requires `hasOwner` on the root ancestor, which is opt-in. If the spec needs a string GUID column for portability, keep it as a user attribute. |
| `AttachmentId` / `DocumentId` (`pk: true, generated: true`) | **Drop.** Use the Mendix built-in `id` like any other persistable entity.                                                                                                                           |

The same pruning applies to `System.Image` subtypes for the file fields, plus `Width` / `Height` are inherited.

For `System.User` subtypes (and, transitively, `Administration.Account` subtypes), drop `AccountGuid` / `LoginId`, `Password`, `Name`, `Email`, `FullName` — see `user_entity_generalization.md`.

---

## How the MCP handles it (so planners know it "just works")

Pass `System.FileDocument` (or `System.Image`, `System.User`) as `generalization.parentEntity` to `create_entity` / `create_multiple_entities` / `set_entity_generalization` exactly as you would `Administration.Account`. The builder:

1. Validates the FQN against `KNOWN_SYSTEM_PARENT_ENTITIES` (pre-flight, no mutation).
2. Creates the `Generalization` element on the child entity.
3. Writes the parent qualified name into the underlying `ByNameReferenceProperty` via `gen.__generalization.updateWithRawValue("System.X")` — bypassing the typed setter, which would fail because the SDK cannot resolve the System target. This is the technique documented at <https://www.mendix.com/blog/a-mendix-sdk-primer-part-2/>.
4. At commit time the SDK serialises the by-name reference as a plain string; Studio Pro and the Mendix runtime resolve it at project-load time because they DO have the system project.

The whole sequence lives in `applyGeneralization()` (`src/sharedResolvers.ts`). The planner does not have to know any of this — it is captured here so that an agent reading the rule understands why the implementation looks unusual and does not try to "fix" the raw-write call.

---

## Verification quirks

After committing, `mcp__mx-connect__read_domain_model` will report a System.\* specialization like this:

```json
"generalization": {
  "hasGeneralization": true,
  "parent": "<unknown>"
}
```

The `<unknown>` is a **read-side cosmetic limitation, not a bug**. `read_domain_model` calls the typed getter (`entity.generalization.generalization.qualifiedName`), which goes through `_resolveName('DomainModels$Entity', 'System.FileDocument')` → cache miss → null. The underlying raw qualified name is still stored correctly and survives commit + reload (`gen.__generalization.qualifiedName()` returns the right string). To confirm the commit really did the right thing:

- The `generalization` field is present (not `null`) and `structureTypeName === "DomainModels$Generalization"` (not `NoGeneralization`).
- The entity's user-defined attributes match what is expected after pruning the inherited fields.
- Opening the project in Studio Pro shows the parent without any "Broken reference" error.

---

## Skip the prompt when…

- The source spec does not flag a System.\* parent and the entity is not file/image/user-shaped. Don't invent a `FileDocument` parent just because the entity has a `Binary` attribute — only specialize when the runtime needs to recognise the subtype.
- The user has explicitly said to model an entity as plain persistable (e.g. "import legacy attachments without using Mendix file APIs"). Re-declare the file columns as ordinary user attributes in that case.
- For `System.User`: prefer `Administration.Account` unless the project is built without the Administration module. See `user_entity_generalization.md` for the full trade-off discussion.

---

## See also

- `user_entity_generalization.md` — when to reach for `Administration.Account` (the indirect path to `System.User`).
- `system_members.md` — the four NoGeneralization flags (`hasCreatedDate` / `hasChangedDate` / `hasOwner` / `hasChangedBy`). Inherited on specializations, including System.\* specializations.
- `../tools/domain_model.md` — Tool 5 (`create_entity`), Tool 6 (`create_multiple_entities`), Tool 12 (`set_entity_generalization`).
- `mx-connect/src/sharedResolvers.ts` — the `KNOWN_SYSTEM_PARENT_ENTITIES` allow-list and `applyGeneralization` implementation.
- <https://www.mendix.com/blog/a-mendix-sdk-primer-part-2/> — Mendix's own write-up of the raw-value workaround.
