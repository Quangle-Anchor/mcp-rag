# Domain Model & Entities — Tool Specifications

<!-- BEGIN TOOL 3: read_domain_model -->

## Tool 3: `read_domain_model`

Read the domain model structure from the currently open working copy in the session, including entities, attributes (with default values and calculated state), associations (with delete behavior and owner), generalization, and event handlers. Specify `moduleName` to read a specific module, or omit to read all non-Marketplace modules.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "moduleName": "string (optional) — Name of the module to read. If omitted, returns all modules with fromAppStore === false."
}
```

| Field        | Required | Description                                                                                                                                                          |
| ------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `moduleName` | No       | Specific module name to read (e.g., `"RequestsOverview"`). If omitted, returns the full domain model of all modules with `fromAppStore === false` (non-Marketplace). |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open: `"No working copy is open in this session. Call open_working_copy first."`.
2. If `moduleName` is provided, find the module in `model.root.modules` by name; throw if not found: `"Module '<moduleName>' not found in working copy."`.  
   If `moduleName` is not provided, get all modules with `fromAppStore === false` from `model.root.modules`.
3. For each module in the list, call `await mod.domainModel.load()` to fully load the domain model content into memory before accessing entities and associations.
4. For each loaded domain model, collect data as follows:
   - **Entity:** iterate `dm.entities`. For each entity:
     - `name`: `entity.name` (short name).
     - `qualifiedName`: `entity.qualifiedName` (FQN, e.g., `ModuleName.EntityName`).
     - `generalization`: If `entity.generalization` is an instance of `Generalization` (not `NoGeneralization`), return `{ "hasGeneralization": true, "parent": entity.generalization.generalization.qualifiedName }`. If `NoGeneralization`, return `null`.
     - **Attributes:** iterate `entity.attributes`. For each attribute:
       - `name`: `attr.name`.
       - `type`: determined from the instance class of `attr.type` — see the **Attribute data types** table below for SDK class → output string mapping. For `EnumerationAttributeType`: call `await (attr.type as EnumerationAttributeType).enumeration.load()` (required — this is a lazy-loaded document stub; accessing `.values` directly without loading first will silently return an empty array), then `loadedEnum.values.map(v => v.name).join("/")` to build the string `"Enumeration (Val1/Val2/...)"`.
       - `valueType`: if `attr.value` is an instance of `StoredValue` → `"stored"`; if an instance of `CalculatedValue` → `"calculated"`.
       - `defaultValue`: if `stored`, get `(attr.value as StoredValue).defaultValue ?? null`; if `calculated`, return `null`.
       - `calculatedMicroflow`: if `calculated`, get `(attr.value as CalculatedValue).microflow?.qualifiedName ?? null`; if `stored`, return `null`.
     - **Associations:** iterate `dm.associations` and `dm.crossAssociations`, including only associations where `parent` or `child` is the current entity. For each association:
       - `name`: `assoc.name`.
       - `parent`: short name of the parent entity.
       - `child`: short name of the child entity.
       - `type`: `AssociationType.Reference → "one-to-many"`, `AssociationType.ReferenceSet → "many-to-many"`.
       - `parentDeleteBehavior` / `childDeleteBehavior`: read from `assoc.deleteBehavior.parentDeleteBehavior` and `assoc.deleteBehavior.childDeleteBehavior` (the `AssociationDeleteBehavior` child object on the association), mapped per the Delete Behavior table below: `DeletingBehavior.DeleteMeButKeepReferences → "delete_me_but_keep_references"`, `DeletingBehavior.DeleteMeAndReferences → "delete_me_and_references"`, `DeletingBehavior.DeleteMeIfNoReferences → "delete_me_if_no_references"`.
       - `owner`: `AssociationOwner.Default → "Default"`, `AssociationOwner.Both → "Both"`.
     - `eventHandlers`: Always `null` in the current implementation (reserved for future use).
5. Serialize the result to JSON string and return via `textResult(JSON.stringify(result, null, 2))`. Tool is **read-only** — does not modify working copy state.

---

### Output

Returns a JSON string (via `textResult(JSON.stringify(result, null, 2))`) with the following structure:

```json
{
  "success": true,
  "status": "success",
  "message": "Domain models retrieved from <N> module(s)",
  "data": [
    {
      "moduleName": "string — Module name",
      "entities": [
        {
          "name": "string — Entity name (short name)",
          "qualifiedName": "string — FQN, e.g.: ModuleName.EntityName",
          "generalization": "null  |  { \"hasGeneralization\": true, \"parent\": \"Module.EntityName\" }",
          "attributes": [
            {
              "name": "string — Attribute name",
              "type": "string — Data type (see table below)",
              "valueType": "stored | calculated",
              "defaultValue": "string | null — Default value if present",
              "calculatedMicroflow": "string | null — Microflow FQN if valueType = calculated"
            }
          ],
          "associations": [
            {
              "name": "string — Association name",
              "parent": "string — Parent entity name (short name)",
              "child": "string — Child entity name (short name)",
              "type": "one-to-many | many-to-many",
              "parentDeleteBehavior": "string — See Delete Behavior table below",
              "childDeleteBehavior": "string — See Delete Behavior table below",
              "owner": "Default | Both"
            }
          ],
          "eventHandlers": null
        }
      ]
    }
  ]
}
```

---

### Attribute data types (`type`)

| Output value                  | SDK class                   | Description                                                       |
| ----------------------------- | --------------------------- | ----------------------------------------------------------------- |
| `String`                      | `StringAttributeType`       | Text                                                              |
| `Integer`                     | `IntegerAttributeType`      | Integer                                                           |
| `Long`                        | `LongAttributeType`         | Long integer                                                      |
| `Decimal`                     | `DecimalAttributeType`      | High-precision decimal                                            |
| `Boolean`                     | `BooleanAttributeType`      | True / False                                                      |
| `DateTime`                    | `DateTimeAttributeType`     | Date and time                                                     |
| `AutoNumber`                  | `AutoNumberAttributeType`   | Auto-increment                                                    |
| `Binary`                      | `BinaryAttributeType`       | Binary data                                                       |
| `HashedString`                | `HashedStringAttributeType` | Hashed string (e.g., password)                                    |
| `Enumeration (Val1/Val2/...)` | `EnumerationAttributeType`  | Enumeration — enum values listed in parentheses, separated by `/` |

---

### Association type (`type`)

| Output value   | SDK enum                       | Description                 |
| -------------- | ------------------------------ | --------------------------- |
| `one-to-many`  | `AssociationType.Reference`    | Reference — many-to-one     |
| `many-to-many` | `AssociationType.ReferenceSet` | ReferenceSet — many-to-many |

---

### Delete behavior

| Output value                    | SDK enum                                     | Description                                   |
| ------------------------------- | -------------------------------------------- | --------------------------------------------- |
| `delete_me_but_keep_references` | `DeletingBehavior.DeleteMeButKeepReferences` | Delete this object, keep references (default) |
| `delete_me_and_references`      | `DeletingBehavior.DeleteMeAndReferences`     | Delete this object and all linked objects     |
| `delete_me_if_no_references`    | `DeletingBehavior.DeleteMeIfNoReferences`    | Only delete if no references remain           |

---

### Error Cases

| Condition                                         | Behavior                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| No working copy is open                           | Throw: `"No working copy is open in this session. Call open_working_copy first."` |
| `moduleName` provided but not found               | Throw: `"Module '<moduleName>' not found in working copy."`                       |
| `model.root.modules` is empty and no `moduleName` | Return `{ ..., "data": [] }` — does not throw                                     |
| SDK error during `await mod.domainModel.load()`   | Propagate SDK error — not caught                                                  |

---

### Example — Reading a specific module

**Input:**

```json
{ "moduleName": "RequestsOverview" }
```

**Output:**

```json
{
  "success": true,
  "status": "success",
  "message": "Domain models retrieved from 1 module",
  "data": [
    {
      "moduleName": "RequestsOverview",
      "entities": [
        {
          "name": "LeaveRequest",
          "qualifiedName": "RequestsOverview.LeaveRequest",
          "generalization": null,
          "attributes": [
            {
              "name": "Title",
              "type": "String",
              "valueType": "stored",
              "defaultValue": null,
              "calculatedMicroflow": null
            },
            {
              "name": "StartDate",
              "type": "DateTime",
              "valueType": "stored",
              "defaultValue": null,
              "calculatedMicroflow": null
            },
            {
              "name": "PayFactor",
              "type": "Decimal",
              "valueType": "stored",
              "defaultValue": "0.00",
              "calculatedMicroflow": null
            },
            {
              "name": "Status",
              "type": "Enumeration (Draft/Submitted/Approved/Rejected/Archive)",
              "valueType": "stored",
              "defaultValue": "Draft",
              "calculatedMicroflow": null
            }
          ],
          "associations": [
            {
              "name": "LeaveRequest_LeaveType",
              "parent": "LeaveType",
              "child": "LeaveRequest",
              "type": "one-to-many",
              "parentDeleteBehavior": "delete_me_but_keep_references",
              "childDeleteBehavior": "delete_me_but_keep_references",
              "owner": "Default"
            }
          ],
          "eventHandlers": null
        },
        {
          "name": "User",
          "qualifiedName": "RequestsOverview.User",
          "generalization": {
            "hasGeneralization": true,
            "parent": "Administration.Account"
          },
          "attributes": [],
          "associations": [],
          "eventHandlers": null
        }
      ]
    }
  ]
}
```

---

### Important Notes

- **Read-only:** This tool does not modify the working copy. No need to call `commit_working_copy` after reading.
- **In-memory state:** Data returned reflects the current state of the working copy in the session (including any changes made in the session but not yet committed). To read committed state from the repository, call `commit_working_copy` first, then open a new working copy.
- **Associations listed per-entity:** Each entity lists all related associations (both parent and child sides) from both `dm.associations` and `dm.crossAssociations`. An association may appear in both entities (parent and child) in the output.
- **Generalization:** If an entity inherits from another entity, the `generalization` field has the form `{ "hasGeneralization": true, "parent": "Module.EntityName" }` (FQN of the parent entity). If no inheritance (`NoGeneralization`), the value is `null`.
- **`eventHandlers`:** Always `null` in the current implementation — reserved for future use.
- **Empty module:** A module with no entities is still returned with `"entities": []`.

---

---

<!-- END TOOL 3: read_domain_model -->

<!-- BEGIN TOOL 5: create_entity -->

## Tool 5: `create_entity`

Add a new entity to the domain model of a specified module **without deleting existing entities**. Unlike `create_domain_model` (which clears the entire domain model and rebuilds), `create_entity` only **appends or replaces the specified entity** — other entities and associations in the module are not affected.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

> **See also:** `system_members.md` — **before listing audit-style attributes** (`CreatedAt`, `ModifiedAt`, `UpdatedAt`, …), check the system-member synonym list; prefer `hasCreatedDate` / `hasChangedDate` / `hasOwner` / `hasChangedBy` flags on the entity.

---

### Input

```json
{
  "moduleName": "string (required) — Name of the module containing the domain model (e.g., MyFirstModule)",
  "overwrite": "boolean (optional, default: false) — true = delete existing entity with same name and recreate; false = throw if already exists",
  "entity": {
    "name": "string (required) — Entity name, PascalCase (e.g., Customer)",
    "documentation": "string (optional) — Entity description",
    "location": {
      "x": "number (optional, default: 0)",
      "y": "number (optional, default: 0)"
    },
    "persistable": "boolean (optional, default: true) — false = non-persistent (transient object). IGNORED when `generalization` is provided (inherited from parent).",
    "hasCreatedDate": "boolean (optional, default: false) — IGNORED when `generalization` is provided.",
    "hasChangedDate": "boolean (optional, default: false) — IGNORED when `generalization` is provided.",
    "hasOwner": "boolean (optional, default: false) — IGNORED when `generalization` is provided.",
    "hasChangedBy": "boolean (optional, default: false) — IGNORED when `generalization` is provided.",
    "generalization": {
      "parentEntity": "string (optional) — Qualified name of the parent entity (e.g., 'Administration.Account', 'System.FileDocument'). If provided, the new entity becomes a **specialization** (inherits from) `parentEntity` — all attributes and system-field flags of the parent are inherited automatically, persistable/hasCreatedDate/... flags above are ignored. Parent must exist in the model — pre-flight validation throws if not found. **Cross-module parents in user and marketplace modules are supported** (the resolver eager-loads the owning module's domain model before lookup). **System.* parents** (`System.FileDocument`, `System.Image`, `System.User`) are also supported — `mendixmodelsdk` deliberately hides the System module, so the builder uses the raw-write technique documented at https://www.mendix.com/blog/a-mendix-sdk-primer-part-2/ (writes the qualified name directly into the `ByNameReferenceProperty`; Studio Pro / runtime resolve it at load time). Only the names in `KNOWN_SYSTEM_PARENT_ENTITIES` (sharedResolvers.ts) are accepted — an unknown `System.*` FQN throws to prevent a Studio-Pro 'broken reference' error after commit."
    },
    "attributes": [
      {
        "name": "string (required, schema-level) — Attribute name, PascalCase",
        "type": "string (required, schema-level) — See Attribute Types table below; MCP framework rejects the request before the handler runs if missing",
        "documentation": "string (optional)",
        "defaultValue": "string (optional) — Default value as string (e.g., '0', 'true', '')",
        "length": "number (optional) — Applicable to String type only (default 200)",
        "enumerationName": "string (optional, required if type = Enumeration) — Either a short name ('OrderStatus') or an FQN ('OrderModule.OrderStatus'). When an FQN is provided here, the resolver splits on '.' and uses the prefix as the module qualifier — `enumerationModule` is effectively ignored in that case (no concatenation), so either form works.",
        "enumerationModule": "string (optional) — Module containing the enum. When provided alongside a short-name `enumerationName`, the resolver matches strictly on the qualified name `<enumerationModule>.<enumerationName>` — a same-named enum in another module will NOT be picked up. When both `enumerationModule` is omitted AND `enumerationName` is a short name, the resolver does a project-wide short-name match; if multiple modules have an enum with the same name, iteration order decides — always pass `enumerationModule` (or use the FQN form in `enumerationName`) when there is any chance of cross-module collision."
      }
    ]
  }
}
```

---

### Attribute Types

| `type` value   | Mendix Type  | Notes                                                                                      |
| -------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `String`       | String       | Supports `length` (default 200)                                                            |
| `Integer`      | Integer      | 32-bit integer                                                                             |
| `Long`         | Long         | 64-bit integer                                                                             |
| `Decimal`      | Decimal      | High-precision decimal                                                                     |
| `Boolean`      | Boolean      | True / False                                                                               |
| `DateTime`     | DateTime     | Date and time                                                                              |
| `Enumeration`  | Enumeration  | Requires `enumerationName` (and optionally `enumerationModule`)                            |
| `Binary`       | Binary       | Binary data (file, image); `defaultValue` ignored — Binary does not support default values |
| `HashedString` | HashedString | Hashed string (e.g., password)                                                             |
| `AutoNumber`   | AutoNumber   | Auto-increment; `defaultValue` is the initial seed value (SDK default if omitted)          |

---

### Behavior

#### Step 1 — Pre-flight validation (transactional — before creating the entity)

1. **Check working copy:** If no session working copy is open — throw `"No working copy is open in this session. Call open_working_copy first."`.
2. **Check `entity.name`:** If empty or missing — throw `"entity.name is required and must be a non-empty string."`.
3. **Find module:** `model.root.modules.find(m => m.name === moduleName)` — throw if not found, with list of available modules.
4. **Load domain model:** `await module.domainModel.load()`.
5. **Check entity name conflict:** Search `dm.entities` for any entity with `e.name === entity.name`:
   - If exists and `overwrite: false` (default) — throw `"Entity '${entity.name}' already exists in module '${moduleName}'. Set overwrite: true to replace it."`.
   - If exists and `overwrite: true` — mark old entity for deletion.
   - If does not exist and `overwrite: true` — do nothing extra; entity is created as if `overwrite: false`. Response returns "created" (not "overwritten").
6. **Validate attributes:** For each attribute at index `i`:
   - Missing `name` — throw `"Attribute at index ${i} is missing required field 'name'."`.
   - Invalid `type` — throw `"Unknown attribute type: '${type}'. Supported: String, Integer, Long, Decimal, Boolean, DateTime, Binary, HashedString, AutoNumber, Enumeration."`.
   - `type = Boolean` but `defaultValue` is missing or empty — throw `"Attribute '${name}' is type Boolean but no defaultValue was provided. Please specify a defaultValue of 'true' or 'false'."`.
   - `type = Enumeration` but missing `enumerationName` — throw `"Attribute '${name}' is type Enumeration but enumerationName was not provided."`.
   - `type = Enumeration` and `enumerationName` provided: resolve enum at this step — if not found — throw `"Enumeration '${qname}' not found. Available: ${list}."`.

#### Step 2 — Create entity

7. **If `overwrite: true` and old entity exists:** Call `.delete()` on the old entity to remove it from `dm.entities`.

   > **Warning:** When an entity is deleted, any `Association` or `CrossAssociation` in the domain model with `parent` or `child` pointing to that entity becomes a broken reference. Caller must recreate those associations after overwrite if needed.

8. **Create new entity:** `domainmodels.Entity.createIn(dm)`, set properties:
   - `entity.name`, `entity.documentation`, `entity.location`
   - **If `generalization.parentEntity` provided:** Pre-flight uses `validateGeneralizationParent(model, parentEntity)` (in `sharedResolvers.ts`); the actual write goes through `applyGeneralization(model, entity, parentEntity)`. Two paths:
     - **User / marketplace parent** (anything not starting with `System.`): `applyGeneralization` calls `resolveEntityByFqn`, which eager-loads the parent's module if it is enumerated by `model.allModules()` (covers lazy marketplace modules), then `model.findEntityByQualifiedName(parentEntity)`. Creates `domainmodels.Generalization.createIn(entity)` and sets `gen.generalization = parent` via the typed setter.
     - **System.\* parent** (`System.FileDocument`, `System.Image`, `System.User`): the typed setter cannot be used because the SDK does not expose the System module. `applyGeneralization` instead validates against the `KNOWN_SYSTEM_PARENT_ENTITIES` allow-list, then writes the raw qualified-name string into the underlying `ByNameReferenceProperty` via `gen.__generalization.updateWithRawValue(parentEntity)`. Studio Pro and the runtime resolve the qname at load time. See https://www.mendix.com/blog/a-mendix-sdk-primer-part-2/.
     - Either way: the `persistable`, `hasCreatedDate`, `hasChangedDate`, `hasOwner`, `hasChangedBy` flags are **not** applied — they are inherited from the parent.
   - **Otherwise (no generalization):** `NoGeneralization.createIn(entity)` with `persistable`, `hasCreatedDate`, `hasChangedDate`, `hasOwner`, `hasChangedBy`.

   > **Mendix note:** When `persistable: false`, the flags `hasCreatedDate`, `hasChangedDate`, `hasOwner`, `hasChangedBy` must be `false`. Studio Pro will report a validation error if a non-persistent entity has system members enabled — the model SDK does not block this at creation time.

   > **Generalization & pre-flight:** Validity of `generalization.parentEntity` is checked in Step 1 (pre-flight) — if the parent QN does not exist in the model, the tool throws before any mutation occurs. Inheritance cycle detection (self-reference or cycles) is not performed — caller's responsibility.

9. **Create attributes:** For each attribute in `entity.attributes`:
   - `domainmodels.Attribute.createIn(entity)`, set `name`, `documentation`.
   - Call `applyAttributeType(attr, attrInput, model)` — uses `createInAttributeUnderType()` (Mendix 9–11 compatible).
   - If `type !== "Binary"`: `domainmodels.StoredValue.createIn(attr)` with `defaultValue`. For `Binary`, skip the `StoredValue` step — Binary does not support default values in Mendix.
10. **No flush, no commit** — caller must call `commit_working_copy`.

> **Non-destructive:** `create_entity` does **not** call `dm.entities.clear()` or `dm.associations.clear()`. Only deletes the specific entity when `overwrite: true`.

---

### Output

Returns plain text (MCP `textResult`):

```
# New creation (no generalization):
Entity '<name>' created in module '<moduleName>'.
Attributes: <count>
Persistable: <true|false>
System fields: <comma-separated list of enabled flags — any combination of: createdDate, changedDate, owner, changedBy; or "none" if all false>
(Changes are not committed — call commit_working_copy when done.)

# New creation (with generalization — specialization):
Entity '<name>' created in module '<moduleName>'.
Attributes: <count>
Generalization: specialization of '<parentQualifiedName>' (persistable and system fields inherited from parent)
(Changes are not committed — call commit_working_copy when done.)

# When overwrite:
Entity '<name>' overwritten in module '<moduleName>'.
Attributes: <count>
Persistable: <true|false>  (or corresponding Generalization line if overwrite creates a specialization)
System fields: <comma-separated list of enabled flags, or "none">
Warning: Existing associations referencing this entity may be broken — recreate them if needed.
(Changes are not committed — call commit_working_copy when done.)
```

---

### Error Cases

| Condition                                                                                                                    | Behavior                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No working copy is open                                                                                                      | Throw: `"No working copy is open in this session. Call open_working_copy first."`                                                                                                                                                                                                                                                                 |
| `entity.name` is empty or missing                                                                                            | Throw: `"entity.name is required and must be a non-empty string."`                                                                                                                                                                                                                                                                                |
| `moduleName` not found                                                                                                       | Throw: `"Module \"${moduleName}\" not found. Available modules: ${available}"`                                                                                                                                                                                                                                                                    |
| Entity with same name exists, `overwrite: false`                                                                             | Throw: `"Entity '${name}' already exists in module '${moduleName}'. Set overwrite: true to replace it."`                                                                                                                                                                                                                                          |
| Attribute missing `name` at index `i`                                                                                        | Throw: `"Attribute at index ${i} is missing required field 'name'."`                                                                                                                                                                                                                                                                              |
| Attribute `name` matches a Mendix reserved member (case-sensitive: `id`, `createdDate`, `changedDate`, `owner`, `changedBy`) | Throw: `"Attribute '${name}' on entity '${entityName}' uses the Mendix reserved member name. Reserved: id, createdDate, changedDate, owner, changedBy. Use PascalCase variants (CreatedDate, ChangedBy, etc.) for custom audit columns, or enable the corresponding system field via hasCreatedDate / hasChangedDate / hasOwner / hasChangedBy."` |
| Attribute `type` is invalid                                                                                                  | Throw: `"Unknown attribute type: '${type}'. Supported: String, Integer, Long, Decimal, Boolean, DateTime, Binary, HashedString, AutoNumber, Enumeration."`                                                                                                                                                                                        |
| `type = Boolean` with no `defaultValue`                                                                                      | Throw: `"Attribute '${name}' is type Boolean but no defaultValue was provided. Please specify a defaultValue of 'true' or 'false'."`                                                                                                                                                                                                              |
| `type = Enumeration` missing `enumerationName`                                                                               | Throw: `"Attribute '${name}' is type Enumeration but enumerationName was not provided."`                                                                                                                                                                                                                                                          |
| Enumeration not found in model                                                                                               | Throw: `"Enumeration '${qname}' not found. Available: ${list}."`                                                                                                                                                                                                                                                                                  |

---

### Full Examples

**Example 1 — Basic entity:**

```json
{
  "moduleName": "MyFirstModule",
  "entity": {
    "name": "Customer",
    "documentation": "Represents a customer in the system",
    "location": { "x": 100, "y": 100 },
    "persistable": true,
    "hasCreatedDate": true,
    "hasChangedDate": true,
    "attributes": [
      { "name": "FullName", "type": "String", "length": 200 },
      { "name": "Email", "type": "String", "length": 255 },
      { "name": "Age", "type": "Integer", "defaultValue": "0" },
      { "name": "IsActive", "type": "Boolean", "defaultValue": "true" },
      { "name": "RegisteredAt", "type": "DateTime" }
    ]
  }
}
```

**Example 2 — Entity with Enumeration attribute:**

```json
{
  "moduleName": "OrderModule",
  "entity": {
    "name": "Order",
    "location": { "x": 300, "y": 200 },
    "persistable": true,
    "hasCreatedDate": true,
    "hasChangedDate": true,
    "attributes": [
      { "name": "OrderNumber", "type": "AutoNumber" },
      { "name": "TotalAmount", "type": "Decimal", "defaultValue": "0" },
      {
        "name": "Status",
        "type": "Enumeration",
        "enumerationName": "OrderStatus",
        "enumerationModule": "OrderModule"
      },
      { "name": "Notes", "type": "String", "length": 2000 }
    ]
  }
}
```

**Example 3 — Non-persistent (transient object):**

```json
{
  "moduleName": "HelperModule",
  "entity": {
    "name": "SearchFilter",
    "documentation": "Transient object passing filter params to a microflow",
    "persistable": false,
    "attributes": [
      { "name": "Keyword", "type": "String", "length": 100 },
      { "name": "FromDate", "type": "DateTime" },
      { "name": "ToDate", "type": "DateTime" },
      { "name": "MaxResults", "type": "Integer", "defaultValue": "50" }
    ]
  }
}
```

**Example 4 — Overwrite existing entity:**

```json
{
  "moduleName": "MyFirstModule",
  "overwrite": true,
  "entity": {
    "name": "Customer",
    "location": { "x": 100, "y": 100 },
    "persistable": true,
    "hasCreatedDate": true,
    "hasChangedDate": true,
    "hasOwner": true,
    "attributes": [
      { "name": "FullName", "type": "String", "length": 200 },
      { "name": "PhoneNumber", "type": "String", "length": 20 },
      { "name": "PasswordHash", "type": "HashedString" }
    ]
  }
}
```

---

---

<!-- END TOOL 5: create_entity -->

<!-- BEGIN TOOL 6: create_multiple_entities -->

## Tool 6: `create_multiple_entities`

Create multiple entities at once in a single call (batch version of `create_entity`, Tool 5). Each entity in the list can override the module individually. Does not delete existing entities — only appends or replaces specified entities.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

> **See also:** `create_entity` (Tool 5) — to create a single entity with full options (generalization, system flags, location, documentation). `system_members.md` — before listing audit-style attributes on any entity, check the system-member synonym list; prefer `hasCreatedDate` / `hasChangedDate` / `hasOwner` / `hasChangedBy` flags.

---

### Input

```json
{
  "moduleName": "string (optional) — Default module for all entities. Can be overridden per entity.",
  "entities": [
    {
      "entityName": "string (required) — Entity name, PascalCase",
      "moduleName": "string (optional) — Override module for this entity",
      "overwrite": "boolean (optional, default: false) — true = delete existing entity with same name and recreate",
      "documentation": "string (optional)",
      "location": {
        "x": "number (optional, default: 0)",
        "y": "number (optional, default: 0)"
      },
      "persistable": "boolean (optional, default: true)",
      "hasCreatedDate": "boolean (optional, default: false)",
      "hasChangedDate": "boolean (optional, default: false)",
      "hasOwner": "boolean (optional, default: false)",
      "hasChangedBy": "boolean (optional, default: false)",
      "generalization": {
        "parentEntity": "string (optional) — FQN of the parent entity. Cross-module parents in user and marketplace modules (e.g. `Administration.Account`, `WorkflowCommons.*`) are auto-loaded by the resolver. **System.* parents** (FileDocument, Image, User) work via the raw-write technique — see Tool 5's `parentEntity` field for details."
      },
      "attributes": [
        {
          "name": "string (required)",
          "type": "string (required) — See Attribute Types in Tool 5",
          "documentation": "string (optional)",
          "defaultValue": "string (optional)",
          "length": "number (optional) — Max length for String attributes",
          "enumerationName": "string (optional) — Existing enum, short name ('OrderStatus') or FQN ('OrderModule.OrderStatus'). FQN form embedded here takes precedence over a separate `enumerationModule`.",
          "enumerationModule": "string (optional) — Module containing the enum. When supplied with a short `enumerationName`, the resolver matches strictly on the qualified name — a same-named enum in another module is NOT picked. See Tool 5 for the full collision-resolution rules."
        }
      ]
    }
  ]
}
```

| Field                    | Required | Description                                                             |
| ------------------------ | -------- | ----------------------------------------------------------------------- |
| `moduleName` (top-level) | No       | Default module if entity has no `moduleName` of its own                 |
| `entities`               | Yes      | Array of entities to create; must have at least 1 element               |
| `entities[].entityName`  | Yes      | Entity name in PascalCase                                               |
| `entities[].moduleName`  | No       | Override module for this entity; if omitted uses top-level `moduleName` |
| `entities[].overwrite`   | No       | Default `false` — throw if entity already exists                        |
| `entities[].attributes`  | No       | List of attributes to create with the entity                            |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Validate: `entities` array must not be empty — throw: `"entities must contain at least one entry."`. For each entity, determine the effective module: use `entity.moduleName` if provided, otherwise use top-level `moduleName`; throw if both are missing: `"moduleName is required — provide top-level moduleName or per-entity moduleName."`.
3. For each entity in the array, apply the full logic of `create_entity` (Tool 5):
   - Find module by name; throw if not found: `"Module '<moduleName>' not found in working copy. Available modules: <list>."`.
   - **Load domain model before accessing entities:** `await mod.domainModel.load()`.
   - Check if entity exists; if so and `overwrite: false` — throw: `"Entity '<entityName>' already exists in module '<moduleName>'. Set overwrite: true to replace it."`. If `overwrite: true` — `existingEntity.delete()` before creating new.
   - Create `domainmodels.Entity.createIn(dm)`, set `name`, `documentation`, `location`.
   - If `generalization.parentEntity` is provided: delegate to `applyGeneralization(model, entity, parentEntity)` (see `sharedResolvers.ts`). For user/marketplace parents this resolves via `resolveEntityByFqn` (eager-loads the parent's module) and uses the typed setter; for `System.*` parents it validates against `KNOWN_SYSTEM_PARENT_ENTITIES` and writes the raw qname via `gen.__generalization.updateWithRawValue(...)`. Skip `persistable`/system flags either way.
   - Otherwise (no generalization): create `domainmodels.NoGeneralization.createIn(entity)` and set flags on that `NoGeneralization` instance: `noGen.persistable`, `noGen.hasCreatedDate`, `noGen.hasChangedDate`, `noGen.hasOwner`, `noGen.hasChangedBy` — from input (defaults: `persistable=true`, rest `false`). **Do not assign directly to `entity.persistable`** — that property does not exist on the SDK `Entity` and will silently fail.
   - Create each `Attribute` per the `attributes` array. For each: `const attr = domainmodels.Attribute.createIn(entity)`, set `attr.name`. Create type object using the corresponding factory per `type` value — e.g.: `domainmodels.StringAttributeType.createIn(attr)`, `domainmodels.IntegerAttributeType.createIn(attr)`, `domainmodels.BooleanAttributeType.createIn(attr)`, `domainmodels.AutoNumberAttributeType.createIn(attr)`, `domainmodels.EnumerationAttributeType.createIn(attr)` (see full table at Tool 5). Create `StoredValue.createIn(attr)` unconditionally **except `Binary`** — Binary does not use StoredValue. **SDK note:** `AutoNumberAttributeType` in `mendixmodelsdk@^4.110` **does not expose** a `.seed` property; AutoNumber uses `StoredValue` like other numeric types and `defaultValue` serves as the seed (assign to `StoredValue.defaultValue` as string). Validate before creating: `type` must be a valid value and `name` must not be duplicate within the current entity.
   - If `overwrite: true` but entity does not exist — create normally (no throw).
4. **Failure strategy: fail-fast** — stop immediately at the first entity that errors and throw; do not process remaining entities. **Note on partial state:** entities that were successfully processed before the error remain in the working copy — they are not rolled back.
5. Return JSON summary after processing the full list.

---

### Output

Returns JSON string (via `textResult(JSON.stringify(result, null, 2))`):

```json
{
  "success": true,
  "status": "success",
  "message": "Created <N> entities",
  "data": {
    "created": ["ModuleName.EntityName", "..."],
    "overwritten": ["ModuleName.EntityName", "..."],
    "count": "<number> — total entities created or overwritten (created.length + overwritten.length)"
  }
}
```

---

### Error Cases

| Condition                                                                                                                       | Behavior                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No working copy is open                                                                                                         | Throw: `"No working copy is open in this session. Call open_working_copy first."`                                                                                                                                                                                                                                                               |
| `entities` is empty                                                                                                             | Throw: `"entities must contain at least one entry."`                                                                                                                                                                                                                                                                                            |
| Cannot determine module for an entity                                                                                           | Throw: `"moduleName is required — provide top-level moduleName or per-entity moduleName."`                                                                                                                                                                                                                                                      |
| Module not found                                                                                                                | Throw: `"Module '<moduleName>' not found in working copy. Available modules: <list>."`                                                                                                                                                                                                                                                          |
| Entity already exists and `overwrite: false`                                                                                    | Throw: `"Entity '<entityName>' already exists in module '<moduleName>'. Set overwrite: true to replace it."`                                                                                                                                                                                                                                    |
| `generalization.parentEntity` not found                                                                                         | Throw: `"Parent entity '<parentEntity>' not found in model."`                                                                                                                                                                                                                                                                                   |
| `attributes[].type` is invalid                                                                                                  | Throw: `"Invalid attribute type '<value>' on entity '<entityName>'. Supported: String, Integer, Long, Decimal, Boolean, DateTime, AutoNumber, Binary, HashedString, Enumeration:EnumName."`                                                                                                                                                     |
| `attributes[].name` matches a Mendix reserved member (case-sensitive: `id`, `createdDate`, `changedDate`, `owner`, `changedBy`) | Throw: `"Attribute '<name>' on entity '<entityName>' uses the Mendix reserved member name. Reserved: id, createdDate, changedDate, owner, changedBy. Use PascalCase variants (CreatedDate, ChangedBy, etc.) for custom audit columns, or enable the corresponding system field via hasCreatedDate / hasChangedDate / hasOwner / hasChangedBy."` |
| `attributes[].name` is duplicate within the same entity                                                                         | Throw: `"Duplicate attribute name '<attributeName>' on entity '<entityName>'."`                                                                                                                                                                                                                                                                 |

---

---

<!-- END TOOL 6: create_multiple_entities -->

<!-- BEGIN TOOL 7: create_association -->

## Tool 7: `create_association`

Add one or more Associations to a module's domain model **without destroying** existing entities or associations. Unlike `create_domain_model` (which rebuilds the entire domain model from scratch), `create_association` only **appends** — suitable for multi-step sessions where entities have already been created.

Supports both **same-module** and **cross-module** associations (e.g., `MyModule.Order` → `Administration.Account`).

Prerequisite: `open_working_copy` must be called first, and the referenced entities must already exist in the model.

> **See also:** `system_members.md` — **before adding an audit-style association** to `System.User` / `Administration.Account` (`Owner`, `CreatedBy`, `ChangedBy`, `ModifiedBy`, `UpdatedBy`, …), check the system-member synonym list; prefer `hasOwner` / `hasChangedBy` flags on the entity instead.

---

### Input

```json
{
  "moduleName": "string (required) — Name of the module containing the domain model (where the association is created)",
  "associations": [
    {
      "name": "string (required) — Association name, convention: ParentEntity_ChildEntity (e.g., Order_OrderLine)",
      "parentEntity": "string (required) — Short name if same module (e.g., 'Order'), or FQN if cross-module (e.g., 'Administration.Account')",
      "childEntity": "string (required) — Short name if same module, or FQN if cross-module",
      "type": "string (optional, default: Reference) — Reference | ReferenceSet",
      "owner": "string (optional, default: Default) — Default | Both",
      "overwrite": "boolean (optional, default: false) — If true and an association with same name already exists, delete and recreate",
      "documentation": "string (optional) — Association description",
      "deleteBehavior": {
        "parentDeleteBehavior": "string (optional, default: DeleteMeButKeepReferences)",
        "childDeleteBehavior": "string (optional, default: DeleteMeButKeepReferences)"
      }
    }
  ]
}
```

---

### Association types

> **Read this before drafting any association — `parent` and `child` are opposite to ER-diagram intuition.** In the Mendix SDK / MPR file format, **`Parent` is the OWNER of the association** — the entity that physically holds the foreign-key reference attribute, the many-side (`[*]`) end. **`Child` is the REFERENCED entity** — the one-side (`[1]`) end. This matches Mendix's "owner-first" naming convention: in the canonical example `Order_Customer`, Order is the entity that has a `Customer` reference attribute (FK holder), so `Order` goes in the SDK `parent` slot and `Customer` in `child`. See the Mendix-shipped sibling `Administration.AccountPasswordData_Account` — `parent` is `AccountPasswordData` (transient form holding the reference), `child` is `Account` (referenced user). Follow the `ParentEntity_ChildEntity` (= `Owner_Referenced` = `[*]-side_[1]-side`) naming convention. **The tool emits warnings when (a) `name` does not match the `PascalCase_PascalCase` pattern, or (b) `name` matches `<PascalA>_<PascalB>` but the slots are exactly swapped vs the tokens.** (This is counter-intuitive — most ER notations call the `[1]` side the "parent" — so verify with `read_domain_model` or `query_associations` after building, and see `specs/rules/association_parent_child.md` for the planner-side companion rule.)

#### `type` — Cardinality

| Value          | Mendix SDK                     | Relationship | Description                                                                                                                                                    |
| -------------- | ------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Reference`    | `AssociationType.Reference`    | Many-to-one  | Default. **Parent** holds a foreign-key reference attribute pointing to a single **Child**. Parent is on the many (`[*]`) side, Child on the one (`[1]`) side. |
| `ReferenceSet` | `AssociationType.ReferenceSet` | Many-to-many | Mendix uses an intermediate join table; both entities navigate via the join table.                                                                             |

---

#### `owner` — Navigation ownership

| Value     | Mendix SDK                 | Description                                                                                                                                                                                           |
| --------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Default` | `AssociationOwner.Default` | Only the **Parent** entity owns the association (foreign-key reference attribute is stored on the parent side — see the parent/child note above for why parent = FK holder). Default and most common. |
| `Both`    | `AssociationOwner.Both`    | Both entities can navigate the association via a join table. Only meaningful with `ReferenceSet`. With `Reference`, emits a warning (see Warnings).                                                   |

> **Best practice:** Use `Default` unless you need to traverse from both sides of a `ReferenceSet` without XPath. `Both` with `type: "Reference"` has no practical effect and will be warned.

---

#### `deleteBehavior` — Delete behavior

Each side (parent/child) can independently configure behavior when that object is deleted:

| Value                       | Mendix SDK                                   | Description                                                                                                                                   |
| --------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DeleteMeButKeepReferences` | `DeletingBehavior.DeleteMeButKeepReferences` | **(Default)** Delete this object; orphaned reference on the other side returns `empty` at runtime — Mendix handles this gracefully, no crash. |
| `DeleteMeAndReferences`     | `DeletingBehavior.DeleteMeAndReferences`     | Delete this object **and** all objects on the other side currently referencing it (cascade delete).                                           |
| `DeleteMeIfNoReferences`    | `DeletingBehavior.DeleteMeIfNoReferences`    | Only allow deletion if no objects are currently referencing this one (restricted delete).                                                     |

**Practical combinations.** Remember `parentDeleteBehavior` governs what happens to references when the **parent** (`[*]` side / FK holder) is deleted, and `childDeleteBehavior` governs the **child** (`[1]` side / referenced entity). For Reference associations, the entity to cascade _from_ is usually the one-side (child) — so cascade behaviors typically live on `childDeleteBehavior`.

| Scenario                                                                         | SDK `parent` (owner / FK holder / `[*]`) | SDK `child` (referenced / `[1]`) | `parentDeleteBehavior`      | `childDeleteBehavior`       |
| -------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------- | --------------------------- | --------------------------- |
| **Cascade**: delete OrderLines when their Order is deleted                       | `OrderLine`                              | `Order`                          | `DeleteMeButKeepReferences` | `DeleteMeAndReferences`     |
| **Restrict**: prevent Department deletion while any Employee still references it | `Employee`                               | `Department`                     | `DeleteMeButKeepReferences` | `DeleteMeIfNoReferences`    |
| **Tag many-to-many Article** (`ReferenceSet`)                                    | `Tag`                                    | `Article`                        | `DeleteMeButKeepReferences` | `DeleteMeButKeepReferences` |

Convention check: the association names follow `Parent_Child` = `Owner_Referenced` — `OrderLine_Order`, `Employee_Department`, `Tag_Article`.

> **Note on `ReferenceSet` + `DeleteMeAndReferences`:** With `ReferenceSet`, `DeleteMeAndReferences` cascades to **all** objects on the other side currently referenced — a much wider delete scope than `Reference` and can cause unintended data loss. Use `DeleteMeButKeepReferences` for many-to-many by default; only use `DeleteMeAndReferences` when cascade is intentional and has been carefully reviewed.

---

### Behavior

#### Step 1 — Pre-flight validation (transactional — before creating any association)

Tool performs **all validation first**, then starts creation. If any check fails, no associations are created.

1. **Check working copy:** If no session working copy is open — throw `"No working copy is currently open. Call open_working_copy first."`.
2. **Check `associations` not empty:** If array is empty — throw `"associations array must contain at least one entry."`.
3. **Check required fields:** For each association at index `i`:
   - Missing `name` — throw `"Association at index ${i} is missing required field 'name'."`.
   - Missing `parentEntity` or `childEntity` — throw `"Association '${name}' is missing required field '${field}'."`.
4. **Find module:** `model.root.modules.find(m => m.name === moduleName)` — throw if not found, with list of available modules.
5. **Load domain model:** `await module.domainModel.load()`.
6. **Resolve all entity references:** For each `parentEntity` and `childEntity` in the entire array:
   - **If contains `.` (FQN):** use `model.findEntityByQualifiedName(value)` directly.
   - **If no `.` (short name):** search `dm.entities` by `e.name === value`; if not found, try `model.findEntityByQualifiedName(moduleName + '.' + value)`.
   - If still not found — throw `"Entity '${value}' not found. For cross-module entities use FQN (e.g. 'OtherModule.EntityName')."`.
7. **Check semantic conflict:** For each association already existing in `dm.associations` with the same `name`:
   - If `overwrite: false` (default): compare `parentEntity`, `childEntity`, `type`, `owner`. If any field differs from input — throw `"Association '${name}' already exists with different definition (parent: ${existing.parent} vs ${input.parentEntity}, child: ${existing.child} vs ${input.childEntity}, type: ${existing.type} vs ${input.type}, owner: ${existing.owner} vs ${input.owner}). Use overwrite: true to replace it."`. If all match — mark as `skipped`.
   - If `overwrite: true`: mark for deletion and recreation.

#### Step 2 — Create associations

8. **For each association (in declaration order):**
   - If `skipped`: skip, record `status: "skipped (already exists, definition matches)"`.
   - If `overwrite: true` and exists: delete old association from `dm.associations`, record `status: "overwritten"`.
   - Create `domainmodels.Association.createIn(dm)` and set properties:
     - `assoc.name`, `assoc.documentation`
     - `assoc.parent = resolvedParentRef`, `assoc.child = resolvedChildRef`
     - `assoc.type` per `AssociationType.Reference` / `AssociationType.ReferenceSet`
     - `assoc.owner` per `AssociationOwner.Default` / `AssociationOwner.Both`
     - `AssociationDeleteBehavior.createIn(assoc)` with `parentDeleteBehavior`, `childDeleteBehavior` per `parseDeletingBehavior`.
   - Record `status: "created"`.
9. **No flush, no commit** — caller must call `commit_working_copy`.

> **Non-destructive:** `create_association` does **not** call `dm.entities.clear()` or `dm.associations.clear()`. Only appends or replaces per `overwrite`. Use `create_domain_model` if a full rebuild is needed.

---

### Warnings (do not block creation)

| Condition                                                 | Warning message                                                                                                  |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `name` does not follow `PascalParent_PascalChild` pattern | `"Association name '${name}' does not follow convention 'ParentEntity_ChildEntity'."`                            |
| `type: "Reference"` with `owner: "Both"`                  | `"owner 'Both' has no effect on Reference associations. Use ReferenceSet if bidirectional ownership is needed."` |

---

### Output

Returns plain text (MCP `textResult`):

```
Associations processed in module '<moduleName>': <created> created, <overwritten> overwritten, <skipped> skipped.
  - [<status>] <name>: <parentEntity FQN> → <childEntity FQN> (<type>, owner=<owner>, parentDel=<parentDeleteBehavior>, childDel=<childDeleteBehavior>)
  - ...
Warnings:
  - <warning 1>
  - ...
(Changes are not committed — call commit_working_copy when done.)
```

Example output (no warnings):

```
Associations processed in module 'TestEntityMaintenance': 2 created, 1 overwritten, 0 skipped.
  - [created] TestEntity_AssociatedEntity: TestEntityMaintenance.TestEntity → TestEntityMaintenance.AssociatedEntity (Reference, owner=Default, parentDel=DeleteMeButKeepReferences, childDel=DeleteMeButKeepReferences)
  - [created] OrderLine_Order: TestEntityMaintenance.OrderLine → TestEntityMaintenance.Order (Reference, owner=Default, parentDel=DeleteMeButKeepReferences, childDel=DeleteMeAndReferences)
  - [overwritten] Tag_Article: TestEntityMaintenance.Tag → TestEntityMaintenance.Article (ReferenceSet, owner=Both, parentDel=DeleteMeButKeepReferences, childDel=DeleteMeButKeepReferences)
(Changes are not committed — call commit_working_copy when done.)
```

Example output with warning (`type: "Reference"` + `owner: "Both"`):

```
Associations processed in module 'TestEntityMaintenance': 1 created, 0 overwritten, 0 skipped.
  - [created] Invoice_Payment: TestEntityMaintenance.Invoice → TestEntityMaintenance.Payment (Reference, owner=Both, parentDel=DeleteMeButKeepReferences, childDel=DeleteMeButKeepReferences)
Warnings:
  - Association 'Invoice_Payment': owner 'Both' has no effect on Reference associations. Use ReferenceSet if bidirectional ownership is needed.
(Changes are not committed — call commit_working_copy when done.)
```

> **`parentEntity`/`childEntity`** in output are always **resolved FQNs** (not the short-name inputs) so the caller can audit exactly which entities are linked. The `Warnings:` section only appears when at least one warning exists.

| Field (in output) | Description                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `created`         | Number of newly created associations                                                     |
| `skipped`         | Number of associations skipped because they already exist with **matching definition**   |
| `overwritten`     | Number of associations deleted and recreated due to `overwrite: true`                    |
| `associations`    | Detail per association with `status`, applied `deleteBehavior`, and resolved entity FQNs |
| `warnings`        | Non-blocking warnings array (naming convention, `owner: "Both"` with `Reference`)        |

---

### Error Cases

| Condition                                                                                            | Behavior                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No working copy is open                                                                              | Throw: `"No working copy is currently open. Call open_working_copy first."`                                                                                                                             |
| `associations` is empty array                                                                        | Throw: `"associations array must contain at least one entry."` — pre-flight                                                                                                                             |
| `name` missing at index `i`                                                                          | Throw: `"Association at index ${i} is missing required field 'name'."` — pre-flight                                                                                                                     |
| `parentEntity` or `childEntity` missing                                                              | Throw: `"Association '${name}' is missing required field '${field}'."` — pre-flight                                                                                                                     |
| `moduleName` not found                                                                               | Throw with list of available modules — pre-flight                                                                                                                                                       |
| Entity (short name or FQN) not found                                                                 | Throw: `"Entity '${value}' not found. For cross-module entities use FQN (e.g. 'OtherModule.EntityName')."` — pre-flight                                                                                 |
| Association with same name already exists with different `parentEntity`/`childEntity`/`type`/`owner` | Throw: `"Association '${name}' already exists with different definition (parent: ... vs ..., child: ... vs ..., type: ... vs ..., owner: ... vs ...). Use overwrite: true to replace it."` — pre-flight |

> **Transactional guarantee:** All validation in Step 1 must pass before Step 2 begins. If pre-flight fails — no associations are created, no partial state.

---

### Full Examples

**Same-module associations:**

```json
{
  "moduleName": "TestEntityMaintenance",
  "associations": [
    {
      "name": "TestEntity_AssociatedEntity",
      "parentEntity": "TestEntity",
      "childEntity": "AssociatedEntity",
      "type": "Reference",
      "owner": "Default",
      "documentation": "Links a TestEntity to its AssociatedEntity reference object",
      "deleteBehavior": {
        "parentDeleteBehavior": "DeleteMeButKeepReferences",
        "childDeleteBehavior": "DeleteMeButKeepReferences"
      }
    },
    {
      "name": "OrderLine_Order",
      "parentEntity": "OrderLine",
      "childEntity": "Order",
      "type": "Reference",
      "owner": "Default",
      "documentation": "OrderLine holds the FK to its Order (parent = owner = [*] side). Cascade is set on childDeleteBehavior so deleting an Order also deletes its OrderLines.",
      "deleteBehavior": {
        "parentDeleteBehavior": "DeleteMeButKeepReferences",
        "childDeleteBehavior": "DeleteMeAndReferences"
      }
    }
  ]
}
```

**Cross-module association (FQN):**

```json
{
  "moduleName": "TestEntityMaintenance",
  "associations": [
    {
      "name": "TestEntity_Account",
      "parentEntity": "TestEntity",
      "childEntity": "Administration.Account",
      "type": "Reference",
      "owner": "Default",
      "documentation": "Links TestEntity to its owner Mendix Account"
    }
  ]
}
```

**Overwrite existing association:**

```json
{
  "moduleName": "TestEntityMaintenance",
  "associations": [
    {
      "name": "Tag_Article",
      "parentEntity": "Tag",
      "childEntity": "Article",
      "type": "ReferenceSet",
      "owner": "Default",
      "overwrite": true,
      "documentation": "Updated: changed owner from Both to Default"
    }
  ]
}
```

---

---

<!-- END TOOL 7: create_association -->

<!-- BEGIN TOOL 8: create_multiple_associations -->

## Tool 8: `create_multiple_associations`

Create multiple associations at once in a single call (batch version of `create_association` + `create_cross_module_association`, Tools 7–13). Automatically distinguishes same-module and cross-module for each association based on the module of the parent/child entity.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

> **See also:** `create_association` (Tool 7) and `create_cross_module_association` (Tool 13) — to create a single association. `system_members.md` — before adding audit-style associations to `System.User` / `Administration.Account`, check the system-member synonym list; prefer `hasOwner` / `hasChangedBy` flags on the entity instead.

---

### Input

```json
{
  "associations": [
    {
      "name": "string (required) — Association name (e.g., Department_Employee)",
      "parentEntity": "string (required) — Name or FQN of parent entity",
      "childEntity": "string (required) — Name or FQN of child entity",
      "type": "string (optional, default: Reference) — Reference | ReferenceSet",
      "owner": "string (optional, default: Default) — Default | Both",
      "overwrite": "boolean (optional, default: false) — Delete and recreate if already exists",
      "documentation": "string (optional)",
      "deleteBehavior": {
        "parentDeleteBehavior": "string (optional, default: DeleteMeButKeepReferences)",
        "childDeleteBehavior": "string (optional, default: DeleteMeButKeepReferences)"
      }
    }
  ],
  "moduleName": "string (required) — Module containing the association (and the parent entity)"
}
```

| Field                         | Required | Description                                                                          |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `associations`                | Yes      | Array of associations to create; must have at least 1 element                        |
| `associations[].name`         | Yes      | Association name                                                                     |
| `associations[].parentEntity` | Yes      | Name or FQN of parent entity; if FQN from a different module → cross-module          |
| `associations[].childEntity`  | Yes      | Name or FQN of child entity; if FQN from a different module → cross-module           |
| `moduleName`                  | Yes      | Module registering the association (must contain the parent entity for cross-module) |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Validate: `associations` array must not be empty (throw: `"associations must contain at least one entry."`). For each element, confirm `name`, `parentEntity`, and `childEntity` are all provided; throw immediately if missing.
3. Find module by `moduleName`; throw if not found: `"Module '<moduleName>' not found in working copy."`.
4. **Load domain model:** `await mod.domainModel.load()`.
5. **Phase 1 — Pre-flight validation (entire array, no SDK writes):** For each association:
   - **Determine same-module or cross-module:** If `childEntity` contains `.` and the module prefix differs from `moduleName` → cross-module; otherwise → same-module.
   - Validate `parentEntity`: if it is a FQN and the module prefix differs from `moduleName` — throw: `"parentEntity '<entity>' must belong to module '<moduleName>'. Cross-module: only childEntity may be in a different module."`.
   - Resolve `parentEntity` in `dm.entities` (compare `e.name` with the short name after stripping FQN prefix); throw if not found: `"Entity '<parentEntity>' not found in module '<moduleName>'."`.
   - Resolve `childEntity`: same-module → search `dm.entities`; cross-module → search the whole model with `model.allEntities().find(e => e.qualifiedName === childFQN)`. Throw if not found: `"Entity '<childEntity>' not found in working copy."`.
   - Check for duplicate name: if exists in `dm.associations` or `dm.crossAssociations` and `overwrite: false` — throw: `"Association '<name>' already exists. Use overwrite: true to replace it."`.
6. **Phase 2 — Mutation (only runs if Phase 1 fully succeeds):** For each association:
   - If `overwrite: true` and association exists — delete (`existingAssoc.delete()`) before creating new.
   - **Same-module:** `const assoc = domainmodels.Association.createIn(dm)`. Assign IEntity objects directly: `assoc.parent = resolvedParentEntity; assoc.child = resolvedChildEntity`. Set `assoc.name = name`. Set `assoc.type = domainmodels.AssociationType.Reference` (or `domainmodels.AssociationType.ReferenceSet` if input is `"ReferenceSet"`). Set `assoc.owner = domainmodels.AssociationOwner.Default` (or `domainmodels.AssociationOwner.Both` if input is `"Both"`). If `documentation` provided → `assoc.documentation = documentation`. Create delete behavior: `const db = domainmodels.AssociationDeleteBehavior.createIn(assoc)` then `db.parentDeleteBehavior = domainmodels.DeletingBehavior.DeleteMeButKeepReferences` and `db.childDeleteBehavior = domainmodels.DeletingBehavior.DeleteMeButKeepReferences` (overridden by input if provided — enum path: `domainmodels.DeletingBehavior.<value>`).
   - **Cross-module:** `const crossAssoc = domainmodels.CrossAssociation.createIn(dm)`. Assign parent entity (in this module) directly: `crossAssoc.parent = resolvedParentEntity`. Assign child via FQN string: `crossAssoc.childQualifiedName = childFQN` (form `"ModuleName.EntityName"` — this is a writable string property, not an IEntity reference). Set `crossAssoc.name`, `crossAssoc.type`, `crossAssoc.owner`, `crossAssoc.documentation`, and `deleteBehavior` same as same-module.
7. Record changes to the in-memory working copy. No flush, no commit — caller must call `commit_working_copy`.
8. Return JSON summary.

> **`skipped` field:** Always an empty array in the current implementation — tool does not support `ifMissing: "skip"`. The `overwritten` array contains names of associations deleted and recreated; `created` contains purely new associations.

---

### Output

```json
{
  "success": true,
  "status": "success",
  "message": "Created <N> associations",
  "data": {
    "created": ["AssociationName", "..."],
    "overwritten": ["AssociationName", "..."],
    "skipped": [],
    "warnings": [],
    "count": 2
  }
}
```

---

### Error Cases

| Condition                                                      | Behavior                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| No working copy is open                                        | Throw: `"No working copy is open in this session. Call open_working_copy first."`                                                     |
| `associations` is empty                                        | Throw: `"associations must contain at least one entry."`                                                                              |
| `moduleName` not found                                         | Throw: `"Module '<moduleName>' not found in working copy."`                                                                           |
| `parentEntity` belongs to a different module than `moduleName` | Throw: `"parentEntity '<entity>' must belong to module '<moduleName>'. Cross-module: only childEntity may be in a different module."` |
| Entity not found                                               | Throw: `"Entity '<entityName>' not found in module '<moduleName>'."`                                                                  |
| Association already exists and `overwrite: false`              | Throw: `"Association '<name>' already exists. Use overwrite: true to replace it."`                                                    |

---

<!-- END TOOL 8: create_multiple_associations -->

<!-- BEGIN TOOL 10: delete_model_element -->

## Tool 10: `delete_model_element`

Delete a model element from the domain model or module. Supports element types: `entity`, `attribute`, `association`, `microflow`, `constant`, `enumeration`. This is a more general version of `delete_association` (Tool 15) — extended to other element types.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

> **See also:** `delete_association` (Tool 15) — if only deleting an association, with `ifMissing` and `dryRun` support.

---

### Input

```json
{
  "elementType": "string (required) — entity | attribute | association | microflow | constant | enumeration",
  "moduleName": "string (optional) — Module containing the element; if omitted, searches all non-Marketplace modules",
  "entityName": "string (conditional) — Entity name (required for: entity, attribute, association)",
  "attributeName": "string (conditional) — Attribute name (required when elementType = attribute)",
  "associationName": "string (conditional) — Association name (required when elementType = association)",
  "documentName": "string (conditional) — Document name (required when elementType = microflow | constant | enumeration)",
  "elementName": "string (optional) — Generic alias — used for any elementType if the specific field is not provided",
  "ifMissing": "string (optional, default: error) — error | skip"
}
```

| `elementType` | Required fields (besides `elementType`)                                               |
| ------------- | ------------------------------------------------------------------------------------- |
| `entity`      | `entityName` or `elementName`                                                         |
| `attribute`   | `entityName` + `attributeName` (or `elementName` for attribute)                       |
| `association` | `associationName` or `elementName`; `entityName` if needed to disambiguate short name |
| `microflow`   | `documentName` or `elementName`                                                       |
| `constant`    | `documentName` or `elementName`                                                       |
| `enumeration` | `documentName` or `elementName`                                                       |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Resolve element name: `elementName` is a generic alias — if the specific field (`entityName`, `attributeName`, `associationName`, `documentName`) is not provided, use `elementName`. Specific field takes precedence when both are provided.
3. Find module by `moduleName` if provided; otherwise search the element across all modules with `fromAppStore === false`. If the element with the same name is found in multiple modules — throw: `"'<name>' found in multiple modules: <list>. Provide moduleName to disambiguate."` — do not silently pick the first module. Store the found module in variable `resolvedMod`; use `resolvedMod.name` in output.
4. Based on `elementType`, perform lookup and deletion:
   - **`entity` / `attribute` / `association`:** Load domain model first: `await mod.domainModel.load()`.
     - **`entity`:** Find entity in `dm.entities` by name (compare `e.name`). Call `entity.delete()`.
       > **Cascade warning:** `entity.delete()` does **not** automatically delete associations referencing this entity. Associations with `parent` or `child` pointing to the deleted entity will become orphaned and corrupt the model. Caller must delete related associations first (use `delete_association`, Tool 15) or use `diagnose_associations` (Tool 11) afterwards.
     - **`attribute`:** Find entity by `entityName` (or `elementName`) in `dm.entities`, then find attribute in `entity.attributes` by `attributeName`. Call `attribute.delete()`.
     - **`association`:** Search both `dm.associations` (compare `a.name`) and `dm.crossAssociations` (compare `a.name`) by name. For `CrossAssociation`, `child` is a cross-unit stub — only use `assoc.name` for comparison, do not access `assoc.child.name`. Call `assoc.delete()`.
   - **`microflow` / `constant` / `enumeration`:** **Do not load domain model.** Find in `module.documents` using `instanceof` filter (namespaces `microflows`, `constants`, `enumerations` imported from `mendixmodelsdk`):
     - `microflow`: `module.documents.filter(d => d instanceof microflows.Microflow).find(d => d.name === name)`.
     - `constant`: `module.documents.filter(d => d instanceof constants.Constant).find(d => d.name === name)`.
     - `enumeration`: `module.documents.filter(d => d instanceof enumerations.Enumeration).find(d => d.name === name)`.
     - Call `document.delete()` after finding.
5. If element not found:
   - `ifMissing === "error"` (default): throw with a descriptive message that the element does not exist.
   - `ifMissing === "skip"`: return success with `skipped: true`.
6. Return plain text confirmation.

> **No automatic `commit_working_copy`:** Changes are only written to the in-memory working copy. Caller must call `commit_working_copy` to persist.

> **No `dryRun`:** This tool does not support `dryRun`. To preview before deleting an association, use `delete_association` (Tool 15) with `dryRun: true`.

---

### Output

```
Deleted <elementType> '<resolvedName>' from module '<resolvedModuleName>'.
```

Where `<resolvedName>` is the actual element name (specific field or `elementName`), and `<resolvedModuleName>` is `moduleName` if provided, or `resolvedMod.name` if found via all-modules scan.

If `ifMissing: "skip"` and not found:

```
Skipped: <elementType> '<resolvedName>' not found in module '<resolvedModuleName>'.
```

---

### Error Cases

| Condition                                  | Behavior                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| No working copy is open                    | Throw: `"No working copy is open in this session. Call open_working_copy first."`                                           |
| `elementType` is invalid                   | Throw: `"Invalid elementType '<value>'. Must be one of: entity, attribute, association, microflow, constant, enumeration."` |
| Required field missing for element type    | Throw describing the missing field                                                                                          |
| Element not found and `ifMissing: "error"` | Throw: `"<ElementType> '<name>' not found in module '<moduleName>'."`                                                       |
| Module not found                           | Throw: `"Module '<moduleName>' not found in working copy."`                                                                 |

---

---

<!-- END TOOL 10: delete_model_element -->

<!-- BEGIN TOOL 11: diagnose_associations -->

## Tool 11: `diagnose_associations`

Scan for association-related issues in a module's domain model. Detects errors such as associations pointing to non-existent entities, duplicate-named associations, and invalid cross-module references.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "moduleName": "string (optional) — Module to diagnose. If omitted, diagnoses all non-Marketplace modules."
}
```

| Field        | Required | Description                                                                       |
| ------------ | -------- | --------------------------------------------------------------------------------- |
| `moduleName` | No       | Specific module name; if omitted checks all modules with `fromAppStore === false` |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Determine list of modules to check (same logic as `read_domain_model`, Tool 3): if `moduleName` is provided — only that module; otherwise — all modules with `fromAppStore === false`.
3. **Load domain models of ALL non-Marketplace modules** to build the full valid entity set across the model (needed for orphan checks). Use a single loop — call `load()` and collect `qualifiedName` in the same pass:
   ```ts
   const allModules = model.root.modules.filter(
     (m) => m.fromAppStore === false,
   );
   const validQualifiedNames = new Set<string>();
   for (const m of allModules) {
     const dm = await m.domainModel.load();
     for (const e of dm.entities) {
       if (e.qualifiedName) validQualifiedNames.add(e.qualifiedName);
     }
   }
   ```
   After this loop, all domain models are loaded and `validQualifiedNames` is complete.
4. For each module in the check list, iterate `dm.associations` and `dm.crossAssociations`:
   - **Orphaned parent:** `(assoc.parent?.qualifiedName ?? "")` not in `validQualifiedNames` — record error `ORPHANED_PARENT` (severity: `"error"`). **Use optional chaining** — `assoc.parent` may be null if the entity was deleted.
   - **Orphaned child:**
     - `domainmodels.Association`: `(assoc.child?.qualifiedName ?? "")` not in `validQualifiedNames` — `ORPHANED_CHILD` (severity: `"error"`).
     - `domainmodels.CrossAssociation`: get FQN via `cross.childQualifiedName ?? cross.child?.qualifiedName ?? ""` (do not use `cross.child.qualifiedName` directly — `child` is a cross-unit stub that may not be loaded); check in `validQualifiedNames`; if absent — `ORPHANED_CHILD` (severity: `"error"`).
   - **Duplicate name:** multiple associations with same name in same module — record warning `DUPLICATE_NAME` (severity: `"warning"`). Algorithm: `const nameCount = new Map<string, number>()` — iterate all `dm.associations` and `dm.crossAssociations`, increment count by name; then for each name with `count > 1`, emit one `DUPLICATE_NAME` issue with `detail: "Found <count> associations named '<name>' in module '<moduleName>'"`.
   - **Invalid cross-module:** `domainmodels.CrossAssociation` where `(assoc.parent?.qualifiedName ?? "").split(".")[0]` does not match the name of the **module currently being iterated** — record warning `INVALID_CROSS_MODULE` (severity: `"warning"`).
5. **`healthy` field:** `true` if the `issues` array is **empty**; `false` if there is at least one issue at any severity. `healthy` and `issues` are always consistent — never `healthy: true` when `issues` is non-empty.

   ### Severity table

   | Code                   | Severity  | Meaning                                                                                     |
   | ---------------------- | --------- | ------------------------------------------------------------------------------------------- |
   | `ORPHANED_PARENT`      | `error`   | Association points to a non-existent parent entity                                          |
   | `ORPHANED_CHILD`       | `error`   | Association points to a non-existent child entity                                           |
   | `DUPLICATE_NAME`       | `warning` | Multiple associations with same name in same module                                         |
   | `INVALID_CROSS_MODULE` | `warning` | CrossAssociation has a parent that does not belong to the module containing the association |

6. Return JSON summary with issue list via `textResult(JSON.stringify(result, null, 2))`.

---

### Output

```json
{
  "success": true,
  "status": "success",
  "message": "Diagnosed <N> module(s): <issueCount> issue(s) found",
  "data": {
    "modules": [
      {
        "moduleName": "RequestsOverview",
        "issues": [
          {
            "severity": "error | warning",
            "code": "ORPHANED_PARENT | ORPHANED_CHILD | DUPLICATE_NAME | INVALID_CROSS_MODULE",
            "associationName": "string",
            "detail": "string — Detailed issue description"
          }
        ],
        "healthy": false
      }
    ],
    "totalIssues": 0
  }
}
```

---

### Error Cases

| Condition                           | Behavior                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| No working copy is open             | Throw: `"No working copy is open in this session. Call open_working_copy first."` |
| `moduleName` provided but not found | Throw: `"Module '<moduleName>' not found in working copy."`                       |

---

<!-- END TOOL 11: diagnose_associations -->

<!-- BEGIN TOOL 12: set_entity_generalization -->

## Tool 12: `set_entity_generalization`

Set inheritance (generalization) for an existing entity, making it a specialization of a parent entity. Unlike `create_entity` (Tool 5) which sets generalization only at entity creation time — this tool modifies the generalization of an already-existing entity. Supports cross-module inheritance.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

> **See also:** `create_entity` (Tool 5) — `generalization.parentEntity` field when creating an entity. `remove_entity_generalization` (Tool 13) — to remove inheritance.

---

### Input

```json
{
  "moduleName": "string (optional) — Module containing the child entity; if omitted, searches all modules",
  "entityName": "string (required) — Name of the entity to set inheritance for",
  "parentEntity": "string (required) — Name or FQN of the parent entity (e.g., 'Administration.Account')",
  "parentModule": "string (optional) — Module containing the parent entity; needed when parentEntity is a short name that exists in multiple modules"
}
```

| Field          | Required | Description                                                                                                                |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `entityName`   | Yes      | Name of the entity to change generalization for                                                                            |
| `parentEntity` | Yes      | Short name or FQN (`Module.EntityName`) of the parent entity                                                               |
| `moduleName`   | No       | Module containing the child entity                                                                                         |
| `parentModule` | No       | Module containing the parent entity — needed when `parentEntity` is a short name that is ambiguous across multiple modules |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Find the child entity (`entityName`):
   - If `moduleName` is provided: `mod = model.root.modules.find(m => m.name === moduleName)` — throw if not found: `"Module '<moduleName>' not found in working copy."`. Load domain model: `await mod.domainModel.load()`. Find `entity = dm.entities.find(e => e.name === entityName)` — throw if not found: `"Entity '<entityName>' not found in working copy."`.
   - If `moduleName` not provided: iterate all modules with `fromAppStore === false`, load each domain model, find entity by `e.name === entityName`. Store found module in variable `mod` (for output `<actualModuleName>`). Throw if not found in any module: `"Entity '<entityName>' not found in working copy."`.
3. Find the parent entity:
   - If `parentEntity` contains `.` (FQN): `parentEnt = model.allEntities().find(e => e.qualifiedName === parentEntity)`.
   - If `parentEntity` is short name and `parentModule` is provided:
     ```ts
     const parentMod = model.root.modules.find((m) => m.name === parentModule);
     if (!parentMod)
       throw new Error(`"Module '<parentModule>' not found in working copy."`);
     const parentDm = await parentMod.domainModel.load();
     parentEnt = parentDm.entities.find((e) => e.name === parentEntity);
     ```
   - If `parentEntity` is short name and `parentModule` not provided: `model.allEntities().find(e => e.name === parentEntity)`.
     > **Warning:** if multiple modules have an entity with the same short name, the first result is selected — non-deterministic. Caller should use FQN or provide `parentModule`.
   - Throw if not found: `"Parent entity '<parentEntity>' not found in working copy."`.
4. Check for self-reference: if child entity and parent entity are the same entity (same `qualifiedName`) — throw `"An entity cannot inherit from itself."`.
   > **Note:** Multi-level inheritance cycles (A → B → A) are not detected — caller's responsibility.
5. Check current generalization: whether `entity.generalization` is `domainmodels.Generalization` (existing inheritance) or `domainmodels.NoGeneralization` (root entity), **must call `entity.generalization.delete()` first** to release the current instance — SDK does not auto-replace it. After deletion, `entity.generalization` becomes `null`.
6. Assign new generalization:
   ```ts
   const gen = domainmodels.Generalization.createIn(entity);
   gen.generalization = parentEnt;
   ```
   `domainmodels.Generalization.createIn(entity)` automatically assigns `entity.generalization = gen`. `gen.generalization` is a `ByNameReferenceProperty<IEntity>` — SDK accepts `IEntity` stub directly without needing to load the parent module's domain model. This means `parentEnt` can be retrieved from `model.allEntities()` without `await load()` for the parent entity's module.
7. Record changes to the in-memory working copy. No flush, no commit — caller must call `commit_working_copy`.

> **Output `<actualModuleName>`:** Is the actual module name of the child entity: `resolvedModuleName = moduleName ?? mod.name` (the module name found when scanning all-modules). `<parentQualifiedName>` is `parentEnt.qualifiedName`.

---

### Output

```
Set generalization: '<actualModuleName>.<entityName>' now inherits from '<parentQualifiedName>'.
(Changes are not committed — call commit_working_copy when done.)
```

Where `<actualModuleName>` is the actual module name of the child entity (`moduleName` if provided, or the module name found when scanning all-modules).

---

### Error Cases

| Condition                                   | Behavior                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| No working copy is open                     | Throw: `"No working copy is open in this session. Call open_working_copy first."` |
| `moduleName` provided but not found         | Throw: `"Module '<moduleName>' not found in working copy."`                       |
| `entityName` not found                      | Throw: `"Entity '<entityName>' not found in working copy."`                       |
| `parentEntity` not found                    | Throw: `"Parent entity '<parentEntity>' not found in working copy."`              |
| `parentModule` provided but not found       | Throw: `"Module '<parentModule>' not found in working copy."`                     |
| Child entity and parent entity are the same | Throw: `"An entity cannot inherit from itself."`                                  |

---

<!-- END TOOL 12: set_entity_generalization -->

<!-- BEGIN TOOL 13: remove_entity_generalization -->

## Tool 13: `remove_entity_generalization`

Remove inheritance from an entity, converting it to a root entity (no longer a specialization). After calling this tool, the entity will have `generalization` as `NoGeneralization`.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

> **See also:** `set_entity_generalization` (Tool 7) — to set inheritance.

---

### Input

```json
{
  "moduleName": "string (optional) — Module containing the entity; if omitted, searches all modules",
  "entityName": "string (required) — Name of the entity to remove inheritance from"
}
```

| Field        | Required | Description                                      |
| ------------ | -------- | ------------------------------------------------ |
| `entityName` | Yes      | Name of the entity to remove generalization from |
| `moduleName` | No       | Module containing the entity                     |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Find entity:
   - If `moduleName` is provided: find module in `model.root.modules` by name; throw if not found: `"Module '<moduleName>' not found in working copy."`. Load domain model: `const dm = await mod.domainModel.load()`. Find `entity = dm.entities.find(e => e.name === entityName)`; throw if not found: `"Entity '<entityName>' not found in working copy."`.
   - If `moduleName` not provided: iterate all modules with `fromAppStore === false`. For each module `m`, load `const dm = await m.domainModel.load()`, find entity. When found, **store `const resolvedMod = m`** for later use. Throw if not found in any module: `"Entity '<entityName>' not found in working copy."`.
3. Check `entity.generalization`: if already an instance of `domainmodels.NoGeneralization` — return success with a message indicating no change (no further steps needed).
4. Call `entity.generalization.delete()` to delete the current instance — this step is required to release the old instance; SDK does not auto-replace it. Create `const noGen = domainmodels.NoGeneralization.createIn(entity)` to establish entity as root. **`createIn` automatically assigns `entity.generalization = noGen`** — no manual assignment needed. Note: `resolvedMod` was established in step 2 — use `resolvedMod.name` in output when `moduleName` was not provided.
   After creating `NoGeneralization`, set default flags **on the `noGen` instance** (not directly on `entity`):
   - `noGen.persistable = true`
   - `noGen.hasCreatedDate = false`
   - `noGen.hasChangedDate = false`
   - `noGen.hasOwner = false`
   - `noGen.hasChangedBy = false`
5. Record changes to the in-memory working copy. No flush, no commit — caller must call `commit_working_copy`.

---

### Output

```
Removed generalization from '<actualModuleName>.<entityName>'. Entity is now a root entity.
(Changes are not committed — call commit_working_copy when done.)
```

Where `<actualModuleName>` = `moduleName` if provided, otherwise = the module name found when scanning all-modules (`resolvedMod.name`).

If entity is already a root (no generalization):

```
No change: '<actualModuleName>.<entityName>' has no generalization to remove.
```

---

### Error Cases

| Condition                           | Behavior                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| No working copy is open             | Throw: `"No working copy is open in this session. Call open_working_copy first."` |
| `moduleName` provided but not found | Throw: `"Module '<moduleName>' not found in working copy."`                       |
| `entityName` not found              | Throw: `"Entity '<entityName>' not found in working copy."`                       |

---

<!-- END TOOL 13: remove_entity_generalization -->

<!-- BEGIN TOOL 83: arrange_domain_model -->

## Tool 83: `arrange_domain_model`

Arrange entity positions on the domain-model canvas using a centered-tree layout modelled after `mcp__studio-pro__arrange_domain_model` (observed and re-implemented against the Mendix Model SDK). Treats same-module associations as an **undirected** graph, picks a leaf as the default root, computes per-sub-tree widths so each entity is horizontally centered over its descendants, and uses a dynamic Y offset that scales with the previous entity's attribute count. Writes `entity.location` for each entity in the working copy.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

> **Workflow rule:** any working-copy session that called `create_entity`, `create_multiple_entities`, `create_association`, `create_multiple_associations`, `create_cross_module_association`, `set_entity_generalization`, or legacy `create_domain_model` must run this tool on every affected module **before** `commit_working_copy` — otherwise the diagram is unreadable in Studio Pro even though the commit succeeds. See [`../rules/arrange_after_domain_model_build.md`](../rules/arrange_after_domain_model_build.md).

---

### Input

```json
{
  "moduleName": "string (required) — Module to arrange layout for",
  "rootEntity": "string (optional) — Entity to place at the top of the hierarchy; if omitted, chosen automatically",
  "connectionPointsOnly": "boolean (optional, default: false) — If true, skip all entity layout and only compute/set parentConnection + childConnection on each Association based on existing entity.location values"
}
```

| Field                  | Required | Description                                                                                                                                                                                                                                                                                                                |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `moduleName`           | Yes      | Module containing the domain model to arrange                                                                                                                                                                                                                                                                              |
| `rootEntity`           | No       | Entity to place at the top of the hierarchy; if omitted, the lowest-degree (leaf) entity in the undirected association graph is picked, tie-broken alphabetically by entity name. Ignored when `connectionPointsOnly: true`.                                                                                               |
| `connectionPointsOnly` | No       | When `true`: skip entity layout entirely. Read existing `entity.location` values (e.g. set by `mcp__studio-pro__arrange_domain_model`) and only compute/write `parentConnection` / `childConnection` on each same-module `Association`. Use this when entity positions were already established by a better external tool. |

---

### Layout constants

| Constant               | Value | Meaning                                                                                                                                                                                                                                       |
| ---------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORIGIN_X`             |  `50` | Left edge of the layout                                                                                                                                                                                                                       |
| `ORIGIN_Y`             |  `50` | Top edge of the layout                                                                                                                                                                                                                        |
| `SIBLING_X_OFFSET`     | `250` | Horizontal distance between sibling cells (and between orphan-grid columns)                                                                                                                                                                   |
| `TREE_GAP_X`           | `250` | Horizontal gap between disconnected trees                                                                                                                                                                                                     |
| `ORPHAN_GRID_PER_ROW`  |   `3` | Columns in the orphan grid                                                                                                                                                                                                                    |
| `ENTITY_MIN_HEIGHT`    |  `80` | Minimum per-attribute spacing height used by the **arranger** for laying out parent / child rows. NOT the visual rendered height.                                                                                                             |
| `ENTITY_HEADER_HEIGHT` |  `70` | Base spacing height (per arranger) before attribute rows.                                                                                                                                                                                     |
| `ATTR_LINE_HEIGHT`     |  `10` | Per-attribute spacing increment (arranger only).                                                                                                                                                                                              |
| `ENTITY_VISUAL_HEIGHT` | `100` | Fixed **visual** entity-box height in pixels. Studio Pro renders every entity box at this height regardless of attribute count (attributes scroll internally). Used by connection-point math so arrows land on the actual rendered box edges. |
| `VERTICAL_GAP`         |  `80` | Vertical gap between adjacent levels                                                                                                                                                                                                          |
| `ENTITY_WIDTH`         | `100` | Fixed entity-box width in pixels (Studio Pro default — not exposed by the SDK)                                                                                                                                                                |

Two distinct heights exist:

- **Arrange height** (for canvas layout): `max(ENTITY_MIN_HEIGHT, ENTITY_HEADER_HEIGHT + ATTR_LINE_HEIGHT * attributeCount)`. Used by the arranger to space parent rows further apart for entities with many attributes (extra canvas breathing room around tall entities makes the diagram more readable). Y offset between parent and child = arrange-height(parent) + `VERTICAL_GAP`.
- **Visual height** (for connection points): always `ENTITY_VISUAL_HEIGHT` (= 100). Studio Pro renders the entity box at this fixed size, so connection-point offsets must reference this value rather than the arrange height — otherwise arrows for tall (many-attribute) entities would terminate far below the actual rendered box.

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Find module by `moduleName`; throw if not found.
3. Load domain model: `await mod.domainModel.load()`.
4. **If `connectionPointsOnly: true`**: skip steps 5–10; jump directly to step 11 (apply connection points to existing entity positions), then return. Output uses the `connectionPointsOnly` variant.
5. Build an **undirected adjacency map** from `dm.associations`. Each same-module association contributes two entries (parent→child and child→parent). Duplicate edges (e.g. when two associations connect the same pair) are deduplicated. `dm.crossAssociations` is skipped (the layout is per-module). Studio-pro's observed behavior ignores parent/child direction for layout purposes — using the same convention here.
6. Determine root entity:
   - If `rootEntity` is provided: look it up in `dm.entities`; throw if not found.
   - Otherwise: among entities with degree ≥ 1 in the undirected graph, pick the one with the smallest degree (preferring leaves). Ties are broken alphabetically by entity name. If no entity is connected (all degree-0), `root = null` and every entity is treated as an orphan.
   - **Note on tie-break:** Studio-pro's exact tie-break among equal-degree leaves is not documented and not deterministic across all observed cases. Alphabetical tie-break is a best-effort approximation that matches the 4-entity observation (Department picked over LeaveType) but does not guarantee parity in every topology.
7. **Build sub-tree:** starting from `root`, run DFS over the undirected graph (tracking `visited`). For each entity, record its children (unvisited neighbors). Each node's `subtreeWidth` (in cells) = `1` if leaf, otherwise `sum(child.subtreeWidth)`.
8. **Layout sub-tree:** recursive DFS. For a node with `subtreeWidth = W`, occupying cells `[leftCell, leftCell + W − 1]`, the entity's `x` is the cell-center: `ORIGIN_X + (leftCell + (W − 1) / 2) * SIBLING_X_OFFSET`. Children are laid out left to right, each consuming `child.subtreeWidth` cells and inheriting `y_child = y_parent + boxHeight(parent) + VERTICAL_GAP`. All children of the same parent share the same `y`.
9. Set `entity.location = { x, y }` (whole-object assignment — SDK change tracking requires it; do NOT mutate `entity.location.x = ...`).
10. **Multi-tree:** for each unvisited entity with degree ≥ 1, start a new tree at `leftCell = ceil((currentMaxX + TREE_GAP_X − ORIGIN_X) / SIBLING_X_OFFSET)`, `y = ORIGIN_Y`. Increments `groupCount`. (`currentMaxX` tracks the rightmost X used by any tree so far.)
11. **Orphan grid:** entities still unvisited (degree-0) are placed in a `ORPHAN_GRID_PER_ROW`-column grid starting at `y = maxYAcrossTrees + boxHeight(0) + VERTICAL_GAP` (or `ORIGIN_Y` if no tree was laid out). Each row's height is the max `boxHeight` of entities in that row. Columns step by `SIBLING_X_OFFSET`.
12. **Set association connection points.** After all entity positions are established, iterate over `dm.associations` (same-module only — `dm.crossAssociations` is skipped) and write `parentConnection` / `childConnection` on each association. The rules use **corners only** (never edge midpoints) so that multiple arrows on the same edge land on distinct corners instead of stacking at the centre. `crossAssociations` are excluded because `parentConnection` / `childConnection` exist only on the concrete `Association` class, not `AssociationBase`.

> **Coordinate system (verified empirically):**
>
> 1.  **`parentConnection` / `childConnection` are OFFSETS relative to each entity's `location`**, not absolute canvas coordinates. Studio Pro renders an arrow endpoint at `entity.location + connection`.
> 2.  **`entity.location` is the TOP-LEFT corner of the entity box.** The box spans `[location.x, location.x + ENTITY_WIDTH]` × `[location.y, location.y + ENTITY_VISUAL_HEIGHT]`.
>
> Every connection point is one of the four corner offsets (with `W = ENTITY_WIDTH = 100`, `H = ENTITY_VISUAL_HEIGHT = 100`):
> | Corner | Offset |
> |---|---|
> | top-left (TL) | `(0, 0)` |
> | top-right (TR) | `(W, 0)` = `(100, 0)` |
> | bottom-left (BL) | `(0, H)` = `(0, 100)` |
> | bottom-right (BR) | `(W, H)` = `(100, 100)` |

**Step A — Edge selection** (per association). With `dx = c.location.x − p.location.x`, `dy = c.location.y − p.location.y`:

| Relative position                           | Parent edge | Child edge |
| ------------------------------------------- | ----------- | ---------- |
| Child below parent (`dy >= H`)              | bottom      | top        |
| Parent below child (`-dy >= H`)             | top         | bottom     |
| Same row, child right of parent (`dx >= 0`) | right       | left       |
| Same row, child left of parent              | left        | right      |

**Step B — Corner selection** depends on how many associations exist with the **same ordered `(parent, child)` direction**. Opposite-direction associations between the same pair of entities (e.g. one `Tool → Version` and one `Version → Tool`) form two separate ordered groups, so each is treated as N=1 and uses its own natural diagonal — the resulting two arrows lie on the same diagonal line but with opposite arrowheads, which is the conventional Mendix rendering of a bidirectional relationship. Same-direction same-pair associations (e.g. two `Order → Customer` relationships) stay grouped and trigger the N=2 spread. Within a group, associations are sorted by association name for stable ordering across re-runs; the term **i** below means index after that sort (`i = 0` is the 1st).

Let:

- **Natural side** = the side of the edge closer to the other entity.
  - Vertical relationship (top/bottom edges): `right` if `dx >= 0`, else `left`.
  - Horizontal relationship (left/right edges): `bottom` if `dy >= 0`, else `top`.
- **Opposite side** = the other side of the edge.
- **Aligned** = `|dx| < W/2` for vertical relationships, or `|dy| < H/2` for horizontal relationships.

| Case                                      | Parent corner                                             | Child corner                                               | Result                                                                  |
| ----------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| **N=1, aligned**                          | edge corner on **natural side**                           | edge corner on **natural side**                            | Clean straight arrow on the same side of both boxes.                    |
| **N=1, non-aligned**                      | edge corner on **natural side** (P's corner closest to C) | edge corner on **opposite side** (C's corner closest to P) | Natural diagonal — short path between the two boxes.                    |
| **N=2 same ordered direction, i=0** (1st) | edge corner on **natural side**                           | edge corner on **natural side**                            | Parallel arrow on natural side.                                         |
| **N=2 same ordered direction, i=1** (2nd) | edge corner on **opposite side**                          | edge corner on **opposite side**                           | Parallel arrow on opposite side — paired with the 1st without crossing. |
| **N≥3 same ordered direction**            | falls back to the N=1 rule for every association          | falls back to the N=1 rule for every association           | Emits a warning in the tool output; 3rd+ arrows overlap the 1st/2nd.    |

Concrete examples (with `W = H = 100`):

- C directly below P, single association: `parentConnection = (100, 100)` (P bottom-right), `childConnection = (100, 0)` (C top-right). Straight vertical on the right side.
- C below-right of P (`dx >= W/2`), single association: `parentConnection = (100, 100)` (P BR), `childConnection = (0, 0)` (C TL). Short natural diagonal.
- Two associations both going `P → C` with P above C, both aligned (`dx ≈ 0`):
  - 1st: `parentConnection = (100, 100)` (P BR) → `childConnection = (100, 0)` (C TR).
  - 2nd: `parentConnection = (0, 100)` (P BL) → `childConnection = (0, 0)` (C TL).
  - Two parallel verticals, one per side; no X-crossing.
- Two associations both going `P → C` on the same row, C right of P:
  - 1st: `parentConnection = (100, 100)` (P right-bottom) → `childConnection = (0, 100)` (C left-bottom).
  - 2nd: `parentConnection = (100, 0)` (P right-top) → `childConnection = (0, 0)` (C left-top).
- **Two associations in opposite directions** (one `Tool → Version`, one `Version → Tool`), with Version above-right of Tool: each ends up in its own N=1 ordered group and uses its own natural-diagonal.
  - `Tool → Version`: parentConnection = `(100, 0)` (Tool TR) → childConnection = `(0, 100)` (Version BL).
  - `Version → Tool`: parentConnection = `(0, 100)` (Version BL) → childConnection = `(100, 0)` (Tool TR).
  - The two arrows lie on the same diagonal line; opposite arrowheads distinguish them.
- Three associations in the same ordered direction: warning emitted; the 3rd reuses the 1st's corners and overlaps.

**Stable ordering.** Within an ordered-direction group, associations are sorted ascending by `association.name` (`localeCompare`) before slot assignment. This guarantees that re-running `arrange_domain_model` on the same model yields the same parent/child connection corners per association name.

12. Record changes to the in-memory working copy. No flush, no commit — caller must call `commit_working_copy`.

---

### Output

```
# Default (full layout):
Arranged <N> entities in module '<moduleName>'. Root: '<entityName>'. Groups: <groupCount> tree(s), <orphanCount> orphan(s).
(Changes are not committed — call commit_working_copy when done.)

# connectionPointsOnly: true:
Set association connection points for <N> entities in module '<moduleName>' (entity layout unchanged).
(Changes are not committed — call commit_working_copy when done.)
```

If any ordered `(parent, child)` direction has **3 or more** associations, the response is followed by a `Warnings:` block (one bullet per affected direction). The connection points are still applied — the warning is informational so the modeller can redesign before the 3rd+ arrow overlaps.

```
Warnings:
  - 3 associations in the same direction (Order -> Customer): Order_Customer, Order_BillTo, Order_ShipTo. Connection-point corners run out at N=2; the 3rd+ arrow will overlap. Consider redesigning the relationship as a single association with an attribute, or introducing an intermediate entity.
```

---

### Error Cases

| Condition                                     | Behavior                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| No working copy is open                       | Throw: `"No working copy is open in this session. Call open_working_copy first."` |
| `moduleName` not found                        | Throw: `"Module '<moduleName>' not found in working copy."`                       |
| `rootEntity` provided but not found in module | Throw: `"Entity '<rootEntity>' not found in module '<moduleName>'."`              |
| Module has no entities                        | Return `"No entities to arrange in module '<moduleName>'."` — does not throw      |

---

### Comparison vs `mcp__studio-pro__arrange_domain_model`

This implementation is **modelled after** studio-pro's observed behavior — same algorithm family, same constants where verifiable. The two still differ on the points below; remaining gaps are intentional or due to unverifiable internals.

| Aspect                                | mx-connect                                                              | studio-pro                                                                                                                                           | Aligned?                      |
| ------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Origin                                | `(50, 50)`                                                              | `(50, 50)` (observed)                                                                                                                                | ✅                            |
| Sibling X offset (tree + orphan grid) | `250`                                                                   | `250` (observed)                                                                                                                                     | ✅                            |
| Orphan grid columns                   | `3`                                                                     | `3` (observed on SPMCP with 8 orphans)                                                                                                               | ✅                            |
| Parent → child Y offset               | `boxHeight(parent) + 80`; `boxHeight = max(110, 90 + 10·attrCount)`     | Same formula matches observed Δy of 190 (low-attr) / 250 (8 attrs) entities                                                                          | ✅                            |
| Graph direction                       | Undirected adjacency                                                    | Undirected (observed: BFS reaches descendants regardless of parent/child)                                                                            | ✅                            |
| Sibling layout                        | Centered around parent via sub-tree-width computation                   | Centered (observed: User at x=175 with children at 50 and 300)                                                                                       | ✅                            |
| Default root                          | Lowest-degree connected entity; alphabetical tie-break                  | Lowest-degree confirmed; tie-break rule **not fully resolved** — 4-entity test matched alphabetical (D over LT) but a 5-entity test picked LT over D | ⚠️ Best-effort tie-break      |
| Disconnected components               | Side-by-side at `(maxX + TREE_GAP_X, ORIGIN_Y)` with `TREE_GAP_X = 250` | "Side by side" per tool description — exact gap **not observable** (no multi-tree topology available in sample modules)                              | ⚠️ Best-effort gap            |
| Execution model                       | Online Working Copy; needs `commit_working_copy` to persist             | Live Studio Pro project; user saves in Studio Pro                                                                                                    | ❌ Fundamental — cannot align |
| Input names                           | `moduleName`, `rootEntity` (camelCase, server-wide convention)          | `module_name`, `root_entity` (snake_case)                                                                                                            | ❌ Kept by convention         |
| Output                                | Plain text string `"Arranged N entities …"`                             | JSON object: `{ success, entities_arranged, trees, orphans, bounding_box, layout[] }`                                                                | ❌ Kept by convention         |
| Cross-module associations             | Skipped (only same-module edges drive layout)                           | Behavior on cross-module not verified                                                                                                                | — Unverified                  |

**Known approximations** (documented because we can't verify them from sample runs):

1. **Root tie-break** for equal-degree leaves uses alphabetical name order. Studio-pro's actual rule produced inconsistent picks across our 4-entity and 5-entity observations.
2. **Disconnected-tree gap** uses `TREE_GAP_X = 250`. No sample module had multiple connected components to measure studio-pro's actual gap.

Callers needing bit-exact studio-pro layout should invoke `mcp__studio-pro__arrange_domain_model` directly when a Studio Pro instance is running on `localhost:3002`.

---

<!-- END TOOL 83: arrange_domain_model -->
