/**
 * XPath constraint linter.
 *
 * Three classes of errors are blocked at write-time, all of which the SDK
 * accepts verbatim and only surface later when Studio Pro / the runtime
 * tries to resolve the constraint:
 *
 *   1. **`System.User_Account` antipattern.** `Administration.Account` is a
 *      *specialization* of `System.User` via generalization, not an
 *      association. No `User_Account` association exists in either module.
 *
 *   2. **`…Account = '[%CurrentUser%]'` antipattern.** `[%CurrentUser%]`
 *      always resolves to a `System.User` instance. Mendix Account-derived
 *      entities ARE `System.User` via polymorphism. Comparing them through
 *      a path step / attribute named `Account` is virtually never correct;
 *      the canonical pattern is object-identity: `[id = '[%CurrentUser%]']`
 *      (when the retrieved entity inherits `System.User`) or
 *      `[<assoc> = '[%CurrentUser%]']` (when traversing to a User-inheriting
 *      entity).
 *
 *   3. **Unknown XPath function calls.** Mendix XPath supports a tightly
 *      restricted function set — booleans (`true`, `false`, `not`), four
 *      string functions (`length`, `string-length`, `contains`, `starts-with`,
 *      `ends-with`), and ten date extractors (`year-from-dateTime`, …). Calls
 *      to anything else (general XPath 1.0 functions like `position()` /
 *      `count()` / `sum()` / `substring()` / `concat()` / `normalize-space()`,
 *      JavaScript-style typos like `startsWith()` / `yearFromDateTime()`)
 *      commit cleanly but the runtime rejects them at retrieve time with
 *      "Function 'X' is unknown" / "Unsupported XPath function" — sometimes
 *      only on specific code paths so the bug is intermittent. Detection uses
 *      an allow-list derived from `specs/reference/microflow-xpath.md`.
 *
 * Class 1 and 2 are string-based regex checks that work at every call site
 * regardless of whether the source `IEntity` has been loaded yet. Class 3
 * scans every `<ident>(` occurrence after stripping single-quoted string
 * literals so the literal content of `'[%CurrentUser%]'` etc. doesn't
 * false-positive on the percent-sign / bracket characters.
 *
 * Planner-facing rationale lives in
 * `specs/rules/xpath_function_syntax.md` (functions) and
 * `specs/rules/xpath_currentuser.md` (Account form).
 * The authoritative function list lives in
 * `specs/reference/microflow-xpath.md`.
 */
// ─── Class 1 & 2 — Account / [%CurrentUser%] antipatterns ────────────────
const SYSTEM_USER_ACCOUNT_RE = /\bSystem\.User_Account\b/;
const ACCOUNT_CURRENTUSER_RE = /\bAccount\s*=\s*'\[%CurrentUser%\]'/;
// ─── Class 3 — Function allow-list ───────────────────────────────────────
// Strip single-quoted string literals before scanning so quoted content like
// '[%CurrentUser%]', 'I''m a name', or 'starts-with-prefix' doesn't false-
// positive on either the kebab tokens or the parenthesis characters. Mendix
// XPath uses single quotes for string literals; double quotes are not valid
// (the reference doc spells this out as an anti-pattern).
const SINGLE_QUOTED_RE = /'(?:''|[^'])*'/g;
// Match identifiers immediately followed by `(`. The leading char class
// excludes calls preceded by `.` / `$` / `_` / `/` (member or path access —
// not a function call in Mendix XPath; harmless to skip). Identifiers can
// contain hyphens because Mendix XPath uses kebab-case for most functions.
const FUNCTION_CALL_RE = /(?:^|[^a-zA-Z0-9_.$/])([a-z][a-zA-Z0-9-]*)(?=\s*\()/g;
// XPath operator keywords. These can legitimately precede `(` for sub-
// expression grouping (e.g. `... and (Status = 'PENDING' or ...)`). Without
// this skip-list the function-call regex would false-positive on `and(`,
// `or(`, etc. — they aren't functions even when followed by an open paren.
const XPATH_KEYWORDS = new Set([
    "and", "or", "div", "mod",
]);
// Mendix XPath built-in function allow-list. Derived from
// `specs/reference/microflow-xpath.md` (the authoritative reference).
// When Mendix ships a new XPath function, add it here and update the
// reference doc.
const MENDIX_XPATH_FUNCTIONS = new Set([
    // Boolean
    "true", "false", "not",
    // String
    "length", "string-length",
    "contains", "starts-with", "ends-with",
    // Date and time extractors (with optional timezone arg)
    "year-from-dateTime",
    "month-from-dateTime",
    "day-from-dateTime",
    "hours-from-dateTime",
    "minutes-from-dateTime",
    "seconds-from-dateTime",
    "quarter-from-dateTime",
    "day-of-year-from-dateTime",
    "week-from-dateTime",
    "weekday-from-dateTime",
]);
// Common wrong-language guesses, JavaScript-style typos for Mendix-XPath
// kebab functions, and unsupported XPath 1.0 / 2.0 functions → actionable
// suggestion. Anything not in the map gets a generic pointer at the
// reference doc.
const SUBSTITUTE_HINTS = {
    // camelCase versions of Mendix-XPath kebab functions
    startsWith: "Mendix XPath uses kebab-case: 'starts-with($attr, $prefix)' (not 'startsWith').",
    endsWith: "Mendix XPath uses kebab-case: 'ends-with($attr, $suffix)' (not 'endsWith').",
    stringLength: "Mendix XPath uses kebab-case: 'string-length($attr)' or simply 'length($attr)' (not 'stringLength').",
    yearFromDateTime: "Mendix XPath uses kebab-case: 'year-from-dateTime($attr)' (not 'yearFromDateTime').",
    monthFromDateTime: "Mendix XPath uses kebab-case: 'month-from-dateTime($attr)' (not 'monthFromDateTime').",
    dayFromDateTime: "Mendix XPath uses kebab-case: 'day-from-dateTime($attr)' (not 'dayFromDateTime').",
    hoursFromDateTime: "Mendix XPath uses kebab-case: 'hours-from-dateTime($attr)' (not 'hoursFromDateTime').",
    minutesFromDateTime: "Mendix XPath uses kebab-case: 'minutes-from-dateTime($attr)' (not 'minutesFromDateTime').",
    // General XPath 1.0 / 2.0 functions that Mendix does NOT support
    substring: "Mendix XPath has no substring(). Filter on whole-attribute comparison, use contains() / starts-with() / ends-with(), or pre-process the value in a microflow expression before passing as $variable.",
    concat: "Mendix XPath has no concat(). Compose strings in a microflow expression with '+' before passing as $variable, or filter on individual attributes.",
    count: "Mendix XPath has no count(). Use the AggregateList activity with function=Count on the retrieved list.",
    sum: "Mendix XPath has no sum(). Use the AggregateList activity with function=Sum + a numeric attribute on the retrieved list.",
    avg: "Mendix XPath has no avg(). Use AggregateList with function=Average + a numeric attribute.",
    min: "Mendix XPath has no min(). Use AggregateList with function=Minimum + a numeric attribute.",
    max: "Mendix XPath has no max(). Use AggregateList with function=Maximum + a numeric attribute.",
    round: "Mendix XPath has no round(). Do rounding in a microflow expression with round($x) and pass the result as $variable.",
    ceiling: "Mendix XPath has no ceiling(). Compute with ceil($x) in a microflow expression and pass as $variable.",
    floor: "Mendix XPath has no floor(). Compute with floor($x) in a microflow expression and pass as $variable.",
    abs: "Mendix XPath has no abs(). Compute with abs($x) in a microflow expression and pass as $variable.",
    number: "Mendix XPath has no number()-coercion function. Use $variable typed correctly upstream.",
    string: "Mendix XPath has no string()-coercion function. Use $variable typed correctly upstream.",
    boolean: "Mendix XPath has no boolean()-coercion function. Use the value as-is or wrap as a Boolean variable upstream.",
    position: "Mendix XPath has no position(). XPath constraints are filters, not ordered queries; sort/page in the Retrieve activity instead.",
    last: "Mendix XPath has no last(). XPath constraints are filters, not ordered queries; sort/limit in the Retrieve activity instead.",
    id: "Mendix XPath has no XPath-1.0 id() function — but the bare attribute 'id' IS valid for object-identity comparison: [id = '[%CurrentUser%]'].",
    name: "Mendix XPath has no name() function. Filter on a named attribute directly.",
    "local-name": "Mendix XPath has no local-name(). XML namespace functions are not supported.",
    "namespace-uri": "Mendix XPath has no namespace-uri(). XML namespace functions are not supported.",
    "normalize-space": "Mendix XPath has no normalize-space(). Trim the value with trim($s) in a microflow expression first and pass as $variable.",
    translate: "Mendix XPath has no translate(). Pre-process the value in a microflow expression with replaceAll() and pass as $variable.",
    "current-dateTime": "Mendix XPath has no current-dateTime() function — use the system variable '[%CurrentDateTime%]' (with the quoted-bracket-percent form).",
    "current-date": "Mendix XPath has no current-date() function — use '[%CurrentDateTime%]' (and combine with '[%DayLength%]' if you need date-only behaviour).",
    "current-time": "Mendix XPath has no current-time() function — use '[%CurrentDateTime%]'.",
};
function suggestionFor(name) {
    const specific = SUBSTITUTE_HINTS[name];
    if (specific)
        return specific;
    return (`'${name}' is not a Mendix-XPath built-in. See ` +
        `specs/reference/microflow-xpath.md for the authoritative function ` +
        `list. Supported: true(), false(), not(); length(), string-length(), ` +
        `contains(), starts-with(), ends-with(); year-from-dateTime(), ` +
        `month-from-dateTime(), day-from-dateTime(), hours-from-dateTime(), ` +
        `minutes-from-dateTime(), seconds-from-dateTime(), quarter-from-dateTime(), ` +
        `day-of-year-from-dateTime(), week-from-dateTime(), weekday-from-dateTime(). ` +
        `Anything else (substring, concat, count, sum, etc.) must be done in a ` +
        `microflow expression or AggregateList activity, not in XPath.`);
}
// ─── Validator entry point ───────────────────────────────────────────────
export function validateXPathOrThrow(xpath, context) {
    if (!xpath)
        return;
    if (SYSTEM_USER_ACCOUNT_RE.test(xpath)) {
        throw new Error(`[${context}] XPath references 'System.User_Account', which is not a real Mendix construct.\n` +
            `  XPath: ${xpath}\n` +
            `  Reason: Administration.Account is a specialization of System.User via generalization, not an association. ` +
            `No 'User_Account' association exists in either the System or Administration module.\n` +
            `  Fix: compare object identity instead.\n` +
            `    - If the retrieved entity itself inherits System.User: [id = '[%CurrentUser%]']\n` +
            `    - If traversing through an association to a User-inheriting entity X: [<assoc_to_X> = '[%CurrentUser%]'] ` +
            `(drop any trailing '/Account' or '/System.User_Account').`);
    }
    if (ACCOUNT_CURRENTUSER_RE.test(xpath)) {
        throw new Error(`[${context}] XPath compares a path ending in 'Account' to '[%CurrentUser%]'.\n` +
            `  XPath: ${xpath}\n` +
            `  Reason: '[%CurrentUser%]' is always a System.User instance. Mendix Account-derived entities ARE System.User via polymorphism (generalization, not association), ` +
            `so comparing through an 'Account' association/path step is virtually never correct.\n` +
            `  Fix: use object-identity comparison.\n` +
            `    - If retrieving the User-inheriting entity itself: [id = '[%CurrentUser%]']\n` +
            `    - If traversing from another entity (e.g. LeaveRequest → Employee): end the path at the entity: ` +
            `[<assoc> = '[%CurrentUser%]'] — drop any '/Account' suffix.`);
    }
    // Class 3 — Function allow-list. Walk every `<ident>(` occurrence in the
    // string with quoted literals stripped, and reject anything not on the
    // allow-list.
    const residual = xpath.replace(SINGLE_QUOTED_RE, "''");
    FUNCTION_CALL_RE.lastIndex = 0;
    let m;
    while ((m = FUNCTION_CALL_RE.exec(residual)) !== null) {
        const name = m[1];
        if (MENDIX_XPATH_FUNCTIONS.has(name))
            continue;
        if (XPATH_KEYWORDS.has(name))
            continue;
        throw new Error(`[${context}] XPath calls '${name}(...)', which is not a Mendix-XPath built-in.\n` +
            `  XPath: ${xpath}\n` +
            `  Reason: Mendix XPath supports a tightly restricted function set. The SDK accepts the string verbatim; the runtime rejects it at retrieve time with "Function '${name}' is unknown" or "Unsupported XPath function".\n` +
            `  Fix: ${suggestionFor(name)}\n` +
            `  See specs/reference/microflow-xpath.md for the authoritative function list and specs/rules/xpath_function_syntax.md for the planner-facing rationale.`);
    }
}
//# sourceMappingURL=xpathValidator.js.map