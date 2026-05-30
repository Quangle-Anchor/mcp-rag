---
audiences: [tool-call]
triggers:
  tool-call: "before authoring any microflow activity that references a variable — i.e. before any create_microflow / create_microflow_activities / insert_before_activity / modify_microflow_activity call that includes ChangeVariable, ChangeObject, CommitObject, DeleteObject, AggregateList, ListOperation, LoopedActivity, Retrieve(Association), CallMicroflow with parameter arguments, ValidationFeedback, ExclusiveSplit, or any expression slot that may contain $Var references"
status: hard-enforced
enforcer: src/microflowReferenceValidator.ts
---

# Microflow Reference Correctness — Planning Guidance

Microflow activities consume **variables** in fixed-shape slots. Mendix's
runtime metamodel enforces three contracts that the SDK does not check at
write-time:

1. **Required-target slots must be non-empty.** `ChangeVariable.variable`,
   `ChangeObject.variable`, `CommitObject.variable`, `DeleteObject.variable`,
   `ValidationFeedback.objectVariable`, `Retrieve.source.startVariableName`
   (when source.type=Association) — all require a name. The SDK silently
   persists `null`; Studio Pro then emits `CE0037 "The 'Variable' property
is required."` for every empty slot at project load.

2. **References must resolve to a declared variable.** Every `$Name` token
   in an expression (CreateVariable.initialValue, ChangeVariable.value,
   MemberChange.value, ExclusiveSplit.condition, message-template
   parameters, CallMicroflow argument expressions, Retrieve XPath, …) and
   every variable slot must name a microflow parameter or an earlier
   activity's output. Otherwise Studio Pro fails project load with
   `CE0109 "Undefined variable 'X'"` or `CE0117 "Error(s) in expression."`

3. **Slot kind (Object / List / Primitive) must match.** ChangeObject
   requires an Object, not a List. AggregateList / ListOperation /
   LoopedActivity require a List, not an Object. Mendix commits the
   mismatch; Studio Pro rejects it with
   `CE7247 "Variable 'X' is of type List of Y, but should be of type
Object."` (or the converse). The most common cause is a `Retrieve` with
   `range: "All"` (returns a List) whose output is later fed to a
   single-Object slot — the validator's error message includes a
   `range: "First"` suggestion in this case.

---

## How the validator builds the variable-type table

Walked once per microflow / `create_microflow_activities` call before any
activity is wired:

| Source                                                                      | Resulting VarDecl                                                                                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Microflow parameter                                                         | kind from `parameter.type` (Object / List / Primitive); entityQN from spec.                                                                      |
| `CreateVariable.outputVariableName`                                         | kind = Primitive; primitive name from `variableType`.                                                                                            |
| `Retrieve` (Database, `range: "First"`)                                     | kind = Object; entityQN from `source.entityQualifiedName`.                                                                                       |
| `Retrieve` (Database, `range: "All"` / `"ConstantRange"` / `"CustomRange"`) | kind = List; entityQN from `source.entityQualifiedName`. `rangeIsAll` flag set so downstream Object-slot consumers get the `range:"First"` hint. |
| `Retrieve` (Association)                                                    | kind = Object (best-effort default — see Limitations).                                                                                           |
| `CreateObject.outputVariableName`                                           | kind = Object; entityQN from `entityQualifiedName`.                                                                                              |
| `CallMicroflow.outputVariableName`                                          | kind = Object (best-effort default — see Limitations).                                                                                           |
| `AggregateList.outputVariableName`                                          | kind = Primitive (Long for Count, Decimal otherwise).                                                                                            |
| `ListOperation.outputVariableName`                                          | kind = List (Sort/Head/Tail/Union/Intersect/Subtract), or Primitive Boolean (Contains).                                                          |
| `LoopedActivity.iteratorVariableName`                                       | kind = Object; entityQN inherited from the bound list's element type. Visible only INSIDE the loop body.                                         |

---

## Decision rule for the planner

1. **When writing a `ChangeVariable`** — populate BOTH `variable` (target
   name) AND `value` (expression). The target must name a variable
   declared upstream (parameter or earlier activity output). Pre-declaring
   the variable with `CreateVariable variableType="String", initialValue=""`
   and reassigning it in branches via `ChangeVariable` is the canonical
   pattern for merging branches without hitting the CE0111 duplicate-name
   error — but the `variable` field must be set on every ChangeVariable.

2. **When writing a `ChangeObject` / `DeleteObject`** — verify the
   source variable is `Object<entity>`, not a List. If the source came
   from a `Retrieve`, set `range: "First"` (or use the entity-association
   form of Retrieve). `range: "All"` always returns a List.

3. **When writing an `AggregateList` / `ListOperation` /
   `LoopedActivity`** — verify the source list variable is `List<entity>`.
   If the source is a single object, retrieve into a list (or fall through
   from a `Retrieve range: "All"`).

4. **When writing any expression** (initialValue, condition, value,
   memberChange value, message parameter, CallMicroflow argument, XPath)
   — every `$Name` token must resolve to an in-scope variable. The
   validator builds the full in-scope set per call and reports it in the
   error message when a reference doesn't resolve, so you can pick a
   correct name from the list.

---

## What it looks like at runtime

### Empty ChangeVariable target

```
[activity 'a8' (ChangeVariable.variable)] Variable name is empty.
  Reason: this slot requires the name of a previously declared variable.
  Mendix commits the empty value; Studio Pro rejects with CE0037
  "The 'Variable' property is required."
  Fix: set ChangeVariable.variable to the name of an in-scope variable
  (microflow parameter, CreateVariable, Retrieve.outputVariableName,
  CreateObject.outputVariableName, AggregateList.outputVariableName, …).
```

### List variable fed to ChangeObject (with `range:"First"` hint)

```
[activity 'a10' (ChangeObject.variable)] Variable 'Counter' is a List,
but ChangeObject requires an Object.
  Source: Retrieve(Database range:"All") at activity 'a4'
  Reason: Studio Pro CE7247 rejects "Variable 'Counter' is of type
  List of Mod.SystemCounter, but should be of type Object."
  Specifically: 'Counter' came from Retrieve(Database range:"All") at
  activity 'a4' — change the Retrieve's range from "All" to "First" to
  get a single Object instead of a List.
```

### Expression refers to undefined variable

```
[activity 'a2' (ChangeVariable.value)] Expression references undefined
variable '$Missing'.
  Expression: $Missing + 1
  Reason: Mendix commits the broken reference; Studio Pro fails project
  load with CE0109 "Undefined variable 'Missing'" or CE0117 "Error(s) in
  expression."
  Fix: declare 'Missing' upstream, or change the expression to reference
  one of the in-scope names: [Counter, CounterKey, Now, RequestCode].
```

### Attribute-path traversal on a List (CE0117 — list-attribute case)

`$Var/Attribute` is only valid when `$Var` is an Object. When the source is
a `Retrieve range:"All"` (returning a List), the expression silently commits
but Studio Pro fails project load with CE0117 "Error(s) in expression."
Most common case: an ExclusiveSplit gate like `$Balance/AvailableDays >= 5`
where `Balance` came from `Retrieve range:"All"`.

```
[activity 'a22' (ExclusiveSplit.condition)] Expression performs attribute-
path traversal '$Balance/...' but '$Balance' is a List, not an Object.
  Expression: $LeaveType/SkipBalanceCheck = true or ($Balance/AvailableDays >= $ComputedDays)
  Source: Retrieve(Database range:"All") (existing) 'Balance'
  Reason: Mendix commits the broken expression; Studio Pro fails project
  load with CE0117 "Error(s) in expression." Attribute-path traversal
  ($Var/Attribute) requires 'Balance' to be an Object.
  Fix: change the source Retrieve's range from "All" to "First" (so
  'Balance' is an Object instead of a List), or refactor the expression
  to use AggregateList / ListOperation on the list.
```

### Modify-path validation

The modify path tools (`create_microflow_activities`, `insert_before_activity`,
`modify_microflow_activity`) now reconstruct the variable-type table from the
loaded microflow's SDK objects and apply the same checks. A List/Object kind
mismatch added by an append-style spec — or a `change_variable: "Counter"`
edit whose target is a `Retrieve range:"All"` output — fires at write-time
with the same error shapes as the create path.

The flat-namespace approximation: the modify-path table treats LoopedActivity
iterator + inner-activity outputs as in scope at the top level. This is
permissive (won't reject an outer activity that references an inner-only
variable — Mendix catches that at project load) but never false-positives
on the kind / undefined-reference checks that matter most.

---

## Limitations (documented, deferred)

- **`CallMicroflow.outputVariableName` type.** Resolving the called
  microflow's return type requires loading it (async, IModel-coupled).
  The validator best-effort-defaults to Object. Undefined-reference
  catches work; Object-vs-List on the produced variable does not.
- **`CallMicroflow` argument kind matching.** The argument _expression_ is
  validated for undefined-reference and list-attribute traversal, but the
  kind of each argument is not checked against the callee microflow's
  parameter type. Passing a List to an Object parameter (e.g. the live
  `SUB_LeaveBalance_Recalculate($Balance)` case where `$Balance` is a List)
  is not yet caught.
- **`Retrieve(Association)` result kind.** Mendix associations can return
  Object (1:1, child→parent of 1:N) or List (parent→children of 1:N)
  depending on the association's multiplicity. Without the IModel we
  default to Object; downstream List-only consumers will fail-loud, which
  is the safer direction.
- **`RestOperationCall.outputVariableName` / `bodyVariableName`** —
  skipped pending OperationParameter type loading.
- **`ShowPage`, `CallNanoflow`, `JavaScriptAction`, `Synchronize`,
  `CancelSynchronize`** — variable-reference scan not yet wired.

---

## See also

- [`expression_function_syntax.md`](./expression_function_syntax.md) — sister
  rule for Mendix-expression function calls.
- [`xpath_function_syntax.md`](./xpath_function_syntax.md) — sister rule
  for XPath function calls.
- [`looped_activity_terminators.md`](./looped_activity_terminators.md) —
  inner-flow terminator rules for `LoopedActivity` bodies.
- `../tools/microflows.md` — per-tool reference for the activity shapes
  whose slots are validated here.
- `mx-connect/src/microflowReferenceValidator.ts` — the canonical
  enforcement code.
