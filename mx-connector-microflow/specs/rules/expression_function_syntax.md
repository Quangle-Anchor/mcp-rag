---
audiences: [tool-call]
triggers:
  tool-call: "before authoring any Mendix-expression string for CreateVariable.initialValue, ChangeVariable.value, ExclusiveSplit / LoopedActivity expression conditions, MemberChange.value, LogMessage / ShowMessage / ValidationFeedback template parameters, CallMicroflow / CallNanoflow / JavaScript-action / ShowPage parameter expressions"
status: hard-enforced
enforcer: src/expressionValidator.ts
---

# Mendix Expression Function Syntax — Planning Guidance

Mendix microflows mix two superficially-similar but lexically-disjoint
expression dialects, AND the Mendix-expression dialect itself is restricted
to a fixed set of built-ins. Confusing either rule is a high-cost, deceptive
failure mode: the SDK accepts any string verbatim, and Studio Pro only
catches the mistake later, when the project fails to load with `Function 'X'
is unknown`.

The validator at `src/expressionValidator.ts` blocks **two** classes of this
confusion at write-time:

1. **XPath kebab-case function calls** leaking into Mendix-expression slots
   (`year-from-dateTime`, `current-dateTime`, `starts-with`, …). Detection is
   unambiguous because no Mendix built-in contains a hyphen.
2. **Unknown camelCase function calls** — invented Mendix functions
   (`year()`, `formatInteger()`), JavaScript / Python / Java guesses
   (`parseInt()`, `split()`, `map()`, `now()`), and typos (`getYear()`).
   Detection uses an allow-list derived from
   [`../reference/microflow-expressions.md`](../reference/microflow-expressions.md)
   — the authoritative list of every Mendix-expression built-in.

This document explains the _why_ so the planner can reason about edge cases.

---

## The split that causes the bug

| Dialect               | Where it lives                                                                                                                                                                                                                                                                                                                         | Identifier style           | Examples                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **XPath 2.0**         | Inside the `xpath:` slot of a `Retrieve` activity, and entity-access constraint XPath                                                                                                                                                                                                                                                  | kebab-case                 | `year-from-dateTime`, `current-dateTime`, `starts-with`, `string-length`, `local-name`, `normalize-space`         |
| **Mendix expression** | Every other expression slot: `CreateVariable.initialValue`, `ChangeVariable.value`, `ExclusiveSplit` / `LoopedActivity` expression conditions, `MemberChange.value`, `LogMessage` / `ShowMessage` / `ValidationFeedback` template parameters, `CallMicroflow` / `CallNanoflow` / `JavaScriptAction` / `ShowPage` parameter expressions | camelCase + special tokens | `year`, `daysBetween`, `startsWith`, `length`, `trim`, `formatDateTime`, `[%CurrentUser%]`, `[%CurrentDateTime%]` |

The two dialects share zero built-in function names — no Mendix-expression
built-in contains a hyphen. So a kebab-case function call followed by `(` in
any expression slot is unambiguously XPath leakage.

---

## Decision rule (apply this before authoring an expression)

1. **Identify the slot kind.** If you are writing into the `xpath:` field of a
   Retrieve activity, you are in XPath territory — kebab-case is correct, and
   `xpathValidator.ts` runs there. Otherwise you are in Mendix-expression
   territory.

2. **In a Mendix-expression slot, never use a hyphenated function name.**
   The most common translations:

   | XPath (do NOT use here)                  | Mendix-expression replacement                                          |
   | ---------------------------------------- | ---------------------------------------------------------------------- |
   | `year-from-dateTime($d)`                 | `year($d)`                                                             |
   | `month-from-dateTime($d)`                | `month($d)`                                                            |
   | `day-from-dateTime($d)`                  | `day($d)`                                                              |
   | `hours-from-dateTime($d)`                | `hours($d)`                                                            |
   | `minutes-from-dateTime($d)`              | `minutes($d)`                                                          |
   | `seconds-from-dateTime($d)`              | `seconds($d)`                                                          |
   | `current-dateTime()`                     | `[%CurrentDateTime%]` (a token, not a function)                        |
   | `current-date()`                         | `[%CurrentDateTime%]` (trim with `trimToDays()` if you need date-only) |
   | `starts-with($s, $prefix)`               | `startsWith($s, $prefix)`                                              |
   | `ends-with($s, $suffix)`                 | `endsWith($s, $suffix)`                                                |
   | `string-length($s)`                      | `length($s)`                                                           |
   | `normalize-space($s)`                    | `trim($s)`                                                             |
   | `local-name(...)` / `namespace-uri(...)` | (no equivalent — XPath-only)                                           |

3. **If you do not know whether a hyphenated function has a Mendix
   equivalent**, treat the function as XPath-only and reach for a different
   expression altogether. Studio Pro's reference docs at
   `docs.mendix.com/refguide/expressions/` list every Mendix-expression
   built-in.

4. **Stay inside the camelCase allow-list.** Mendix has no `year()`, no
   `month()`, no `formatInteger()`, no `parseInt()`, no `split()`, no
   `now()`, no trigonometry — the lookalike from XPath / JavaScript / Python
   / Java is silently broken. Common slips and their fixes:

   | Wrong (would commit, fail at project load)         | Fix                                                                                               |
   | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
   | `year($d)` / `getYear($d)`                         | `formatDateTime($d, 'yyyy')` (returns String) or `calendarYearsBetween($d1, $d2)` for differences |
   | `month($d)` / `getMonth($d)`                       | `formatDateTime($d, 'MM')`                                                                        |
   | `day($d)` / `getDay($d)` / `getDate($d)`           | `formatDateTime($d, 'dd')`                                                                        |
   | `hours($d)`                                        | `formatDateTime($d, 'HH')` (24-hour)                                                              |
   | `formatInteger($n)` / `formatLong($n)`             | `toString($n)` or `formatDecimal(toDecimal($n), '#,##0')`                                         |
   | `parseInt($s)`                                     | `parseInteger($s)`                                                                                |
   | `parseFloat($s)` / `parseDouble($s)`               | `parseDecimal($s)`                                                                                |
   | `toInteger($s)`                                    | `parseInteger($s)`                                                                                |
   | `toDecimal($s)`                                    | `parseDecimal($s)`                                                                                |
   | `now()`                                            | `[%CurrentDateTime%]` (a token, not a function)                                                   |
   | `today()`                                          | `trimToDays([%CurrentDateTime%])`                                                                 |
   | `currentUser()`                                    | `[%CurrentUser%]`                                                                                 |
   | `indexOf($s, $sub)`                                | `find($s, $sub)`                                                                                  |
   | `concat($a, $b)`                                   | `$a + $b`                                                                                         |
   | `split($s, $sep)` / `join($list, $sep)`            | Tokenize / join in a microflow loop or a Java action                                              |
   | `map($list, …)` / `filter($list, …)` / `reduce(…)` | Iterate via `LoopedActivity`; aggregate via `AggregateList`                                       |
   | `sin / cos / tan / ln / log / exp`                 | Trigonometry / logarithms must be a Java action                                                   |

   The validator's allow-list is the same set documented in
   [`../reference/microflow-expressions.md`](../reference/microflow-expressions.md).
   If a function is not in that file, it does not exist in Mendix
   expressions — full stop.

---

## What it looks like at runtime

### Kebab-case XPath leak

```
[activity 'createFiscalYear' (CreateVariable.initialValue)] Expression
contains 'year-from-dateTime(...)', which is an XPath 2.0 function, not a
Mendix-expression function.
  Expression: year-from-dateTime($LeaveRequest/StartDate)
  Reason: Mendix accepts the string verbatim at commit time; Studio Pro
  then fails project load with "Function 'year-from-dateTime' is unknown".
  Fix: Use the Mendix-expression equivalent instead: year($d).
  XPath functions are only valid inside Retrieve activity 'xpath:'
  constraints — never in CreateVariable.initialValue, ChangeVariable.value,
  ExclusiveSplit / LoopedActivity expression conditions, MemberChange.value,
  message-template parameters, or CallMicroflow argument expressions.
  See specs/rules/expression_function_syntax.md.
```

### Unknown camelCase function call

```
[activity 'fiscalYear' (CreateVariable.initialValue)] Expression calls
'year(...)', which is not a Mendix-expression built-in.
  Expression: year($LeaveRequest/StartDate)
  Reason: Mendix accepts the string verbatim at commit time; Studio Pro
  then fails project load with "Function 'year' is unknown".
  Fix: Mendix expressions have no year() function. Use formatDateTime($d,
  'yyyy') to get the year as a String; for differences use
  calendarYearsBetween($d1, $d2) (returns Integer/Long).
  See specs/reference/microflow-expressions.md for the authoritative
  function list and specs/rules/expression_function_syntax.md for the
  planner-facing rationale.
```

In both cases the tool call fails — no partial state is written. Recovering
means re-issuing the call with a valid Mendix-expression form.

---

## Skip the prompt when…

- The string is the value of a `xpath:` slot on a Retrieve activity (the
  validator does not run there — that path is covered by
  `src/xpathValidator.ts`).
- The string is `undefined` or empty — the validator returns early.
- The hyphen appears inside a single-quoted string literal, e.g.
  `formatDateTime($d, 'yyyy-MM-dd')`. The validator strips single-quoted
  segments before scanning, so this case is safe.

---

## See also

- [`../reference/microflow-expressions.md`](../reference/microflow-expressions.md)
  — the authoritative function list. The validator's allow-list is derived from
  this file. When Mendix ships a new built-in, add it to both.
- `expression_attribute_paths.md` — the matching dialect rule for variable /
  attribute references inside expressions (`$Var/Attr` vs the FQN form).
- `xpath_currentuser.md` — the canonical XPath form for `[%CurrentUser%]`,
  enforced by `src/xpathValidator.ts`.
- `enum_value_in_expression.md` — enum literals in expression slots must use
  the FQN constant (`Module.Enum.VALUE`) rather than a bare string literal.
- `../tools/microflows.md` — the per-tool reference.
- `mx-connect/src/expressionValidator.ts` — the canonical enforcement code.
