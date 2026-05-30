---
audiences: [tool-call]
triggers:
  tool-call: "before authoring any Mendix expression whose target slot is enum-typed (MemberChange.value, CreateVariable.initialValue, ChangeVariable.value, CallMicroflow enum arguments, ExclusiveSplit Expression comparing an enum)"
status: hard-enforced
enforcer: src/enumValueValidator.ts
notes: "Hard-enforced for `MemberChange.value` (Tool 25 `create_microflow` and Tool 26 `create_microflow_activities` / Tool 70 `insert_before_activity` paths) and for `CallMicroflow.parameterMappings[].argument` (Tool 25 only). Advisory only for `ChangeVariable.value`, `CreateVariable.initialValue`, `ExclusiveSplit.condition` (Expression), and `microflow_call` arguments under Tool 26 — wrong patterns commit and fail at Studio Pro's consistency check or at runtime."
---

# Enumeration Values in Mendix Expressions — Planning Guidance

Mendix has **two grammars** for enum value references depending on where the
expression appears. The MCP tools do not (yet) distinguish between them at
every callsite, so the planner must pick the right one.

## Pattern A — XPath constraint (string literal)

`Retrieve.source.xpath`, entity-access-rule XPath, and datasource XPath are
evaluated by Mendix's XPath engine. **Enum values in XPath are written as
string literals.** The XPath engine has no notion of enum constants.

```
xpath: "[Status = 'PENDING' and DeletedFlag = false]"          ✓ correct
xpath: "[Status = LeaveRequest.Enum_LeaveStatus.PENDING]"      ✗ XPath parse error
```

## Pattern B — Mendix expression (FQN value reference)

Every other expression-bearing field is evaluated by Mendix's microflow-
expression engine, which is type-aware. **For enum attributes, the value
reference is `Module.EnumName.VALUE`** — the bare-quoted form is parsed as a
String literal and triggers a type mismatch with the enum-typed attribute.

| Activity field | Wrong | Right |
|---|---|---|
| `MemberChange.value` (enum attribute) | `"'PENDING'"` | `"LeaveRequest.Enum_LeaveStatus.PENDING"` |
| `CreateObject` memberChanges (enum) | `"'DRAFT'"` | `"LeaveRequest.Enum_LeaveStatus.DRAFT"` |
| `CallMicroflow.parameterMappings[].argument` (enum-typed param) | `"'PENDING'"` | `"LeaveRequest.Enum_LeaveStatus.PENDING"` |
| `CreateVariable.initialValue` (enum-typed) | `"'FULL'"` | `"LeaveRequest.Enum_Session.FULL"` |
| `ChangeVariable.value` (enum-typed) | `"'CANCELLED'"` | `"LeaveRequest.Enum_LeaveStatus.CANCELLED"` |
| `ExclusiveSplit.condition` (Expression — comparing an enum) | `"$LR/Status = 'PENDING'"` | `"$LR/Status = LeaveRequest.Enum_LeaveStatus.PENDING"` |
| `LogMessage` / `ShowMessage` / `ValidationFeedback` parameters (passing an enum) | `"'PENDING'"` | `"$LR/Status"` (or the FQN constant if comparing) |

> **`ExclusiveSplit` with `conditionType: "Enumeration"`**: the `condition` is
> just the enum-typed variable (e.g. `$LR/Status`), and each outgoing flow's
> `condition` field carries a **bare enum value name** (`"PENDING"`). That
> bare form is the `EnumerationCase` case-value, not an expression — it is
> correct as-is and the rule does NOT apply there.

## Decision rule

Before writing any value into an expression-bearing field, ask:

1. **Is the field an XPath constraint?** (e.g. `Retrieve.source.xpath`,
   entity-access XPath, datasource XPath.) → use the bare-quoted literal form
   (`'PENDING'`). Stop.
2. **Is the target slot enum-typed?** Look up the attribute / variable / parameter
   type.
   - **No** → no enum rule applies; use whatever form fits (`$Var`, `'string'`,
     `1`, etc.).
   - **Yes** → use the FQN form `Module.EnumName.VALUE`.

## What it looks like at runtime

Wrong (string literal in a Mendix-expression slot):

```json
{
  "id": "act_promote",
  "type": "ChangeObject",
  "variable": "LR",
  "memberChanges": [
    { "attributeQualifiedName": "LeaveRequest.LeaveRequest.Status",
      "changeType": "Set", "value": "'PENDING'" }
  ]
}
```

Studio Pro consistency check (when validator was bypassed or the slot is not
yet validated):
```
The expression 'PENDING' has type String, but Enumeration was expected.
```

Right:

```json
{ "attributeQualifiedName": "LeaveRequest.LeaveRequest.Status",
  "changeType": "Set", "value": "LeaveRequest.Enum_LeaveStatus.PENDING" }
```

When the validator IS engaged (default for `MemberChange.value` and Tool-25
`CallMicroflow` arguments), the wrong form throws at build time with:
```
[activity 'act_promote'] value 'PENDING' for enum attribute LeaveRequest.LeaveRequest.Status must be the FQN constant LeaveRequest.Enum_LeaveStatus.PENDING, not a string literal. See docs/enum_value_in_expression_defect.md and specs/rules/enum_value_in_expression.md.
```

Opt-in: pass `autoTranslateEnumLiterals: true` on `create_microflow`,
`create_microflow_activities`, or `insert_before_activity` and the validator
rewrites `'PENDING'` → `LeaveRequest.Enum_LeaveStatus.PENDING`, adding a
warning to the response's `warnings` array. An unknown value name (e.g.
`'BOGUS'`) still throws — the validator does not silently invent constants.

## Sites not yet hard-enforced

These slots accept Mendix expressions but the validator does NOT fire there
today. Author the FQN form yourself; the wrong form will commit and surface
at Studio Pro load:

- `ChangeVariable.value` — variable scope resolution is out of scope.
- `CreateVariable.initialValue` — `Enumeration` is not (yet) a supported
  `variableType.type` in the builder, so the case is doubly latent.
- `ExclusiveSplit.condition` (Expression type) — would require parsing the
  expression to find `$Var/Attr = 'NAME'` sub-patterns.
- `microflow_call` activity arguments under Tool 26 / Tool 70 — that path
  doesn't load the target microflow's parameter list, so the parameter type
  cannot be inspected without extra plumbing. (Tool 25's `CallMicroflow`
  IS validated.)

These are documented as `// TODO(enum-literal-validator)` in the source.

## Skip the check when…

- The field is an XPath constraint (Pattern A above) — different grammar.
- The field is an `EnumerationCase` `value` on an `ExclusiveSplit`
  Enumeration outgoing flow — bare names are correct there.
- The expression is a `getCaption(…)` or `getKey(…)` call — the result is a
  String, not an Enumeration.

## See also

- `expression_attribute_paths.md` — sibling rule covering the
  `$Variable/AttrName` vs `Module.Entity.Attribute` distinction. Same writing
  style; load both whenever drafting any expression that touches an enum.
- `xpath_currentuser.md` — shares the XPath grammar (Pattern A).
- `../tools/microflows.md` — the per-tool spec; the `MemberChange` table
  links back to this rule.
- `../reference/microflow-expressions.md` — "Enumeration Values in Expressions"
  subsection summarises Pattern B with examples.
- `../../src/enumValueValidator.ts` — the enforcing validator. The error
  string above is verbatim from this module.
- `../../docs/enum_value_in_expression_defect.md` — the original defect
  report with affected microflows and root-cause walk-through.
