---
audiences: [tool-call]
triggers:
  tool-call: "before authoring any XPath constraint for Retrieve.source.xpath, datasource-microflow filter XPath, ListView / DataGrid2 source XPath, or entity-access constraint XPath"
status: hard-enforced
enforcer: src/xpathValidator.ts
---

# Mendix XPath Function Syntax — Planning Guidance

Mendix XPath is a tightly restricted dialect: only the functions catalogued
in [`../reference/microflow-xpath.md`](../reference/microflow-xpath.md) are
supported. Any other call — a general XPath 1.0 / 2.0 function (`count()`,
`sum()`, `substring()`, `concat()`, `normalize-space()`, `position()`), a
JavaScript-style typo (`startsWith()` instead of `starts-with()`,
`yearFromDateTime()` instead of `year-from-dateTime()`), or an invented
helper — commits cleanly through the SDK but the runtime rejects it at
retrieve time with `Function 'X' is unknown` / `Unsupported XPath
function`. Sometimes the rejection only fires on specific code paths, which
makes the bug intermittent and hard to attribute.

The validator at `src/xpathValidator.ts` blocks **three** classes of XPath
mistake at write-time:

1. **`System.User_Account` antipattern** — see
   [`xpath_currentuser.md`](./xpath_currentuser.md).
2. **`Account = '[%CurrentUser%]'` antipattern** — see
   [`xpath_currentuser.md`](./xpath_currentuser.md).
3. **Unknown XPath function calls** — covered here.

---

## The allow-list (the only functions Mendix XPath understands)

| Category                                       | Functions                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boolean                                        | `true()`, `false()`, `not($x)`                                                                                                                                                                                                                 |
| String                                         | `length($s)`, `string-length($s)`, `contains($s, $sub)`, `starts-with($s, $prefix)`, `ends-with($s, $suffix)`                                                                                                                                  |
| Date / time extractors (optional timezone arg) | `year-from-dateTime`, `month-from-dateTime`, `day-from-dateTime`, `hours-from-dateTime`, `minutes-from-dateTime`, `seconds-from-dateTime`, `quarter-from-dateTime`, `day-of-year-from-dateTime`, `week-from-dateTime`, `weekday-from-dateTime` |

System variables (`'[%CurrentDateTime%]'`, `'[%CurrentUser%]'`, …) and
microflow variables (`$Foo`) are **not** functions — they're literals /
references. They pass through the validator unchanged.

---

## Decision rule (apply this before authoring an XPath constraint)

1. **Identify the slot.** If you are writing into `Retrieve.source.xpath`,
   datasource-microflow filter XPath, list-widget source XPath, or an
   entity-access constraint, you are in XPath territory. Anything else is
   probably Mendix-expression territory — see
   [`expression_function_syntax.md`](./expression_function_syntax.md).

2. **Mendix XPath uses kebab-case.** The five string functions and ten date
   extractors above are the only ones — and they ALL use kebab-case. If you
   find yourself reaching for camelCase (`startsWith`, `yearFromDateTime`),
   you've crossed dialects.

3. **If a function isn't on the allow-list, it doesn't exist in Mendix
   XPath — even if it looks like a "standard" XPath function.** General
   XPath 1.0 / 2.0 has `substring()`, `concat()`, `count()`, `sum()`,
   `position()`, `last()`, `normalize-space()`, `translate()` and many
   others. Mendix supports **none** of them. Workarounds:

   | Wrong (would commit, fail at retrieve time)  | Fix                                                                                                                      |
   | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
   | `substring($s, 0, 3) = 'PRE'`                | `starts-with($s, 'PRE')` (or pre-process in a microflow expression and pass as `$Prefix`)                                |
   | `concat($a, $b) = 'foo'`                     | Compose the string in a microflow expression with `+` and pass as `$Composed`                                            |
   | `count(Module.Assoc/Entity) > 0`             | Use the existence form: `[Module.Assoc/Entity]`. Or retrieve into a list and use `AggregateList Count` in the microflow. |
   | `sum(Module.Assoc/Entity/Amount) > 100`      | Retrieve into a list; use `AggregateList Sum` with `attribute = Module.Entity.Amount`                                    |
   | `position() = 1`                             | XPath constraints are filters, not ordered queries. Sort + limit in the Retrieve activity's range/sort.                  |
   | `last()`                                     | Same — sort/limit at the Retrieve level.                                                                                 |
   | `normalize-space($s) = 'foo'`                | `trim($s)` in a microflow expression and pass as `$Trimmed`.                                                             |
   | `current-dateTime() > $d`                    | `'[%CurrentDateTime%]' > $d` (use the system-variable form, not a function)                                              |
   | `startsWith($s, 'PRE')`                      | `starts-with($s, 'PRE')` — kebab                                                                                         |
   | `yearFromDateTime($d) = 2024`                | `year-from-dateTime($d) = 2024` — kebab                                                                                  |
   | `length($s) > 5` and `string-length($s) > 5` | Both valid; either form.                                                                                                 |

4. **Pre-process in a microflow expression when XPath can't do it.** XPath
   is for filtering, not transformation. If the predicate needs string
   manipulation, arithmetic, casting, or aggregation, compute the value /
   filter the list in a microflow activity and only the final filter
   condition appears in XPath.

---

## What it looks like at runtime

Calling `create_microflow` (or any tool that writes XPath:
`create_microflow_activities`, `insert_before_activity`,
`modify_microflow_activity`, `create_nanoflow`, `update_nanoflow`,
`set_calculated_attribute` if the calc-microflow contains an XPath) with
an unknown XPath function fails with an error like:

```
[activity 'retrieveBalance' (Retrieve.xpath)] XPath calls 'count(...)',
which is not a Mendix-XPath built-in.
  XPath: [count(Module.Assoc/Entity) > 0]
  Reason: Mendix XPath supports a tightly restricted function set. The SDK
  accepts the string verbatim; the runtime rejects it at retrieve time
  with "Function 'count' is unknown" or "Unsupported XPath function".
  Fix: Mendix XPath has no count(). Use the AggregateList activity with
  function=Count on the retrieved list.
  See specs/reference/microflow-xpath.md for the authoritative function
  list and specs/rules/xpath_function_syntax.md for the planner-facing
  rationale.
```

The tool call fails — no partial state is written. Recovering means
re-issuing the call with a valid Mendix-XPath form.

---

## Skip the prompt when…

- The string is the value of a Mendix-expression slot (`CreateVariable.initialValue`,
  `ChangeVariable.value`, etc.). XPath functions in Mendix-expression slots
  are caught by [`expression_function_syntax.md`](./expression_function_syntax.md)
  and `src/expressionValidator.ts`, not here.
- The string is `undefined` or empty — the validator returns early.
- The function-name-shaped substring lives inside a single-quoted string
  literal (`contains(Name, 'starts-with-foo')`). The validator strips quoted
  segments before scanning, so this case is safe.

---

## See also

- [`../reference/microflow-xpath.md`](../reference/microflow-xpath.md) — the
  authoritative XPath function list. The validator's allow-list is derived
  from this file. When Mendix ships a new XPath function, add it to both.
- [`expression_function_syntax.md`](./expression_function_syntax.md) — the
  sister rule for Mendix-expression slots (camelCase dialect, different
  function set).
- [`xpath_currentuser.md`](./xpath_currentuser.md) — the canonical
  `[id = '[%CurrentUser%]']` rule (Classes 1 and 2 in the validator).
- `../tools/microflows.md` — per-tool reference for the slots that get
  validated (Retrieve.xpath in particular).
- `mx-connect/src/xpathValidator.ts` — the canonical enforcement code.
