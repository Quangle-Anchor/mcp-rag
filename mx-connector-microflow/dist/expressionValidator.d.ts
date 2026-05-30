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
export declare function validateMendixExpressionOrThrow(value: string | undefined, context: string): void;
