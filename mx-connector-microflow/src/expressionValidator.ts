/**
 * Mendix-expression linter.
 *
 * Two classes of errors are blocked at write-time, both of which the SDK
 * accepts verbatim and which only surface later when Studio Pro fails project
 * load with `Function 'X' is unknown`:
 *
 *   1. **XPath 2.0 functions** (kebab-case: `year-from-dateTime`,
 *      `current-dateTime`, `starts-with`, `string-length`, …) leaking into
 *      Mendix-expression slots. Detection is unambiguous because no Mendix
 *      built-in contains a hyphen.
 *   2. **Unknown camelCase function calls** — typos (`getYear()`), invented
 *      Mendix functions (`year()`, `formatInteger()`), and wrong-language
 *      guesses (`parseInt()`, `split()`, `join()`, `map()`). Detection uses
 *      an allow-list derived from `specs/reference/microflow-expressions.md`.
 *
 * Mendix-expression slots covered:
 *   `CreateVariable.initialValue`, `ChangeVariable.value`,
 *   `ExclusiveSplit / LoopedActivity` expression conditions,
 *   `MemberChange.value`, `LogMessage / ShowMessage / ValidationFeedback`
 *   template parameters, `CallMicroflow / CallNanoflow / JavaScriptAction /
 *   ShowPage` parameter expressions, `EndEvent.returnValue` (non-Void).
 *
 * Skipped:
 *   - `Retrieve.xpath` — XPath dialect; validated separately by
 *     `xpathValidator.ts`.
 *
 * Planner-facing rationale lives in `specs/rules/expression_function_syntax.md`.
 * The authoritative function list lives in
 * `specs/reference/microflow-expressions.md`.
 */

// Strip single-quoted string literals before scanning so a payload like
// formatDateTime($d, 'yyyy-MM-dd') doesn't false-positive on 'yyyy-MM-dd'.
// Mendix expressions use single quotes for string literals; double quotes are
// not valid expression syntax (the SDK normalizer in microflowOperations.ts
// even rewrites "..." to '...' before storage), so a single-quote stripper is
// sufficient.
const SINGLE_QUOTED_RE = /'(?:''|[^'])*'/g;

// Kebab-case-identifier followed by `(`. The leading `\b` + lowercase start
// prevents matching things like `$Var-Y(` (the `\b` would be at the start of
// `$` not the identifier) and `42-3(` (no letter start).
const KEBAB_CALL_RE = /\b[a-z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)+(?=\s*\()/;

// CamelCase / lowercase identifier followed by `(`. The lookahead guards the
// `(` without consuming it. The lookbehind-style char class on the left edge
// excludes calls preceded by `.` (member access — not a function in Mendix
// expressions but harmless to skip), `$` (variable reference — Mendix has no
// callable variables, but the regex would otherwise match e.g. `$f(`), `/`
// (slash-path attribute access), or another identifier character.
const CAMEL_CALL_RE =
  /(?:^|[^a-zA-Z0-9_.$/])([a-z][a-zA-Z0-9]*)(?=\s*\()/g;

// Map XPath function name → Mendix-expression equivalent (or token, where the
// translation isn't a function). Used to make the error message
// directly actionable. Anything not in the map gets a generic suggestion.
const XPATH_TO_MENDIX: Record<string, string> = {
  "year-from-dateTime": "year($d)",
  "month-from-dateTime": "month($d)",
  "day-from-dateTime": "day($d)",
  "hours-from-dateTime": "hours($d)",
  "minutes-from-dateTime": "minutes($d)",
  "seconds-from-dateTime": "seconds($d)",
  "current-dateTime": "[%CurrentDateTime%]",
  "current-date": "[%CurrentDateTime%] (trim with trimToDays() if needed)",
  "current-time": "[%CurrentDateTime%]",
  "local-name": "(no equivalent — XPath-only)",
  "namespace-uri": "(no equivalent — XPath-only)",
  "starts-with": "startsWith($s, $prefix)",
  "ends-with": "endsWith($s, $suffix)",
  "string-length": "length($s)",
  "normalize-space": "trim($s)",
};

// Allow-list of Mendix-expression built-in functions. Derived from
// `specs/reference/microflow-expressions.md` (the authoritative reference).
// When Mendix ships a new built-in, add it here and update the reference doc.
const MENDIX_EXPRESSION_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  // Boolean / special
  "not",
  "isNew",
  // Math
  "abs", "ceil", "floor", "max", "min", "pow", "random", "round", "sqrt",
  // String
  "toLowerCase", "toUpperCase",
  "substring", "find", "findLast",
  "contains", "startsWith", "endsWith",
  "trim",
  "isMatch", "replaceAll", "replaceFirst",
  "urlEncode", "urlDecode",
  // Date creation
  "dateTime", "dateTimeUTC",
  // Date boundaries
  "beginOfDay", "beginOfWeek", "beginOfMonth", "beginOfYear",
  "endOfDay", "endOfWeek", "endOfMonth", "endOfYear",
  // Date differences (absolute; calendarXBetween returns Integer/Long)
  "millisecondsBetween", "secondsBetween", "minutesBetween", "hoursBetween",
  "daysBetween", "weeksBetween",
  "calendarMonthsBetween", "calendarYearsBetween",
  // Add time (+ UTC variants for days/weeks/months/quarters/years)
  "addMilliseconds", "addSeconds", "addMinutes", "addHours",
  "addDays", "addWeeks", "addMonths", "addQuarters", "addYears",
  "addDaysUTC", "addWeeksUTC", "addMonthsUTC", "addQuartersUTC", "addYearsUTC",
  // Subtract time (+ UTC variants for days/weeks/months/quarters/years)
  "subtractMilliseconds", "subtractSeconds", "subtractMinutes", "subtractHours",
  "subtractDays", "subtractWeeks", "subtractMonths", "subtractQuarters", "subtractYears",
  "subtractDaysUTC", "subtractWeeksUTC", "subtractMonthsUTC",
  "subtractQuartersUTC", "subtractYearsUTC",
  // Trim (+ UTC variants for hours/days/months/years)
  "trimToSeconds", "trimToMinutes", "trimToHours",
  "trimToDays", "trimToMonths", "trimToYears",
  "trimToHoursUTC", "trimToDaysUTC", "trimToMonthsUTC", "trimToYearsUTC",
  // Type conversion — basic
  "toString", "length",
  "parseInteger",
  // Decimal parse / format
  "parseDecimal", "formatDecimal",
  // Date parse / format (+ UTC variants)
  "parseDateTime", "parseDateTimeUTC",
  "formatDateTime", "formatDateTimeUTC",
  "formatTime", "formatTimeUTC",
  "formatDate", "formatDateUTC",
  "dateTimeToEpoch", "epochToDateTime",
  // Enumeration
  "getCaption", "getKey",
]);

// Mendix-expression language keywords. These can legally precede `(` (e.g.
// `if (cond) then a else b` is valid even though parens around the condition
// are optional). Listing them avoids false positives.
const LANGUAGE_KEYWORDS: ReadonlySet<string> = new Set<string>([
  "if", "then", "else",
  "and", "or",
  "true", "false",
  "empty",
  "mod", "div",
]);

// Common wrong-language guesses and invented Mendix functions → actionable
// suggestion. Anything not in the map gets a generic pointer at the reference
// doc.
const UNKNOWN_TO_MENDIX_SUGGESTION: Record<string, string> = {
  // Mendix does NOT have year/month/day/hours/minutes/seconds extractors as
  // functions. The XPath-side year-from-dateTime() is caught by the kebab
  // path with a `year($d)` suggestion — but `year($d)` itself is wrong in
  // Mendix expressions. Provide the real replacement here.
  year: "Mendix expressions have no year() function. Use formatDateTime($d, 'yyyy') to get the year as a String; for differences use calendarYearsBetween($d1, $d2) (returns Integer/Long).",
  month: "Mendix expressions have no month() function. Use formatDateTime($d, 'MM') (or 'M' for no zero pad).",
  day: "Mendix expressions have no day() function. Use formatDateTime($d, 'dd') (day-of-month) or 'D' (day-of-year).",
  hours: "Mendix expressions have no hours() function. Use formatDateTime($d, 'HH') for 24-hour, 'hh' for 12-hour.",
  minutes: "Mendix expressions have no minutes() function. Use formatDateTime($d, 'mm').",
  seconds: "Mendix expressions have no seconds() function. Use formatDateTime($d, 'ss').",
  getYear: "Mendix expressions have no getYear() function. Use formatDateTime($d, 'yyyy') (returns String) or calendarYearsBetween() for differences.",
  getMonth: "Mendix expressions have no getMonth() function. Use formatDateTime($d, 'MM').",
  getDay: "Mendix expressions have no getDay() function. Use formatDateTime($d, 'dd').",
  getDate: "Mendix expressions have no getDate() function. Use formatDateTime($d, ...) or [%CurrentDateTime%].",
  getTime: "Mendix expressions have no getTime() function. Use dateTimeToEpoch($d) for the epoch-millis value.",
  // Numeric formatting
  formatInteger: "Mendix expressions have no formatInteger(). For Integer/Long → String use toString($n); for a custom numeric format use formatDecimal(toDecimal($n), '#,##0').",
  formatLong: "Mendix expressions have no formatLong(). Use toString($n) or formatDecimal(toDecimal($n), '...').",
  formatNumber: "Mendix expressions have no formatNumber(). Use formatDecimal($d, '#,##0.##') for Decimal, or toString($n) for Integer/Long.",
  toInteger: "Mendix expressions have no toInteger() function. Use parseInteger($s) for String → Integer/Long.",
  toLong: "Mendix expressions have no toLong() function. Use parseInteger($s).",
  toDecimal: "Mendix expressions have no toDecimal() function. Use parseDecimal($s) for String → Decimal.",
  toBoolean: "Mendix expressions have no toBoolean() function. Use an if/then/else expression or compare directly.",
  // JS / Python / Java guesses
  parseInt: "Use parseInteger($s) (Mendix returns Integer/Long).",
  parseFloat: "Use parseDecimal($s) (Mendix has no Float type — Decimal is the closest analog).",
  parseDouble: "Use parseDecimal($s).",
  parseBoolean: "Mendix expressions cannot parse Boolean from String. Compare directly: $s = 'true'.",
  split: "Mendix expressions have no split(). Tokenize via a microflow loop using find() + substring(), or move the logic into a Java action.",
  join: "Mendix expressions have no join(). Concatenate Strings with '+' or build via a microflow loop.",
  map: "Mendix expressions have no map(). Iterate via a LoopedActivity in a microflow.",
  filter: "Mendix expressions have no filter(). Use a Retrieve activity with XPath, or filter via a LoopedActivity.",
  reduce: "Mendix expressions have no reduce(). Aggregate via an AggregateList activity in a microflow.",
  some: "Mendix expressions have no some()/any(). Use an AggregateList Count with a filtered Retrieve.",
  every: "Mendix expressions have no every()/all(). Use an AggregateList Count + comparison.",
  forEach: "Mendix expressions have no forEach(). Use a LoopedActivity in a microflow.",
  concat: "Concatenate Strings with '+'. There is no concat() function.",
  // Substring/string variants
  indexOf: "Use find($s, $sub) (returns Integer index, or -1).",
  lastIndexOf: "Use findLast($s, $sub).",
  charAt: "Use substring($s, $i, 1).",
  toLower: "Use toLowerCase($s).",
  toUpper: "Use toUpperCase($s).",
  toLocaleLowerCase: "Use toLowerCase($s) (Mendix has no locale-specific variant).",
  toLocaleUpperCase: "Use toUpperCase($s).",
  // Math
  ln: "Mendix expressions have no ln(). No natural-log built-in is available; compute via Java action if needed.",
  log: "Mendix expressions have no log(). No logarithm built-in is available; compute via Java action if needed.",
  exp: "Mendix expressions have no exp(). Use pow(2.71828, $x) for an approximation, or compute via Java action.",
  sin: "Mendix expressions have no sin()/cos()/tan(). Trigonometry must be done in a Java action.",
  cos: "Mendix expressions have no sin()/cos()/tan(). Trigonometry must be done in a Java action.",
  tan: "Mendix expressions have no sin()/cos()/tan(). Trigonometry must be done in a Java action.",
  // Time / now
  now: "Mendix expressions have no now() function. Use the runtime variable [%CurrentDateTime%].",
  today: "Mendix expressions have no today() function. Use trimToDays([%CurrentDateTime%]) or the runtime variable [%BeginOfCurrentDay%].",
  currentDateTime: "Mendix expressions have no currentDateTime() function — it is a token, not a function. Use [%CurrentDateTime%] (note the surrounding [%...%]).",
  currentUser: "Mendix expressions have no currentUser() function — it is a token. Use [%CurrentUser%] (in expressions) or [id = '[%CurrentUser%]'] (in XPath).",
};

function suggestionFor(name: string): string {
  const specific = UNKNOWN_TO_MENDIX_SUGGESTION[name];
  if (specific) return specific;
  return (
    `'${name}' is not a Mendix-expression built-in. See ` +
    `specs/reference/microflow-expressions.md for the authoritative function ` +
    `list. Common Mendix substitutes: toString(), length(), substring(), ` +
    `find(), startsWith(), formatDateTime(), parseInteger(), parseDecimal(), ` +
    `daysBetween(), addDays(), getCaption(), trim(), isMatch().`
  );
}

export function validateMendixExpressionOrThrow(
  value: string | undefined,
  context: string
): void {
  if (!value) return;

  const residual = value.replace(SINGLE_QUOTED_RE, "''");

  // 1. XPath kebab-case function leak — most specific signal, check first.
  const kebab = KEBAB_CALL_RE.exec(residual);
  if (kebab) {
    const kebabName = kebab[0];
    const known = XPATH_TO_MENDIX[kebabName];
    const fix = known
      ? `Use the Mendix-expression equivalent instead: ${known}.`
      : `'${kebabName}' is XPath 2.0 syntax. Mendix-expression built-ins are camelCase (e.g. 'year', 'daysBetween', 'startsWith') — no built-in contains a hyphen.`;
    throw new Error(
      `[${context}] Expression contains '${kebabName}(...)', which is an XPath 2.0 function, not a Mendix-expression function.\n` +
        `  Expression: ${value}\n` +
        `  Reason: Mendix accepts the string verbatim at commit time; Studio Pro then fails project load with "Function '${kebabName}' is unknown".\n` +
        `  Fix: ${fix}\n` +
        `  XPath functions are only valid inside Retrieve activity 'xpath:' constraints — never in CreateVariable.initialValue, ChangeVariable.value, ExclusiveSplit / LoopedActivity expression conditions, MemberChange.value, message-template parameters, or CallMicroflow argument expressions.\n` +
        `  See specs/rules/expression_function_syntax.md.`
    );
  }

  // 2. Unknown camelCase function call. Walk every `<identifier>(` occurrence
  // and reject any that isn't in the Mendix-expression allow-list.
  CAMEL_CALL_RE.lastIndex = 0;
  let camel: RegExpExecArray | null;
  while ((camel = CAMEL_CALL_RE.exec(residual)) !== null) {
    const name = camel[1];
    if (MENDIX_EXPRESSION_FUNCTIONS.has(name)) continue;
    if (LANGUAGE_KEYWORDS.has(name)) continue;
    throw new Error(
      `[${context}] Expression calls '${name}(...)', which is not a Mendix-expression built-in.\n` +
        `  Expression: ${value}\n` +
        `  Reason: Mendix accepts the string verbatim at commit time; Studio Pro then fails project load with "Function '${name}' is unknown".\n` +
        `  Fix: ${suggestionFor(name)}\n` +
        `  See specs/reference/microflow-expressions.md for the authoritative function list and specs/rules/expression_function_syntax.md for the planner-facing rationale.`
    );
  }
}
