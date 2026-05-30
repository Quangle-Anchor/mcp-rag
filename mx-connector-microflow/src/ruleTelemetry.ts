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
 * Build a small set of canonical pointers shared across write-tools.
 * Composed below into per-tool arrays.
 */
const EXPRESSION_FUNCTION: RulePointer = {
  rule: "Mendix-expression function allow-list (no XPath kebab leak; no invented functions like year(), formatInteger(), parseInt(), split(), now())",
  enforcer: "src/expressionValidator.ts",
  ref: "specs/reference/microflow-expressions.md + specs/rules/expression_function_syntax.md",
};

const XPATH_CURRENTUSER: RulePointer = {
  rule: "XPath [%CurrentUser%] form ([id = '[%CurrentUser%]'] on a System.User specialization; never on a non-User entity)",
  enforcer: "src/xpathValidator.ts",
  ref: "specs/rules/xpath_currentuser.md + specs/reference/microflow-xpath.md",
};

const XPATH_FUNCTION: RulePointer = {
  rule: "XPath function allow-list (Mendix XPath supports only true/false/not, length/string-length/contains/starts-with/ends-with, and 10 *-from-dateTime extractors — kebab-case. No count/sum/substring/concat/position/normalize-space; no camelCase typos like startsWith/yearFromDateTime)",
  enforcer: "src/xpathValidator.ts",
  ref: "specs/rules/xpath_function_syntax.md + specs/reference/microflow-xpath.md",
};

const ENUM_LITERAL: RulePointer = {
  rule: "Enum literals in expressions use Module.Enum.VALUE FQN (XPath uses bare-quoted 'VALUE')",
  enforcer: "src/enumValueValidator.ts",
  ref: "specs/rules/enum_value_in_expression.md",
};

const LOOP_TERMINATORS: RulePointer = {
  rule: "LoopedActivity inner-flow terminators: continue / break (never end — Studio Pro CE0068)",
  enforcer: "src/microflowBuilder.ts (buildInnerLoop)",
  ref: "specs/rules/looped_activity_terminators.md",
};

const AGGREGATE_NUMERIC: RulePointer = {
  rule: "AggregateList: Count forbids attribute; Sum/Average/Min/Max require numeric attribute (Autonumber/Decimal/Integer/Long)",
  enforcer: "src/microflowBuilder.ts + src/microflowOperations.ts",
  ref: "specs/tools/microflows.md (AggregateList section)",
};

const VARIABLE_UNIQUENESS: RulePointer = {
  rule: "Microflow variable names are unique within the whole microflow (parameters + activity outputs + LoopedActivity inner activities share one flat namespace)",
  enforcer: "src/microflowBuilder.ts (validateUniqueVariableNames)",
  ref: "specs/tools/microflows.md (Variable name uniqueness section)",
};

const ENDEVENT_RETURNVALUE: RulePointer = {
  rule: "Non-Void microflow EndEvents auto-synchronise returnValue when returnType / returnVariableName changes",
  enforcer: "src/microflowOperations.ts (updateMicroflow)",
  ref: "specs/tools/microflows.md (Tool 77 update_microflow)",
};

const ERROR_HANDLING_TYPE: RulePointer = {
  rule: "errorHandlingType allow-list per mode: microflow={Rollback,Custom,CustomWithoutRollBack,Continue (only on CallMicroflow/LoopedActivity)}; nanoflow={Abort,CustomWithoutRollBack}",
  enforcer: "src/microflowBuilder.ts (applyErrorHandlingType)",
  ref: "specs/tools/microflows.md + specs/tools/nanoflows.md (Error handling sections)",
};

const REFERENCE_CORRECTNESS: RulePointer = {
  rule: "Variable references: required-target slots must be non-empty (CE0037); $Var references must resolve to a declared variable (CE0109/CE0117); Object/List/Primitive kinds must match the consumer slot (CE7247) — includes range:'First' hint when a List from Retrieve range:'All' is fed to an Object slot",
  enforcer: "src/microflowReferenceValidator.ts (create path; modify path is a follow-up)",
  ref: "specs/rules/microflow_reference_correctness.md",
};

const SYSTEM_MEMBERS: RulePointer = {
  rule: "System members: do not redeclare createdDate / changedDate / owner / changedBy as user attributes — use hasCreatedDate / hasChangedDate / hasOwner / hasChangedBy flags",
  enforcer: "src/systemMemberSynonyms.ts (advisory warning on synonyms)",
  ref: "specs/rules/system_members.md",
};

const SYSTEM_SPECIALIZATION: RulePointer = {
  rule: "System.* specialization (FileDocument / Image / User): inherited fields (Name, Contents, Size, …) must NOT be redeclared as user attributes",
  enforcer: "src/sharedResolvers.ts (KNOWN_SYSTEM_PARENT_ENTITIES allow-list)",
  ref: "specs/rules/system_specialization.md + specs/rules/user_entity_generalization.md",
};

const ASSOCIATION_PARENT_CHILD: RulePointer = {
  rule: "Association naming convention: Parent_Child direction; cross-module placement matters (parent module owns the association)",
  ref: "specs/rules/association_parent_child.md",
};

const ARRANGE_AFTER_DM: RulePointer = {
  rule: "After mutating a domain model, call arrange_domain_model so Studio Pro opens to a readable diagram",
  ref: "specs/rules/arrange_after_domain_model_build.md",
};

const BRANCH_SELECTION: RulePointer = {
  rule: "WORKING_BRANCH_NAME from .env is the durable branch authorization; default to 'main' only after explicit user confirmation",
  ref: "specs/preflight.md + CLAUDE.md (Working branch selection)",
};

/**
 * Per-tool pointer index. Read-only tools intentionally omitted — they
 * don't write into governed slots. Tools where every rule is already
 * documented in the spec but not enforced get the rule with no `enforcer`
 * field.
 */
const RULE_POINTERS_BY_TOOL: Record<string, readonly RulePointer[]> = {
  // ── microflow / nanoflow authoring ─────────────────────────────────────
  create_microflow: [
    EXPRESSION_FUNCTION,
    XPATH_CURRENTUSER,
    XPATH_FUNCTION,
    ENUM_LITERAL,
    LOOP_TERMINATORS,
    AGGREGATE_NUMERIC,
    VARIABLE_UNIQUENESS,
    REFERENCE_CORRECTNESS,
    ERROR_HANDLING_TYPE,
  ],
  create_microflow_activities: [
    EXPRESSION_FUNCTION,
    XPATH_CURRENTUSER,
    XPATH_FUNCTION,
    ENUM_LITERAL,
    AGGREGATE_NUMERIC,
    VARIABLE_UNIQUENESS,
    REFERENCE_CORRECTNESS,
    ERROR_HANDLING_TYPE,
  ],
  insert_before_activity: [
    EXPRESSION_FUNCTION,
    XPATH_CURRENTUSER,
    XPATH_FUNCTION,
    ENUM_LITERAL,
    AGGREGATE_NUMERIC,
    VARIABLE_UNIQUENESS,
    REFERENCE_CORRECTNESS,
    ERROR_HANDLING_TYPE,
  ],
  modify_microflow_activity: [
    EXPRESSION_FUNCTION,
    XPATH_CURRENTUSER,
    XPATH_FUNCTION,
    ENUM_LITERAL,
    AGGREGATE_NUMERIC,
    VARIABLE_UNIQUENESS,
    REFERENCE_CORRECTNESS,
  ],
  update_microflow: [ENDEVENT_RETURNVALUE],
  create_nanoflow: [
    EXPRESSION_FUNCTION,
    ENUM_LITERAL,
    LOOP_TERMINATORS,
    AGGREGATE_NUMERIC,
    VARIABLE_UNIQUENESS,
    ERROR_HANDLING_TYPE,
  ],
  update_nanoflow: [
    EXPRESSION_FUNCTION,
    ENUM_LITERAL,
    LOOP_TERMINATORS,
    AGGREGATE_NUMERIC,
    VARIABLE_UNIQUENESS,
    ERROR_HANDLING_TYPE,
  ],
  set_calculated_attribute: [EXPRESSION_FUNCTION],
  // ── entity / association authoring ─────────────────────────────────────
  create_entity: [SYSTEM_MEMBERS, SYSTEM_SPECIALIZATION],
  create_multiple_entities: [SYSTEM_MEMBERS, SYSTEM_SPECIALIZATION],
  add_attribute: [SYSTEM_MEMBERS],
  update_attribute: [SYSTEM_MEMBERS],
  set_entity_generalization: [SYSTEM_SPECIALIZATION],
  create_association: [ASSOCIATION_PARENT_CHILD, SYSTEM_MEMBERS],
  create_multiple_associations: [ASSOCIATION_PARENT_CHILD, SYSTEM_MEMBERS],
  create_cross_module_association: [ASSOCIATION_PARENT_CHILD, SYSTEM_MEMBERS],
  create_domain_model: [SYSTEM_MEMBERS, SYSTEM_SPECIALIZATION, ASSOCIATION_PARENT_CHILD],
  arrange_domain_model: [ARRANGE_AFTER_DM],
  // ── pages / widgets ────────────────────────────────────────────────────
  add_widget: [
    {
      rule: "Mendix 11 React client incompatibility: DropDown / ReferenceSelector render but FAIL Studio Pro consistency check (CE0582 / CE7005). Use ComboBox via create_combobox for association-bound enum / reference selection. Status: NOT HARD-ENFORCED — see defect_reports/Open/builder-output-fails-mx-check.md Class 7.",
      ref: "defect_reports/Open/builder-output-fails-mx-check.md (Class 7)",
    },
  ],
  create_combobox: [
    {
      rule: "ComboBox is a pluggable widget (id com.mendix.widget.web.combobox.Combobox); binds via association + caption attribute (NOT a drop-in for DropDown enum binding)",
      enforcer: "src/comboBoxBuilder.ts",
      ref: "specs/reference/page-creation.md",
    },
  ],
  // ── session / preflight ────────────────────────────────────────────────
  open_working_copy: [BRANCH_SELECTION],
};

/**
 * Format a one-line pointer entry. `enforcer` is the load-bearing field —
 * if it's present, the rule is hard-enforced and the agent can rely on
 * the validator catching mistakes. Otherwise the rule is advisory and the
 * agent must follow it deliberately.
 */
function formatPointer(p: RulePointer): string {
  const enforcement = p.enforcer ? "✓ enforced" : "  advisory";
  const where = p.enforcer ? ` — ${p.enforcer}` : "";
  const ref = p.ref ? ` (see ${p.ref})` : "";
  return `  [${enforcement}] ${p.rule}${where}${ref}`;
}

/**
 * Build the pointer block for a tool. Returns an empty string when the
 * tool has no pointers (read-only tools, simple session tools, etc.) so
 * the response is unchanged.
 */
export function rulePointerBlock(toolName: string): string {
  const pointers = RULE_POINTERS_BY_TOOL[toolName];
  if (!pointers || pointers.length === 0) return "";
  const header =
    `Rules in scope for ${toolName} ` +
    `(hard-enforced rules block bad input at write-time; advisory rules need agent compliance):`;
  return [header, ...pointers.map(formatPointer)].join("\n");
}

/**
 * Append the pointer block to an existing text response. No-op when the
 * tool has no pointers.
 */
export function appendRulePointers(text: string, toolName: string): string {
  const block = rulePointerBlock(toolName);
  if (!block) return text;
  return `${text}\n\n${block}`;
}
