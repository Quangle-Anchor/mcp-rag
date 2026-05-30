---
audiences: [tool-call]
triggers:
  tool-call: "before authoring any Mendix expression string (MemberChange, ExclusiveSplit condition, LogMessage / ShowMessage template, LoopedActivity break condition, ValidationFeedback, calculated attribute, etc.) that dereferences an attribute via a variable"
status: advisory
notes: "no static validator; wrong expressions commit successfully and fail at Studio Pro's expression-parser pass or at runtime with an opaque error ('invalid expression', 'cannot resolve member')."
---

# Mendix Expression Attribute Paths — Planning Guidance

When writing a Mendix expression that dereferences an attribute via a variable —
in any of `MemberChange.value`, `ExclusiveSplit.condition`, `LogMessage` /
`ShowMessage` template parameters, `LoopedActivity.breakCondition`,
`ValidationFeedback.template` parameters, or any other expression-bearing field
— the form is **always**

```
$Variable/AttributeShortName
```

It is **never**

```
$Variable/Module.Entity.AttributeName
```

The dot-separated triple is the qualified-name form used to _identify_ an
attribute in tool-input fields like `attributeQualifiedName`. It is **not** how
the Mendix expression parser reads an attribute off a typed variable. Using
the qualified triple in an expression makes the parser look for a sub-entity
or association named `Module.Entity.AttributeName`, which does not exist —
the call commits but the project fails to validate.

---

## The split that causes the confusion

`mx-connect` tools accept two grammatically similar but semantically
distinct kinds of value:

### A. Identifier fields → **FQN required**

These fields tell the activity _which member to operate on_. The tool resolves
them through `model.findAttributeByQualifiedName()` / equivalent and rejects
short names.

| Field                                                                                    | Example                                    | Form                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------- |
| `attributeQualifiedName` (`MemberChange`)                                                | `"LeaveManagement.LeaveRequest.StartDate"` | `Module.Entity.Attribute` |
| `associationQualifiedName` (`MemberChange`, `Retrieve`)                                  | `"LeaveManagement.LeaveRequest_Owner"`     | `Module.Entity_Related`   |
| Attribute slot in `sortItems` / `AggregateList` / `ValidationFeedback`                   | `"LeaveManagement.LeaveRequest.StartDate"` | `Module.Entity.Attribute` |
| Entity / enumeration `qualifiedName` on `Retrieve`, `Create`, `Cast`, `EnumerationSplit` | `"LeaveManagement.LeaveRequest"`           | `Module.Entity`           |

### B. Expression fields → **Mendix expression syntax**

These fields hold a string the Mendix expression parser will evaluate at
microflow-execution time. They use the same syntax as the in-Studio-Pro
expression editor — _not_ the SDK qualified-name syntax.

| Field                                                                           | Example                                                                                                                   | Form                                                                                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `value` (`MemberChange`, `CreateObject` member values, `ChangeVariable`)        | `"$LeaveRequest/StartDate"`                                                                                               | `$Variable/AttrName`                                                                                                                            |
| `condition` (`ExclusiveSplit` Expression, `breakCondition` on `LoopedActivity`) | `"$LeaveRequest/Status = 'PENDING'"`                                                                                      | `$Variable/AttrName`                                                                                                                            |
| `condition` (`ExclusiveSplit` Enumeration)                                      | `"$LeaveRequest/Status"`                                                                                                  | `$Variable/AttrName` returning an enum                                                                                                          |
| `template` `parameters` (`LogMessage`, `ShowMessage`, `ValidationFeedback`)     | `"$LeaveRequest/RequestCode"`                                                                                             | `$Variable/AttrName`                                                                                                                            |
| `xpath` constraint on `Retrieve`                                                | `"[StartDate >= $Today]"`, `"[Owner/LeaveManagement.LeaveRequest_Owner/LeaveManagement.Employee/id = '[%CurrentUser%]']"` | XPath syntax — attribute on the result-set entity is bare (`StartDate`), association traversal is qualified (`Module.Assoc/Module.Entity/Attr`) |

---

## The decision rule (apply before writing any expression)

For each `$Variable` reference, ask:

1. **Is the target attribute defined on `$Variable`'s own entity (or any of its
   inherited specializations)?**
   - **Yes** → use `$Variable/AttributeShortName`.
   - **No, it lives across an association** → traverse the association:
     `$Variable/Module.AssociationName/AttributeShortName`. If the target side
     of the association has subtypes and you need to read an attribute that
     only exists on one of them, qualify the navigation:
     `$Variable/Module.AssociationName/Module.SubclassEntity/AttributeShortName`.

2. **Are you populating an identifier field** (`attributeQualifiedName`,
   `associationQualifiedName`, etc.)?
   - **Yes** → use the FQN `Module.Entity.Attribute`. This is a _separate
     field_ from the expression-bearing one; the two coexist on the same
     activity (e.g. `MemberChange` has both `attributeQualifiedName` and
     `value`).

The two never share the same field, and the two never share the same syntax.

---

## Worked examples

### `MemberChange` setting `LeaveRequest.Status` to a value derived from another variable

```json
{
  "id": "act_set_status",
  "type": "MemberChange",
  "variable": "LeaveRequest",
  "attributeQualifiedName": "LeaveManagement.LeaveRequest.Status",
  "changeType": "Set",
  "value": "$NewStatus"
}
```

`attributeQualifiedName` → FQN. `value` → variable reference.

### `MemberChange` copying `$Parameter/StartDate` onto `$LeaveRequest/StartDate`

```json
{
  "id": "act_copy_date",
  "type": "MemberChange",
  "variable": "LeaveRequest",
  "attributeQualifiedName": "LeaveManagement.LeaveRequest.StartDate",
  "changeType": "Set",
  "value": "$Parameter/StartDate"
}
```

Right-hand side is `$Parameter/StartDate`, NOT `$Parameter/LeaveManagement.LeaveRequest.StartDate`.

### `ExclusiveSplit` branching on `LeaveRequest.Status`

```json
{
  "id": "split_status",
  "type": "ExclusiveSplit",
  "caption": "Which Status?",
  "conditionType": "Enumeration",
  "condition": "$LeaveRequest/Status",
  "enumerationQualifiedName": "LeaveManagement.LeaveRequestStatus"
}
```

`condition` → expression (`$Var/Attr`). `enumerationQualifiedName` → FQN.

### Association traversal in an expression

```json
{
  "id": "act_log_owner_email",
  "type": "LogMessage",
  "level": "Info",
  "node": "LeaveManagement",
  "template": "Approved request from {1}",
  "parameters": ["$LeaveRequest/LeaveManagement.LeaveRequest_Owner/Email"]
}
```

`$LeaveRequest` is a `LeaveRequest` object, so traverse `LeaveRequest_Owner`
(qualified by module because association names are not unique within a
project) to reach the related `Employee`, then read the inherited `Email`
attribute with the short name.

### `Retrieve.xpath` filter on a date range

```
[StartDate >= $FromDate and EndDate <= $ToDate]
```

Inside an XPath bracket, attribute names on the result-set entity are bare
(no `Module.Entity/` prefix — the result-set entity is implicit). Variable
references on the right side use `$Var` or `$Var/Attr`.

---

## Counter-examples — wrong forms an agent might draft

| Wrong                                                                                                                                    | Right                                                              | Why                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"$LeaveRequest/LeaveManagement.LeaveRequest.StartDate"`                                                                                 | `"$LeaveRequest/StartDate"`                                        | The `$LeaveRequest` variable is already typed; the parser tries to navigate `LeaveManagement.LeaveRequest.StartDate` as if it were an association, fails to find it.  |
| `"$SingleEntity/TestEntityMaintenance.TestEntity.BooleanAttr = true"`                                                                    | `"$SingleEntity/BooleanAttr = true"`                               | Same — `$SingleEntity` is already typed, no qualifier needed.                                                                                                         |
| `"$Employee/FullName"` when `$Employee` is typed as the parent `Administration.Account` and `FullName` lives on `Administration.Account` | `"$Employee/FullName"`                                             | Both sides are correct in this case — attributes inherited from a generalization parent are accessed with the same short-name form.                                   |
| `"$Order/Customer.Name"` (mixing module separator and dot)                                                                               | `"$Order/Sales.Order_Customer/Name"`                               | Need to traverse an association to reach a _different_ entity. The association name must be module-qualified; the attribute on the target side is still a short name. |
| `attributeQualifiedName: "StartDate"` on a `MemberChange`                                                                                | `attributeQualifiedName: "LeaveManagement.LeaveRequest.StartDate"` | Identifier fields require FQN — the short form makes the resolver throw.                                                                                              |

---

## Skip the check when…

- The expression has no `/` at all (e.g. `"$Found = true"`, `"true"`, `"1 + 2"`,
  `"empty"`, function calls like `"toString($LeaveRequest/Status)"`). The
  bare-variable / literal forms do not hit this rule.
- The string is a Studio-Pro–authored microflow that already round-trips
  through Studio Pro cleanly. Don't rewrite working expressions — the rule is
  for when _you_ are authoring the expression string.
- The field is an identifier field (see the table above) — those expect FQN
  and are governed by a different consistency rule.

---

## See also

- `../tools/microflows.md` — Tool 25 (`create_microflow`) and Tool 26
  (`create_microflow_activities`), in particular the "Consistency rule" / "Mendix
  expression syntax" box near `MemberChange`. Each activity spec lists which of
  its fields are identifier-form vs expression-form.
- `xpath_currentuser.md` — the canonical `[id = '[%CurrentUser%]']` form;
  shares the same XPath / expression grammar.
- `system_specialization.md` — when reading attributes inherited from a
  System.\* parent, the same short-name form applies
  (`$Attachment/Contents`, `$Attachment/Name`, not
  `$Attachment/System.FileDocument.Contents`).
