# Microflows — Tool Specifications

> See also: `../rules/expression_function_syntax.md` — when authoring any
> Mendix-expression slot on a microflow activity (CreateVariable.initialValue,
> ChangeVariable.value, ExclusiveSplit / LoopedActivity conditions,
> MemberChange.value, message-template parameters, CallMicroflow /
> CallNanoflow / ShowPage parameter expressions). Kebab-case function calls
> (e.g. `year-from-dateTime(`) are XPath, not Mendix expressions, and are
> hard-blocked by `src/expressionValidator.ts`.
>
> See also: `../rules/looped_activity_terminators.md` — when authoring any
> `LoopedActivity` inner-flow terminator. Inside a loop body only `"continue"`
> (→ `ContinueEvent`) and `"break"` (→ `BreakEvent`) are valid; `"end"` is
> reserved for the outer microflow's `EndEvent` and is auto-rewritten to
> `"continue"` with a warning if it appears inside a loop. Hard-enforced by
> `src/microflowBuilder.ts` (`buildInnerLoop` pre-flight + `wireFlow`
> `isInnerLoop` guard).

<!-- BEGIN TOOL 23: list_microflows -->

## Tool 23: `list_microflows`

List all microflows in a module (or the entire project if no module is specified). Reads directly from the open working copy — does not require Mendix Studio Pro to be running.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "moduleName": "string (optional) — Name of the module to list. If omitted, lists microflows from all modules in the project."
}
```

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. If `moduleName` is provided:
   - Find module via `model.root.modules.find(m => m.name === moduleName)`. Throw if not found: `"Module \"<moduleName>\" not found. Available modules: <comma-separated list>"`.
   - Filter microflows: `module.documents.filter(d => d instanceof microflows.Microflow)`.
   - Collect `{ name, qualifiedName }` for each microflow — **no `.load()` needed** since `.name` and `.qualifiedName` are available on the `IDocument` stub.
3. If `moduleName` is not provided:
   - Iterate all modules with `fromAppStore === false` in `model.root.modules`.
   - For each module, filter: `module.documents.filter(d => d instanceof microflows.Microflow)`.
   - Collect `{ name, qualifiedName }` (no `.load()` needed). Skip modules with no microflows from the result (do not display them).
4. Sort results alphabetically by `qualifiedName` within each module (`array.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName))`).
5. Return `textResult(output)` — plain text following the Output format below.

> **Note:** `microflows.Microflow` and `microflows.Nanoflow` are two separate classes in the SDK. The `instanceof microflows.Microflow` filter **excludes** Nanoflows and other document types (pages, constants, enumerations...) from results. Both `.name` and `.qualifiedName` are available on the `IDocument` stub without calling `.load()` — avoid calling `.load()` inside the listing loop.

---

### Output

Returns plain text (MCP `textResult`):

```
# When moduleName is specified:
Microflows in module '<moduleName>' (<count> total):
  1. <moduleName>.<microflowName>
  2. <moduleName>.<microflowName>
  ...

# When moduleName is not specified:
Microflows in project (<total_count> total):

Module '<module1>':
  1. <module1>.<microflowName>
  ...

Module '<module2>':
  1. <module2>.<microflowName>
  ...
```

Example (with `moduleName`):

```
Microflows in module 'TestEntityMaintenance' (3 total):
  1. TestEntityMaintenance.ACT_TestEntity_Save
  2. TestEntityMaintenance.ACT_TestEntity_BulkUpdate
  3. TestEntityMaintenance.VAL_TestEntity_Validate
```

Example (without `moduleName` — whole project):

```
Microflows in project (5 total):

Module 'MyFirstModule':
  1. MyFirstModule.ACT_Order_Create
  2. MyFirstModule.ACT_Order_Submit

Module 'TestEntityMaintenance':
  1. TestEntityMaintenance.ACT_TestEntity_Save
  2. TestEntityMaintenance.ACT_TestEntity_BulkUpdate
  3. TestEntityMaintenance.VAL_TestEntity_Validate
```

---

### Error Cases

| Condition                                                                    | Behavior                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| No working copy is open                                                      | Throw: `"No working copy is open in this session. Call open_working_copy first."`           |
| `moduleName` provided but not found                                          | Throw: `"Module \"<moduleName>\" not found. Available modules: <comma-separated list>"`     |
| Module has no microflows (when `moduleName` provided)                        | Return `"No microflows found in module '<moduleName>'."` — no throw                         |
| `moduleName` not provided and no non-Marketplace modules exist               | Return `"No modules found in working copy."` — no throw                                     |
| `moduleName` not provided and all non-Marketplace modules have no microflows | Return `"Microflows in project (0 total):\n(no microflows found in any module)"` — no throw |

---

<!-- END TOOL 23: list_microflows -->

<!-- BEGIN TOOL 24: read_microflow_details -->

## Tool 24: `read_microflow_details`

Read the full details of a microflow from the working copy: parameters with data types, return type, and all activities with complete configuration (entity, variables, expressions, member changes). Supports qualified name (`Module.MicroflowName`).

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "microflowName": "string (required) — Microflow name or qualified name (e.g.: 'TestEntityMaintenance.ACT_TestEntity_Save')",
  "moduleName": "string (optional) — Module containing the microflow. Required if microflowName is a short name and exists in multiple modules."
}
```

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Resolve microflow:
   - If `microflowName` contains `.` (qualified name): use `model.findMicroflowByQualifiedName(microflowName)`. Throw if returns `undefined`.
   - If `moduleName` is provided: find module → filter `module.documents.filter(d => d instanceof microflows.Microflow)` → find by `mf.name === microflowName`. Throw if module does not exist or microflow not found.
   - If only `microflowName` (short name, no `moduleName`): iterate all modules with `fromAppStore === false`, filter `microflows.Microflow`, return the first match. **Non-deterministic** if multiple modules have microflows with the same name — recommend providing `moduleName`.
3. `await microflow.load()` — loads full microflow data (parameters, return type, settings). **Note:** `objectCollection` is a separate document unit, needs to be loaded separately in step 4.
4. Collect:
   - **Parameters:** `microflow.parameters[]` → `{ name, type: DataType, documentation }`. No separate load needed — parameters are available after `microflow.load()`.
   - **Return type:** `microflow.microflowReturnType` + `microflow.returnVariableName`. Convert SDK DataType to string per the **DataType mapping (SDK → output)** table below.
   - **Settings:** `allowConcurrentExecution`, `applyEntityAccess`, `url` (read `microflow.url` — empty string if not set, displayed as `"(none)"`).
   - **Activities:** `await microflow.objectCollection.load()` → iterate `microflow.objectCollection.objects` (type `MicroflowObject[]`, includes `StartEvent`, `EndEvent`, `ActionActivity`, `ExclusiveSplit`, `LoopedActivity`): read type, caption, corresponding action configuration.
5. Number activities by **position in `objectCollection.objects`** (creation order), starting at 1 — includes `StartEvent` (position 1) and `EndEvent` (last position). This `position` value is used by `modify_microflow_activity` and `insert_before_activity`.
6. Return `textResult(output)`. **This tool is read-only — does not modify the model. No need to call `commit_working_copy`.**

> **Note:** Display order reflects the order in `objectCollection.objects` (creation order), not necessarily the visual order on the canvas. `StartEvent` and `EndEvent` are counted in the `position` sequence but cannot be edited via `modify_microflow_activity`. Always use `position` from this tool's output when calling `modify_microflow_activity` or `insert_before_activity`.

**DataType mapping (SDK → output string):**

| SDK class      | Output string                             |
| -------------- | ----------------------------------------- |
| `VoidType`     | `Void`                                    |
| `BooleanType`  | `Boolean`                                 |
| `StringType`   | `String`                                  |
| `IntegerType`  | `Integer`                                 |
| `LongType`     | `Long`                                    |
| `DecimalType`  | `Decimal`                                 |
| `DateTimeType` | `DateTime`                                |
| `ObjectType`   | `Object [entity: <entity.qualifiedName>]` |
| `ListType`     | `List [entity: <entity.qualifiedName>]`   |

Entity QN read from `(type as ObjectType).entity.qualifiedName` or `(type as ListType).entity.qualifiedName`.

---

### Output

Returns plain text (MCP `textResult`):

```
Microflow: <moduleName>.<microflowName>
Documentation: <documentation or "(none)">
Return type: <type> [entity: <entityQN>]
Return variable: <returnVariableName or "(none)">
Allow concurrent execution: <true|false>
Apply entity access: <true|false>
URL: <url or "(none)">

Parameters (<count>):
  1. <name>: <type> [entity: <entityQN>]
  ...

Activities (<count>):
  [1] StartEvent
  [2] <ActivityType> — caption: "<caption>"
      <type-specific fields>
  ...
  [N] EndEvent
```

**Activity-specific fields in output:**

| `ActivityType`           | Fields displayed                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `CreateObject`           | `entity: <QN>`, `outputVar: <name>`, `commit: <mode>`, `memberChanges: <count>`                                        |
| `ChangeObject`           | `variable: <name>`, `commit: <mode>`, `refreshInClient: <bool>`, `memberChanges: <count>`                              |
| `CommitObject`           | `variable: <name>`, `withEvents: <bool>`, `refreshInClient: <bool>`                                                    |
| `DeleteObject`           | `variable: <name>`                                                                                                     |
| `Retrieve (Database)`    | `source: Database`, `entity: <QN>`, `outputVar: <name>`, `range: <type>`, `xpath: <expr or "(none)">`                  |
| `Retrieve (Association)` | `source: Association(<assocQN>)`, `outputVar: <name>`                                                                  |
| `CreateVariable`         | `variableName: <name>`, `variableType: <type>`, `initialValue: <expr>`                                                 |
| `ChangeVariable`         | `variable: <name>`, `value: <expr>`                                                                                    |
| `CallMicroflow`          | `microflow: <QN>`, `outputVar: <name or "(none)">`, `parameterMappings: <count>`                                       |
| `LogMessage`             | `level: <level>`, `node: <name>`, `template: "<template>"`                                                             |
| `ShowMessage`            | `type: <type>`, `blocking: <bool>`, `template: "<template>"`                                                           |
| `ShowPage`               | `page: <QN>`, `passedObject: <varName or "(none)">` (legacy field on Mx ≤ 10), `parameterMappings: <count>` (Mx ≥ 9.7) |
| `ClosePage`              | _(no extra fields)_                                                                                                    |
| `ValidationFeedback`     | `object: <varName>`, `attribute: <QN or "(none)">`, `association: <QN or "(none)">`, `template: "<template>"`          |
| `AggregateList`          | `list: <varName>`, `function: <func>`, `attribute: <QN or "(none)">`, `outputVar: <name>`                              |
| `ListOperation`          | `operation: <op>`, `list: <varName>`, `outputVar: <name>`                                                              |
| `ExclusiveSplit`         | `conditionType: <type>`, `condition: <expr>`                                                                           |
| `LoopedActivity`         | `list: <varName>`, `iterator: <varName>`, `innerActivities: <count>`                                                   |

---

### Filled Output Example

```
Microflow: TestEntityMaintenance.ACT_TestEntity_Save
Documentation: (none)
Return type: Void
Return variable: (none)
Allow concurrent execution: false
Apply entity access: true
URL: (none)

Parameters (1):
  1. TestEntity: Object [entity: TestEntityMaintenance.TestEntity]

Activities (6):
  [1] StartEvent
  [2] RetrieveAction — caption: "Retrieve existing"
      source: Database
      entity: TestEntityMaintenance.TestEntity
      outputVar: ExistingEntity
      range: First
      xpath: [TestEntityMaintenance.TestEntity/Id = $TestEntity/Id]
  [3] ExclusiveSplit — caption: "Is duplicate?"
      conditionType: Expression
      condition: $ExistingEntity != empty
  [4] ActionActivity — caption: "Show error"
      type: ShowMessage
      messageType: Error
      blocking: true
      template: "Duplicate entity found."
  [5] CommitAction — caption: "Save"
      variable: TestEntity
      withEvents: true
      refreshInClient: true
  [6] EndEvent
```

---

### Error Cases

| Condition                           | Behavior                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| No working copy is open             | Throw: `"No working copy is open in this session. Call open_working_copy first."`                      |
| `microflowName` not found           | Throw: `"Microflow '<name>' not found."` with suggestion to use qualified name or provide `moduleName` |
| `moduleName` provided but not found | Throw: `"Module '<moduleName>' not found. Available: <list>."`                                         |

---

<!-- END TOOL 24: read_microflow_details -->

<!-- BEGIN TOOL 25: create_microflow -->

## Tool 25: `create_microflow`

Create a new Microflow in a module, with full parameters, list of activities, and nested flows. Input is a JSON object describing the complete microflow structure.

Prerequisite: `open_working_copy` must be called first.

> **Lifecycle note:** Unlike `create_domain_model` (self-contained, manages its own working copy), `create_microflow` requires a session working copy to be open. Reason: microflows are typically created in the same session as the domain model and pages — bundled into a single commit. See the multi-step flow at the end of this file.

---

### Input — Schema Overview

```json
{
  "moduleName": "string (required)",
  "microflowName": "string (required) — Convention: ACT_ (action), VAL_ (validation), SUB_ (sub-flow), SCH_ (scheduled)",
  "documentation": "string (optional)",
  "returnType": { ...ReturnTypeSpec },
  "returnVariableName": "string (optional) — Return variable name; must exist in scope (parameter or outputVariableName of an activity)",
  "allowConcurrentExecution": "boolean (optional, default: true)",
  "applyEntityAccess": "boolean (optional, default: true — enforces entity access per security role)",
  "overwrite": "boolean (optional, default: false — if true and microflow already exists, delete and recreate)",
  "parameters": [ ...ParameterSpec ],
  "activities": [ ...ActivitySpec ],
  "flows": [ ...FlowSpec ]
}
```

> **Security:** `applyEntityAccess` defaults to `true`. Set to `false` only when entity access bypass is needed for system-level microflows (e.g.: scheduled jobs, internal APIs). Document the reason in `documentation` when opting out.

> **Naming convention:** Implementation will emit a warning in output if `microflowName` does not start with `ACT_`, `VAL_`, `SUB_`, `SCH_`, `IVK_`, or `OCH_`. Warning does not block microflow creation.

> **Overwrite:** If `overwrite: false` (default) and the microflow already exists, return `alreadyExisted: true` and do nothing. If `overwrite: true`, the old microflow is deleted and fully recreated.

---

### `ReturnTypeSpec` — Return Type

| `type`     | Mendix DataType        | Additional properties                    |
| ---------- | ---------------------- | ---------------------------------------- |
| `Void`     | VoidType               | —                                        |
| `Boolean`  | BooleanType            | —                                        |
| `String`   | StringType             | —                                        |
| `Integer`  | IntegerType            | —                                        |
| `Long`     | LongType (IntegerType) | —                                        |
| `Decimal`  | DecimalType            | —                                        |
| `DateTime` | DateTimeType           | —                                        |
| `Object`   | ObjectType             | `"entityQualifiedName": "Module.Entity"` |
| `List`     | ListType               | `"entityQualifiedName": "Module.Entity"` |

```json
// Examples
"returnType": { "type": "Void" }
"returnType": { "type": "Boolean" }
"returnType": { "type": "Object", "entityQualifiedName": "TestEntityMaintenance.TestEntity" }
"returnType": { "type": "List",   "entityQualifiedName": "TestEntityMaintenance.TestEntity" }
```

---

### Variable name uniqueness (microflow-wide)

Mendix microflow variable names share **one flat namespace per microflow**. Every variable a parameter or activity _declares_ must be unique across the whole microflow, including inside `LoopedActivity` inner bodies. Studio Pro rejects duplicates with `CE0111 "Duplicate variable name '<name>'"`.

The builder enforces this pre-flight in `create_microflow`, `create_microflow_activities`, `insert_before_activity`, and `modify_microflow_activity` — see `defect_reports/Open/builder-output-fails-mx-check.md` "Class 4".

**Variable-DECLARING slots (must each be unique microflow-wide):**

| Activity type                      | Declaring slot                           |
| ---------------------------------- | ---------------------------------------- |
| `CreateObject`                     | `outputVariableName`                     |
| `Retrieve`                         | `outputVariableName`                     |
| `CreateVariable`                   | `variableName`                           |
| `CallMicroflow`                    | `outputVariableName`                     |
| `AggregateList`                    | `outputVariableName`                     |
| `ListOperation`                    | `outputVariableName`                     |
| `RestOperationCall`                | `outputVariableName`, `bodyVariableName` |
| `CallNanoflow` (nanoflow-only)     | `outputVariableName`                     |
| `JavaScriptAction` (nanoflow-only) | `outputVariableName`                     |
| `LoopedActivity`                   | `iteratorVariableName`                   |
| Microflow parameter                | `name`                                   |

**Variable-REFERENCING slots** (do NOT need to be unique — they reference a name declared elsewhere): `ChangeObject.variable`, `ChangeVariable.variable`, `CommitObject.variable`, `DeleteObject.variable`.

---

### `ParameterSpec` — Input Parameters

```json
{
  "name": "string (required) — Parameter variable name in PascalCase",
  "type": { ...ReturnTypeSpec }
}
```

**Example:**

```json
"parameters": [
  { "name": "NewTestEntity", "type": { "type": "Object", "entityQualifiedName": "TestEntityMaintenance.TestEntity" } },
  { "name": "IsEdit",        "type": { "type": "Boolean" } }
]
```

---

### `ActivitySpec` — Activity Types

Each activity is an object in the `activities` array. Common fields:

| Field               | Type   | Required | Description                                                                                                                                                                                |
| ------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                | string | Yes      | Unique internal ID, used in `flows` to reference this activity                                                                                                                             |
| `type`              | string | Yes      | Activity type (see table below)                                                                                                                                                            |
| `caption`           | string | No       | Caption displayed on the canvas                                                                                                                                                            |
| `backgroundColor`   | string | No       | Background color: `Default` `Blue` `Gray` `Green` `LightBlue` `Orange` `Purple` `Red` `Yellow`                                                                                             |
| `documentation`     | string | No       | Internal documentation note                                                                                                                                                                |
| `errorHandlingType` | string | No       | Per-activity error handling. See "Error handling type" section below — values are mode-specific (`CE6035`). Omit to use the mode default (`Rollback` in microflows, `Abort` in nanoflows). |

#### Error handling type (`errorHandlingType`)

Mendix Studio Pro enforces a different allow-list per context (Studio Pro `CE6035` rejects anything outside these sets). The builder validates the value pre-flight and overrides the SDK's universal `Rollback` default when the activity is created inside a nanoflow body. See `defect_reports/Open/builder-output-fails-mx-check.md` "Class 6".

| Value                   | Microflow                                        | Nanoflow   | Notes                                                               |
| ----------------------- | ------------------------------------------------ | ---------- | ------------------------------------------------------------------- |
| `Rollback`              | ✅ default                                       | ❌         | Reverts changes and bubbles the error to the caller.                |
| `Custom`                | ✅                                               | ❌         | Requires an explicit error-handler flow (see "Out of scope" below). |
| `CustomWithoutRollBack` | ✅                                               | ✅         | Requires an explicit error-handler flow; does not roll back.        |
| `Continue`              | ✅ (only on `CallMicroflow` or `LoopedActivity`) | ❌         | Keeps changes and continues as if no error occurred.                |
| `Abort`                 | ❌                                               | ✅ default | Terminates the nanoflow. Introduced in Mendix 8.0.0.                |

**Limitation:** `Custom` and `CustomWithoutRollBack` require a separate error-handler subtree, which the builder does not yet wire. The value is accepted but a warning is added to `ctx.warnings` reminding the planner to add the error flow in Studio Pro.

Sources: <https://docs.mendix.com/refguide/error-handling-in-microflows/>, <https://docs.mendix.com/refguide/error-handling-in-nanoflows/>.

**Supported activity types:**

| `type`               | Mendix SDK Class           | Description                                                                                   |
| -------------------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| `CreateObject`       | `CreateObjectAction`       | Create a new entity instance                                                                  |
| `ChangeObject`       | `ChangeObjectAction`       | Modify properties of an existing entity instance                                              |
| `CommitObject`       | `CommitAction`             | Persist an entity instance to the database                                                    |
| `DeleteObject`       | `DeleteAction`             | Remove an entity instance from the database                                                   |
| `Retrieve`           | `RetrieveAction`           | Retrieve data from DB or via association                                                      |
| `CreateVariable`     | `CreateVariableAction`     | Create a local primitive variable                                                             |
| `ChangeVariable`     | `ChangeVariableAction`     | Change the value of a variable                                                                |
| `CallMicroflow`      | `MicroflowCallAction`      | Call another microflow                                                                        |
| `LogMessage`         | `LogMessageAction`         | Write to the Mendix log (debug/info/warning/error)                                            |
| `AggregateList`      | `AggregateListAction`      | Calculate aggregate over a list (count, sum, avg...)                                          |
| `ListOperation`      | `ListOperationAction`      | Operations on a list (filter, sort, union, subtract…)                                         |
| `ShowMessage`        | `ShowMessageAction`        | Display a message popup                                                                       |
| `ShowPage`           | `ShowPageAction`           | Open a page/form                                                                              |
| `ClosePage`          | `CloseFormAction`          | Close the current page/form                                                                   |
| `ValidationFeedback` | `ValidationFeedbackAction` | Attach a validation error message to an attribute                                             |
| `ExclusiveSplit`     | `ExclusiveSplit`           | Branch (boolean expression or enum)                                                           |
| `LoopedActivity`     | `LoopedActivity`           | Loop over each element of a list                                                              |
| `RestCall`           | `RestCallAction`           | Inline REST call (HTTP method + URL + body + response handling), no service document required |
| `RestOperationCall`  | `RestOperationCallAction`  | Typed call to an operation defined on a `ConsumedRestService` document (Tool 99)              |

> **Note on `backgroundColor`:** This property only applies to `ActionActivity` (i.e., all types except `ExclusiveSplit` and `LoopedActivity`). Implementation will ignore `backgroundColor` if provided for these two types instead of throwing an error.

---

#### `CreateObject`

Create a new entity instance. Maps to `CreateObjectAction`.

```json
{
  "id": "act_create",
  "type": "CreateObject",
  "caption": "Create TestEntity",
  "entityQualifiedName": "TestEntityMaintenance.TestEntity",
  "outputVariableName": "NewTestEntity",
  "commit": "No",
  "memberChanges": [
    {
      "attributeQualifiedName": "TestEntityMaintenance.TestEntity.StringAttr",
      "changeType": "Set",
      "value": "$Parameter/StringAttr"
    }
  ]
}
```

| Field                 | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| `entityQualifiedName` | QN of the entity to create                                 |
| `outputVariableName`  | Variable name to hold the newly created object             |
| `commit`              | `No` (default) \| `Yes` \| `YesWithoutEvents`              |
| `memberChanges`       | List of attribute/association changes (see `MemberChange`) |

---

#### `ChangeObject`

Change attribute/association of an existing entity instance. Maps to `ChangeObjectAction`.

```json
{
  "id": "act_change",
  "type": "ChangeObject",
  "caption": "Update TestEntity",
  "variable": "NewTestEntity",
  "commit": "Yes",
  "refreshInClient": true,
  "memberChanges": [
    {
      "attributeQualifiedName": "TestEntityMaintenance.TestEntity.StringAttr",
      "changeType": "Set",
      "value": "'Updated'"
    }
  ]
}
```

| Field             | Description                                      |
| ----------------- | ------------------------------------------------ |
| `variable`        | Variable name holding the object to change       |
| `commit`          | `No` \| `Yes` \| `YesWithoutEvents`              |
| `refreshInClient` | `true` / `false` — refresh widgets on the client |
| `memberChanges`   | List of changes (see `MemberChange`)             |

For an **enum-typed** attribute, the `value` is the FQN constant — NOT a string literal:

```json
"memberChanges": [
  { "attributeQualifiedName": "LeaveRequest.LeaveRequest.Status", "changeType": "Set", "value": "LeaveRequest.Enum_LeaveStatus.PENDING" }
]
```

> **Enumeration values in expressions:** when the target attribute or variable is enum-typed, the value MUST be the FQN constant (`Module.Enum.VALUE`), NOT a string literal (`'VALUE'`). The string-literal form is for XPath constraints only. See [`../rules/enum_value_in_expression.md`](../rules/enum_value_in_expression.md).

---

#### `MemberChange` — Used in `CreateObject` and `ChangeObject`

```json
{
  "attributeQualifiedName": "TestEntityMaintenance.TestEntity.StringAttr",
  "changeType": "Set",
  "value": "$Parameter/StringAttr"
}
```

| Field                      | Description                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `attributeQualifiedName`   | Fully qualified name of the attribute (`Module.Entity.Attr`). Use this field **or** `associationQualifiedName`, not both. |
| `associationQualifiedName` | Fully qualified name of the association (`Module.Entity_Related`).                                                        |
| `changeType`               | `Set` (default) \| `Add` \| `Remove`                                                                                      |
| `value`                    | Mendix expression (e.g.: `'text'`, `$Var`, `$Var/Attr`, `true`, `1 + 2`)                                                  |

> **Consistency rule — applies to identifier fields, NOT to expression strings.** Fields that identify _which_ attribute or association the activity targets (`attributeQualifiedName`, `associationQualifiedName`, the attribute slot in `sortItems` / `AggregateList` / `ValidationFeedback`) must use the **Fully Qualified Name** form `Module.Entity.Attribute` — short names will throw at the resolve step. Expression-bearing fields (`value` on `MemberChange`, `condition` on `ExclusiveSplit`, `template` `parameters` on `LogMessage` / `ShowMessage`, `breakCondition` on `LoopedActivity`, etc.) use **Mendix expression syntax** instead — see the box below.

> **Mendix expression syntax (for the `value` / `condition` / `parameters` / `breakCondition` fields):**
>
> - `$Var` — a variable in scope.
> - `$Var/AttrName` — access an attribute of `$Var`'s entity. Use the **short attribute name**; do NOT prefix it with `Module.Entity.` (e.g. `$LeaveRequest/StartDate`, NOT `$LeaveRequest/LeaveManagement.LeaveRequest.StartDate` — the latter parses as an association traversal and will fail to resolve).
> - `$Var/Module.AssociationName` — traverse an association from `$Var`, returning the target entity.
> - `$Var/Module.AssociationName/AttrName` — traverse an association and then read an attribute on the target.
> - `'literal'`, `true`, `false`, `empty`, `1 + 2`, function calls (`toString(...)`, `dateTime(...)`) — same as the in-Studio-Pro expression editor.
>
> Full decision rule, identifier-vs-expression split, association-traversal grammar, and worked counter-examples live in [`../rules/expression_attribute_paths.md`](../rules/expression_attribute_paths.md).

> **Enumeration values in expressions:** when the target attribute is enum-typed, the value MUST be the FQN constant (`Module.Enum.VALUE`), NOT a string literal (`'VALUE'`). The string-literal form is for XPath constraints only. See [`../rules/enum_value_in_expression.md`](../rules/enum_value_in_expression.md).

---

#### `CommitObject`

Persist an entity instance to the database, triggering `Before/AfterCommit` events. Maps to `CommitAction`.

```json
{
  "id": "act_commit",
  "type": "CommitObject",
  "caption": "Commit TestEntity",
  "variable": "NewTestEntity",
  "withEvents": true,
  "refreshInClient": true
}
```

---

#### `DeleteObject`

Remove an entity instance from the database. Maps to `DeleteAction`.

```json
{
  "id": "act_delete",
  "type": "DeleteObject",
  "caption": "Delete TestEntity",
  "variable": "NewTestEntity"
}
```

---

#### `Retrieve`

Retrieve data from the database or via association. Maps to `RetrieveAction`.

**Retrieve from Database:**

```json
{
  "id": "act_retrieve",
  "type": "Retrieve",
  "caption": "Retrieve All TestEntities",
  "outputVariableName": "TestEntityList",
  "source": {
    "type": "Database",
    "entityQualifiedName": "TestEntityMaintenance.TestEntity",
    "xpath": "[StringAttr != empty]",
    "range": {
      "type": "All"
    },
    "sortItems": [
      {
        "attributeQualifiedName": "TestEntityMaintenance.TestEntity.StringAttr",
        "order": "Ascending"
      }
    ]
  }
}
```

**Retrieve via Association:**

```json
{
  "id": "act_retrieve_assoc",
  "type": "Retrieve",
  "caption": "Retrieve Player via Association",
  "outputVariableName": "RelatedPlayer",
  "source": {
    "type": "Association",
    "startVariableName": "NewTestEntity",
    "associationQualifiedName": "TestEntityMaintenance.TestEntity_Player"
  }
}
```

**`range` options:**

| `type`          | Additional properties                                               | Description           |
| --------------- | ------------------------------------------------------------------- | --------------------- |
| `All`           | —                                                                   | Retrieve all          |
| `First`         | —                                                                   | Only the first object |
| `ConstantRange` | `"limit": 10, "offset": 0`                                          | Fixed count           |
| `CustomRange`   | `"limitExpression": "$PageSize", "offsetExpression": "$PageOffset"` | Dynamic expression    |

---

#### `CreateVariable`

Create a local primitive variable. Maps to `CreateVariableAction`.

```json
{
  "id": "act_createvar",
  "type": "CreateVariable",
  "caption": "Initialize IsValid",
  "variableName": "IsValid",
  "variableType": { "type": "Boolean" },
  "initialValue": "true"
}
```

| Field          | Description                                 |
| -------------- | ------------------------------------------- |
| `variableName` | Name of the new variable                    |
| `variableType` | See `ReturnTypeSpec` (primitive types only) |
| `initialValue` | Mendix expression for the initial value     |

---

#### `ChangeVariable`

Change the value of an existing variable. Maps to `ChangeVariableAction`.

```json
{
  "id": "act_changevar",
  "type": "ChangeVariable",
  "caption": "Set IsValid = false",
  "variable": "IsValid",
  "value": "false"
}
```

> **Enumeration values in expressions:** when the target attribute or variable is enum-typed, the value MUST be the FQN constant (`Module.Enum.VALUE`), NOT a string literal (`'VALUE'`). The string-literal form is for XPath constraints only. See [`../rules/enum_value_in_expression.md`](../rules/enum_value_in_expression.md).

---

#### `CallMicroflow`

Call another microflow and receive the return value. Maps to `MicroflowCallAction`.

```json
{
  "id": "act_callmf",
  "type": "CallMicroflow",
  "caption": "Validate TestEntity",
  "microflowQualifiedName": "TestEntityMaintenance.VAL_TestEntity_Validate",
  "outputVariableName": "IsValid",
  "parameterMappings": [
    { "parameterName": "NewTestEntity", "argument": "$NewTestEntity" },
    { "parameterName": "IsEdit", "argument": "$IsEdit" }
  ]
}
```

| Field                    | Description                                                              |
| ------------------------ | ------------------------------------------------------------------------ |
| `microflowQualifiedName` | QN of the microflow to call                                              |
| `outputVariableName`     | Variable name to receive the return value (skip if Void)                 |
| `parameterMappings`      | Array of `{ parameterName, argument }` — argument is a Mendix expression |

---

#### `ShowMessage`

Display a message dialog to the user. Maps to `ShowMessageAction`.

```json
{
  "id": "act_msg",
  "type": "ShowMessage",
  "caption": "Show Error",
  "messageType": "Error",
  "template": "An error occurred: {1}",
  "parameters": ["$ErrorDetail"],
  "blocking": true
}
```

| Field         | Valid values                          | Description                                            |
| ------------- | ------------------------------------- | ------------------------------------------------------ |
| `messageType` | `Information` \| `Warning` \| `Error` | Message type (default: `Information`)                  |
| `template`    | string with `{1}`, `{2}`...           | Message content; `{N}` are placeholders for parameters |
| `parameters`  | array of Mendix expressions           | Values substituted into `{N}` in the template          |
| `blocking`    | `true` / `false`                      | `true` = modal (blocking), `false` = non-blocking      |

---

#### `ShowPage`

Open a page/form. Maps to `ShowPageAction`.

**Mendix 10 (legacy single-parameter form):**

```json
{
  "id": "act_showpage",
  "type": "ShowPage",
  "caption": "Open Edit Modal",
  "pageQualifiedName": "TestEntityMaintenance.Edit_Test_Entity_Modal",
  "passedObjectVariableName": "NewTestEntity"
}
```

**Mendix 9.7+ / Mendix 11 (modern multi-parameter form):**

```json
{
  "id": "act_showpage",
  "type": "ShowPage",
  "caption": "Open Edit Modal",
  "pageQualifiedName": "TestEntityMaintenance.Edit_Test_Entity_Modal",
  "parameterMappings": [
    { "parameterName": "TestEntity", "argument": "$NewTestEntity" }
  ]
}
```

**Dual-version dispatch (builder behaviour)**

The builder reads `model.metaModelVersion` to decide which slot to write:

| Spec input                                   | Mendix 10 (metamodel < 9.18)                                     | Mendix 11 (metamodel ≥ 9.18)                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `parameterMappings` present (any length > 0) | Writes `PageSettings.parameterMappings` (works on 9.7+)          | Writes `PageSettings.parameterMappings`                                                                           |
| Only `passedObjectVariableName`              | Writes the legacy `ShowPageAction.passedObjectVariableName` slot | **Auto-translates** to a single `parameterMappings` entry binding the page's first parameter to `$<variableName>` |
| Neither                                      | Page opens with no input (supported on both)                     | Page opens with no input                                                                                          |

The `passedObjectVariableName` property was deleted from the metamodel in 9.18.0; on Mendix 11 the builder uses `parameterMappings` so caller code that still passes the legacy field keeps working without changes. Prefer `parameterMappings` for new code — it works on both metamodels and supports pages with more than one parameter.

When `parameterMappings` is provided, each entry's `parameterName` must match the **name** of a `PageParameter` on the target page (validated after `page.load()`); `argument` is a microflow expression evaluated in the calling scope.

---

#### `ClosePage`

Close the currently displayed page/form and return to the previous page. Maps to `CloseFormAction`.

```json
{
  "id": "act_close",
  "type": "ClosePage",
  "caption": "Close Modal"
}
```

---

#### `ValidationFeedback`

Attach a validation error message to a specific attribute of an entity instance. Maps to `ValidationFeedbackAction`.

```json
{
  "id": "act_valid",
  "type": "ValidationFeedback",
  "caption": "String Attr Required",
  "objectVariable": "NewTestEntity",
  "attributeQualifiedName": "TestEntityMaintenance.TestEntity.StringAttr",
  "message": "String Attribute is required"
}
```

| Field                      | Description                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `objectVariable`           | **Required.** Variable name holding the object to validate.                                                                                               |
| `attributeQualifiedName`   | **Required** (exactly one of this or `associationQualifiedName`). QN of the attribute to display the error on (`Module.Entity.Attribute`).                |
| `associationQualifiedName` | **Required** (exactly one of this or `attributeQualifiedName`). Use instead of `attributeQualifiedName` when validating an association.                   |
| `message`                  | **Required.** Error message content (plain text). Empty/missing values are rejected — the builder throws rather than producing a blank Feedback template. |

---

#### `ExclusiveSplit` — Conditional Branch

Create a decision point. Supports two `conditionType` values: **boolean expression** (2 branches) or **enum split** (N branches per enum value). Maps to `ExclusiveSplit` + `ExpressionSplitCondition` / `EnumerationSplitCondition`.

> **Note:** `ExclusiveSplit` does not inherit from `ActionActivity` so it has no `backgroundColor`. Implementation ignores this field if provided.

**`conditionType: "Expression"` — Boolean split (2 branches)**

```json
{
  "id": "split_valid",
  "type": "ExclusiveSplit",
  "caption": "Is Form Valid?",
  "conditionType": "Expression",
  "condition": "$IsValid = true"
}
```

Flows:

```json
{ "from": "split_valid", "to": "act_save",    "condition": "true"  },
{ "from": "split_valid", "to": "act_invalid",  "condition": "false" }
```

**`conditionType: "Enumeration"` — Enum split (N branches)**

```json
{
  "id": "split_status",
  "type": "ExclusiveSplit",
  "caption": "Which Status?",
  "conditionType": "Enumeration",
  "condition": "$NewTestEntity/EnumAttr",
  "enumerationQualifiedName": "TestEntityMaintenance.EnumOptions"
}
```

Flows — each branch `condition` must be an **enumeration value name** (or `"[empty]"` for unset):

```json
{ "from": "split_status", "to": "act_option_a", "condition": "OptionA" },
{ "from": "split_status", "to": "act_option_b", "condition": "OptionB" },
{ "from": "split_status", "to": "act_default",  "condition": "[empty]" }
```

| Field                      | Description                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `conditionType`            | `"Expression"` (default) \| `"Enumeration"`                                          |
| `condition`                | Boolean expression (Expression) or expression returning an enum value (Enumeration)  |
| `enumerationQualifiedName` | Required when `conditionType: "Enumeration"` — QN of the enumeration (`Module.Enum`) |

> **Enumeration values in expressions:** when the target attribute or variable is enum-typed, the value MUST be the FQN constant (`Module.Enum.VALUE`), NOT a string literal (`'VALUE'`). The string-literal form is for XPath constraints only. See [`../rules/enum_value_in_expression.md`](../rules/enum_value_in_expression.md).

---

#### `LogMessage`

Write a message to the Mendix application log with a specified level. Maps to `LogMessageAction`.

```json
{
  "id": "act_log",
  "type": "LogMessage",
  "caption": "Log Error",
  "level": "Error",
  "node": "TestEntityMaintenance",
  "template": "Save failed for entity {1}: {2}",
  "parameters": ["$NewTestEntity/StringAttr", "$ErrorMessage"]
}
```

| Field        | Valid values                                                       | Description                                   |
| ------------ | ------------------------------------------------------------------ | --------------------------------------------- |
| `level`      | `Critical` \| `Error` \| `Warning` \| `Info` \| `Debug` \| `Trace` | Log level (default: `Info`)                   |
| `node`       | string                                                             | Log node name — use module name by convention |
| `template`   | string with `{1}`, `{2}`...                                        | Message template                              |
| `parameters` | array of Mendix expressions                                        | Values for placeholders in the template       |

---

#### `AggregateList`

Calculate an aggregate over a list: count, sum, average, min, max. Maps to `AggregateListAction`.

```json
{
  "id": "act_count",
  "type": "AggregateList",
  "caption": "Count TestEntities",
  "listVariableName": "TestEntityList",
  "aggregateFunction": "Count",
  "outputVariableName": "TotalCount"
}
```

Example — sum over an attribute:

```json
{
  "id": "act_sum",
  "type": "AggregateList",
  "caption": "Sum IntegerAttr",
  "listVariableName": "TestEntityList",
  "aggregateFunction": "Sum",
  "attributeQualifiedName": "TestEntityMaintenance.TestEntity.IntegerAttr",
  "outputVariableName": "TotalSum"
}
```

| Field                    | Valid values                                            | Description                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listVariableName`       | string                                                  | **Required.** Variable name of the list to aggregate. Empty/missing values are rejected — the builder throws rather than producing an AggregateList with a blank `List` field.                                                                                                                                                            |
| `aggregateFunction`      | `Count` \| `Sum` \| `Average` \| `Minimum` \| `Maximum` | Aggregate function. `Count` operates on the list itself and **must not** specify `attributeQualifiedName` (builder throws — Studio Pro `CE0016`).                                                                                                                                                                                         |
| `attributeQualifiedName` | string (FQN)                                            | Required for `Sum` / `Average` / `Minimum` / `Maximum`. The referenced attribute must be one of `Autonumber` / `Decimal` / `Integer` / `Long` — non-numeric attributes are rejected pre-flight (Studio Pro `CE0016: "Attribute must be of type Autonumber, Decimal, Integer, or Long."`). Forbidden when `aggregateFunction === "Count"`. |
| `outputVariableName`     | string                                                  | **Required.** Variable to receive the result (Decimal or Integer depending on function). Must be unique microflow-wide (CE0111 — see "Variable name uniqueness" near the top of this file).                                                                                                                                               |

---

#### `ListOperation`

Perform set/sort/check operations on a list. Maps to `ListOperationAction`.

> **SDK constraint — no `Filter` operation:** In the Mendix SDK, `ListOperationAction` does **not** support inline expression filtering. To filter a list, use one of two approaches:
>
> - `Retrieve` from Database with an `xpath` constraint (preferred — more efficient).
> - `LoopedActivity` + `ExclusiveSplit` + `ContinueEvent` to filter manually.
>   `filterExpression` is not declared in this spec.

```json
{
  "id": "act_sort",
  "type": "ListOperation",
  "caption": "Sort by StringAttr",
  "operation": "Sort",
  "listVariableName": "TestEntityList",
  "outputVariableName": "SortedList",
  "sortItems": [
    {
      "attributeQualifiedName": "TestEntityMaintenance.TestEntity.StringAttr",
      "order": "Ascending"
    }
  ]
}
```

```json
{
  "id": "act_contains",
  "type": "ListOperation",
  "caption": "List Contains Object?",
  "operation": "Contains",
  "listVariableName": "TestEntityList",
  "objectVariableName": "SingleEntity",
  "outputVariableName": "IsInList"
}
```

| `operation` | Additional parameters                                                                | `outputVariableName` | Return type |
| ----------- | ------------------------------------------------------------------------------------ | -------------------- | ----------- |
| `Union`     | `secondListVariableName` (string)                                                    | Required             | List        |
| `Intersect` | `secondListVariableName` (string)                                                    | Required             | List        |
| `Subtract`  | `secondListVariableName` (string)                                                    | Required             | List        |
| `Contains`  | `objectVariableName` (string — **single object**, not a list)                        | Required             | Boolean     |
| `Sort`      | `sortItems`: array of `{ attributeQualifiedName, order: "Ascending"\|"Descending" }` | Required             | List        |
| `Head`      | —                                                                                    | Required             | Object      |
| `Tail`      | —                                                                                    | Required             | List        |

> **`Contains` semantics:** checks whether a **single object** (`objectVariableName`) is contained in the list — not list-vs-list. Returns `Boolean`.

> **`outputVariableName`** is required for all operations. The output variable type depends on the operation (see "Return type" column above).

---

#### `LoopedActivity`

Loop over each element of a list. Maps to `LoopedActivity` in the Mendix SDK. `LoopedActivity` appears normally in the outer `flows` — it connects to other activities via its `id` like any other activity. Inside it contains its own sub-graph.

> **Important — a LoopedActivity has NO inner StartEvent.** This is the Mendix Studio Pro convention: every microflow has exactly one StartEvent at the outer level, and the iteration entry point of a loop is implicit (the first activity in `activities[]`, or the auto-generated breakSplit when `breakCondition` is set). The two valid terminal events INSIDE a loop body are:

| Inner event     | Keyword in inner `flows` | Meaning                                                                                                                                                                                                         |
| --------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ContinueEvent` | `"continue"`             | Ends the current iteration, **continues to the next element** (equivalent to `continue` in programming loops)                                                                                                   |
| `BreakEvent`    | `"break"`                | **Exits the loop** — control returns to the outer flow after the LoopedActivity (equivalent to `break` in programming loops). See [Mendix Break Event reference](https://docs.mendix.com/refguide/break-event). |

> **`"end"` is invalid inside a loop body.** Studio Pro consistency check rejects every `EndEvent` placed inside a `LoopedActivity` with `CE0068 "End events cannot be placed inside a loop"`. The keyword `"end"` is reserved for the **outer microflow's** terminal event only. For back-compat, the tool auto-rewrites any `to: "end"` in an inner-loop `flows` array to `to: "continue"` and emits a warning — but planners and spec authors should use `"break"` (early loop exit) or `"continue"` (normal iteration end) explicitly. See `specs/rules/looped_activity_terminators.md`.

> **Backwards compatibility:** The keyword `"start"` may still appear as a `from` in inner-loop `flows` (older specs use it to denote the entry activity), but the tool **silently drops** any `from: "start"` flow — no SequenceFlow is created. The destination of that dropped flow has no special meaning either; the implicit entry is always the first object in the inner ObjectCollection (which the tool guarantees is the breakSplit if present, otherwise the first user-declared activity).

> **Common pattern:** If processing each element sequentially without exiting the loop early, use `"to": "continue"`. Use `"to": "break"` when an early loop exit is needed.

**Example — simple loop (no early break):**

```json
{
  "id": "loop_entities",
  "type": "LoopedActivity",
  "caption": "For each TestEntity",
  "listVariableName": "TestEntityList",
  "iteratorVariableName": "SingleEntity",
  "activities": [
    {
      "id": "act_change_inner",
      "type": "ChangeObject",
      "caption": "Mark as Processed",
      "variable": "SingleEntity",
      "commit": "Yes",
      "refreshInClient": false,
      "memberChanges": [
        {
          "attributeQualifiedName": "TestEntityMaintenance.TestEntity.BooleanAttr",
          "changeType": "Set",
          "value": "true"
        }
      ]
    }
  ],
  "flows": [{ "from": "act_change_inner", "to": "continue" }]
}
```

> The first activity in `activities[]` (`act_change_inner` here) is the implicit entry. No `"from": "start"` flow is needed.

**Example — loop with `breakCondition` (early exit):**

```json
{
  "id": "loop_find",
  "type": "LoopedActivity",
  "caption": "Find First Active Entity",
  "listVariableName": "TestEntityList",
  "iteratorVariableName": "SingleEntity",
  "breakCondition": "$Found = true",
  "activities": [
    {
      "id": "split_active",
      "type": "ExclusiveSplit",
      "caption": "Is Active?",
      "conditionType": "Expression",
      "condition": "$SingleEntity/BooleanAttr = true"
    },
    {
      "id": "act_set_found",
      "type": "ChangeVariable",
      "caption": "Found = true",
      "variable": "Found",
      "value": "true"
    }
  ],
  "flows": [
    { "from": "start", "to": "split_active" },
    { "from": "split_active", "to": "act_set_found", "condition": "true" },
    { "from": "split_active", "to": "continue", "condition": "false" },
    { "from": "act_set_found", "to": "break" }
  ]
}
```

> When `breakCondition` is set, the auto-generated breakSplit becomes the implicit entry of the loop. The `"from": "start"` flow shown above tells the tool which activity is the loop body's entry (used to wire the breakSplit's `false` branch). Outside of the breakCondition case, `"from": "start"` flows are silently ignored. The example above flows to `"break"` after `act_set_found` because once the target entity has been found there is no reason to continue iterating — the loop should exit early.

| Field                  | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listVariableName`     | Yes      | Variable name of the list to iterate (must exist in outer scope)                                                                                                                                                                                                                                                                                                                                                                              |
| `iteratorVariableName` | Yes      | Iterator variable name for each element in the iteration                                                                                                                                                                                                                                                                                                                                                                                      |
| `breakCondition`       | No       | **Syntactic sugar** — tool auto-generates an inner `ExclusiveSplit` at the loop start: `true` branch → `BreakEvent` (exits the loop), `false` branch → first activity in `activities`. The Mendix SDK has no `breakCondition` property directly on `LoopedActivity`. Caller does not need to declare this ExclusiveSplit in the inner `activities`/`flows` — the tool generates and wires it automatically.                                   |
| `activities`           | Yes      | Array of `ActivitySpec` inside the loop — same schema as outer `activities`                                                                                                                                                                                                                                                                                                                                                                   |
| `flows`                | Yes      | Array of `FlowSpec` inside the loop. Terminal keywords: `"continue"` (next iteration → `ContinueEvent`) and `"break"` (exit loop → `BreakEvent`). The keyword `"end"` is **invalid** inside a loop body (Studio Pro CE0068); the tool auto-rewrites `to: "end"` to `to: "continue"` with a warning for back-compat. `"start"` is allowed as a `from` for backwards compatibility but is silently dropped except when `breakCondition` is set. |

> **Auto-layout inside loop:**
>
> - Calculates X/Y positions for the inner sub-graph.
> - Canvas size of `LoopedActivity` on the outer flow:
>   - `width = inner_activities_count × 220 + 100`
>   - `height = max(160, max_parallel_branches × 160)` — calculated from the deepest parallel branch count inside (ExclusiveSplit creates additional branches).

---

#### `RestCall`

Inline REST call (Mendix's generic "Call REST" activity). Use this when you do not have or do not want a `ConsumedRestService` document — the URL, HTTP method, request body, and response handler are all specified inline. Maps to `microflows.RestCallAction` with an embedded `HttpConfiguration`. Available since meta-model 6.6.0.

```json
{
  "id": "act_call_geo",
  "type": "RestCall",
  "caption": "Reverse geocode",
  "httpMethod": "GET",
  "url": "'https://api.example.com/geo/' + $Address/PostCode",
  "headers": [
    { "name": "Accept", "value": "'application/json'" },
    { "name": "X-Api-Key", "value": "$AppConfig/ApiKey" }
  ],
  "requestBody": {
    "type": "json",
    "rawExpression": "exportXMLToString('Module.EXM_Request', $Request)"
  },
  "responseHandling": {
    "type": "implicitMapping",
    "importMappingQualifiedName": "Module.IMM_GeoResponse",
    "rootObjectVariableName": "Geo"
  },
  "errorResultHandling": "Throw",
  "useRequestTimeout": true,
  "timeoutExpression": "30",
  "proxyConfiguration": "Default"
}
```

| Field                                         | Required | Description                                                                                                                |
| --------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `httpMethod`                                  | Yes      | One of `GET` `POST` `PUT` `PATCH` `DELETE` `HEAD` `OPTIONS`                                                                |
| `url`                                         | Yes      | MicroflowExpression evaluating to the full URL                                                                             |
| `headers[]`                                   | No       | Each header `{ name, value }`. `value` is a MicroflowExpression. Maps to `HeaderWithValueTemplate`                         |
| `requestBody.type`                            | No       | `none` `json` `binary` `formData` `custom` `advanced` (default: `none`). Bodies are only valid for `POST/PUT/PATCH/DELETE` |
| `requestBody.rawExpression`                   | No       | MicroflowExpression for `json` bodies                                                                                      |
| `requestBody.exportMappingQualifiedName`      | No       | When supplied with `type='json'`, switches to mapping-driven serialization (export mapping must exist via Tool 112)        |
| `requestBody.binarySource`                    | No       | Variable name holding a `System.FileDocument`/`Image`; required when `type='binary'`                                       |
| `requestBody.formFields[]`                    | No       | Required when `type='formData'`. Each item `{ name, value }` where `value` is a MicroflowExpression                        |
| `requestBody.customBuilderMicroflow`          | No       | Required when `type='custom'`. Microflow QN producing the raw body                                                         |
| `responseHandling.type`                       | No       | `none` `implicitMapping` (default: `none`)                                                                                 |
| `responseHandling.importMappingQualifiedName` | No       | Required when `type='implicitMapping'`. Import mapping must exist (Tool 111)                                               |
| `responseHandling.rootObjectVariableName`     | No       | Variable name for the deserialized root (default: import-mapping root entity short name)                                   |
| `errorResultHandling`                         | No       | `Throw` (default) `CustomWithoutRollback` `CustomWithRollback`                                                             |
| `useRequestTimeout`                           | No       | Boolean (default: false)                                                                                                   |
| `timeoutExpression`                           | No       | MicroflowExpression evaluating to a number of seconds; required when `useRequestTimeout=true`                              |
| `proxyConfiguration`                          | No       | `Default` (default) `None` `Custom`                                                                                        |

**Validation rules:**

- `requestBody.type !== 'none'` requires an HTTP method that allows a body. The builder throws on `GET/HEAD/OPTIONS` with a non-none body.
- Exactly one body-source field is allowed per `requestBody.type`. Combining `rawExpression` and `exportMappingQualifiedName` throws.
- When `responseHandling.type='implicitMapping'`, the response body is parsed and bound. The activity's output is the import mapping's root variable.

---

#### `RestOperationCall`

Typed call to an operation defined on a `ConsumedRestService` document. Use this whenever a service document exists (manually authored via Tool 99 or generated by Tool 98). Maps to `microflows.RestOperationCallAction`. Available since meta-model 10.1.0.

```json
{
  "id": "act_get_customer",
  "type": "RestOperationCall",
  "caption": "Get customer",
  "operationQualifiedName": "CRM.CrmApi.GetCustomer",
  "parameterMappings": [{ "parameter": "Id", "value": "$Order/CustomerId" }],
  "queryParameterMappings": [
    { "parameter": "include", "value": "'orders,addresses'" }
  ],
  "bodyVariable": null,
  "outputVariableName": "Customer"
}
```

| Field                      | Required | Description                                                                                                                                                                                      |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `operationQualifiedName`   | Yes      | QN of the operation defined under a `ConsumedRestService` (e.g. `CRM.CrmApi.GetCustomer`)                                                                                                        |
| `parameterMappings[]`      | Cond.    | One entry per path parameter; `parameter` matches the operation's `OperationParameter.name`; `value` is a MicroflowExpression. Required when the operation declares path parameters              |
| `queryParameterMappings[]` | Cond.    | One entry per query parameter, same shape. Required entries depend on `usage` (`required` vs `optional`) on the operation                                                                        |
| `bodyVariable`             | Cond.    | Variable name of the entity / list / file passed to the request body. Required only when the operation has a body and no inline expression is configured on the operation itself                 |
| `baseUrlParameterMapping`  | No       | When the service's base URL is template-parameterised (Mendix 10.17+), supply a `{ value }` MicroflowExpression to override per call                                                             |
| `outputVariableName`       | No       | Variable name to hold the parsed response object/list. Required when the operation's response handler emits a typed result (`ImplicitMappingResponseHandling`); ignored for `NoResponseHandling` |

**Validation rules:**

- The operation referenced in `operationQualifiedName` must already exist in the working copy at the time of microflow creation. The builder resolves it via `model.findRestOperationByQualifiedName` and throws if absent.
- Every required path parameter on the operation must have a matching `parameterMappings[]` entry. Missing entries throw with the list of unmatched parameters.
- Every `required` query parameter must have a matching `queryParameterMappings[]` entry. `optional` query parameters are mapped only when supplied.
- When the operation declares a body, `bodyVariable` is required unless the service-level body uses `exportMappingQualifiedName` with `$bodyParameter` resolved on the operation side.
- `outputVariableName` must be a valid Mendix variable name (PascalCase). Use `validate_name` if uncertain.

**Studio Pro serialization pitfall — truncated parameter QN on `RestOperationParameterMapping` / `QueryParameterMapping`.**
The SDK's typed setter `pm.parameter = target` writes `target.qualifiedName` into the underlying `__parameter` slot, which is then serialized into the .mpr as the `"parameter"` field. The catch: the SDK's `AbstractElement._getQualifiedName` walker only prepends container names whose class is `_declaredAsNamespace`, and **`Rest$RestOperation` is not flagged as a namespace** (only `Module`, `Folder`, `Entity`, and `AppService` are in 4.110.x). So an `OperationParameter` named `Id` under `Mod.Svc.GetCustomer` gets `target.qualifiedName === "Mod.Svc.Id"` — the operation segment is silently skipped. Studio Pro's deserializer cannot resolve the truncated QN, the `Parameter` field comes back null, and `set_ParameterId` throws on project load:

```
System.InvalidOperationException: An error occurred when trying to set the 'Parameter' property of a Rest operation parameter mapping in a Microflow with ID <guid>.
 ---> System.ArgumentNullException: Value cannot be null. (Parameter 'value')
   at Mendix.Modeler.Integration.RestOperationParameterMapping.set_ParameterId(OperationParameterIdentifier value)
```

The builder works around this by overwriting the slot with the **operation-prefixed full QN** via `__parameter.updateWithRawValue(`${loadedOp.qualifiedName}.${target.name}`)` immediately after the typed setter. The loaded operation's own `qualifiedName` is correct because `Rest$ConsumedRestService` IS a namespace. Same fix applies to `QueryParameterMapping.queryParameter`. If you change how `RestOperationCall` builds these mappings, preserve `healMappingQualifiedName()` and the corrected-QN computation, or any project committed without it will refuse to open in Studio Pro. Verified end-to-end by `mx-connect/scripts/diag_rest_mapping.mjs` (shows the SDK-computed QN is truncated) and `scripts/diag_test_fix.mjs` (shows the operation-prefixed QN loads cleanly).

---

### `FlowSpec` — Connections Between Activities

The `flows` array describes the arrows connecting activities on the microflow canvas. `start` and `end` are reserved keywords representing `StartEvent` and `EndEvent`.

```json
"flows": [
  { "from": "start",       "to": "act_create"   },
  { "from": "act_create",  "to": "act_commit"   },
  { "from": "act_commit",  "to": "split_valid"  },
  { "from": "split_valid", "to": "act_close",    "condition": "true"  },
  { "from": "split_valid", "to": "act_invalid",  "condition": "false" },
  { "from": "act_close",   "to": "end"          },
  { "from": "act_invalid", "to": "end"          }
]
```

| Field       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `from`      | `"start"` or the `id` of the source activity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `to`        | `"end"` or the `id` of the destination activity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `condition` | Branch condition label for outgoing flows from `ExclusiveSplit` (ignored for regular activities)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `branch`    | _(Optional, boolean)_ Layout-only override. `true` = draw this flow as a branch (downward, BOTTOM→TOP connection). `false` = draw as the main path (right, RIGHT→LEFT connection). When omitted, **per-split auto-classification** picks exactly one happy outgoing flow per decision (RIGHT→LEFT); every other outgoing flow on the same split becomes a branch (BOTTOM→TOP). Picking the happy flow, in precedence order: (a) if any flow targets a `ValidationFeedback`, the first non-VF sibling is happy; (b) otherwise the `"true"`-cased flow is happy. Explicit `branch` on any flow of a split disables auto-classification for that whole split — the caller controls all of its flows. |

> **Connection direction (auto-set by the tool):** every generated `SequenceFlow` carries `originConnectionIndex` and `destinationConnectionIndex` so Studio Pro renders the arrow on the right sides of the shapes:
>
> - **Main flow** (anything except an ExclusiveSplit's `false` branch by default, or whatever `branch` explicitly sets): leaves the **right** side of the origin (`originConnectionIndex = 1`) and enters the **left** side of the destination (`destinationConnectionIndex = 3`).
> - **Branch flow** (an ExclusiveSplit's `condition: "false"` outgoing flow by default, or whatever `branch: true` explicitly sets): leaves the **bottom** side of the origin (`originConnectionIndex = 2`) and enters the **top** side of the destination (`destinationConnectionIndex = 0`).
>
> Connection-index convention on a rectangular shape: `0 = Top`, `1 = Right`, `2 = Bottom`, `3 = Left`.

#### Inverted-happy-path validation (Mendix `empty($field)` pattern)

For a validation split like `empty($LeaveRequest/RequestedFor)`:

- `true` → the field is missing → **unhappy** path (show validation error)
- `false` → the field is present → **happy** path

The default convention would put the validation error on the main right line and the happy path drooping downward — visually inverted from the user's intent. Use `branch` to flip:

```json
"flows": [
  { "from": "split_empty",
    "to": "act_show_validation",
    "condition": "true",
    "branch": true   },
  { "from": "split_empty",
    "to": "act_save",
    "condition": "false",
    "branch": false  }
]
```

Result: the `false` (happy) flow runs straight right; the `true` (validation-failure) flow drops down — matching the canonical Mendix happy-path-right idiom. The `condition` field still controls the EnumerationCase label Studio Pro renders, so the runtime semantics are unchanged.

#### Auto-detection: flows to a `ValidationFeedback` action

When `branch` is omitted, classification is done **per split, not per flow**. For each decision (`ExclusiveSplit` / `InheritanceSplit`) the tool picks one happy outgoing flow — drawn straight right (RIGHT→LEFT) — and every other outgoing flow on the same split becomes a branch (BOTTOM→TOP). Picking the happy flow:

1. If any outgoing flow targets a `ValidationFeedback` activity AND at least one sibling does not, the first non-VF sibling is happy. ValidationFeedback is never the happy case.
2. Otherwise, the `"true"`-cased flow is happy (standard Mendix Expression-split convention).

Because classification is per-split, the happy case stays `RIGHT→LEFT` regardless of whether its `condition` is `"true"` or `"false"`. For example, in `empty($field)` → `true:VF, false:save`, the `false:save` flow is automatically classified as the happy case and drawn `RIGHT→LEFT` — no `branch` override needed.

Setting an explicit `branch` on any flow of a split disables this auto-classification for the entire split: every flow on that split uses its own explicit (or per-flow default) value. Precedence is therefore: **(1)** any explicit `branch` on the split → caller controls all of the split's flows → **(2)** per-split auto-classification described above.

#### Continuation after a `ValidationFeedback` action

When a `ValidationFeedback` is itself reached by a vertical (branch) flow and its only outgoing flow lands on an `EndEvent`, the layout **continues vertically**: the `EndEvent` is placed directly below the `ValidationFeedback` (`y += Y_STEP`) and the connecting flow is drawn `BOTTOM→TOP`. A `ValidationFeedback` reached horizontally keeps the default behavior — the `EndEvent` is placed to its right (`x += X_STEP`, `RIGHT→LEFT`).

This rule applies to the immediate `EndEvent` only; any other downstream activity follows the standard horizontal continuation.

---

### Behavior — Execution Steps

**Pre-flight checks (before creating any objects):**

1. Find module by `moduleName`. Throw if not found.
2. Check for duplicate `id` values in `activities` — throw immediately if duplicate found.
3. Check `flows` referencing an `id` not in `activities` — throw with the invalid id.
4. Check **graph integrity**:
   - **Dead end:** an activity in `activities` has no outgoing flow (except `end`) → throw with activity id.
   - **Unreachable:** an activity has no incoming flow (except `start`) → throw.
   - **Cycle outside LoopedActivity:** cycle detected in the outer flow graph → throw (cycles are only valid inside `LoopedActivity`).
5. Check each `ExclusiveSplit`: must have at least 2 outgoing flows, each flow must have `condition`. Throw if missing. For `conditionType: "Enumeration"`: resolve enumeration via `enumerationQualifiedName`, get all `value.name` entries, validate that each `condition` in outgoing flows is one of those names or `"[empty]"` — throw immediately if no match, including the invalid value and the list of valid values.
6. **Validate `returnVariableName`** (if `returnType` is not `Void`): the name must appear in at least one of:
   - `parameters[].name`
   - `activities[].outputVariableName`
   - `activities[].variableName` (from `CreateVariable`)
   - If not found → throw: `"returnVariableName '${name}' is not defined in any parameter or activity output."`

**Creating the microflow:**

7. If a microflow with the same name already exists:
   - `overwrite: false` (default): return `alreadyExisted: true`, stop.
   - `overwrite: true`: delete the old microflow, proceed to create new.
8. Create `microflows.Microflow.createIn(module)`, set `name`, `documentation`, `allowConcurrentExecution`, `applyEntityAccess`.
9. Create `MicroflowParameter` for each entry in `parameters`, map `type` → `datatypes.DataType`.
10. Set `microflowReturnType` per `returnType`. Set `returnVariableName` if provided.
11. Create `StartEvent` and `EndEvent` in `microflow.objectCollection`.
12. For each activity in `activities` (in declaration order):
    - `ExclusiveSplit`: create `microflows.ExclusiveSplit` + `ExpressionSplitCondition` or `EnumerationSplitCondition`. Ignore `backgroundColor`.
    - `LoopedActivity`: create `microflows.LoopedActivity`, set `iteratedListVariableName`. If `breakCondition` is provided: **auto-generate** an inner `ExclusiveSplit` (not in the input `activities`) with `ExpressionSplitCondition.expression = breakCondition`; `true` branch wires to inner `EndEvent`; `false` branch wires to `StartEvent`/first activity per inner `flows`. Recursively process inner `activities` and `flows`: `"start"` → inner `StartEvent`; `"continue"` → inner `ContinueEvent`; `"end"` → inner `EndEvent` (break loop early).
    - All others: create `ActionActivity`, create the corresponding action class (`CreateObjectAction`, `LogMessageAction`...), assign to `activity.action`, set `backgroundColor` if provided.
    - Resolve all qualified names immediately at this step (`findEntityByQualifiedName`, `findAttributeByQualifiedName`, `findEnumerationByQualifiedName`...). Throw immediately if not found.
13. For each flow in `flows`:
    - Resolve origin/destination (`"start"` → `StartEvent`, `"end"` → `EndEvent`, id → corresponding activity).
    - Create `SequenceFlow.createIn(microflow)`, assign `origin`, `destination`.
    - Assign `condition` label if provided.
14. **Auto-layout** — set positions via `relativeMiddlePoint`:
    - `StartEvent` at `(0, 0)`. Walk the **main flow** (every flow except a `condition: "false"` outgoing of an `ExclusiveSplit`) horizontally to the right at `y = 0`, advancing `x` by `220` per step.
    - For each `ExclusiveSplit` encountered on the main path: lay out its **FALSE branch** starting at `(splitX, +160)` and walk its main flow horizontally to the right. If a FALSE branch itself contains an `ExclusiveSplit`, its FALSE branch is placed one row deeper (`y += 160` recursively).
    - Each `EndEvent` lands at the natural `(x, y)` where its incoming flow terminates — main-path EndEvents at `y = 0`, branch-path EndEvents at the row of their branch.
    - Connection indices on every `SequenceFlow` are set per the rule above (main = `1, 3`; FALSE branch = `2, 0`).
    - **Inner-loop layout** (`LoopedActivity` body): no inner `StartEvent`. The first object in the inner ObjectCollection (breakSplit if present, else first user activity) is the implicit entry. Inner activities are placed starting at `(85, 100)` inside the loop's local coordinate system. `ContinueEvent` is created last and appears to the right of the body activities.
    - `LoopedActivity` size on the outer canvas: `228 × 200`.
    - Parameters: stacked vertically above the StartEvent at `x = -2`, starting `y = -170` and stepping `+84` per parameter.

---

### Output

Returns plain text (MCP `textResult`). Three variants:

```
# Creating new or replacing (overwrite):
Microflow <created|replaced>: <moduleName>.<microflowName>
Activities: <count>
Parameters: <count>
Warnings:
  - <warning 1>
  - <warning 2>

# Microflow already exists, overwrite: false (no-op):
Microflow "<moduleName>.<microflowName>" already exists — no changes made.
```

- First line uses `created` for new creation, `replaced` if `overwrite: true` deleted/recreated the old microflow.
- `Warnings:` section only appears when there is at least one warning.

| Internal field   | Description                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `alreadyExisted` | `true` if microflow existed and `overwrite: false` — emits the "already exists" variant                                            |
| `overwritten`    | `true` if microflow was deleted and recreated due to `overwrite: true` — first line uses `replaced`                                |
| `warnings`       | Array of non-blocking warnings (naming convention, `outputVariableName` on Void callee, etc.) — rendered under `Warnings:` section |

---

### Error Cases

| Condition                                                                                                           | Behavior                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module does not exist                                                                                               | Throw with available module list                                                                                                                                                                                                                                                              |
| Duplicate `id` in `activities`                                                                                      | Throw: `"Duplicate activity id: '${id}'"` — pre-flight                                                                                                                                                                                                                                        |
| `flows` references `id` not in `activities`                                                                         | Throw with the invalid id — pre-flight                                                                                                                                                                                                                                                        |
| Activity has no incoming flow (except `start`)                                                                      | Throw: `"Unreachable activity: '${id}'"` — pre-flight                                                                                                                                                                                                                                         |
| Activity has no outgoing flow (except `end`)                                                                        | Throw: `"Dead-end activity: '${id}'"` — pre-flight                                                                                                                                                                                                                                            |
| Cycle in flow outside `LoopedActivity`                                                                              | Throw: `"Cycle detected involving activity '${id}'"` — pre-flight                                                                                                                                                                                                                             |
| `ExclusiveSplit` flow missing `condition`                                                                           | Throw — pre-flight                                                                                                                                                                                                                                                                            |
| `ExclusiveSplit` has fewer than 2 outgoing flows                                                                    | Throw — pre-flight                                                                                                                                                                                                                                                                            |
| `ExclusiveSplit` enum flow `condition` is not a valid enumeration value name                                        | Throw: `"Invalid enum condition '${val}' for split '${id}'. Valid values: [OptionA, OptionB, ...]"` — pre-flight                                                                                                                                                                              |
| `returnVariableName` not found in scope                                                                             | Throw: `"returnVariableName '${name}' is not defined in any parameter or activity output"` — pre-flight                                                                                                                                                                                       |
| `entityQualifiedName` not found                                                                                     | Throw at activity processing, with context (activity id)                                                                                                                                                                                                                                      |
| `attributeQualifiedName` not found                                                                                  | Throw with context (activity id, attribute FQN provided)                                                                                                                                                                                                                                      |
| `enumerationQualifiedName` not found                                                                                | Throw with context (ExclusiveSplit activity id)                                                                                                                                                                                                                                               |
| `microflowQualifiedName` not found                                                                                  | Throw with context (`CallMicroflow` activity id)                                                                                                                                                                                                                                              |
| `AggregateList` missing `attributeQualifiedName` when not `Count`                                                   | Throw                                                                                                                                                                                                                                                                                         |
| `AggregateList` has `attributeQualifiedName` AND `aggregateFunction === "Count"`                                    | Throw — pre-flight: `"function 'Count' must not specify 'attributeQualifiedName' — Count operates on the list itself. Studio Pro would reject this as CE0016."`                                                                                                                               |
| `AggregateList` Sum/Average/Minimum/Maximum bound to a non-numeric attribute                                        | Throw — pre-flight: `"function '<fn>' requires a numeric attribute (Autonumber, Decimal, Integer, or Long). Attribute '<QN>' is '<actualType>'. Studio Pro would reject this as CE0016."`                                                                                                     |
| Duplicate variable name across activities (and/or parameters)                                                       | Throw — pre-flight: `"duplicate variable name '<name>' declared by <a-id> and <b-id>. Microflow variable names must be unique across all activities (including LoopedActivity inner activities). Studio Pro would reject this as CE0111."` Walks LoopedActivity inner activities recursively. |
| `errorHandlingType` value outside the mode-specific allow-list                                                      | Throw: `"errorHandlingType "<value>" is not supported in <mode> context. Allowed values: <list>. Studio Pro would reject this as CE6035."` See the table above.                                                                                                                               |
| `errorHandlingType: "Continue"` set on an activity that is not `CallMicroflow` or `LoopedActivity` (microflow mode) | Throw: `"errorHandlingType "Continue" is only allowed on "CallMicroflow" or "LoopedActivity" in microflow context (got "<type>"). Studio Pro would reject this as CE6035."`                                                                                                                   |
| `errorHandlingType: "Custom"` or `"CustomWithoutRollBack"` set on any activity                                      | Warning: `"errorHandlingType "<value>" requires a separate error-handler flow which the builder does not yet wire. Add it manually in Studio Pro, or change to "Rollback" / "Abort" / "Continue"."`                                                                                           |
| `LoopedActivity.listVariableName` not in scope                                                                      | Throw with hint (list of variables in scope at that point)                                                                                                                                                                                                                                    |
| `ListOperation.Contains` has `secondListVariableName` instead of `objectVariableName`                               | Throw: `"Contains requires objectVariableName (single object), not secondListVariableName"`                                                                                                                                                                                                   |
| `ListOperation` missing `outputVariableName`                                                                        | Throw — `outputVariableName` is required for all operations                                                                                                                                                                                                                                   |
| `LoopedActivity` inner flow uses `"end"` (any occurrence)                                                           | Warning + auto-rewrite to `"continue"`: `"LoopedActivity '<id>': flow {from: ..., to: \"end\"} is illegal inside a loop (Studio Pro CE0068). Auto-rewrote to {to: \"continue\"}. Use {to: \"break\"} for early loop exit."` See `specs/rules/looped_activity_terminators.md`.                 |
| `LoopedActivity` inner activity has no inbound flow (CE0102 orphan)                                                 | Throw with the orphan list and a `{from: "<prev>", to: "<orphan>"}` hint — pre-flight                                                                                                                                                                                                         |
| `CallMicroflow` has `outputVariableName` but callee returns `Void`                                                  | Warning (no throw): `"outputVariableName set but callee '${qn}' returns Void"`                                                                                                                                                                                                                |
| `ShowPage.passedObjectVariableName` does not match the page's data source                                           | Warning (no throw): entity context verification is the caller's responsibility                                                                                                                                                                                                                |
| `ShowPage.passedObjectVariableName` provided on Mendix metamodel ≥ 9.18 but target page has no parameters           | Throw: `"ShowPage activity '<id>' was given 'passedObjectVariableName=...' but page '<QN>' has no parameters on metamodel ≥ 9.18. Provide explicit 'parameterMappings' instead."` (auto-translation needs at least one page parameter)                                                        |
| `ShowPage.parameterMappings[i].parameterName` not found on target page                                              | Throw with the list of available parameter names: `"Page parameter '<name>' not found on '<QN>' [activity '<id>']. Available: ..."`                                                                                                                                                           |

---

### Example 1 — `ACT_TestEntity_Save` (boolean split + logging)

```json
{
  "moduleName": "TestEntityMaintenance",
  "microflowName": "ACT_TestEntity_Save",
  "documentation": "Validate and commit a TestEntity. Returns true on success.",
  "returnType": { "type": "Boolean" },
  "returnVariableName": "Success",
  "applyEntityAccess": true,
  "parameters": [
    {
      "name": "NewTestEntity",
      "type": {
        "type": "Object",
        "entityQualifiedName": "TestEntityMaintenance.TestEntity"
      }
    }
  ],
  "activities": [
    {
      "id": "act_validate",
      "type": "CallMicroflow",
      "caption": "Validate TestEntity",
      "backgroundColor": "Blue",
      "microflowQualifiedName": "TestEntityMaintenance.VAL_TestEntity_Validate",
      "outputVariableName": "IsValid",
      "parameterMappings": [
        { "parameterName": "NewTestEntity", "argument": "$NewTestEntity" }
      ]
    },
    {
      "id": "split_valid",
      "type": "ExclusiveSplit",
      "caption": "Is Valid?",
      "conditionType": "Expression",
      "condition": "$IsValid = true"
    },
    {
      "id": "act_commit",
      "type": "CommitObject",
      "caption": "Commit TestEntity",
      "backgroundColor": "Green",
      "variable": "NewTestEntity",
      "withEvents": true,
      "refreshInClient": true
    },
    {
      "id": "act_close",
      "type": "ClosePage",
      "caption": "Close Modal"
    },
    {
      "id": "act_set_success",
      "type": "CreateVariable",
      "caption": "Success = true",
      "variableName": "Success",
      "variableType": { "type": "Boolean" },
      "initialValue": "true"
    },
    {
      "id": "act_log_fail",
      "type": "LogMessage",
      "caption": "Log Validation Failure",
      "level": "Warning",
      "node": "TestEntityMaintenance",
      "template": "Validation failed for TestEntity {1}",
      "parameters": ["$NewTestEntity/AutoNumberAttr"]
    },
    {
      "id": "act_set_fail",
      "type": "CreateVariable",
      "caption": "Success = false",
      "variableName": "Success",
      "variableType": { "type": "Boolean" },
      "initialValue": "false"
    }
  ],
  "flows": [
    { "from": "start", "to": "act_validate" },
    { "from": "act_validate", "to": "split_valid" },
    { "from": "split_valid", "to": "act_commit", "condition": "true" },
    { "from": "split_valid", "to": "act_log_fail", "condition": "false" },
    { "from": "act_commit", "to": "act_close" },
    { "from": "act_close", "to": "act_set_success" },
    { "from": "act_set_success", "to": "end" },
    { "from": "act_log_fail", "to": "act_set_fail" },
    { "from": "act_set_fail", "to": "end" }
  ]
}
```

---

### Example 2 — `ACT_TestEntity_BulkUpdate` (LoopedActivity + AggregateList)

```json
{
  "moduleName": "TestEntityMaintenance",
  "microflowName": "ACT_TestEntity_BulkUpdate",
  "documentation": "Retrieve all TestEntities, count them, then loop and mark BooleanAttr = true.",
  "returnType": { "type": "Integer" },
  "returnVariableName": "TotalCount",
  "applyEntityAccess": true,
  "parameters": [],
  "activities": [
    {
      "id": "act_retrieve",
      "type": "Retrieve",
      "caption": "Retrieve All TestEntities",
      "outputVariableName": "TestEntityList",
      "source": {
        "type": "Database",
        "entityQualifiedName": "TestEntityMaintenance.TestEntity",
        "range": { "type": "All" }
      }
    },
    {
      "id": "act_count",
      "type": "AggregateList",
      "caption": "Count Entities",
      "listVariableName": "TestEntityList",
      "aggregateFunction": "Count",
      "outputVariableName": "TotalCount"
    },
    {
      "id": "loop_update",
      "type": "LoopedActivity",
      "caption": "For each TestEntity",
      "listVariableName": "TestEntityList",
      "iteratorVariableName": "SingleEntity",
      "activities": [
        {
          "id": "act_change_inner",
          "type": "ChangeObject",
          "caption": "Mark BooleanAttr = true",
          "variable": "SingleEntity",
          "commit": "Yes",
          "refreshInClient": false,
          "memberChanges": [
            {
              "attributeQualifiedName": "TestEntityMaintenance.TestEntity.BooleanAttr",
              "changeType": "Set",
              "value": "true"
            }
          ]
        }
      ],
      "flows": [
        { "from": "start", "to": "act_change_inner" },
        { "from": "act_change_inner", "to": "continue" }
      ]
    }
  ],
  "flows": [
    { "from": "start", "to": "act_retrieve" },
    { "from": "act_retrieve", "to": "act_count" },
    { "from": "act_count", "to": "loop_update" },
    { "from": "loop_update", "to": "end" }
  ]
}
```

---

---

<!-- END TOOL 25: create_microflow -->

<!-- BEGIN TOOL 26: create_microflow_activities -->

## Tool 26: `create_microflow_activities`

Create one or more new activities appended to the end of an existing microflow. Unlike `create_microflow` (creates the entire microflow from scratch), this tool **appends** activities to an existing microflow without destroying the current structure.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first, and the microflow must already exist in the working copy.

---

### Input

```json
{
  "moduleName": "string (optional) — Module containing the microflow. Required if microflowName is a short name.",
  "microflowName": "string (required) — Microflow name or qualified name.",
  "activities": [
    {
      "activity_type": "string (required) — Activity type. See Activity Types table below.",
      "activity_config": { ... }
    }
  ]
}
```

**Activity Types table (`activity_type`):**

| `activity_type`                       | Equivalent in `create_microflow` | Description                                               |
| ------------------------------------- | -------------------------------- | --------------------------------------------------------- |
| `create_object`                       | `CreateObject`                   | Create a new entity instance                              |
| `create_variable`                     | `CreateVariable`                 | Create a primitive variable (String, Integer, Boolean...) |
| `change_object`                       | `ChangeObject`                   | Change properties of an entity instance                   |
| `change_variable`                     | `ChangeVariable`                 | Change the value of a primitive variable                  |
| `commit`                              | `CommitObject`                   | Persist an entity instance to the database                |
| `rollback`                            | —                                | Rollback uncommitted changes                              |
| `delete`                              | `DeleteObject`                   | Delete an entity instance                                 |
| `retrieve` / `retrieve_from_database` | `Retrieve` (Database)            | Query from the database                                   |
| `retrieve_by_association`             | `Retrieve` (Association)         | Retrieve via association                                  |
| `microflow_call`                      | `CallMicroflow`                  | Call another microflow                                    |
| `change_list`                         | `ListOperation`                  | List operations (add/remove/clear/set)                    |
| `sort_list`                           | `ListOperation` (Sort)           | Sort a list                                               |
| `find_in_list`                        | `ListOperation` (Head-like)      | Find an element in a list                                 |
| `aggregate_list`                      | `AggregateList`                  | Aggregate calculations (count/sum/avg...)                 |
| `show_message`                        | `ShowMessage`                    | Display a message popup                                   |
| `log_message`                         | `LogMessage`                     | Write to log                                              |
| `union_lists`                         | `ListOperation` (Union)          | Merge two lists                                           |
| `subtract_lists`                      | `ListOperation` (Subtract)       | Subtract two lists                                        |
| `intersect_lists`                     | `ListOperation` (Intersect)      | Intersect two lists                                       |
| `contains_in_list`                    | `ListOperation` (Contains)       | Check if object is in list                                |
| `head_of_list`                        | `ListOperation` (Head)           | Get the first element of a list                           |
| `tail_of_list`                        | `ListOperation` (Tail)           | Get the remaining elements of a list                      |

> **Not supported:** `create_list` (no equivalent SDK action — use `retrieve_from_database` with XPath returning an empty list instead), `filter_list` (no SDK action — use XPath in `retrieve_from_database` instead), `reduce_list` (no SDK action — use `aggregate_list` instead).

> **Not supported:** `ExclusiveSplit` and `LoopedActivity` — these complex branching structures are only supported via `create_microflow` with a declarative `flows` graph. Use `create_microflow` (overwrite) to recreate the microflow with branching logic.

> **Note:** `create_variable` creates `CreateVariableAction` (primitive variable), `create_object` creates `CreateObjectAction` (entity object) — these are two distinct actions in the SDK.

**`activity_config` for common types:**

```json
// create_object
{
  "entity": "Module.EntityName",
  "variableName": "NewObject",
  "commit": "No",
  "refresh_in_client": false,
  "initial_values": [
    { "attribute": "Module.Entity.Attr", "value": "$Param/Attr" }
  ]
}

// change_object
{
  "variable": "ExistingObject",
  "commit": "Yes",
  "refresh_in_client": true,
  "changes": [
    { "attribute": "Module.Entity.Attr", "value": "'NewValue'" }
  ]
}

// retrieve_from_database
{
  "entity": "Module.Entity",
  "output_variable": "ResultList",
  "xpath": "[BooleanAttr = true()]",
  "range": "All"
}

// retrieve_by_association
{
  "association_name": "Module.Entity_Related",
  "output_variable": "RelatedObj",
  "input_variable": "CurrentObj",
  "module_name": "Module"
}

// microflow_call
{
  "microflow_name": "Module.ACT_DoSomething",
  "return_variable": "Result",
  "parameters": [
    { "name": "InputEntity", "value": "$CurrentObj" }
  ]
}

// aggregate_list
{
  "list_variable": "EntityList",
  "function": "Count",
  "output_variable": "TotalCount"
}
// "Count" must NOT carry an "attribute" key (CE0016). Non-Count functions
// require "attribute" pointing at a numeric attribute (Autonumber/Decimal/
// Integer/Long). Builder rejects non-numeric attributes pre-flight.

// log_message
{
  "level": "Info",
  "node": "Module",
  "template": "Processing entity {1}",
  "parameters": ["$CurrentObj/Name"]
}

// show_message
{
  "messageType": "Error",
  "template": "Validation failed: {1}",
  "parameters": ["$ErrorMsg"],
  "blocking": true
}
```

> **Mendix expressions:** Use single quotes for string literals (`'text'`), not double quotes. The tool auto-converts double quotes → single quotes when detected.

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Resolve microflow: qualified name first → moduleName + short name → scan all modules with `fromAppStore === false`. Throw if not found.
3. `await microflow.load()` + `await microflow.objectCollection.load()`.
4. **Pre-flight validation:** Iterate all `activities` before creating anything — resolve all qualified names (`entity`, `attribute`, `microflow_name`). Throw immediately if any QN is not found, including the activity index and invalid QN name. Do not create partial state.
5. For each activity in `activities` (in declaration order):
   - Parse `activity_type` → create `ActionActivity` + corresponding action class (see table).
   - Set configuration from `activity_config`: entity, variable names, expressions, member changes.
   - Append object to `microflow.objectCollection` (using `createIn(oc)` — appends).
6. **Does not** create `SequenceFlow` automatically — caller must ensure the flow graph is valid after appending.

> **Warning:** Activities are appended to the end of `objectCollection` but **have no** `SequenceFlow` connecting them. Studio Pro will display them as "floating" (unconnected). For a complete flow, use `create_microflow` with declarative `activities` + `flows` from the start, or ensure the caller creates `SequenceFlow` separately after appending.

7. No flush, no commit — caller must call `commit_working_copy`.

---

### Output

Returns plain text (MCP `textResult`):

```
Added <count> activities to microflow '<moduleName>.<microflowName>':
  [<pos>] <ActivityType> — <caption or entity/variable>
  ...
(Changes are not committed — call commit_working_copy when done.)
```

Where `<pos>` is the 1-based position of the new activity in `objectCollection.objects` after appending (= old object count + order in batch).

---

### Error Cases

| Condition                                   | Behavior                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| No working copy is open                     | Throw: `"No working copy is open in this session. Call open_working_copy first."` |
| Microflow not found                         | Throw: `"Microflow '<name>' not found."`                                          |
| `activities` is an empty array              | Throw: `"activities array must contain at least one entry."`                      |
| `activity_type` is invalid                  | Throw: `"Unknown activity_type '<value>'. See supported types."`                  |
| Entity / attribute / microflow QN not found | Throw at the failing activity, with context (index in input array)                |

---

<!-- END TOOL 26: create_microflow_activities -->

<!-- BEGIN TOOL 69: modify_microflow_activity -->

## Tool 69: `modify_microflow_activity`

Modify the properties of an existing activity in a microflow by position (1-based). Use `read_microflow_details` first to determine the exact position of the activity to modify.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "microflowName": "string (required) — Microflow name or qualified name.",
  "moduleName": "string (optional) — Module containing the microflow.",
  "position": "integer (required) — 1-based position of the activity to modify (from read_microflow_details).",
  "caption": "string (optional) — New caption for the activity.",
  "disabled": "boolean (optional) — Set the disabled state of the activity.",
  "output_variable": "string (optional) — New output variable name (create_object, retrieve, aggregate_list, microflow_call).",
  "commit": "string (optional) — New commit mode: Yes | YesWithoutEvents | No (create_object, change_object).",
  "refresh_in_client": "boolean (optional) — Update refresh_in_client (create_object, change_object, commit).",
  "with_events": "boolean (optional) — Set with_events for commit action.",
  "use_return_variable": "boolean (optional) — Set use return variable for microflow_call action.",
  "commit_variable": "string (optional) — Variable name for commit action.",
  "rollback_variable": "string (optional) — Variable name for rollback action.",
  "delete_variable": "string (optional) — Variable name for delete action.",
  "change_variable": "string (optional) — Variable name for change_object action."
}
```

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Resolve microflow. `await microflow.load()` + `await microflow.objectCollection.load()`.
3. Get the activity at `position` (1-based) from `objectCollection.objects`. Throw if `position` is out of range.
4. Check the object type at `position`: if it is `StartEvent` or `EndEvent`, throw immediately — terminal events cannot be modified.
5. Check activity type to determine which fields are valid:
   - `caption`: valid for `ActionActivity`, `ExclusiveSplit`, `LoopedActivity` (not applicable to `StartEvent`/`EndEvent`).
   - `disabled`: valid for `ActionActivity` and `ExclusiveSplit` (not applicable to `LoopedActivity`, `StartEvent`, `EndEvent`).
   - `output_variable`: only valid for `CreateObjectAction`, `RetrieveAction`, `AggregateListAction`, `MicroflowCallAction`. SDK property: `action.outputVariableName`.
   - `commit`: only valid for `CreateObjectAction`, `ChangeObjectAction`. SDK property: `action.commit` (CommitEnum).
   - `refresh_in_client`: only valid for `CreateObjectAction`, `ChangeObjectAction`, `CommitAction`. SDK property: `action.refreshInClient`.
   - `with_events`: only valid for `CommitAction`. SDK property: `action.withEvents`.
   - `commit_variable` / `rollback_variable` / `delete_variable` / `change_variable`: SDK property `action.variableName` of the corresponding action (`CommitAction`, `RollbackAction`, `DeleteAction`, `ChangeObjectAction`).
   - `use_return_variable`: valid for `MicroflowCallAction`. SDK property: `action.useReturnVariable`.
6. For each provided and valid field, set the corresponding value on the action object.
7. Throw if the field is not compatible with the activity type at `position`, including the activity type currently present.
8. **Note:** The positions of other activities in `objectCollection` do not change after modify — only the properties of the activity at `position` are updated.
9. No flush, no commit — caller must call `commit_working_copy`.

---

### Output

Returns plain text (MCP `textResult`):

```
Modified activity at position <position> in '<moduleName>.<microflowName>' (<ActivityType>):
  caption: "<new>"
  disabled: <bool>
  output_variable: "<new>"
  ...
(Changes are not committed — call commit_working_copy when done.)
```

Only lists fields that were actually changed.

---

### Error Cases

| Condition                                       | Behavior                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| No working copy is open                         | Throw: `"No working copy is open in this session. Call open_working_copy first."`       |
| Microflow not found                             | Throw: `"Microflow '<name>' not found."`                                                |
| `position` is out of range                      | Throw: `"Position <n> is out of range. Microflow has <count> objects (1-based)."`       |
| `position` points to `StartEvent` or `EndEvent` | Throw: `"Cannot modify StartEvent/EndEvent at position <n>."`                           |
| Field not compatible with activity type         | Throw: `"Field '<field>' is not applicable to activity type '<type>' at position <n>."` |
| No fields provided to modify                    | Throw: `"No fields to modify. Provide at least one property to update."`                |

---

<!-- END TOOL 69: modify_microflow_activity -->

<!-- BEGIN TOOL 70: insert_before_activity -->

## Tool 70: `insert_before_activity`

Insert a new activity before a specific position in a microflow. Use `read_microflow_details` to determine the exact `before_position`. Activity format is the same as `create_microflow_activities`.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

> **Note:** Position numbers in `read_microflow_details` reflect creation order, not necessarily the visual order on the canvas. Always verify positions after insertion by calling `read_microflow_details` again.

---

### Input

```json
{
  "microflowName": "string (required) — Microflow name or qualified name.",
  "moduleName": "string (optional) — Module containing the microflow.",
  "before_position": "integer (required) — 1-based position of the activity to insert before.",
  "activity": {
    "activity_type": "string (required) — Activity type (see Activity Types table in Tool 35, e.g.: 'log_message', 'create_object').",
    "... configuration fields per type (same as activity_config in Tool 35) ..."
  }
}
```

**Activity format:** uses `activity_type` field (same as Tool 35 `create_microflow_activities`), with corresponding configuration fields at the same level.

Example:

```json
{
  "microflowName": "TestEntityMaintenance.ACT_TestEntity_Save",
  "before_position": 3,
  "activity": {
    "activity_type": "log_message",
    "level": "Info",
    "node": "TestEntityMaintenance",
    "template": "Pre-save hook triggered"
  }
}
```

> **Edge case warning:** `before_position = 1` inserts before `StartEvent` — valid in terms of position but usually unintended. `before_position = N+1` (N = current object count) is equivalent to appending — use `create_microflow_activities` instead.

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Resolve microflow: qualified name first → if `moduleName` provided, search that module → if no `moduleName`, scan all modules with `fromAppStore === false`, return first match. `await microflow.load()` + `await microflow.objectCollection.load()`.
3. Validate `before_position` is within valid range (1 ≤ `before_position` ≤ `oc.objects.length + 1`). Throw if out of range.
4. Parse `activity.activity_type` → validate it is valid. Throw if not in Activity Types from Tool 35.
5. Resolve qualified names in config (entity, attribute, microflow). Throw immediately if not found, including the invalid QN name.
6. **Create activity using detached-then-splice pattern:**
   ```
   const act = ActionActivity.create(model);   // DO NOT use createIn(oc)
   act.action = <action>;                       // set action before splicing
   oc.objects.splice(before_position - 1, 0, act);
   ```
   **Reason:** `createIn(oc)` marks the element as "attached" — `PartListProperty.checkAddedItem` will throw when splicing. Creating detached first then splicing works correctly.
7. **Does not** create or update `SequenceFlow` automatically — caller is responsible for ensuring the flow graph is valid after insertion. Use `read_microflow_details` after insert to verify positions.
8. No flush, no commit — caller must call `commit_working_copy`.

---

### Output

Returns plain text (MCP `textResult`):

```
Inserted <ActivityType> activity before position <before_position> in '<moduleName>.<microflowName>'.
New activity is now at position <before_position> (activities after it shifted by +1).
Total objects in objectCollection: <new_count>.
(Changes are not committed — call commit_working_copy when done.)
```

---

### Error Cases

| Condition                                   | Behavior                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| No working copy is open                     | Throw: `"No working copy is open in this session. Call open_working_copy first."` |
| Microflow not found                         | Throw: `"Microflow '<name>' not found."`                                          |
| `before_position` is out of range           | Throw: `"before_position <n> is out of range. Valid range: 1–<max>."`             |
| `activity.activity_type` is invalid         | Throw: `"Unknown activity_type '<value>'. See supported types in Tool 35."`       |
| Entity / attribute / microflow QN not found | Throw with context (field and QN not found)                                       |

---

<!-- END TOOL 70: insert_before_activity -->

<!-- BEGIN TOOL 77: update_microflow -->

## Tool 77: `update_microflow`

Update properties of an existing microflow in the working copy: return type, return variable name, and REST endpoint URL. Only updates fields that are provided.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

> **EndEvent.returnValue is auto-synchronised (Class 3 fix).** When `returnType` or `returnVariableName` changes, the tool walks every top-level `EndEvent` in the microflow and rewrites `returnValue` to `$<effectiveReturnVariableName>` (non-Void) or `""` (Void). Previously the tool only emitted a soft warning, which produced Studio Pro `CE0067 "End event return value missing"` whenever the planner changed a Void microflow to a value-returning one. See `defect_reports/Open/builder-output-fails-mx-check.md` "Class 3". `LoopedActivity` bodies are intentionally skipped because Studio Pro `CE0068` forbids `EndEvent` inside a loop (see `specs/rules/looped_activity_terminators.md`).

---

### Input

```json
{
  "microflowName": "string (required) — Microflow name or qualified name (e.g.: 'Module.ACT_MyMicroflow')",
  "moduleName": "string (optional) — Module containing the microflow. Required if using short name and duplicates exist in multiple modules.",
  "returnType": "string (optional) — New return type. See Return Types table below.",
  "returnVariableName": "string (optional) — New return variable name.",
  "url": "string (optional) — REST endpoint URL. Empty string to clear URL. See also Tool 38 (`set_microflow_url`) to get/set URL independently."
}
```

**Return Types (the `returnType` field):**

| Value                    | Mendix DataType | Notes                                           |
| ------------------------ | --------------- | ----------------------------------------------- |
| `void`                   | `VoidType`      | —                                               |
| `boolean`                | `BooleanType`   | —                                               |
| `string`                 | `StringType`    | —                                               |
| `integer`                | `IntegerType`   | —                                               |
| `long`                   | `LongType`      | —                                               |
| `decimal`                | `DecimalType`   | —                                               |
| `float`                  | `FloatType`     | **Deprecated** — use `decimal` instead          |
| `datetime`               | `DateTimeType`  | —                                               |
| `object:<Module.Entity>` | `ObjectType`    | E.g.: `object:TestEntityMaintenance.TestEntity` |
| `list:<Module.Entity>`   | `ListType`      | E.g.: `list:TestEntityMaintenance.TestEntity`   |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Resolve microflow: qualified name first → moduleName + short name → scan all modules with `fromAppStore === false`. Throw if not found.
3. `await microflow.load()`. Read and store old values for each provided field: `oldReturnType` (via DataType reverse mapping from Tool 33), `oldReturnVariableName`, `oldUrl`. Used for no-op comparison and generating output diff.
4. For each provided field:
   - **`returnType`:** Parse string → `datatypes.DataType` object. For `object:` / `list:`: resolve entity via `model.findEntityByQualifiedName` — throw `"Entity '<QN>' not found in model."` if returns `undefined`. Assign to `microflow.microflowReturnType`. Mark `returnTypeChanged = true` when the new value differs from the old.
   - **`returnVariableName`:** Validate no name conflict with any microflow parameter — throw `"returnVariableName '<name>' conflicts with parameter '<paramName>'."`. Assign to `microflow.returnVariableName`. Mark `returnNameChanged = true` when changed.
   - **`url`:** Assign to `microflow.url` (empty string to clear).
   - **No-op:** If new value equals old value, skip the field — do not list in output.
5. **EndEvent re-synchronisation (Class 3 fix).** If `returnTypeChanged || returnNameChanged`:
   - If the effective `returnType` is non-Void: the effective `returnVariableName` must be set AND must resolve to a parameter or activity-output variable in the loaded microflow (same set of declaring slots as Tool 33 step 4). Throws with the same message family if it doesn't resolve.
   - Walk `loaded.objectCollection.objects` and for every `EndEvent`: set `returnValue = "$<effectiveName>"` (non-Void) or `""` (Void).
   - Append `EndEvent.returnValue: <n> event(s) re-synchronised to '<value>'` to the output change list.
6. If no fields were actually changed: throw `"No fields to update. Provide at least one of: returnType, returnVariableName, url."`.
7. No flush, no commit — caller must call `commit_working_copy`.

---

### Output

Returns plain text (MCP `textResult`):

```
Microflow '<moduleName>.<microflowName>' updated:
  returnType: <oldType> → <newType>
  returnVariableName: <old> → <new>
  EndEvent.returnValue: <n> event(s) re-synchronised to '$<effectiveName>'
  url: <old or "(none)"> → <new or "(none)">
(Changes are not committed — call commit_working_copy when done.)
```

Only lists fields that were actually changed (no-ops omitted). The `EndEvent.returnValue` line appears only when `returnType` and/or `returnVariableName` changed.

**Example:**

```
Microflow 'TestEntityMaintenance.ACT_TestEntity_Save' updated:
  returnType: Void → Object [entity: TestEntityMaintenance.TestEntity]
  returnVariableName: (none) → NewTestEntity
  EndEvent.returnValue: 2 event(s) re-synchronised to '$NewTestEntity'
(Changes are not committed — call commit_working_copy when done.)
```

---

### Error Cases

| Condition                                                                          | Behavior                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No working copy is open                                                            | Throw: `"No working copy is open in this session. Call open_working_copy first."`                                                                                                                                                                                                   |
| Microflow not found                                                                | Throw: `"Microflow '<name>' not found."`                                                                                                                                                                                                                                            |
| `returnType` string is invalid                                                     | Throw: `"Invalid returnType '<value>'. Expected: void, boolean, string, integer, decimal, float, datetime, object:Module.Entity, list:Module.Entity."`                                                                                                                              |
| Entity in `object:` / `list:` not found                                            | Throw: `"Entity '<QN>' not found in model."`                                                                                                                                                                                                                                        |
| No fields provided to update                                                       | Throw: `"No fields to update. Provide at least one of: returnType, returnVariableName, url."`                                                                                                                                                                                       |
| `returnType` changed to non-Void but no effective `returnVariableName`             | Throw (Class 3 fix): `"Microflow now has return type \"<type>\" but no returnVariableName is set. Every EndEvent of a non-Void microflow must have a returnValue expression — set returnVariableName to the parameter or activity-output variable that holds the value to return."` |
| Effective `returnVariableName` is not declared by any parameter or activity output | Throw (Class 3 fix): `"returnVariableName '<name>' is not defined in any parameter or activity output of microflow '<module.name>'."`                                                                                                                                               |

---

<!-- END TOOL 77: update_microflow -->

<!-- BEGIN TOOL 43: set_microflow_url -->

## Tool 43: `set_microflow_url`

Get or set the URL path of a microflow in the working copy (`microflow.url` property). Omit `url` to read the current URL; provide `url` to set it (empty string to clear). See also Tool 34 (`update_microflow`) to set URL together with other properties.

> **SDK Note:** `microflow.url` is a direct property on `microflows.Microflow`. This is a URL path string — it does not automatically expose the microflow as a REST endpoint (additional configuration in Published REST Service is required). If the `mendixmodelsdk` version in use does not have this property, the tool will throw `"microflow.url property not available in this SDK version."`.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "microflowName": "string (required) — Microflow name or qualified name.",
  "moduleName": "string (optional) — Module containing the microflow. If omitted, searches the entire project.",
  "url": "string (optional) — URL to set (e.g.: '/api/v1/myendpoint'). Omit to read the current URL. Empty string to clear URL."
}
```

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Resolve microflow via 3 branches:
   - If `microflowName` contains `.` (qualified name): `model.findMicroflowByQualifiedName(microflowName)`. Throw if `undefined`.
   - If `moduleName` is provided: find module → filter `module.documents.filter(d => d instanceof microflows.Microflow)` → find by `mf.name`. Throw if module or microflow not found.
   - If no `moduleName`: scan all modules with `fromAppStore === false`, return the first match. Emit warning: `"moduleName not provided — resolved to <resolvedModuleName>.<microflowName>. Provide moduleName for deterministic resolution."` if more than 1 module contains a microflow with the same name.
3. `await microflow.load()`.
4. If `url` is **not** provided (read mode):
   - Read `microflow.url`. If `undefined` or empty string, display as `"(none)"`.
   - Return output.
5. If `url` **is** provided (write mode):
   - If `url` is non-empty and does not start with `/`: emit warning `"URL should start with '/' (e.g. '/api/v1/myendpoint')."` — does not block the set.
   - Assign `microflow.url = url` (empty string to clear).
   - No flush, no commit — caller must call `commit_working_copy`.

---

### Output

Returns plain text (MCP `textResult`):

```
# Read mode (url not provided):
URL of '<moduleName>.<microflowName>': <url or "(none)">

# Write mode (url provided):
URL of '<moduleName>.<microflowName>' set to: <url>
(Changes are not committed — call commit_working_copy when done.)

# Clear mode (url = ""):
URL of '<moduleName>.<microflowName>' cleared.
(Changes are not committed — call commit_working_copy when done.)
```

---

### Error Cases

| Condition                                                   | Behavior                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| No working copy is open                                     | Throw: `"No working copy is open in this session. Call open_working_copy first."`                 |
| Microflow not found                                         | Throw: `"Microflow '<name>' not found."`                                                          |
| `url` does not start with `/` (when provided and non-empty) | Emit warning: `"URL should start with '/' (e.g. '/api/v1/myendpoint')."` — does not block the set |

---

<!-- END TOOL 43: set_microflow_url -->

<!-- BEGIN TOOL 48: read_microflow_security -->

## Tool 48: `read_microflow_security`

Read security information of a microflow/nanoflow in the working copy: which module roles are allowed to execute it, and the `applyEntityAccess` setting. Read-only — does not modify security settings.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

---

### Input

```json
{
  "microflowName": "string (optional) — Microflow name or qualified name. If omitted, returns security for all microflows.",
  "moduleName": "string (optional) — Filter by module. If omitted, searches the entire project.",
  "include_nanoflows": "boolean (optional, default: false) — If true, includes Nanoflows in results."
}
```

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Determine search scope:
   - If `microflowName` contains `.` (qualified name) **and** `moduleName` is provided: QN takes priority, `moduleName` is ignored.
   - If `microflowName` is provided (not QN): resolve the unique microflow via moduleName + short name → or scan all modules with `fromAppStore === false`.
   - If `microflowName` is omitted and `moduleName` is provided: iterate all microflows in that module (`module.documents.filter(d => d instanceof microflows.Microflow)`).
   - If both are omitted: iterate all microflows in the entire project (all modules with `fromAppStore === false`).
   - If `include_nanoflows: true`: also include `microflows.Nanoflow` in the same scope. Note: `microflowName` can only resolve to one Microflow or one Nanoflow — it cannot match both if names collide.
3. If `moduleName` is provided: `await module.moduleSecurity.load()` to load the `ModuleSecurity` document. Guard: if `module.moduleSecurity` is `null` / `undefined`, treat the module as having no security → `allowedRoles: (none — module security not configured)`.
4. For each microflow in scope:
   - `await mf.load()`.
   - Read `mf.applyEntityAccess`.
   - **For Microflow:** Iterate `moduleSecurity.microflowAccesses[]` → filter entries where `ma.microflow.qualifiedName === mf.qualifiedName` → get `ma.allowedRoles[].name`. If no entry found → no roles configured.
   - **For Nanoflow:** `ModuleSecurity.microflowAccesses` does not contain Nanoflows — server-side security does not apply. Display `allowedRoles: (N/A — nanoflows are not listed in ModuleSecurity)`. `applyEntityAccess` is still read from `nf.applyEntityAccess`.
5. Sort results by qualified name.
6. Return `textResult(output)`. This tool is read-only — no need for `commit_working_copy`.

> **Implementation note:** Mendix Model SDK stores microflow access rules in `ModuleSecurity.microflowAccesses` — each `MicroflowAccess` contains a `microflow` reference and `allowedRoles[]`. If a microflow has no `MicroflowAccess` entry → no roles are defined (may run at system-level or security not yet configured). Case `applyEntityAccess: false` with no roles → microflow runs at system level (bypasses object-level security checks).

> **SDK note:** Must call `await module.moduleSecurity.load()` separately (`await module.load()` does not automatically load it). `ModuleSecurity` is a separate document unit.

---

### Output

Returns plain text (MCP `textResult`):

```
Microflow security (<count> microflow(s)):

<moduleName>.<microflowName>:
  applyEntityAccess: <true|false>
  allowedRoles: <role1>, <role2>, ...
              | (none — no roles defined)
              | (N/A — nanoflows are not listed in ModuleSecurity)
              | (none — module security not configured)

<moduleName>.<microflowName2>:
  ...
```

- `(none — no roles defined)`: Microflow exists in `ModuleSecurity` but `allowedRoles[]` is empty, or no `MicroflowAccess` entry exists for this microflow.
- `(N/A — nanoflows are not listed in ModuleSecurity)`: This is a Nanoflow — server-side security via `microflowAccesses` does not apply.
- `(none — module security not configured)`: `module.moduleSecurity` is null/undefined.

Example:

```
Microflow security (3 microflow(s)):

TestEntityMaintenance.ACT_TestEntity_Save:
  applyEntityAccess: true
  allowedRoles: User, Administrator

TestEntityMaintenance.VAL_TestEntity_Validate:
  applyEntityAccess: true
  allowedRoles: (none — no roles defined)

TestEntityMaintenance.NF_ComputeLabel (Nanoflow):
  applyEntityAccess: false
  allowedRoles: (N/A — nanoflows are not listed in ModuleSecurity)
```

---

### Error Cases

| Condition                              | Behavior                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| No working copy is open                | Throw: `"No working copy is open in this session. Call open_working_copy first."` |
| `microflowName` provided but not found | Throw: `"Microflow '<name>' not found."`                                          |
| `moduleName` provided but not found    | Throw: `"Module '<moduleName>' not found. Available: <list>."`                    |
| No microflows found in scope           | Return `"No microflows found in <scope>."` — no throw                             |

---

<!-- END TOOL 48: read_microflow_security -->

<!-- BEGIN TOOL 94: microflow_arrange -->

## Tool 94: `microflow_arrange`

Auto-arrange activities on a microflow canvas using the **same flow-aware algorithm as `create_microflow`** (Tool 25). The layout follows the Mendix Studio Pro convention: the main path is drawn horizontally left-to-right starting from the `StartEvent` at `(0, 0)`; each `ExclusiveSplit`/`InheritanceSplit` emits its branches (the `false` case of an Expression split, any flow whose destination is a `ValidationFeedback` activity, or any additional outgoing flows) one row lower at `y + Y_STEP`. Parameters are stacked vertically above the start. Connection indices on every `SequenceFlow` are normalized (`RIGHT→LEFT` for main, `BOTTOM→TOP` for branches). The algorithm recurses into nested `LoopedActivity` collections.

Operates on a single named microflow, all microflows in a module, or all user-module microflows in the project. Replaces the previous Dagre-based implementation, which produced graph layouts that did not match Mendix canvas conventions.

Prerequisite: `configure_token` → `configure_app` → `open_working_copy` must be called first.

> **No external dependency.** The layout is hand-crafted in `src/microflowArranger.ts` and mirrors `src/microflowBuilder.ts` (`autoLayout`, `autoLayoutInnerLoop`). The `mfautolayout` / `dagre` packages are **not** used.

---

### Input

```json
{
  "microflowName": "string (optional) — Short name or FQN of a single microflow to arrange",
  "moduleName": "string (optional) — Arrange all microflows in this module",
  "branchOverrides": [{ "captionContains": "empty(", "mainCase": "false" }]
}
```

| Field             | Type   | Required | Default | Description                                                                                                                                                                                                                            |
| ----------------- | ------ | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `microflowName`   | string | No       | —       | Short name (e.g. `ACT_LeaveRequest_Save`) or FQN (e.g. `RequestsOverview.ACT_LeaveRequest_Save`). When provided, only this microflow is arranged. Provide `moduleName` to disambiguate when the short name exists in multiple modules. |
| `moduleName`      | string | No       | —       | Module name (e.g. `RequestsOverview`). Without `microflowName`: arranges all microflows in the module. With `microflowName`: narrows the search scope.                                                                                 |
| `branchOverrides` | array  | No       | `[]`    | Per-split overrides for which case is the main (happy) path. Each entry: `{ captionContains: string, mainCase: "true" \| "false" }`. The list is fully caller-controlled (no hard-coded defaults). See "Branch overrides" below.       |

> The layout direction is fixed: the main path is drawn horizontally left-to-right and `ExclusiveSplit`/`InheritanceSplit` branches are drawn downward. There is no `direction` parameter — the algorithm always uses the Mendix Studio Pro convention.

#### Branch overrides

By default, the arranger treats an Expression split's `"true"` case as the main (happy) path drawn right and its `"false"` case as the branch drawn down — **except** when a flow's destination is a `ValidationFeedback` activity, in which case the flow is always treated as a branch regardless of its case value (validation feedback is never the happy case). For Mendix splits where neither auto-rule applies but the semantically happy path is still the `false` case — most commonly `empty($field)` / `isEmpty($list)` / `not <expr>` checks that lead to non-`ValidationFeedback` activities — pass `branchOverrides` to flip the rule per split caption.

Each entry is matched in order, first-hit wins:

| Field             | Description                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `captionContains` | Case-insensitive substring matched against the `ExclusiveSplit.caption` / `InheritanceSplit.caption`. |
| `mainCase`        | `"true"` or `"false"` — the case value that becomes the main (right-going) path for matching splits.  |

Examples:

```json
// Flip every empty-check validation split
"branchOverrides": [
  { "captionContains": "empty(", "mainCase": "false" }
]

// Multiple patterns
"branchOverrides": [
  { "captionContains": "empty(",   "mainCase": "false" },
  { "captionContains": "isEmpty(", "mainCase": "false" },
  { "captionContains": "not ",     "mainCase": "false" }
]

// Override one specific split by its full caption substring
"branchOverrides": [
  { "captionContains": "leaverequest/requestedfor", "mainCase": "false" }
]
```

Splits whose caption doesn't match any entry keep the default `true = main` rule. Pass `[]` (or omit) to disable overrides entirely.

**Scope resolution (priority order):**

| Priority | Condition                              | Scope                                                                                       |
| -------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1        | `microflowName` given                  | Single microflow (use `moduleName` to disambiguate)                                         |
| 2        | `moduleName` given, no `microflowName` | All microflows in the module                                                                |
| 3        | Neither given                          | All microflows in every user module (skips `System`, `Administration`, `NavigationLayouts`) |

---

### Behavior

1. Call `requireWorkingCopy()` — throw if no working copy is open.
2. Collect target microflow stubs (`IMicroflow[]`) per scope rules:
   - **Single:** If `microflowName` contains `.`, treat as FQN and resolve directly. Otherwise search by short name within `moduleName` (if given) or across all user modules. Throw if not found. Throw with disambiguation message if the short name matches multiple modules.
   - **Module:** Find module by `moduleName`; throw if not found. Filter `mod.documents` by `instanceof microflows.Microflow`.
   - **Project:** Iterate `model.root.modules` where `fromAppStore === false` and name not in `["System", "Administration", "NavigationLayouts"]`. For each, filter documents by `instanceof microflows.Microflow`.
3. For each stub, load the full microflow document and its object collection:
   ```js
   const mf = await stub.load();
   await mf.objectCollection.load();
   ```
   > **Lưu ý:** `objectCollection` là một đơn vị tài liệu riêng biệt trong SDK v4.x — cần phải `.load()` trước khi truy cập `objectCollection.objects`.
4. **Partition flows.** All `SequenceFlow`s live on `mf.flows`. Group them into:
   - **Outer flows** — both endpoints are in `mf.objectCollection.objects`.
   - **Inner flows** — both endpoints are inside some `LoopedActivity.objectCollection.objects`.
5. **Classify outer flows per-split.** For every `ExclusiveSplit` / `InheritanceSplit` with outgoing flows, pick **one** happy outgoing flow; every other outgoing flow on that split becomes a `branch`. Non-split-origin flows are `main` (the layout walker may still later promote a `VF→EndEvent` flow to `branch` for vertical continuation — see step 6). Pick the happy flow with this precedence:
   1. **Explicit override.** If `branchOverrides` is supplied, look up the split's caption (lower-cased) against each entry's `captionContains` (lower-cased) in order. On the first match, the flow whose `EnumerationCase.value` equals the matched entry's `mainCase` becomes happy.
   2. **ValidationFeedback siblings.** If at least one outgoing flow targets an `ActionActivity` whose `action` is a `ValidationFeedbackAction` AND at least one outgoing flow does not, the first non-VF sibling is happy. ValidationFeedback is never the happy case, independent of its case value.
   3. **Default.** The flow with `EnumerationCase.value === "true"`. If none, the first outgoing flow.

   The happy flow gets `main` connection indices (RIGHT→LEFT); every other outgoing flow on the same split gets `branch` indices (BOTTOM→TOP) — **regardless** of whether its case value is `"true"` or `"false"`.

6. **Lay out the outer canvas.**
   - Find the `StartEvent` (first instance in `objects`). Place at `relativeMiddlePoint = { x: 0, y: 0 }`, then walk forward along main flows, placing each visited object at `x += X_STEP` (220) on row `y = 0`.
   - When the walk encounters an `ExclusiveSplit`/`InheritanceSplit`, recursively lay out each `branch` outgoing flow on a new row `y + Y_STEP` (160) starting at the split's `x`. Multiple branches from the same split stack downward at `+Y_STEP` per branch.
   - **Vertical continuation after `ValidationFeedback`.** If a `ValidationFeedback` activity was reached via a vertical (branch) flow and its only outgoing flow leads to an `EndEvent`, the `EndEvent` is placed at `(x, y + Y_STEP)` (directly below) instead of `(x + X_STEP, y)` (to the right), and the connecting flow is promoted to a branch so it draws `BOTTOM→TOP`. A `ValidationFeedback` reached horizontally keeps the default behavior. This rule applies only to the immediate `EndEvent`; any other downstream activity follows standard horizontal continuation.
   - If there is no `StartEvent` (unusual for top-level microflows), the first non-parameter object in `objects` becomes the implicit entry.
   - Stack any `MicroflowParameterObject` instances vertically above the start: `x = -2`, `y = -170, -86, -2, ...` (`+84` per parameter).
   - Any objects not reached by the walk are placed on a fallback row at `y = 2 × Y_STEP`, spaced `X_STEP` apart, so Studio Pro still renders them.
7. **Set shape sizes** to match `microflowBuilder.setShapeSize`:
   - `StartEvent` / `EndEvent` / `ContinueEvent` / `BreakEvent` / `ErrorEvent`: `20 × 20`
   - `ExclusiveSplit` / `InheritanceSplit` / `ExclusiveMerge`: `80 × 80`
   - `LoopedActivity`: `228 × 200`
   - `MicroflowParameterObject`: `30 × 30`
   - All other activities (`ActionActivity`, …): `140 × 50`
8. **Set connection indices** on every outer `SequenceFlow`:
   - `main` flows: `originConnectionIndex = 1` (RIGHT), `destinationConnectionIndex = 3` (LEFT)
   - `branch` flows: `originConnectionIndex = 2` (BOTTOM), `destinationConnectionIndex = 0` (TOP)
9. **Recurse into LoopedActivities.** For each `LoopedActivity` in the outer objects, lay out its inner `objectCollection` using `innerStartX = 85`, `innerMainY = 100` (vertically centered in the 200-tall loop frame). There is no inner `StartEvent` — the first object in `innerOc.objects` is the implicit entry. Branches still go to `innerMainY + Y_STEP`. Inner flow connection indices are set the same way.
10. Accumulate `objectCount` per microflow and total `microflowCount`.
11. Record changes to the in-memory working copy. No flush, no commit — caller must call `commit_working_copy`.

> **Coordinate note:** `obj.relativeMiddlePoint` is the **center** of the object — the algorithm writes center coordinates directly (unlike `entity.location` for the domain model, which is a top-left corner).

---

### Output

```
# Single microflow:
Arranged microflow '<FQN>' (<objectCount> objects).
(Changes are not committed — call commit_working_copy when done.)

# Module scope:
Arranged <N> microflow(s) in module '<moduleName>': <mf1>, <mf2>, ...
(Changes are not committed — call commit_working_copy when done.)

# Project scope:
Arranged <N> microflow(s) across <M> module(s).
(Changes are not committed — call commit_working_copy when done.)
```

---

### Error Cases

| Condition                                                       | Behavior                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| No working copy is open                                         | Throw: `"No working copy is open in this session. Call open_working_copy first."`                                  |
| `microflowName` not found in specified module                   | Throw: `"Microflow '<name>' not found in module '<moduleName>'."`                                                  |
| `microflowName` not found in any user module                    | Throw: `"Microflow '<name>' not found in any user module."`                                                        |
| `microflowName` (short name) matches multiple modules           | Throw: `"Ambiguous microflow name '<name>' — found in: <module1>, <module2>. Provide moduleName to disambiguate."` |
| `moduleName` not found                                          | Throw: `"Module '<moduleName>' not found. Available modules: <comma-separated list>."`                             |
| No microflows found in scope                                    | Return `"No microflows found in <scope>."` — does not throw                                                        |
| Project scope: tất cả modules đều là system modules (bị lọc ra) | Return `"No user modules found in working copy."` — does not throw                                                 |
| Microflow has no objects                                        | Skip layout for that microflow (nothing to arrange); still counted in output                                       |

---

### Key differences vs `arrange_domain_model` (Tool 83)

Both tools auto-arrange a Mendix canvas, but they target different canvas types and use different algorithms.

| Aspect                          | `microflow_arrange` (Tool 94)                                                                       | `arrange_domain_model` (Tool 83)             |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Canvas                          | Microflow editor (activities, events, splits, loops)                                                | Domain model (entities)                      |
| Layout strategy                 | Flow-aware: main path right, ExclusiveSplit branches down. Same code path as `create_microflow`.    | Hand-crafted centered-tree (no external lib) |
| Layout direction                | Fixed: LR-main + TB-branches (no parameter)                                                         | `TB` fixed                                   |
| Node sizing                     | Re-applied per shape type (events 20px, splits 80px, loops 228×200, activities 140×50, params 30px) | Computed: `max(110, 90 + 10 × attrCount)`    |
| Position property               | `obj.relativeMiddlePoint` (center)                                                                  | `entity.location` (top-left corner)          |
| Side effects beyond positioning | Also normalizes `SequenceFlow.originConnectionIndex` / `destinationConnectionIndex`                 | Position only                                |
| Scope                           | Single MF / module / project                                                                        | Single module only                           |

### Algorithm origin

The layout is **the same algorithm** used by `create_microflow` (`src/microflowBuilder.ts` → `autoLayout` / `autoLayoutInnerLoop`). Arranging an existing microflow with this tool produces the same canvas geometry as creating that microflow from scratch with `create_microflow`.

---

<!-- END TOOL 94: microflow_arrange -->
