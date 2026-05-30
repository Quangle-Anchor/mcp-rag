# Enumerations — Tool Specifications

<!-- BEGIN TOOL 19: create_enumeration -->
## Tool 19: `create_enumeration`

Create or replace an Enumeration in a module, with an ordered list of values where each value can have a display caption. If the enumeration already exists, all existing values are deleted and rebuilt (idempotent).

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

### Input

```json
{
  "moduleName": "string (required) — Module containing the enumeration",
  "enumerationName": "string (required) — Enumeration name in PascalCase",
  "documentation": "string (optional) — Description, only applied when creating new (ignored when replacing)",
  "values": [ (required) — ordered list of values
    {
      "name": "string (required) — Enum value name (internal identifier)",
      "caption": "string (optional) — Display caption, default = name"
    }
  ]
}
```

### Behavior

1. Find module by `moduleName`. Throw if not found.
2. Find enumeration by qualified name `<moduleName>.<enumerationName>`:
   - If exists: `load()` and `values.clear()` to rebuild (`replaced: true`). **Note:** the `documentation` field is **completely ignored** when replacing — the current `documentation` value of the enumeration is **preserved** (not deleted, not updated). Only when creating new, `documentation` is written.
   - If not yet existing: create `enumerations.Enumeration.createIn(module)` and set `name`, `documentation`.
3. For each input value:
   - Create `enumerations.EnumerationValue.createIn(enumeration)`.
   - Set `name`.
   - Create `texts.Text.createInEnumerationValueUnderCaption(value)` and attach `en_US` translation with `caption` (or `name` if caption is not provided). **Note:** the caption language is hardcoded to `en_US`; if the project has additional languages, translations for those languages are not created.

### Output

Returns plain text (MCP `textResult`):

```
Enumeration created: <moduleName>.<enumerationName>
Values: <count>
```

If replace: first line is `Enumeration replaced: <moduleName>.<enumerationName>`.

### Error Cases

- Module `moduleName` does not exist → throw `Module "<name>" not found. Available: ...`
- `enumerationName` matches a Mendix reserved word (case-insensitive) → throw `'<name>' is a Mendix reserved word and cannot be used as an enumeration name in module '<moduleName>' (case-insensitive match). Source: https://docs.mendix.com/refguide/enumerations/. Pick a different identifier — e.g. append a suffix like '_VAL' or use a longer descriptive name.`
- Any value `name` matches a Mendix reserved word (case-insensitive) → throw `'<name>' is a Mendix reserved word and cannot be used as an enumeration value name in '<moduleName>.<enumerationName>' (case-insensitive match). Source: https://docs.mendix.com/refguide/enumerations/. ...`. Pre-flight check — happens before any mutation, so the call is transactional.
- `values` is an empty array — allowed (creates enum with no values), no throw.
- Duplicate value names in `values` — not validated; Studio Pro may reject on project load.

> **Reserved-word source.** The full list is maintained in `src/mendixReservedWords.ts` (`MENDIX_ENUM_RESERVED_WORDS`), mirroring https://docs.mendix.com/refguide/enumerations/. `com` was added in Studio Pro 11.2 — keep this list in sync when bumping `mendixmodelsdk`.

---
<!-- END TOOL 19: create_enumeration -->

---

<!-- BEGIN TOOL 20: list_enumerations -->
## Tool 20: `list_enumerations`

**Status**: Available

Read-only enumerator for `enumerations.Enumeration` documents in the working copy. For each enumeration returns its qualified name, the ordered list of values (internal `name` + `en_US` caption), and `documentation`. Scope is the whole working copy by default; pass `moduleName` to restrict the search to one module.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first. Read-only — does **not** mutate the working copy.

---

### Input

```json
{
  "moduleName": "string (optional) — Restrict to a single module. Searches all non-Marketplace modules if omitted."
}
```

| Field        | Required | Description                                                                                                                       |
|--------------|----------|-----------------------------------------------------------------------------------------------------------------------------------|
| `moduleName` | No       | When provided, only enumerations under that module (including those nested in folders) are returned. When omitted, scans every `module` where `fromAppStore === false`. |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Determine the modules to scan:
   - If `moduleName` is provided: find module by name; throw if not found: `"Module '<moduleName>' not found in working copy."`.
   - Otherwise: iterate `model.root.modules.filter(m => !m.fromAppStore)`.
3. For each module, walk both `module.documents` and the documents inside every nested `Folder` (recursive). Collect every document that `instanceof enumerations.Enumeration`.
4. For each enumeration, `await enumeration.load()` so `values` and `documentation` are materialised.
5. For each `EnumerationValue`, also load it (`await value.load()`) and read the `en_US` translation off `value.caption.translations`:
   - Prefer the translation whose `languageCode === "en_US"`.
   - Fall back to the first translation if `en_US` is absent.
   - If `caption` is null or has no translations, fall back to `value.name`.
6. Resolve `folderQualifiedName` the same way as `list_constants` (Tool 18) — null when the immediate container is the module itself.
7. Return the list sorted by `qualifiedName` ascending; for each enum, values are returned **in the order they appear in `enumeration.values`** (declaration order — Studio Pro persists this order).

---

### Output

```json
{
  "success": true,
  "status": "success",
  "message": "Found <N> enumeration(s)",
  "data": [
    {
      "name": "string — Short name",
      "qualifiedName": "string — ModuleName.EnumName",
      "moduleName": "string",
      "folderQualifiedName": "string | null",
      "documentation": "string — May be empty",
      "valueCount": "integer",
      "values": [
        {
          "name": "string — Internal identifier",
          "caption": "string — en_US caption, or the first available translation, or `name` as last-resort fallback",
          "captionLanguage": "string — Language code of the returned caption (typically 'en_US'). Null if no translations existed."
        }
      ],
      "remote": "boolean — true when Enumeration.remoteSource is non-null (remote-bound enum, Mendix ≥ 10.2)"
    }
  ]
}
```

When no enumerations match, `data` is `[]` and `success` stays `true`.

---

### Error Cases

- No working copy → throw `"No working copy is open in this session. Call open_working_copy first."`.
- `moduleName` not found → throw `"Module '<moduleName>' not found in working copy."`.
- A value's caption Text fails to load → bubble the SDK error verbatim (do not silently skip a value, since order matters for enum semantics).

### Notes

- **Captions are returned in `en_US` by convention.** This matches `create_enumeration` (Tool 19), which only writes `en_US`. Projects with additional languages will still get an `en_US` caption if it exists; the agent can call `query_model_elements` for raw `Texts$Translation` rows if a different language is required.
- **Value order is meaningful.** The list reflects the declaration order in the Mendix model, which Studio Pro uses when presenting enum dropdowns. Don't sort `values` alphabetically in the output.
- **Marketplace modules are skipped.** Same rationale as `list_constants` (Tool 18).
- **`remote: true` enums.** Enumerations sourced from a remote OData / consumed REST service have a `remoteSource` set. The tool surfaces the flag but does not expand the source; combine with `read_consumed_rest_service` / `read_consumed_odata_service` if you need the binding.

### Example

```json
{
  "moduleName": "MyFirstModule"
}
```

Result:

```json
{
  "success": true,
  "status": "success",
  "message": "Found 1 enumeration(s)",
  "data": [
    {
      "name": "OrderStatus",
      "qualifiedName": "MyFirstModule.OrderStatus",
      "moduleName": "MyFirstModule",
      "folderQualifiedName": null,
      "documentation": "",
      "valueCount": 3,
      "values": [
        { "name": "Draft",     "caption": "Draft",     "captionLanguage": "en_US" },
        { "name": "Submitted", "caption": "Submitted", "captionLanguage": "en_US" },
        { "name": "Approved",  "caption": "Approved",  "captionLanguage": "en_US" }
      ],
      "remote": false
    }
  ]
}
```

<!-- END TOOL 20: list_enumerations -->

---

<!-- BEGIN TOOL 64: update_enumeration -->
## Tool 64: `update_enumeration`

**Status**: Available

Add new values to and/or remove existing values from an `enumerations.Enumeration` **in place**, preserving the existing values that the caller did not touch. This is the non-destructive companion to `create_enumeration` (Tool 19), which clears and rebuilds the full value list.

Use `update_enumeration` when you need to extend a live enum without breaking microflow expressions or stored attribute values that reference the existing identifiers. Use `create_enumeration` (overwrite) only when the value set is being redefined wholesale.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "enumerationName": "string (required) — Short name OR qualified 'Module.EnumName'",
  "moduleName": "string (optional) — Module containing the enumeration. Searches all modules if omitted.",
  "addValues": [ (optional) — values to append (in order)
    {
      "name": "string (required) — Internal identifier (PascalCase)",
      "caption": "string (optional, default = name) — en_US caption"
    }
  ],
  "removeValues": [ "string", ... ] (optional) — value names to remove
}
```

| Field             | Required | Description                                                                                                                                  |
|-------------------|----------|----------------------------------------------------------------------------------------------------------------------------------------------|
| `enumerationName` | Yes      | Short name or `"Module.EnumName"`. When qualified, the prefix takes precedence over `moduleName` (must match if both are provided).          |
| `moduleName`      | No       | Restrict search to one module. If omitted and the short name is ambiguous, throw a disambiguation error.                                     |
| `addValues`       | No       | Ordered list of values to append. Each entry follows the same shape as `create_enumeration`. Empty array or omitted = no additions.          |
| `removeValues`    | No       | List of value `name`s to delete. Empty array or omitted = no removals.                                                                       |

At least one of `addValues` / `removeValues` must be non-empty, otherwise the call is rejected as a no-op.

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Resolve the enumeration using the same lookup logic as `update_constant` (Tool 63): split qualified `Module.EnumName`, intersect with `moduleName`, disambiguate across modules.
3. `await enumeration.load()`.
4. **Process `removeValues` first** (so an `addValues` entry can legally reuse a name that's being removed in the same call):
   - For each `name` in `removeValues`: find a value in `enumeration.values` where `v.name === name`. If absent, collect into a `notRemoved` list rather than throwing — the call is otherwise idempotent (a value that was already missing stays missing).
   - For each match, call `value.delete()`.
5. **Process `addValues`** in order:
   - For each entry: check that no value with the same `name` exists *after* the removals above. If one still exists, collect into a `notAdded` list (the value was not in `removeValues`) and skip. Do not throw — the call is otherwise idempotent.
   - Otherwise, `enumerations.EnumerationValue.createIn(enumeration)`, set `.name`, and attach a `texts.Text` with an `en_US` `Translation` carrying `caption ?? name`. Same caption logic as `create_enumeration` (Tool 19).
6. **Documentation is untouched.** This tool does not write `Enumeration.documentation`. Use `set_documentation` (Tool 65) for that.
7. Return the resulting state plus the two skip-lists so the caller can detect drift.

---

### Output

```json
{
  "success": true,
  "status": "success",
  "message": "Updated enumeration '<qualifiedName>' — added <addedCount>, removed <removedCount>",
  "data": {
    "qualifiedName": "string",
    "moduleName": "string",
    "enumerationName": "string",
    "added": [ "string", ... ],
    "removed": [ "string", ... ],
    "notAdded": [ "string", ... ],  // names skipped because they already existed
    "notRemoved": [ "string", ... ],// names skipped because they did not exist
    "finalValues": [
      { "name": "string", "caption": "string" }
    ]
  }
}
```

`finalValues` is the canonical order of `enumeration.values` after the call — newly-added values appear at the end in the order they were supplied.

---

### Error Cases

- No working copy → throw `"No working copy is open in this session. Call open_working_copy first."`.
- Both `addValues` and `removeValues` empty / omitted → throw `"At least one of addValues or removeValues must be non-empty."`.
- Enumeration not found / ambiguous: same wording as `update_constant`, substituting "Enumeration" for "Constant".
- `addValues` contains duplicate names within the same call → throw `"addValues contains duplicate name '<X>'."` (the caller's input is malformed; do not silently dedupe).
- `addValues` contains a name that matches a Mendix reserved word (case-insensitive) → throw `'<name>' is a Mendix reserved word and cannot be used as an enumeration value name in '<enumerationName>' ...`. See `create_enumeration` (Tool 19) for the canonical list reference.
- `addValues` and `removeValues` share a name **and** the name is missing from the enumeration → still allowed; the remove is reported under `notRemoved`, the add proceeds and is reported under `added`.

### Notes

- **Removing a value is destructive at runtime.** Stored attribute values that referenced the removed name will fail validation on the next platform load. Studio Pro warns about this in the GUI; this tool does **not** scan for references. Treat `removeValues` as an explicit decision.
- **Captions for `addValues` are written in `en_US` only.** Same rule as `create_enumeration` (Tool 19) — extend manually via `query_model_elements` if multiple languages are required.
- **Rename is a separate tool.** Use `rename_enumeration_value` (Tool 60) to change an existing value's `name` without breaking references; doing it as remove+add via this tool would orphan every microflow/page reference.

### Example — append `Shipped` and `Delivered` to `OrderStatus`

```json
{
  "enumerationName": "MyFirstModule.OrderStatus",
  "addValues": [
    { "name": "Shipped",   "caption": "Shipped" },
    { "name": "Delivered", "caption": "Delivered" }
  ]
}
```

### Example — replace `Draft` with `Pending` (rename via remove+add — NOT recommended, see note above)

```json
{
  "enumerationName": "MyFirstModule.OrderStatus",
  "removeValues": ["Draft"],
  "addValues": [ { "name": "Pending", "caption": "Pending" } ]
}
```

For a real rename that preserves references, prefer `rename_enumeration_value` (Tool 60).

<!-- END TOOL 64: update_enumeration -->

---

<!-- BEGIN TOOL 60: rename_enumeration_value -->
## Tool 60: `rename_enumeration_value`

**Status**: Available

Rename a single `enumerations.EnumerationValue` by changing its internal `name`. The value's position in `enumeration.values`, its `en_US` caption, and any `image` / `remoteValue` are preserved. The qualified name `Module.EnumName.OldValue` becomes `Module.EnumName.NewValue`.

**⚠️ Reference propagation.** Unlike Studio Pro (which auto-updates microflow expressions, page captions, conditional formatting, and stored entity attribute values), this tool only changes the value's `.name`. Anything that referenced the old name by string (microflow expressions like `$Order/Status = MyFirstModule.OrderStatus.Draft`, conditional widgets, navigation, stored runtime data) **will not** be rewritten. This is the same caveat that `rename_document` (Tool 58) carries — and it bites harder here because enum-value references are usually inlined into expressions rather than typed slots.

If the user wants Studio-Pro–quality propagation, they should rename in Studio Pro and commit. This tool is for cases where the rename is being driven by an external schema (e.g. a remote enum source) and the agent is also rewriting all referring expressions in the same commit.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "enumerationName": "string (required) — Short name OR qualified 'Module.EnumName'",
  "valueName": "string (required) — Current name of the value to rename",
  "newName": "string (required) — New name (must follow Mendix value-name rules)",
  "moduleName": "string (optional) — Module containing the enumeration. Searches all modules if omitted."
}
```

| Field             | Required | Description                                                                                                                              |
|-------------------|----------|------------------------------------------------------------------------------------------------------------------------------------------|
| `enumerationName` | Yes      | Short name or `"Module.EnumName"`. Qualified prefix wins when both prefix and `moduleName` are provided (must agree).                    |
| `valueName`       | Yes      | The existing `EnumerationValue.name`. Case-sensitive.                                                                                    |
| `newName`         | Yes      | The new `EnumerationValue.name`. Must be a valid Mendix identifier (PascalCase, no spaces, not a reserved word). Not validated by the SDK — the tool calls `validate_name` (Tool 35) under the hood with kind `"enumeration_value"` and throws on failure. |
| `moduleName`      | No       | Restrict enumeration lookup to one module.                                                                                               |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Resolve the enumeration via the same lookup logic as `update_enumeration` (Tool 64) — accept qualified or short name, disambiguate.
3. `await enumeration.load()`.
4. Find the value where `v.name === valueName`. If absent → throw `"Value '<valueName>' not found in enumeration '<qualifiedName>'."`.
5. Check that no other value in the same enumeration has `name === newName` (case-sensitive). If one does → throw `"Value '<newName>' already exists in enumeration '<qualifiedName>'."`.
6. Validate `newName`: (a) must match `^[A-Za-z][A-Za-z0-9_]*$` (start with a letter, only letters/digits/underscores; no `$`); (b) must not exceed 200 chars; (c) must not be a Mendix reserved word (case-insensitive — full list in `src/mendixReservedWords.ts` mirroring https://docs.mendix.com/refguide/enumerations/). Pre-flight: the reserved-word check runs before the lookup so the call is transactional.
7. Set `value.name = newName`. The caption (`value.caption` / `Text` / `Translation`) is **not** touched — captions are independent of internal names by design.
8. Return the resulting state.

---

### Output

```json
{
  "success": true,
  "status": "success",
  "message": "Renamed '<enumQN>.<oldName>' to '<enumQN>.<newName>'",
  "data": {
    "enumerationQualifiedName": "string",
    "moduleName": "string",
    "oldName": "string",
    "newName": "string",
    "oldQualifiedName": "string — ModuleName.EnumName.OldValueName",
    "newQualifiedName": "string — ModuleName.EnumName.NewValueName",
    "caption": "string — Unchanged en_US caption",
    "warning": "References to the old value are NOT automatically updated. Search microflow expressions, page conditions, and stored entity values for the old qualified name."
  }
}
```

---

### Error Cases

- No working copy → throw `"No working copy is open in this session. Call open_working_copy first."`.
- Enumeration not found / ambiguous: same wording as `update_enumeration`.
- Value not found → throw `"Value '<valueName>' not found in enumeration '<qualifiedName>'."`.
- `newName` collides with an existing value → throw `"Value '<newName>' already exists in enumeration '<qualifiedName>'."`.
- `newName` fails the identifier check → throw `"'<newName>' is not a valid enumeration value name: must start with a letter and contain only letters, digits, or underscores."` (or the matching length error).
- `newName` is a Mendix reserved word (case-insensitive) → throw `'<newName>' is a Mendix reserved word and cannot be used as an enumeration value name in '<enumerationName>' (case-insensitive match). Source: https://docs.mendix.com/refguide/enumerations/. ...`.
- `valueName === newName` (no-op rename) → throw `"newName must differ from valueName."`.

### Notes

- **Captions vs. internal names.** Internal `name` is what microflow expressions, stored attributes, and remote-enum bindings reference. Caption is the display string only. This tool deliberately leaves the caption untouched so the user-facing label can stay stable even when refactoring identifiers — call `set_documentation` on the enum or `update_enumeration` (remove+add) if you also need to change the caption.
- **Remote-bound enums.** If `value.remoteValue` is non-null, the value is mirrored from a remote source (OData / consumed REST). Renaming the local identifier does not push the change back to the remote service, and the remote sync on next refresh may overwrite the rename. Treat remote enums as read-only unless you are also editing the source schema.
- **Why not auto-propagate references.** The SDK does not maintain a reverse index from value identifiers to expression usages; finding them requires walking every microflow's expression text, every page's conditional formatting, and every entity attribute's default value. That is a search-and-replace job, not a "rename" — the agent should run it explicitly via `query_model_elements` + targeted edits, and own the rollback if a search misses a usage.

### Example

```json
{
  "enumerationName": "MyFirstModule.OrderStatus",
  "valueName": "Submitted",
  "newName": "PendingApproval"
}
```

After commit, every existing reference to `MyFirstModule.OrderStatus.Submitted` (microflow expressions, page conditions, stored values) still points at the old identifier and will produce a "Value not found" consistency error when the project is loaded — these must be fixed before commit.

<!-- END TOOL 60: rename_enumeration_value -->
