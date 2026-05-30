# Constants — Tool Specifications

<!-- BEGIN TOOL 17: create_constant -->
## Tool 17: `create_constant`

**Status**: Available

Create a `constants.Constant` document inside a module (or one of its subfolders). The constant's data type is materialised from the SDK's `datatypes` namespace via `createInConstantUnderType`, and `defaultValue` / `exposedToClient` / `documentation` are written verbatim onto the resulting `Constant` element.

### Behavior

1. **Container resolution**. `moduleName` is required and must exist on the working copy. When `folderQualifiedName` is provided, it is walked from the module root (dot-separated segments — e.g. `"MyModule.Settings.Integrations"`); otherwise the constant lands at the module root.
2. **Conflict handling**. If a `Constant` document with the same `name` already exists at the resolved container:
   - With `overwrite: false` (default): the tool returns the existing constant with `alreadyExisted: true` and does not mutate anything. This mirrors the idempotent shape of `create_consumed_rest_service`.
   - With `overwrite: true`: the existing constant is deleted via `.delete()` and a fresh one is created, with `replaced: true` in the result.
3. **Data type creation**. `dataType` is mapped to a constructor on `datatypes` and the result is automatically wired to `Constant.type` via the `createInConstantUnderType(container)` factory:
   - `String` → `datatypes.StringType.createInConstantUnderType`
   - `Integer` → `datatypes.IntegerType.createInConstantUnderType`
   - `Decimal` → `datatypes.DecimalType.createInConstantUnderType`
   - `Boolean` → `datatypes.BooleanType.createInConstantUnderType`
   - `DateTime` → `datatypes.DateTimeType.createInConstantUnderType`
   - **`Long` is intentionally omitted** — the SDK's `datatypes` namespace has only `IntegerType` and no precision/size flag, so a separate Long would silently collapse to Integer. Callers needing Long semantics should pick `Integer`.
4. **Default value**. Stored verbatim on `Constant.defaultValue`. The SDK does not validate the string against `dataType` — pass a form Studio Pro accepts (e.g. `"0"` for Integer, `"true"` / `"false"` for Boolean, ISO-8601 like `"2026-01-01T00:00:00.000Z"` for DateTime). Omit to leave empty.
5. **Exposed-to-client**. Defaults to `false` (Studio Pro default). Setting `true` writes `Constant.exposedToClient = true`, available from Mendix 8.2+.
6. **Working-copy requirement**. Like every write-tool, this requires `open_working_copy` to have been called; changes are buffered in the in-memory model until `commit_working_copy`.

### Input schema

```json
{
  "moduleName": "string (required)",
  "constantName": "string (required) — PascalCase short name",
  "dataType": "'String' | 'Integer' | 'Decimal' | 'Boolean' | 'DateTime' (required)",
  "defaultValue": "string (optional) — Stored verbatim on Constant.defaultValue",
  "documentation": "string (optional)",
  "exposedToClient": "boolean (optional, default: false)",
  "folderQualifiedName": "string (optional) — e.g. 'MyModule.Settings'",
  "overwrite": "boolean (optional, default: false) — Delete existing and recreate"
}
```

### Output

```json
{
  "qualifiedName": "ModuleName.ConstantName",
  "moduleName": "string",
  "constantName": "string",
  "dataType": "'String' | 'Integer' | 'Decimal' | 'Boolean' | 'DateTime'",
  "defaultValue": "string",
  "exposedToClient": "boolean",
  "alreadyExisted": "boolean — true when the constant existed and overwrite=false",
  "replaced": "boolean — true when overwrite triggered a delete+create",
  "folderQualifiedName": "string | null"
}
```

### Errors

- `moduleName is required.`
- `constantName is required.`
- `dataType is required.`
- `Module "<X>" not found. Available: …`
- `Folder '<QN>' not found in module '<X>'.`
- `Unsupported constant data type: <X>`

### Example — create a string constant for a REST API base URL override

```json
{
  "moduleName": "MyFirstModule",
  "constantName": "PetstoreBaseUrl",
  "dataType": "String",
  "defaultValue": "https://petstore3.swagger.io/api/v3",
  "documentation": "Override URL for the Petstore consumed REST service.",
  "exposedToClient": false
}
```

### Use with `configure_rest_authentication`

The original motivation for landing Tool 17 was to unlock the `usernameConstantQN` / `passwordConstantQN` path on Tool 101 (`configure_rest_authentication`). After creating a String constant via this tool, pass its qualified name into the authentication spec — the builder will create a `rest.ConstantValue` bound to the constant rather than a literal `StringValue`:

```json
{
  "serviceQualifiedName": "MyFirstModule.PetstoreService",
  "authentication": {
    "type": "basic",
    "usernameConstantQN": "MyFirstModule.PetstoreUsername",
    "passwordConstantQN": "MyFirstModule.PetstoreSecret"
  }
}
```

<!-- END TOOL 17: create_constant -->

---

<!-- BEGIN TOOL 18: list_constants -->
## Tool 18: `list_constants`

**Status**: Available

Read-only enumerator for `constants.Constant` documents in the working copy. Returns one row per constant with its data type, default value, `exposedToClient` flag, qualified name, and (when present) the parent folder QN. Scope is the whole working copy by default; pass `moduleName` to restrict the search to one module.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first. Read-only — does **not** mutate the working copy.

---

### Input

```json
{
  "moduleName": "string (optional) — Restrict to a single module. Searches all non-Marketplace modules if omitted."
}
```

| Field        | Required | Description                                                                                                       |
|--------------|----------|-------------------------------------------------------------------------------------------------------------------|
| `moduleName` | No       | When provided, only constants under that module (including those nested in folders) are returned. When omitted, scans every module with `fromAppStore === false`. |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Determine the modules to scan:
   - If `moduleName` is provided: find module by name; throw if not found: `"Module '<moduleName>' not found in working copy."`.
   - Otherwise: iterate `model.root.modules.filter(m => !m.fromAppStore)`.
3. For each module, walk both `module.documents` and the documents inside every nested `Folder` (recursive via `folder.documents` / `folder.folders`). Collect every document that `instanceof constants.Constant`.
4. For each constant, call `await constant.load()` so that `type`, `defaultValue`, and `exposedToClient` are populated.
5. Map `constant.type` back to the short-name domain used by `create_constant` (`String` / `Integer` / `Decimal` / `Boolean` / `DateTime`) by `instanceof` checks against `datatypes.StringType` etc. If `type` is null or an unrecognised subclass, report `"Unknown"` rather than throwing — the constant is still listed.
6. Resolve the containing folder QN by walking `containerAsFolderBase` upward; if the immediate container is the module, set `folderQualifiedName: null`.
7. Return the list sorted by `qualifiedName` ascending, wrapped via `textResult(JSON.stringify(result, null, 2))`.

---

### Output

```json
{
  "success": true,
  "status": "success",
  "message": "Found <N> constant(s)",
  "data": [
    {
      "name": "string — Short name",
      "qualifiedName": "string — ModuleName.ConstantName",
      "moduleName": "string",
      "folderQualifiedName": "string | null — e.g. 'MyModule.Settings.Integrations'",
      "dataType": "'String' | 'Integer' | 'Decimal' | 'Boolean' | 'DateTime' | 'Unknown'",
      "defaultValue": "string — Verbatim Constant.defaultValue, may be empty",
      "exposedToClient": "boolean"
    }
  ]
}
```

When no constants match, `data` is `[]` and `success` stays `true`.

---

### Error Cases

- No working copy → throw `"No working copy is open in this session. Call open_working_copy first."`.
- `moduleName` not found → throw `"Module '<moduleName>' not found in working copy."`.
- A constant fails to load (network / SDK error from `await constant.load()`) → bubble the SDK error verbatim. Do not swallow.

### Notes

- **Long is not surfaced.** The SDK has no `LongType` separate from `IntegerType`, so a constant that was authored as a Long in older Studio Pro versions reports as `"Integer"`. Same trade-off as `create_constant` (Tool 17).
- **Mendix Marketplace modules are skipped by default.** Marketplace-installed modules ship their own constants, which the agent should not be touching; if you truly need to inspect them, request the module by name.
- **`Constant.documentation` is intentionally omitted** from the row to keep listings compact — fetch a single constant's documentation via `set_documentation` / `query_model_elements` if needed.

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
  "message": "Found 2 constant(s)",
  "data": [
    {
      "name": "PetstoreBaseUrl",
      "qualifiedName": "MyFirstModule.PetstoreBaseUrl",
      "moduleName": "MyFirstModule",
      "folderQualifiedName": null,
      "dataType": "String",
      "defaultValue": "https://petstore3.swagger.io/api/v3",
      "exposedToClient": false
    },
    {
      "name": "PetstoreTimeoutSeconds",
      "qualifiedName": "MyFirstModule.PetstoreTimeoutSeconds",
      "moduleName": "MyFirstModule",
      "folderQualifiedName": "MyFirstModule.Settings",
      "dataType": "Integer",
      "defaultValue": "30",
      "exposedToClient": false
    }
  ]
}
```

<!-- END TOOL 18: list_constants -->

---

<!-- BEGIN TOOL 63: update_constant -->
## Tool 63: `update_constant`

**Status**: Available

Modify an existing `constants.Constant` document **in place**, without recreating it. Only the runtime-tunable fields are exposed: `defaultValue`, `exposedToClient`, and `documentation`. Data type changes are intentionally out-of-scope — the SDK requires re-attaching a fresh `datatypes.DataType` to the constant, and silent type changes break any microflow expression or binding that referenced the old type. For that, use `create_constant` with `overwrite: true` (which deletes and recreates the constant) or `delete_document` followed by `create_constant`.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "constantName": "string (required) — Short name OR qualified 'Module.ConstantName'",
  "moduleName": "string (optional) — Module containing the constant. Searches all modules if omitted.",
  "defaultValue": "string (optional) — New value for Constant.defaultValue (verbatim)",
  "exposedToClient": "boolean (optional) — New value for Constant.exposedToClient",
  "documentation": "string (optional) — New documentation. Use '' to clear."
}
```

| Field             | Required | Description                                                                                                                                |
|-------------------|----------|--------------------------------------------------------------------------------------------------------------------------------------------|
| `constantName`    | Yes      | Short name or `"Module.ConstantName"`. When qualified, the prefix takes precedence over `moduleName` (must match if both are provided).    |
| `moduleName`      | No       | Restrict search to one module. If omitted and the short name is ambiguous, throw a disambiguation error.                                   |
| `defaultValue`    | No       | Stored verbatim. Not validated against the constant's `dataType`. Omit to leave unchanged.                                                 |
| `exposedToClient` | No       | When provided, written to `Constant.exposedToClient`. Omit to leave unchanged.                                                             |
| `documentation`   | No       | When provided, written to `Constant.documentation`. Pass `""` to explicitly clear; omit to leave unchanged.                                |

At least one of `defaultValue` / `exposedToClient` / `documentation` must be present, otherwise the call is rejected as a no-op.

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Parse `constantName`: if it contains `.`, split on the first dot — the prefix is `moduleName` (or must equal the provided `moduleName` if both are given), the suffix is `localName`.
3. Locate the `Constant`:
   - If `moduleName` is determined: scan that module's `documents` (including subfolders, recursive) for a document where `name === localName` and `doc instanceof constants.Constant`.
   - If `moduleName` is **not** determined: scan all non-Marketplace modules. If exactly one match: use it. If zero: throw `"Constant '<localName>' not found in any module."`. If more than one: throw `"'<localName>' found in multiple modules: <list>. Provide moduleName to disambiguate."`.
4. `await constant.load()` so all properties are materialised.
5. Apply only the fields the caller passed:
   - `defaultValue !== undefined` → `constant.defaultValue = defaultValue`
   - `exposedToClient !== undefined` → `constant.exposedToClient = exposedToClient`
   - `documentation !== undefined` → `constant.documentation = documentation`
6. **Type is never touched.** If the caller's `defaultValue` is incompatible with `constant.type` (e.g. `"abc"` on an Integer constant), the SDK does not validate at write time — Studio Pro rejects the project on load. Callers should match the formats listed under `create_constant` (Tool 17).
7. Return the updated state.

---

### Output

```json
{
  "success": true,
  "status": "success",
  "message": "Updated constant '<qualifiedName>'",
  "data": {
    "qualifiedName": "string",
    "moduleName": "string",
    "constantName": "string",
    "dataType": "'String' | 'Integer' | 'Decimal' | 'Boolean' | 'DateTime' | 'Unknown' — Unchanged; reported for confirmation",
    "defaultValue": "string — Value after the write",
    "exposedToClient": "boolean — Value after the write",
    "documentation": "string — Value after the write",
    "changed": {
      "defaultValue": "boolean — true if this field was written this call",
      "exposedToClient": "boolean",
      "documentation": "boolean"
    }
  }
}
```

---

### Error Cases

- No working copy → throw `"No working copy is open in this session. Call open_working_copy first."`.
- All optional update fields omitted → throw `"At least one of defaultValue, exposedToClient, or documentation must be provided."`.
- `moduleName` provided but does not exist → throw `"Module '<moduleName>' not found in working copy."`.
- Constant not found in the scoped search → throw `"Constant '<localName>' not found in module '<moduleName>'."` (when scoped) or `"Constant '<localName>' not found in any module."` (when unscoped).
- Short name found in multiple modules without disambiguation → throw `"'<localName>' found in multiple modules: <comma-separated list>. Provide moduleName to disambiguate."`.
- Qualified name's module prefix disagrees with `moduleName` parameter → throw `"constantName prefix '<prefixModule>' conflicts with moduleName '<moduleName>'."`.

### Notes

- **No type change path.** Studio-pro's `update_constant` likewise refuses to change the type; recreating the constant is the documented way to change `String` → `Integer`. Doing so via `create_constant` with `overwrite: true` will preserve any folder placement (`folderQualifiedName`).
- **`exposedToClient` semantics.** Flipping a constant from server-only to `exposedToClient: true` makes it visible to the web client, which is a security boundary. The tool will not warn the caller — that judgment is the agent's responsibility.
- **Run-configuration overrides are separate.** This tool writes the design-time default. To change the value in a specific run configuration (Development, Production, ...), use `configure_constant_values` (Tool 79) — those overrides live on `settings.ConstantValue` under a `settings.Configuration`, not on the `Constant` document itself.

### Example

```json
{
  "constantName": "MyFirstModule.PetstoreBaseUrl",
  "defaultValue": "https://staging.petstore.example.com/api/v3",
  "documentation": "Override URL for the Petstore consumed REST service. Updated 2026-05-14 to point at staging."
}
```

<!-- END TOOL 63: update_constant -->

---

<!-- BEGIN TOOL 79: configure_constant_values -->
## Tool 79: `configure_constant_values`

**Status**: Available

Set (or overwrite) the constant-value override for a specific **run configuration** (e.g. `Development`, `Production`). The tool walks `ProjectSettings → ConfigurationSettings.configurations`, finds the configuration by name, and updates the `ConstantValue` row tied to the target constant. Creates the `ConstantValue` row if it does not exist yet.

This is the design-time analogue of editing `App `Settings → Configurations → <ConfigName> → Constants` in Studio Pro.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "configurationName": "string (required) — Run configuration name, e.g. 'Development', 'Production'",
  "constantName": "string (required) — Short name OR qualified 'Module.ConstantName'",
  "moduleName": "string (optional) — Module containing the constant. Searches all modules if omitted.",
  "value": "string (required) — New value for this configuration"
}
```

| Field               | Required | Description                                                                                                                          |
|---------------------|----------|--------------------------------------------------------------------------------------------------------------------------------------|
| `configurationName` | Yes      | Must match `Configuration.name` exactly (case-sensitive). Studio Pro ships with `Development` by default; `Production` is project-defined. |
| `constantName`      | Yes      | Short name or `"Module.ConstantName"`. Same disambiguation rules as `update_constant` (Tool 63).                                     |
| `moduleName`        | No       | Restrict search to one module. Required when the short name exists in multiple modules.                                              |
| `value`             | Yes      | The override value, stored verbatim on `SharedValue.value`. Not validated against the constant's `dataType`.                         |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Resolve the constant: same lookup logic as `update_constant` (Tool 63) — accept `Module.Name` or short name, disambiguate via `moduleName`. Throw the same errors.
3. Locate the `ProjectSettings` document on `model.root.projectSettings` (Mendix model has exactly one). From its `settingsParts`, find the `settings.ConfigurationSettings` part. If the project has none, throw `"Project has no ConfigurationSettings — open the project in Studio Pro at least once to initialize it."`.
4. Find the `settings.Configuration` in `configurationSettings.configurations` where `name === configurationName`. Throw `"Configuration '<configurationName>' not found. Available: <list>."` if absent — do **not** auto-create configurations; that is a separate concern and requires several other fields (database URL, ports, ...).
5. In `configuration.constantValues`, find the `ConstantValue` whose `constant.qualifiedName === <constant>.qualifiedName`.
   - **If found**: load it and overwrite the value.
   - **If not found**: `settings.ConstantValue.createIn(configuration)` and set `constant = <loaded constant>` (the SDK writes `constantQualifiedName` automatically from the typed setter).
6. Write the value depending on SDK version:
   - **Mendix ≥ 10.9**: ensure `sharedOrPrivateValue` is a `settings.SharedValue`. If absent or it is a `PrivateValue`, replace with a fresh `settings.SharedValue.createIn…` and set `.value = value`. `PrivateValue` has no `value` slot (it indicates the value lives outside the model, per-developer), and overwriting that intent silently would be wrong.
   - **Mendix < 10.9**: write the legacy `ConstantValue.value` slot directly.
   The builder picks the path by `instanceof` of `sharedOrPrivateValue` and falls back to `value` if the property is undefined on the loaded element.
7. Return the resulting state.

---

### Output

```json
{
  "success": true,
  "status": "success",
  "message": "Set '<constantQN>' = '<value>' in configuration '<configurationName>'",
  "data": {
    "configurationName": "string",
    "constantQualifiedName": "string",
    "value": "string",
    "created": "boolean — true if a ConstantValue row was created, false if it was overwritten",
    "valueKind": "'shared' | 'private' | 'legacy' — Which storage slot was written"
  }
}
```

`valueKind` is `"legacy"` on Mendix < 10.9, `"shared"` on ≥ 10.9 after the builder forced a `SharedValue`. `"private"` is reported only on read-back; the builder never writes a `PrivateValue` (those represent developer-local overrides and live outside the committed model — agents can't author them).

---

### Error Cases

- No working copy → throw `"No working copy is open in this session. Call open_working_copy first."`.
- Constant resolution failures: same as `update_constant` (not-found, multi-module ambiguity, prefix conflict).
- `ProjectSettings` missing → throw `"Project has no ProjectSettings document."` (should never happen on a Teams-server project).
- `ConfigurationSettings` part missing → throw `"Project has no ConfigurationSettings — open the project in Studio Pro at least once to initialize it."`.
- `configurationName` not found → throw `"Configuration '<configurationName>' not found. Available: <list>."`.
- `value` is `undefined` / `null` (vs. empty string) → throw `"Parameter 'value' is required (use '' to set an empty override)."`.

### Notes

- **This tool does not create configurations.** Studio Pro's "New Configuration" dialog demands a database type, ports, root URL, and a name; encoding all of that into one tool would be unwieldy and error-prone. Create configurations once in Studio Pro, then use this tool to keep their constant overrides in sync.
- **`exposedToClient` constants and overrides.** A constant marked `exposedToClient: true` is shipped to the web client at its run-time configuration value, so this tool is the right place to inject build-time secrets/URLs — but again, that's a security boundary and the caller owns the decision.
- **`PrivateValue` is not authorable.** Studio Pro stores `PrivateValue` for developer-specific overrides outside the team-server project; the actual value lives in the developer's local settings, not in the project model. If the existing `ConstantValue.sharedOrPrivateValue` is a `PrivateValue` when this tool runs, the builder replaces it with a `SharedValue` (and surfaces `valueKind: "shared"` + `replacedPrivate: true` on a future iteration if we want to warn about it). The current spec replaces silently — agents can confirm by re-reading.

### Example — point `PetstoreBaseUrl` at the production endpoint for the Production configuration

```json
{
  "configurationName": "Production",
  "constantName": "MyFirstModule.PetstoreBaseUrl",
  "value": "https://api.petstore.example.com/api/v3"
}
```

After commit, opening the project in Studio Pro and switching to the Production configuration shows the override value, while the design-time default on the `Constant` document itself remains whatever `create_constant` / `update_constant` wrote.

<!-- END TOOL 79: configure_constant_values -->
