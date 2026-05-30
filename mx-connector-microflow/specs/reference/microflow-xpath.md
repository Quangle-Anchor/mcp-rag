# XPath Constraints Reference

> ⚠️ **CRITICAL:** XPath is ONLY for database filtering in retrieve activities. Do NOT use for calculations or general logic (use Expressions instead).  
> **IMPORTANT DISTINCTION:** Mendix XPath differs from standard XPath — follow the syntax below.

This skill enables you to construct XPath constraints for filtering objects in microflow retrieve actions. XPath constraints use a subset of XPath syntax and are always enclosed in square brackets `[]`.

> **Note:** In Studio Pro you only write constraints (not full XPath queries), and not all XPath operators are supported.

## Syntax Rules

- All XPath constraints MUST be enclosed in square brackets: `[constraint]`
- Attribute names are referenced directly without prefixes: `[Price > 100]`
- String literals use single quotes: `[Name = 'John']`
- Association paths use forward slashes: `[Module.Product_Order/Module.Order/Module.Order_Customer/Module.Customer]`
- System variables use the `'[%VariableName%]'` format: `[CreatedDate >= '[%BeginOfCurrentMonth%]']`
- Microflow variables use the `$VariableName` format: `[Price > $MinPrice]`
- Parentheses are used for grouping: `[(Name = 'Jansen' or Name = 'Smit') and Sales.Customer_Address/Sales.Address/City = 'Rotterdam']`
- Attribute names are case-sensitive and must match exactly

## Operators

> **Note:** All operators apply inside the `[]` constraint.

| Operator | Description |
|----------|-------------|
| `=` | Equal to |
| `!=` | Not equal to |
| `<` | Less than |
| `<=` | Less than or equal to |
| `>` | Greater than |
| `>=` | Greater than or equal to |
| `or` | Logical or |
| `and` | Logical and |
| `+` | Addition |
| `-` | Subtraction |
| `*` | Multiplication |
| `div` | Division |

**Examples:**
```
[Price >= 9.70 and Price < 9.80]
[TotalItems * Price >= 1000]
```

## Functions

### Boolean Functions

> **Note:** Boolean literals can be `true()` or `false()`; `'true'`/`'false'` and `true`/`false` (due to implicit type conversion) are also accepted.

| Function | Returns |
|----------|---------|
| `true()` | Boolean literal true |
| `false()` | Boolean literal false |
| `not(x)` | Boolean negation |

### String Functions

> **Note:** String comparisons are generally case-insensitive, depending on database collation.

| Function | Signature | Returns |
|----------|-----------|---------|
| `length(attribute_or_string)` | String | Integer |
| `string-length(attribute_or_string)` | String | Integer (alias for `length()`) |
| `contains(attribute, substring)` | String, String | Boolean |
| `starts-with(attribute, prefix)` | String, String | Boolean |
| `ends-with(attribute, suffix)` | String, String | Boolean |

### Date and Time Functions

> **Note:** Timezone variants accept an IANA timezone or `'UTC'`. GMT offsets are not supported. If omitted, the server timezone is used.  
> **Rule:** Only the functions listed here are supported in XPath constraints.

| Function | Description |
|----------|-------------|
| `year-from-dateTime(attribute, timezone?)` | Extract year |
| `month-from-dateTime(attribute, timezone?)` | Extract month |
| `day-from-dateTime(attribute, timezone?)` | Extract day |
| `hours-from-dateTime(attribute, timezone?)` | Extract hours |
| `minutes-from-dateTime(attribute, timezone?)` | Extract minutes |
| `seconds-from-dateTime(attribute, timezone?)` | Extract seconds |
| `quarter-from-dateTime(attribute, timezone?)` | Extract quarter |
| `day-of-year-from-dateTime(attribute, timezone?)` | 1–366 |
| `week-from-dateTime(attribute, timezone?)` | 1–53 (depends on database) |
| `weekday-from-dateTime(attribute, timezone?)` | Mapping depends on database |

**Examples:**
```
[not(Name = 'Jansen')]
[length(FirstName) >= 5]
[year-from-dateTime(DateAttribute, 'America/New_York') = 2011]
```

## Special Checks

- `= empty`: Check if object or member is empty. `empty` can only be used as a value
- **Exists:** Association path evaluates to `true` if at least one related object exists

**Examples:**
```
[Attribute = empty]
[Sales.Customer_Order/Sales.Order]
```

## Implicit Type Conversions

- **Number to String:** Numeric in string context converts to string
- **String to Number:** Numeric strings in numeric context convert to number

**General conversion rule:** If both sides are plain values and have different types, one side is converted to the type that occurs first in this order:

1. Date and time
2. Boolean
3. Decimal
4. Integer/Long
5. String

## Variables

### Microflow Variables

`$VariableName` — Microflow parameter or variable

### System Variables

**User and Context Variables**

| Variable | Description |
|----------|-------------|
| `'[%CurrentUser%]'` | GUID of the current user |
| `'[%CurrentObject%]'` | GUID of the current context object |
| `'[%UserRole_Administrator%]'` | Administrator user role |

**Date and Time Variables**

| Variable | Description |
|----------|-------------|
| `'[%CurrentDateTime%]'` | Current date and time |

Time period variables follow the pattern `'[%Begin/End + Period + UTC?%]'`:

| Period | Variables |
|--------|-----------|
| Day | `'[%BeginOfCurrentDay%]'`, `'[%EndOfCurrentDay%]'`, `'[%BeginOfYesterday%]'`, `'[%EndOfYesterday%]'`, `'[%BeginOfTomorrow%]'`, `'[%EndOfTomorrow%]'` |
| Week | `'[%BeginOfCurrentWeek%]'`, `'[%EndOfCurrentWeek%]'` |
| Month | `'[%BeginOfCurrentMonth%]'`, `'[%EndOfCurrentMonth%]'` |
| Year | `'[%BeginOfCurrentYear%]'`, `'[%EndOfCurrentYear%]'` |
| Hour/Minute | `'[%BeginOfCurrentHour%]'`, `'[%EndOfCurrentHour%]'`, `'[%BeginOfCurrentMinute%]'`, `'[%EndOfCurrentMinute%]'` |

UTC variants are available by appending `UTC` (e.g., `'[%BeginOfCurrentDayUTC%]'`).

**Time Length Variables**

| Variable | Description |
|----------|-------------|
| `'[%DayLength%]'` | Length of one day |
| `'[%HourLength%]'` | Length of one hour |
| `'[%MinuteLength%]'` | Length of one minute |
| `'[%SecondLength%]'` | Length of one second |
| `'[%WeekLength%]'` | Length of one week |
| `'[%MonthLength%]'` | Length of one month |
| `'[%YearLength%]'` | Length of one year |

**Examples:**
```
[Price > $MinPrice]
[contains(Name, $SearchTerm)]
[id = '[%CurrentUser%]']
```

## Common Patterns

### Filtering by Association

```
[Module.Association/Entity]                          -- Association exists
[Module.Association/Entity/Attribute = 'value']      -- Filter through association
[not(Module.Association/Entity)]                     -- Association does not exist
```

### Combining Multiple Conditions

```
[Condition1 and Condition2 and Condition3]
[Condition1 or Condition2]
[(Condition1 or Condition2) and Condition3]
```

### Date Range Filtering

> **Rule:** When combining a time period variable with a time length variable (e.g., `- 30 * [%DayLength%]`), the entire expression must be inside a single-quoted string.

```
✅ Good: [DateAttribute >= '[%BeginOfCurrentDay%] - 30 * [%DayLength%]']
❌ Bad:  [DateAttribute >= '[%BeginOfCurrentDay%]' - 30 * '[%DayLength%]']
```

### Text Search Patterns

```
[contains(Name, $SearchTerm)]
[contains(Name, $SearchTerm) or contains(Email, $SearchTerm)]
[starts-with(Code, 'PRE')]
[ends-with(Email, '@company.com')]
```

### Empty and Null Checks

```
[Attribute = empty]
[Attribute != empty]
[Module.Association/Entity]
[not(Module.Association/Entity)]
```

## Example Constraints

### Simple Comparisons
```
[Age >= 18]
[Status = 'Active']
```

### Date Filtering
```
[CreatedDate >= '[%BeginOfCurrentMonth%]']
[year-from-dateTime(BirthDate) = 1990]
```

### Association-based Filtering
```
[Sales.Customer_Order/Sales.Order]
[Sales.Customer_Order/Sales.Order/TotalAmount > 1000]
```

### Text Search
```
[contains(Name, $SearchTerm) or contains(Email, $SearchTerm)]
```

### Complex Conditions
```
[(Status = 'Active' or Status = 'Pending') and ExpiryDate > '[%CurrentDateTime%]']
```

### Using System Variables
```
[CreatedById = '[%CurrentUser%]']
```

## Anti-Patterns (DO NOT USE)

- ❌ Do not use unsupported XPath functions like `substring()`, `concat()`, `round()`, `sum()`, `count()`
- ❌ Do not use double quotes for strings – always use single quotes: `'text'` not `"text"`
- ❌ Do not use SQL operators like `LIKE`, `IN`, `BETWEEN`, `IS NULL`
- ❌ Do not use JavaScript/Python operators like `===`, `!==`, `&&`, `||`, `%` (use `div` for division)
- ❌ Do not nest functions excessively – keep expressions simple for performance
- ❌ Do not access deeply nested associations (more than 2–3 levels) – this impacts performance

## Troubleshooting

### Performance Tips

- Index frequently filtered attributes in your domain model
- Avoid deep association paths (more than 2–3 levels)
- Use specific conditions rather than broad `or` clauses
- Consider database retrieval limits to prevent performance issues
- Test with realistic data volumes

### Common Errors

| Error | Solution |
|-------|----------|
| "Invalid XPath" | Check for balanced brackets and proper syntax |
| Empty results | Verify attribute names match your entity exactly (case-sensitive) |
| Type mismatch | Ensure comparisons use compatible types |
| Function not supported | Verify you are using only the functions listed in this reference |
| Association path errors | Check that association paths exist and are spelled correctly with `Module.Association/Entity` format |

## Critical Constraints

> ⚠️ ONLY use the functions and operators documented above – Using unsupported functions will cause runtime errors  
> ⚠️ XPath constraints MUST always start and end with square brackets `[ ]`  
> ⚠️ Keep XPath constraints as simple as possible for better performance and maintainability  
> ⚠️ Attribute names are case-sensitive – they must match exactly as defined in the domain model  
> ⚠️ Use single quotes for string literals, never double quotes  
> ⚠️ Test your XPath constraints with realistic data to ensure correct filtering and performance  
> ⚠️ System variables must always be enclosed in single quotes, square brackets and percentage characters: `'[%SystemVariableName%]'`
