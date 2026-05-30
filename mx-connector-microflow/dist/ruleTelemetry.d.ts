/**
 * Rule-pointer telemetry attached to MCP tool responses.
 *
 * Motivation: the lazy-load protocol (`specs/reference/README.md` +
 * `specs/rules/README.md`) relies on the caller agent voluntarily reading
 * the relevant reference / rule files before writing into a governed slot.
 * In practice agents sometimes skip the read and produce strings that the
 * SDK happily commits but Studio Pro rejects at project load (e.g.
 * `year()`, `formatInteger()` — invented Mendix functions; AggregateList
 * `Count` + attribute; nanoflow CallMicroflow with errorHandlingType=Rollback;
 * …). Hard-enforcement at write-time via validators (`expressionValidator`,
 * `xpathValidator`, `enumValueValidator`, microflow-builder pre-flights,
 * etc.) is the only durable defence — but the planner / agent also benefits
 * from a per-call reminder of WHICH rules just ran, so it learns the
 * landscape and can self-correct on validator throws instead of guessing.
 *
 * This module attaches a concise "Rules enforced this call" block to the
 * text result of every write-tool whose slot is governed by a rule. The
 * block lists each rule with:
 *
 *   - The rule name (planner-facing one-liner)
 *   - Its enforcer in `src/` (where the validator lives, so the agent can
 *     inspect what was checked when in doubt)
 *   - Its reference / planning-rule doc in `specs/` (so the agent can read
 *     the WHY without having to fish the catalog)
 *
 * The block is appended to existing response text; it is non-machine-
 * parseable on purpose (the goal is the agent reads it as English).
 *
 * Pointers are pointers — not enforcement. The validators are the
 * enforcement. Pointers turn the lazy-read protocol from a trigger-based
 * "agent might or might not read" into a by-product of every action.
 */
export interface RulePointer {
    /** One-line rule description (planner-facing). */
    readonly rule: string;
    /** Where the validator lives. Omit when the rule is advisory-only. */
    readonly enforcer?: string;
    /** Where the planning rationale lives (specs/rules/ or specs/reference/). */
    readonly ref?: string;
}
/**
 * Build the pointer block for a tool. Returns an empty string when the
 * tool has no pointers (read-only tools, simple session tools, etc.) so
 * the response is unchanged.
 */
export declare function rulePointerBlock(toolName: string): string;
/**
 * Append the pointer block to an existing text response. No-op when the
 * tool has no pointers.
 */
export declare function appendRulePointers(text: string, toolName: string): string;
