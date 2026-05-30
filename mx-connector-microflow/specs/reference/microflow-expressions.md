# Mendix Expression Language Reference

> ⚠️ **CRITICAL:** Expressions are for calculations and logic inside non-retrieve activities. Do NOT use for database filtering (use XPath instead).

## Syntax Rules

- String literals MUST use single quotes: `'text'` (never double quotes)
- Escape a single quote by doubling it: `'I''m a developer'` results in `I'm a developer`
- Variables are prefixed with `$`: `$Variable`, `$Customer`
- Object attributes use slash notation: `$Object/Attribute`
- Attribute names are case-sensitive: Must match the domain model exactly
- Associations use slash notation: `$Customer/ModuleName.Association_Name/ModuleName.EntityName/Attribute`
- Constants use `@` prefix: `@ModuleName.ConstantName`
- Enumerations use dot notation: `ModuleName.EnumName.EnumValue`
- No comments allowed in expressions
- All parentheses must be balanced in function calls and conditions

> ⚠️ **CRITICAL:** Always verify that attributes and associations exist in the domain model before using them.

## System Variables (Microflows)

| Variable | Description |
|----------|-------------|
| `$latestError` | Object of type `System.Error` containing attributes for the latest error |
| `$latestSoapFault` | Object of type `System.SoapFault` containing attributes for the latest SOAP fault |
| `$latestHttpResponse` | Object of type `System.HttpResponse` containing attributes for the latest HTTP response |
| `$currentSession` | Object of type `System.Session` containing attributes for the current session |
| `$currentUser` | Object of type `System.User` containing attributes for the currently signed-in user |
| `$currentDeviceType` | Enumeration `System.DeviceType` containing the type of the current user's device |

## Operators

> **Rule:** Comparisons with `empty` are only valid for `=` and `!=`; other comparisons error if either side is empty.

| Operator | Description | Types |
|----------|-------------|-------|
| `+`, `-`, `*`, `div`, `:`, `mod` | Arithmetic | Numeric → Numeric |
| `<`, `>`, `<=`, `>=`, `=`, `!=` | Comparison | Returns Boolean |
| `and`, `or` | Boolean logic | Boolean → Boolean |
| `not(x)` | Negation | Boolean → Boolean |
| Unary `-` | Negation | Numeric → Numeric |

**Examples:**
```
3 div 5    → 0.6
4 > 3      → true
not($IsValid)
```

## Special Checks

> **Caution:** Evaluation is left-to-right, so check `empty` before accessing attributes.

- `= empty`: Check if object or member is empty. Boolean result. `empty` can only be used as a value
- `isNew(object)`: Boolean. True for newly created, not yet committed objects

**Examples:**
```
$Order = empty or $Order/Status = MyModule.OrderStatus.Completed
isNew($Customer)
```

## Conditional Expressions

```
if <condition> then <a value> else <other value>
```

**Example:**
```
if 7 > 6 then 'correct' else 'incorrect'
```

## Math Functions

> **Note:** Rounding mode depends on the app setting (commercial vs bankers rounding).

| Function | Signature | Returns |
|----------|-----------|---------|
| `abs(n)` | Numeric | Numeric |
| `ceil(n)` | Numeric | Integer/Long |
| `floor(n)` | Numeric | Integer/Long |
| `max(n1, n2, ...)` | Numeric or Date and time | Same type |
| `min(n1, n2, ...)` | Numeric or Date and time | Same type |
| `pow(n, p)` | Numeric | Decimal |
| `random()` | — | Decimal between 0.0 and 1.0 |
| `round(n)` | Numeric | Integer/Long |
| `round(n, precision)` | Numeric, Integer/Long | Decimal |
| `sqrt(n)` | Numeric | Decimal (error on negative) |

**Example:**
```
round(3.5)  → 4
```

## String Functions

> **Note:** Strings use single quotes and are case-sensitive. `isMatch` is implicitly anchored. `replaceAll` and `replaceFirst` do not support backreferences.

| Function | Signature | Returns |
|----------|-----------|---------|
| `toLowerCase(string)` | String | String |
| `toUpperCase(string)` | String | String |
| `substring(string, start)` | String, Integer | String (errors if start past end) |
| `substring(string, start, length)` | String, Integer, Integer | String (errors if length too long) |
| `find(string, substring)` | String, String | Integer (index or -1) |
| `find(string, substring, start)` | String, String, Integer | Integer |
| `findLast(string, substring)` | String, String | Integer (index or -1) |
| `findLast(string, substring, lastIndex)` | String, String, Integer | Integer |
| `contains(string, substring)` | String, String | Boolean (empty substring returns true) |
| `startsWith(string, prefix)` | String, String | Boolean |
| `endsWith(string, suffix)` | String, String | Boolean |
| `trim(string)` | String | String |
| `isMatch(string, regex)` | String, String | Boolean |
| `replaceAll(string, regex, replace)` | String, String, String | String |
| `replaceFirst(string, regex, replace)` | String, String, String | String |
| `urlEncode(string)` | String | String |
| `urlDecode(string)` | String | String |
| `+ (concatenation)` | String + (String\|Number) | String |

**Examples:**
```
substring('Hello World', 6)           → 'World'
isMatch('test123', '[a-z]+[0-9]+')    → true
urlEncode('Hello, world!')            → 'Hello%2C+world%21'
```

## Date and Time Functions

### Date Creation

> **Rule:** Accepts 1 to 6 fixed literal values only (no variables or attributes). Use `parseDateTime()` for variable input.  
> **Rule:** Valid ranges — year ≥ 1800, month 1–12, day 1–31, hour 0–23, minute 0–59, second 0–59.

| Function | Returns |
|----------|---------|
| `dateTime(year, month, day, hour, minute, second)` | Date and time (local) |
| `dateTimeUTC(year, month, day, hour, minute, second)` | Date and time (UTC) |

**Example:**
```
dateTime(2024, 12, 31, 23, 59, 59)
```

### Date Boundary Functions

| Function | Returns |
|----------|---------|
| `beginOfDay(dateTime)` | Date and time |
| `beginOfWeek(dateTime)` | Date and time |
| `beginOfMonth(dateTime)` | Date and time |
| `beginOfYear(dateTime)` | Date and time |
| `endOfDay(dateTime)` | Date and time |
| `endOfWeek(dateTime)` | Date and time |
| `endOfMonth(dateTime)` | Date and time |
| `endOfYear(dateTime)` | Date and time |

**Example:**
```
beginOfDay([%CurrentDateTime%])
```

### Date Difference Functions

> **Behavior:** Differences are absolute. `calendarMonthsBetween` and `calendarYearsBetween` ignore time and return Integer/Long.

| Function | Returns |
|----------|---------|
| `millisecondsBetween(dateTime1, dateTime2)` | Decimal |
| `secondsBetween(dateTime1, dateTime2)` | Decimal |
| `minutesBetween(dateTime1, dateTime2)` | Decimal |
| `hoursBetween(dateTime1, dateTime2)` | Decimal |
| `daysBetween(dateTime1, dateTime2)` | Decimal |
| `weeksBetween(dateTime1, dateTime2)` | Decimal |
| `calendarMonthsBetween(dateTime1, dateTime2)` | Integer/Long |
| `calendarYearsBetween(dateTime1, dateTime2)` | Integer/Long |

**Example:**
```
daysBetween([%CurrentDateTime%], $Task/DueDate)
```

### Add Time Functions

> **Note:** UTC variants exist for days, weeks, months, quarters, years (e.g., `addDaysUTC`). You can pass Long values.

| Function | Returns |
|----------|---------|
| `addMilliseconds(dateTime, milliseconds)` | Date and time |
| `addSeconds(dateTime, seconds)` | Date and time |
| `addMinutes(dateTime, minutes)` | Date and time |
| `addHours(dateTime, hours)` | Date and time |
| `addDays(dateTime, days)` | Date and time |
| `addWeeks(dateTime, weeks)` | Date and time |
| `addMonths(dateTime, months)` | Date and time |
| `addQuarters(dateTime, quarters)` | Date and time |
| `addYears(dateTime, years)` | Date and time |

**Example:**
```
addDays([%CurrentDateTime%], 7)
```

### Subtract Time Functions

> **Note:** UTC variants exist for days, weeks, months, quarters, years (e.g., `subtractDaysUTC`). You can pass Long values.

| Function | Returns |
|----------|---------|
| `subtractMilliseconds(dateTime, milliseconds)` | Date and time |
| `subtractSeconds(dateTime, seconds)` | Date and time |
| `subtractMinutes(dateTime, minutes)` | Date and time |
| `subtractHours(dateTime, hours)` | Date and time |
| `subtractDays(dateTime, days)` | Date and time |
| `subtractWeeks(dateTime, weeks)` | Date and time |
| `subtractMonths(dateTime, months)` | Date and time |
| `subtractQuarters(dateTime, quarters)` | Date and time |
| `subtractYears(dateTime, years)` | Date and time |

**Example:**
```
subtractMonths([%CurrentDateTime%], 3)
```

### Trim Functions

> **Note:** UTC variants exist for hours, days, months, years (e.g., `trimToDaysUTC`).

| Function | Returns |
|----------|---------|
| `trimToSeconds(dateTime)` | Date and time |
| `trimToMinutes(dateTime)` | Date and time |
| `trimToHours(dateTime)` | Date and time |
| `trimToDays(dateTime)` | Date and time |
| `trimToMonths(dateTime)` | Date and time |
| `trimToYears(dateTime)` | Date and time |

**Example:**
```
trimToDays([%CurrentDateTime%])
```

## Type Conversion Functions

### Basic Conversions

> **Note:** `toString(empty)` returns an empty string. If parsing fails and no default is provided, an error occurs.

| Function | Signature | Returns |
|----------|-----------|---------|
| `toString(value)` | Any | String (for enums returns the key, not the caption) |
| `length(string)` | String | Integer |
| `length(list)` | List | Integer |
| `parseInteger(string)` | String | Integer/Long |
| `parseInteger(string, default)` | String, Integer/Long | Integer/Long |

**Example:**
```
parseInteger('not_a_number', 42)  → 42
```

### Decimal Parse and Format

**Format pattern special characters:**

| Character | Meaning |
|-----------|---------|
| `0` | Digit (required) |
| `#` | Digit (optional) |
| `.` | Decimal separator |
| `,` | Grouping separator |
| `-` | Minus sign |
| `E` | Scientific notation exponent (use `E` + one or more `0`; no grouping with `E`) |
| `;` | Separates positive/negative subpatterns |
| `%` | Multiply by 100 and show percent |
| `U+2030` | Multiply by 1000 and show per mille |
| `U+00A4` | Currency sign (double for international currency) |
| `'` | Quote specials in prefix/suffix; use `''` for a literal `'` |

> **Locale:** Affects decimal/grouping separators and currency symbol. Use IETF BCP 47 (e.g., `en`, `en-US`, `fr-FR`).  
> **Note:** If parsing fails and no default is provided, an error occurs.

| Function | Signature | Returns |
|----------|-----------|---------|
| `parseDecimal(string)` | String | Decimal |
| `parseDecimal(string, default)` | String, Decimal/empty | Decimal |
| `parseDecimal(string, format, default)` | String, String, Decimal/empty | Decimal |
| `formatDecimal(decimal, format)` | Decimal, String | String |
| `formatDecimal(decimal, format, locale)` | Decimal, String, String | String |

**Examples:**
```
parseDecimal('3,241.98', '#,###.##')  → 3241.98
formatDecimal(0.256, '0.0%')          → '25.6%'
```

### Date Parse and Format

> **Caution:** UTC variants exist. Avoid UTC variants in client-side expressions when assigning to non-localized Date and time attributes. If parsing fails and no default is provided, an error occurs.

| Function | Signature | Returns |
|----------|-----------|---------|
| `parseDateTime(string, format)` | String, String | Date and time |
| `parseDateTime(string, format, default)` | String, String, Date and time | Date and time |
| `parseDateTimeUTC(string, format)` | String, String | Date and time (UTC) |
| `parseDateTimeUTC(string, format, default)` | String, String, Date and time | Date and time (UTC) |
| `formatDateTime(dateTime)` | Date and time | String |
| `formatDateTime(dateTime, format)` | Date and time, String | String |
| `formatDateTimeUTC(dateTime)` | Date and time | String |
| `formatDateTimeUTC(dateTime, format)` | Date and time, String | String |
| `formatTime(dateTime)` | Date and time | String |
| `formatTimeUTC(dateTime)` | Date and time | String |
| `formatDate(dateTime)` | Date and time | String |
| `formatDateUTC(dateTime)` | Date and time | String |
| `dateTimeToEpoch(dateTime)` | Date and time | Integer/Long |
| `epochToDateTime(epoch)` | Integer/Long | Date and time |

**Examples:**
```
formatDateTime([%CurrentDateTime%], 'yyyy-MM-dd HH:mm:ss')
dateTimeToEpoch([%CurrentDateTime%])
```

## Enumeration Functions

| Function | Returns |
|----------|---------|
| `getCaption(enum)` | String (localized caption) |
| `getKey(enum)` | String (technical key) |

**Example:**
```
getCaption($Customer/Status)
```

## Enumeration Values in Expressions

Enum values in **Mendix expressions** (microflow values, conditions, parameters) are referenced with their **fully qualified constant**: `ModuleName.EnumName.VALUE`. The bare-quoted form `'VALUE'` is a String literal, not an Enumeration — using it in an enum-typed slot triggers a type mismatch ("`The expression 'VALUE' has type String, but Enumeration was expected.`").

| Context | Form |
|---|---|
| Comparing an enum attribute | `$LR/Status = LeaveManagement.Enum_LeaveStatus.PENDING` |
| Setting an enum attribute via `MemberChange.value` | `LeaveManagement.Enum_LeaveStatus.PENDING` |
| Initialising an enum-typed variable | `LeaveManagement.Enum_LeaveStatus.DRAFT` |
| Passing an enum to a microflow parameter | `LeaveManagement.Enum_LeaveStatus.PENDING` |

> **XPath is different.** Inside `Retrieve.source.xpath` and entity-access XPath, enum values ARE written as bare-quoted literals: `[Status = 'PENDING']`. That is the XPath grammar, not Mendix-expression grammar. See [`../rules/enum_value_in_expression.md`](../rules/enum_value_in_expression.md) for the full Pattern A / Pattern B split.

**Examples:**

```
$LeaveRequest/Status = LeaveManagement.Enum_LeaveStatus.PENDING
LeaveManagement.Enum_LeaveStatus.APPROVED
getCaption(LeaveManagement.Enum_LeaveStatus.PENDING)
```

## Runtime Variables

> **Note:** Date/time variables are also available in UTC format (e.g., `[%CurrentDateTimeUTC%]`).

- `[%BeginOfCurrentDay%]`
- `[%BeginOfCurrentHour%]`
- `[%BeginOfCurrentMinute%]`
- `[%BeginOfCurrentWeek%]`
- `[%BeginOfCurrentMonth%]`
- `[%BeginOfCurrentYear%]`
- `[%BeginOfTomorrow%]`
- `[%BeginOfYesterday%]`
- `[%CurrentDateTime%]`
- `[%EndOfCurrentDay%]`
- `[%EndOfCurrentHour%]`
- `[%EndOfCurrentMinute%]`
- `[%EndOfCurrentWeek%]`
- `[%EndOfCurrentMonth%]`
- `[%EndOfCurrentYear%]`
- `[%EndOfTomorrow%]`
- `[%EndOfYesterday%]`
- `[%CurrentUser%]`: Current user object

## Formatting

Expressions can be split across lines with whitespace for readability. Keep it consistent within a microflow.

## Anti-Patterns (DO NOT USE)

- ❌ Do not use double quotes for strings – always use single quotes: `'text'` not `"text"`
- ❌ Do not use unsupported functions like `split()`, `join()`, `map()`, `filter()`
- ❌ Do not use JavaScript/Python operators like `===`, `!==`, `&&`, `||`, `++`, `--`
- ❌ Do not use the modulo operator `%` – use `mod` instead: `10 mod 3`
- ❌ Do not chain multiple attribute accesses without checking for empty: Check `$Order != empty` first
- ❌ Do not use overly complex nested expressions – break them into multiple microflow activities
- ❌ Do not assume attributes exist – verify the domain model structure first

## Troubleshooting

### Common Errors

| Error | Solution |
|-------|----------|
| "Cannot read attribute of empty object" | Add null checks with `$Object != empty` |
| "Type mismatch" | Ensure operands are compatible types |
| "Invalid function" | Verify the function is supported and spelled correctly |
| "Attribute not found" | Check that the attribute exists in the domain model (case-sensitive) |
| "Invalid date format" | Use the correct format string for `formatDateTime()` or `parseDateTime()` |

### Performance Tips

- Avoid complex calculations in loops; pre-calculate values
- Cache frequently used expressions in variables
- Use appropriate precision; avoid Decimal when Integer/Long suffices

### Regular Expression Notes

Microflows use **Java regular expression syntax**.

## Critical Constraints

> ⚠️ ONLY use functions and operators documented above – Unsupported functions cause runtime errors  
> ⚠️ Use single quotes for all string literals – Double quotes are not supported  
> ⚠️ Attribute and association names are case-sensitive – Must match domain model exactly  
> ⚠️ Always check for empty objects before accessing attributes to prevent errors  
> ⚠️ Verify domain model structure before referencing attributes or associations  
> ⚠️ Keep expressions simple and readable – Complex logic should use multiple activities  
