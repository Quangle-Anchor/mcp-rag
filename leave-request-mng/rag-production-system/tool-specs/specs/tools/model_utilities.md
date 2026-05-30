# Model Utilities — Tool Specifications

<!-- BEGIN TOOL 54: query_model_elements -->
## Tool 54: `query_model_elements`

General query for metamodel elements in the working copy by type name (e.g.: `"Pages$Page"`, `"Microflows$Microflow"`, `"DomainModels$Entity"`). Each element in the Model SDK has a `structureTypeName` property; this tool filters by a substring of that type name, optionally scoped to a module, and returns a list of names, qualified names, containing modules, and (optionally) loaded properties.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "typeName": "string (required) — Metamodel type name or substring of it (e.g.: 'Pages$Page', 'Microflows$Microflow', 'DomainModels$Entity')",
  "moduleName": "string (optional) — Restrict search to a specific module",
  "includeProperties": "boolean (optional, default false) — If true, loads element and returns basic properties",
  "maxResults": "integer (optional, default 50) — Limit the number of results returned"
}
```

| Field               | Required | Description                                                                                                                         |
|---------------------|----------|-------------------------------------------------------------------------------------------------------------------------------------|
| `typeName`          | Yes      | Case-insensitive substring match against `structureTypeName` of elements. E.g.: `"Pages$Page"`, `"Microflows$Microflow"`.           |
| `moduleName`        | No       | Specific module name. If omitted, searches all non-Marketplace modules (`fromAppStore === false`).                                  |
| `includeProperties` | No       | Default `false`. When `true`: for each found element, calls `load()` and reads basic properties (name, documentation).             |
| `maxResults`        | No       | Default 50. Truncates results if the limit is exceeded.                                                                             |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Determine the list of modules to scan:
   - If `moduleName` is provided: find module by name; throw if not found: `"Module '<moduleName>' not found in working copy."`.
   - Otherwise: get all modules with `fromAppStore === false` from `model.root.modules`.
3. Collect elements from the following sources in each module:
   - `module.documents` — contains pages, microflows, constants, enumerations, nanoflows, etc. Always iterate this list regardless of `typeName`.
   - Domain model entities and associations: if `typeName.toLowerCase()` contains `"domainmodels$"`, `"entity"`, or `"association"`, add a step to `await module.domainModel.load()` and collect `dm.entities` and `dm.associations` / `dm.crossAssociations`. Do not load the domain model if `typeName` clearly only matches document types.
4. Filter elements: `element.structureTypeName.toLowerCase().includes(typeName.toLowerCase())`.
5. If `includeProperties === true`: call `await element.load()` and read `name`, `documentation` (if it exists).
6. Truncate results at `maxResults`. If the number of elements found exceeds the limit, add `"truncated": true` in the output.
7. Return the result list via `textResult(JSON.stringify(result, null, 2))`.

---

### Output

```json
{
  "success": true,
  "status": "success",
  "message": "Found <N> element(s) matching '<typeName>'",
  "truncated": false,
  "data": [
    {
      "name": "string — Short name of the element",
      "qualifiedName": "string — FQN in the form ModuleName.ElementName",
      "structureTypeName": "string — Full type name (e.g.: 'Pages$Page')",
      "moduleName": "string — Name of the module containing the element",
      "documentation": "string | null — Only present when includeProperties = true"
    }
  ]
}
```

---

### Error Cases

- No working copy is open → throw `"No working copy is open in this session. Call open_working_copy first."`.
- `moduleName` does not exist → throw `"Module '<moduleName>' not found in working copy."`.
- `typeName` matches no elements → return `data: []`, `success: true`, no throw.
- `typeName` is an empty string → throw `"Parameter 'typeName' must not be empty."`.
- `maxResults` < 1 → throw `"Parameter 'maxResults' must be a positive integer."`.

<!-- END TOOL 54: query_model_elements -->

---

<!-- BEGIN TOOL 36: copy_model_element -->
## Tool 36: `copy_model_element`

Create a deep copy of an entity, microflow, constant, or enumeration under a new name in the same module or a different module. Operates on the open working copy.

**Copy scope:**
- `constant`: fully copies data type and default value.
- `enumeration`: copies all values with captions (language `en_US`).
- `entity`: copies all attributes (name, type, defaultValue) — **does not copy** associations, event handlers, or generalization.
- `microflow`: copies the parameters list. **Activities and flows are not copied** — implementation creates a new microflow with parameters only; the agent must add activities manually afterwards.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "elementType": "string (required) — 'entity' | 'microflow' | 'constant' | 'enumeration'",
  "sourceName": "string (required) — Name of the source element (short name)",
  "newName": "string (required) — New name for the copy",
  "sourceModule": "string (optional) — Module containing the source element. Searches all modules if omitted.",
  "targetModule": "string (optional) — Destination module. Defaults to sourceModule."
}
```

| Field          | Required | Description                                                                                                          |
|----------------|----------|----------------------------------------------------------------------------------------------------------------------|
| `elementType`  | Yes      | Element type: `"entity"`, `"microflow"`, `"constant"`, `"enumeration"`.                                              |
| `sourceName`   | Yes      | Short name of the source element.                                                                                    |
| `newName`      | Yes      | Name for the new copy. Must follow Mendix naming rules (PascalCase).                                                 |
| `sourceModule` | No       | Name of the module containing the source element. If omitted, searches all non-Marketplace modules.                 |
| `targetModule` | No       | Destination module for the copy. Defaults to `sourceModule`. Must exist in the working copy.                        |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Determine the source module:
   - If `sourceModule` is provided: find directly; throw if not found.
   - Otherwise: search all non-Marketplace modules. Throw if element not found; throw if found in multiple modules (requires `sourceModule`).
3. Load the source element via `await element.load()` and verify the type matches `elementType`; if type does not match → throw `"Element '<sourceName>' is not of type '<elementType>'."`.
4. Determine the target module: if `targetModule` is provided, find and confirm it exists; otherwise use the source module.
   - If `elementType === 'entity'`: load `await targetModule.domainModel.load()` to get `targetDomainModel`. Also ensure `await sourceModule.domainModel.load()` has been called to fully read attributes.
5. Check for name conflict: if an element with name `newName` already exists in the target module → throw `"Element '<newName>' already exists in module '<targetModule>'."`.
6. Create the copy by type:
   - **`constant`**: create `constants.Constant.createIn(targetModule)`, copy `name = newName`, `defaultValue`, `type` (create a new instance of the same type — do not use reference assignment).
   - **`enumeration`**: load source (`await source.load()`), create `enumerations.Enumeration.createIn(targetModule)`, copy `name = newName`, `documentation`; copy each `EnumerationValue` (name + caption `en_US`).
   - **`entity`**: create `domainmodels.Entity.createIn(targetDomainModel)`, copy `name = newName`; for each attribute: copy `name`, `type` (create new instance of same type), `defaultValue`. **Do not copy** associations, event handlers, generalization.
   - **`microflow`**: create `microflows.Microflow.createIn(targetModule)`, copy `name = newName`; copy each `MicroflowParameter` (name, type). Do not copy activities. The `note` field in the output is always populated: `"Activities and flows are not copied. Add them manually after creation."`.
7. Return the result via `textResult(JSON.stringify(result, null, 2))`.

---

### Output

```json
{
  "success": true,
  "status": "success",
  "message": "Copied <elementType> '<sourceName>' to '<targetModule>.<newName>'",
  "data": {
    "elementType": "string",
    "sourceName": "string",
    "sourceModule": "string",
    "newName": "string",
    "targetModule": "string",
    "qualifiedName": "string — FQN of the new copy (e.g.: 'TargetModule.NewName')",
    "note": "string | null — Warning about components not copied (if any)"
  }
}
```

---

### Error Cases

- No working copy → throw `"No working copy is open in this session. Call open_working_copy first."`.
- `elementType` is invalid → throw `"Invalid elementType. Must be one of: entity, microflow, constant, enumeration."`.
- Source element not found → throw `"<ElementType> '<sourceName>' not found in working copy."`.
- Source element found but actual type does not match `elementType` → throw `"Element '<sourceName>' is not of type '<elementType>'."`.
- Source element found in multiple modules → throw `"'<sourceName>' found in multiple modules: ... Provide sourceModule to disambiguate."`.
- `targetModule` does not exist → throw `"Module '<targetModule>' not found in working copy."`.
- New name already exists in target module → throw `"Element '<newName>' already exists in module '<targetModule>'."`.

<!-- END TOOL 36: copy_model_element -->

---

<!-- BEGIN TOOL 75: delete_document -->
## Tool 75: `delete_document`

Delete a document (page, microflow, nanoflow, snippet, layout, etc.) from a module in the working copy. `delete_document` is the preferred tool for all document-type deletions. Distinction from `delete_model_element` (Tool 10): use Tool 10 only for domain-model elements (entity, attribute, association). For microflow, constant, enumeration: both tools work, but `delete_document` is recommended because it supports a safer `documentType` filter. In particular, pages can only be deleted via `delete_document`. Supports optional `documentType` filtering to prevent accidental deletion.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "documentName": "string (required) — Name of the document to delete",
  "moduleName": "string (required) — Module containing the document",
  "documentType": "string (optional) — Filter by type: 'page' | 'microflow' | 'nanoflow' | 'snippet' | 'layout' | 'buildingblock'. If omitted: deletes the first document found by name."
}
```

| Field           | Required | Description                                                                                                                                           |
|-----------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| `documentName`  | Yes      | Short name of the document (not a qualified name).                                                                                                    |
| `moduleName`    | Yes      | Name of the module containing the document. Project-wide search is not supported to prevent accidental deletion — always requires module.             |
| `documentType`  | No       | If provided, only deletes if the document matches this type. Prevents accidental deletion when multiple documents share the same name but differ in type. |

**`documentType` to SDK class mapping:**

| `documentType`    | SDK class                        |
|-------------------|----------------------------------|
| `"page"`          | `pages.Page`                     |
| `"microflow"`     | `microflows.Microflow`           |
| `"nanoflow"`      | `microflows.Nanoflow`            |
| `"snippet"`       | `pages.Snippet`                  |
| `"layout"`        | `pages.Layout`                   |
| `"buildingblock"` | `pages.BuildingBlock`            |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Find module by `moduleName` in `model.root.modules`; throw if not found.
3. Find document in `module.documents` by `name === documentName`:
   - If `documentType` is provided: additionally filter by the corresponding SDK class (table above). If no document matching both name and type is found → throw type mismatch error.
   - If `documentType` is not provided: take the first document with `name === documentName`.
4. If document not found → throw `"Document '<documentName>' not found in module '<moduleName>'."`. If multiple documents with the same name and type exist, delete the first one found in `module.documents`.
5. Load document: `await document.load()`. Then call `document.delete()` to remove the document from the working copy.
6. Return the result via `textResult(JSON.stringify(result, null, 2))`.

---

### Output

```json
{
  "success": true,
  "status": "success",
  "message": "Deleted document '<documentName>' from module '<moduleName>'",
  "data": {
    "documentName": "string",
    "moduleName": "string",
    "documentType": "string — The documentType value used for filtering (if provided), or the structureTypeName of the deleted document if documentType was not provided"
  }
}
```

---

### Error Cases

- No working copy → throw `"No working copy is open in this session. Call open_working_copy first."`.
- `moduleName` not found → throw `"Module '<moduleName>' not found in working copy."`.
- Document not found by name → throw `"Document '<documentName>' not found in module '<moduleName>'."`.
- Document found by name but type does not match `documentType` → throw `"Document '<documentName>' in module '<moduleName>' is not of type '<documentType>'."`.

<!-- END TOOL 75: delete_document -->

---

<!-- BEGIN TOOL 45: exclude_document -->
## Tool 45: `exclude_document`

Mark a document (microflow, page, nanoflow, etc.) as excluded from the project or un-exclude it. An excluded document will not be compiled or deployed. Operates on the working copy by setting the `excluded` property on the corresponding document.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "documentName": "string (required) — Name of the document to exclude/include",
  "moduleName": "string (optional) — Module containing the document. Searches all modules if omitted.",
  "excluded": "boolean (optional, default true) — true to exclude, false to include again",
  "documentType": "string (optional) — Filter by type: 'page' | 'microflow' | 'nanoflow' | 'snippet' | 'layout' | 'buildingblock'. Prevents confusion when multiple documents share the same name."
}
```

| Field           | Required | Description                                                                                                                                     |
|-----------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| `documentName`  | Yes      | Short name of the document.                                                                                                                     |
| `moduleName`    | No       | If provided, searches in that specific module. If omitted, searches all non-Marketplace modules; throws if found in multiple modules.           |
| `excluded`      | No       | Default `true`. Set `false` to un-exclude (include the document again).                                                                         |
| `documentType`  | No       | If provided, only applies if the document matches this type. Uses the same mapping as `delete_document`.                                        |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Determine module:
   - If `moduleName` is provided: find directly; throw if not found.
   - Otherwise: iterate all non-Marketplace modules, collect modules with a matching document name in `module.documents`. If not found → throw not found. If found in multiple modules → throw disambiguation error.
3. Find document by `name === documentName` in `module.documents`. If `documentType` is provided, additionally filter by the corresponding SDK class (same mapping as `delete_document`). If no document matching both name and type is found → throw type mismatch error.
4. Throw if document not found.
5. Load document: `await document.load()`. This step is required because the `excluded` property can only be written after the document is fully loaded.
6. Set `document.excluded = excluded ?? true`.
7. Return the result via `textResult(JSON.stringify(result, null, 2))`.

---

### Output

```json
{
  "success": true,
  "status": "success",
  "message": "Document '<documentName>' in '<moduleName>' is now <excluded|included>",
  "data": {
    "documentName": "string",
    "moduleName": "string",
    "excluded": "boolean — New excluded value"
  }
}
```

---

### Error Cases

- No working copy → throw `"No working copy is open in this session. Call open_working_copy first."`.
- `moduleName` not found → throw `"Module '<moduleName>' not found in working copy."`.
- Document not found in the specific module → throw `"Document '<documentName>' not found in module '<moduleName>'."`.
- Document not found in any module (when `moduleName` is omitted) → throw `"Document '<documentName>' not found in any module."`.
- Document found by name but type does not match `documentType` → throw `"Document '<documentName>' in module '<moduleName>' is not of type '<documentType>'."`.
- Document found in multiple modules (when `moduleName` not provided) → throw `"'<documentName>' found in multiple modules: ... Provide moduleName to disambiguate."`.

<!-- END TOOL 45: exclude_document -->

---

<!-- BEGIN TOOL 58: rename_document -->
## Tool 58: `rename_document`

Rename a document (microflow, page, constant, enumeration, or any document type) in the working copy by setting the `.name` property. Supports qualified name format `"Module.DocumentName"`.

**⚠️ Important note:** Unlike Studio Pro (which automatically updates all references), this tool **only renames the document** in the working copy — references to the old name from microflows, pages, navigation, etc. **are not automatically updated**. The agent must manually update these references if needed.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "documentName": "string (required) — Current name (short name or 'Module.DocumentName')",
  "newName": "string (required) — New name",
  "moduleName": "string (optional) — Module containing the document. Searches all modules if omitted.",
  "documentType": "string (optional) — Filter by type: 'page' | 'microflow' | 'nanoflow' | 'snippet' | 'layout' | 'buildingblock' | 'constant' | 'enumeration'. Searches all types if omitted."
}
```

| Field           | Required | Description                                                                                                                                           |
|-----------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| `documentName`  | Yes      | Current name of the document. Supports qualified name format `"Module.Name"` (extracts module from the prefix).                                       |
| `newName`       | Yes      | New name. Must follow Mendix naming rules.                                                                                                            |
| `moduleName`    | No       | Restrict search to a specific module. If omitted, searches all non-Marketplace modules. Ambiguity → throw.                                            |
| `documentType`  | No       | Restrict document type. Helps prevent renaming the wrong document when multiple documents share the same name but differ in type.                     |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Parse `documentName`: if it contains `.`, use the first dot as the boundary — the part before is `moduleName` (if not already provided as a separate parameter), the part after is `localName`. If there are multiple dots, everything after the first dot is the full `localName`.
3. Determine module and find document by name + type (if `documentType` provided):
   - If `moduleName` provided: search in that module; throw if module does not exist.
   - Otherwise: search all non-Marketplace modules; throw disambiguation if found in multiple modules.
4. Load document: `await document.load()`.
4b. Check for new name conflict: if another document with `name === newName` already exists in the same module → throw `"Document '<newName>' already exists in module '<moduleName>'."`. New name is not auto-validated — caller should call `validate_name` first if needed.
5. Set `document.name = newName`.
6. Return the result via `textResult(JSON.stringify(result, null, 2))`.

---

### Output

```json
{
  "success": true,
  "status": "success",
  "message": "Renamed '<oldName>' to '<newName>' in module '<moduleName>'",
  "data": {
    "oldName": "string",
    "newName": "string",
    "moduleName": "string",
    "qualifiedName": "string — FQN after renaming",
    "warning": "References to the old name are NOT automatically updated. Update microflow calls, page references, and navigation manually."
  }
}
```

---

### Error Cases

- No working copy → throw `"No working copy is open in this session. Call open_working_copy first."`.
- `moduleName` not found → throw `"Module '<moduleName>' not found in working copy."`.
- Document not found → throw `"Document '<documentName>' not found."`.
- Document found but type does not match `documentType` → throw `"Document '<documentName>' is not of type '<documentType>'."`.
- New name already exists in module → throw `"Document '<newName>' already exists in module '<moduleName>'."`.
- Found in multiple modules → throw `"'<documentName>' found in multiple modules: ... Provide moduleName to disambiguate."`.

<!-- END TOOL 58: rename_document -->

---

<!-- BEGIN TOOL 65: set_documentation -->
## Tool 65: `set_documentation`

Write documentation text to an element in the working copy: entity, attribute, association, or domain model. Use an empty string to clear documentation. Operates by setting the `.documentation` property on the element after loading it.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "elementType": "string (required) — 'entity' | 'attribute' | 'association' | 'domain_model'",
  "documentation": "string (required) — Documentation content. Use '' to clear.",
  "elementName": "string (optional) — Element name (entity name, association name). Omit for 'attribute' if using entityName + attributeName.",
  "moduleName": "string (optional) — Module containing the element. Searches all modules if omitted.",
  "entityName": "string (optional) — Entity name (used for elementType 'attribute')",
  "attributeName": "string (optional) — Attribute name (used for elementType 'attribute')"
}
```

| Field           | Required              | Description                                                                                                                       |
|-----------------|-----------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| `elementType`   | Yes                   | Element type: `"entity"`, `"attribute"`, `"association"`, `"domain_model"`.                                                       |
| `documentation` | Yes                   | Content to write. Empty string `""` clears current documentation.                                                                |
| `elementName`   | See description       | For `entity`: entity name. For `association`: association name. For `domain_model`: omit.                                        |
| `moduleName`    | No                    | If omitted, searches all non-Marketplace modules. Throws if found in multiple modules (ambiguous).                                |
| `entityName`    | For `attribute`       | Name of the entity containing the attribute. Can be used instead of `elementName`.                                               |
| `attributeName` | For `attribute`       | Name of the attribute to write documentation to. Required when `elementType = "attribute"`.                                      |

**Input by elementType:**

| `elementType`    | Required fields                            |
|------------------|--------------------------------------------|
| `"entity"`       | `elementName` or `entityName`              |
| `"attribute"`    | `entityName` + `attributeName`             |
| `"association"`  | `elementName`                              |
| `"domain_model"` | only `moduleName` (required for this type) |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Determine module:
   - If `elementType === 'domain_model'`: `moduleName` is **required**; throw `"Parameter 'moduleName' is required when elementType is 'domain_model'."` if not provided.
   - If `moduleName` is provided: find directly; throw if not found.
   - Otherwise: iterate all non-Marketplace modules to find the element; throw disambiguation if found in multiple modules.
3. Find and load the element by `elementType`:
   - **`entity`**: call `await module.domainModel.load()`, find entity by name, call `await entity.load()`, set `entity.documentation`.
   - **`attribute`**: call `await module.domainModel.load()`, find entity, call `await entity.load()`, find attribute by `attributeName` in `entity.attributes`, set `attribute.documentation`. Attributes are loaded with the entity — no separate load needed.
   - **`association`**: call `await module.domainModel.load()`, find in `dm.associations` and `dm.crossAssociations` by name, call `await assoc.load()`, set `assoc.documentation`. Note: for `CrossAssociation`, only compare `assoc.name`, do not access `assoc.child.name`.
   - **`domain_model`**: call `await module.domainModel.load()`, set `domainModel.documentation`.
4. Return the result via `textResult(JSON.stringify(result, null, 2))`.

---

### Output

```json
{
  "success": true,
  "status": "success",
  "message": "Documentation updated on <elementType> '<elementName>' in module '<moduleName>'",
  "data": {
    "elementType": "string",
    "elementName": "string — Entity name (for 'entity'), association name (for 'association'), 'EntityName.AttributeName' (for 'attribute'), or module name (for 'domain_model')",
    "moduleName": "string",
    "documentation": "string — Documentation content written"
  }
}
```

---

### Error Cases

- No working copy → throw `"No working copy is open in this session. Call open_working_copy first."`.
- `elementType` is invalid → throw `"Invalid elementType. Must be one of: entity, attribute, association, domain_model."`.
- `elementType === 'domain_model'` and `moduleName` not provided → throw `"Parameter 'moduleName' is required when elementType is 'domain_model'."`.
- Module not found → throw `"Module '<moduleName>' not found in working copy."`.
- Entity not found → throw `"Entity '<entityName>' not found in module '<moduleName>'."`.
- Attribute not found → throw `"Attribute '<attributeName>' not found on entity '<entityName>'."`.
- Association not found → throw `"Association '<elementName>' not found in module '<moduleName>'."`.
- Found in multiple modules (when `moduleName` not provided) → throw `"'<elementName>' found in multiple modules: ... Provide moduleName to disambiguate."`.

<!-- END TOOL 65: set_documentation -->

---

<!-- BEGIN TOOL 35: validate_name -->
## Tool 35: `validate_name`

Check whether a candidate string is a valid name in Mendix, based on standard Mendix naming rules. This tool **does not require a working copy** — operates entirely locally, no session or connection needed.

**Mendix valid name rules:**
- Must start with a letter (A–Z, a–z).
- May only contain: letters, digits (0–9), underscores (`_`).
- Must not contain spaces, hyphens, dots, or special characters.
- Must not be empty.
- Maximum length: 200 characters.

---

### Input

```json
{
  "name": "string (required) — Candidate name to check",
  "autoFix": "boolean (optional, default false) — If true and name is invalid, returns a corrected name"
}
```

| Field     | Required | Description                                                                                                                                          |
|-----------|----------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| `name`    | Yes      | Name string to check.                                                                                                                                |
| `autoFix` | No       | Default `false`. When `true`: if name is invalid, auto-generates a corrected name by: replacing invalid characters with `_`, prefixing `A` if it starts with a digit. |

---

### Behavior

1. Check `name` is not empty; if empty → `valid: false`, `reason: "Name must not be empty."`.
2. Check length ≤ 200; if exceeded → `valid: false`, `reason: "Name exceeds maximum length of 200 characters."`.
3. Check first character is a letter (`/^[A-Za-z]/`); if not → `valid: false`, `reason: "Name must start with a letter."`.
4. Check entire string contains only `[A-Za-z0-9_]`; if not → `valid: false`, `reason: "Name contains invalid characters. Only letters, digits, and underscores are allowed."`.
5. If all checks pass → `valid: true`.
6. If `autoFix === true` and `valid === false`:
   - Replace all characters that are not `[A-Za-z0-9_]` with `_`.
   - If the first character after this step is a digit or `_`, add prefix `A`.
   - Truncate to 200 characters if still too long.
   - Write result into `fixedName`.
7. Return the result via `textResult(JSON.stringify(result, null, 2))`.

---

### Output

When name is valid:
```json
{
  "success": true,
  "status": "success",
  "message": "Name '<name>' is valid.",
  "data": {
    "name": "string — Name checked",
    "valid": true
  }
}
```

When name is invalid (and `autoFix = false`):
```json
{
  "success": true,
  "status": "success",
  "message": "Name '<name>' is invalid.",
  "data": {
    "name": "string",
    "valid": false,
    "reason": "string — Reason for invalidity"
  }
}
```

When name is invalid and `autoFix = true`:
```json
{
  "success": true,
  "status": "success",
  "message": "Name '<name>' is invalid. Suggested fix: '<fixedName>'.",
  "data": {
    "name": "string — Original name",
    "valid": false,
    "reason": "string",
    "fixedName": "string — Corrected valid name"
  }
}
```

---

### Error Cases

- `name` is missing or not a string → throw `"Parameter 'name' is required and must be a string."`.

<!-- END TOOL 35: validate_name -->

---

<!-- BEGIN TOOL 68: check_variable_name -->
## Tool 68: `check_variable_name`

Check whether a variable name is already in use in a microflow. Useful when building microflows via tools to avoid name conflicts. Loads the microflow from the working copy, collects all parameter names and output variable names from activities (including recursively into `LoopedActivity`), then reports availability and suggests an alternative name if already taken.

**Limitation:** Only supports `Microflow`. Does not support `Nanoflow` — even if the name is the same. To check variables in a nanoflow, use `read_nanoflow_details` to read the structure manually.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "microflowName": "string (required) — Microflow name or qualified name 'Module.MicroflowName'",
  "variableName": "string (required) — Variable name to check",
  "moduleName": "string (optional) — Module name. Omit if using qualified name."
}
```

| Field           | Required | Description                                                                                                                      |
|-----------------|----------|----------------------------------------------------------------------------------------------------------------------------------|
| `microflowName` | Yes      | Microflow name (short name or `"Module.MicroflowName"`). If not qualified, searches all modules.                                |
| `variableName`  | Yes      | Variable name to check for availability.                                                                                         |
| `moduleName`    | No       | Restricts microflow search to this module. Takes priority over module name extracted from qualified name.                        |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Parse `microflowName`: if it contains `.`, split into `resolvedModule` and `localName`.
3. Find microflow:
   - If module available (from `moduleName` or parsed): search in `module.documents` by `name === localName` and `instanceof microflows.Microflow`.
   - Otherwise: search all non-Marketplace modules; throw if not found or found in multiple modules.
4. Load microflow: `await microflow.load()`.
5. Collect the list of existing variable names:
   - Parameter names: `microflow.parameters.map(p => p.name)`.
   - Output variable names: recursively iterate `microflow.objectCollection.objects` (activity list). For each activity, read `activity.action.outputVariableName` if it exists on the action (types like `CreateObjectAction`, `RetrieveAction`, `MicroflowCallAction`, `AggregateListAction`, etc.). Not all activities have `outputVariableName` (e.g.: `ChangeObjectAction`, `CommitAction` do not).
   - Recursive traversal: if activity is `LoopedActivity`, also traverse `loopedActivity.loopBody.objectCollection.objects` and continue recursively with the same logic.
6. Check whether `variableName` (case-sensitive) is in the list.
7. If already in use: suggest an alternative name by appending incrementing numeric suffixes starting at 2 (`variableName2`, `variableName3`, ...) until an unused name is found.
8. Return the result via `textResult(JSON.stringify(result, null, 2))`.

---

### Output

When name is available:
```json
{
  "success": true,
  "status": "success",
  "message": "Variable '<variableName>' is available in microflow '<microflowName>'.",
  "data": {
    "microflowName": "string — Qualified name of the microflow",
    "variableName": "string",
    "available": true,
    "existingVariables": ["string", "..."]
  }
}
```

When name is already in use:
```json
{
  "success": true,
  "status": "success",
  "message": "Variable '<variableName>' is already used in microflow '<microflowName>'.",
  "data": {
    "microflowName": "string",
    "variableName": "string",
    "available": false,
    "existingVariables": ["string", "..."],
    "suggestion": "string — Alternative unused name"
  }
}
```

---

### Error Cases

- No working copy → throw `"No working copy is open in this session. Call open_working_copy first."`.
- `microflowName` not found → throw `"Microflow '<microflowName>' not found in working copy."`.
- Found in multiple modules → throw `"'<microflowName>' found in multiple modules: ... Provide moduleName to disambiguate."`.

<!-- END TOOL 68: check_variable_name -->
