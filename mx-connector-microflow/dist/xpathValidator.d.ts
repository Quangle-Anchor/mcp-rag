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
export declare function validateXPathOrThrow(xpath: string | undefined, context: string): void;
