/**
 * Microflow reference-correctness validator.
 *
 * Catches a family of "the SDK accepted it but Studio Pro rejects at project
 * load" failures where activities reference variables that are missing,
 * empty, or of the wrong shape (Object vs List). These all silently commit
 * through the SDK and only surface in Studio Pro's consistency check.
 *
 * Errors blocked at write-time:
 *
 *   1. **CE0037 — empty variable name.** `ChangeVariable.variable`,
 *      `ChangeObject.variable`, `CommitObject.variable`,
 *      `DeleteObject.variable`, `ValidationFeedback.objectVariable`, etc.
 *      All require a non-empty value. The MCP tool silently persists `null`
 *      when omitted; Studio Pro then emits "The 'Variable' property is
 *      required." The agent never sees it until project load.
 *
 *   2. **CE0109 / CE0117 — undefined variable reference.** Any expression
 *      string (CreateVariable.initialValue, ChangeVariable.value,
 *      MemberChange.value, ExclusiveSplit.condition, message templates,
 *      CallMicroflow parameter expressions, Retrieve XPath, …) may include
 *      `$Var` references. If `Var` was never declared by a parameter or
 *      earlier activity output, Studio Pro reports "Undefined variable
 *      'X'" at load time. We scan every expression for `\$Name` tokens and
 *      check each name against the variable-type table.
 *
 *      Sub-case — **CE0117 attribute-path traversal on a List.** When the
 *      expression contains `$Var/Attribute`, `Var` MUST be Object-kind;
 *      attribute-path traversal silently commits on a List variable but
 *      Studio Pro fails project load. The error message includes a
 *      `range: "First"` hint when the source was a Retrieve range:"All".
 *
 *   3. **CE7247 — Object slot fed a List (or vice-versa).** ChangeObject,
 *      DeleteObject (Object-only variants), AggregateList.listVariableName,
 *      ListOperation.listVariableName, LoopedActivity.listVariableName, and
 *      Retrieve.source.startVariableName all have a fixed expected kind.
 *      When the supplied variable has a different kind we throw with a
 *      `range: "First"` hint when the source variable came from a
 *      `Retrieve` with `range: "All"` (the most common cause of the
 *      List/Object mismatch in practice).
 *
 *   4. **Retrieve range vs downstream use** — subsumed by (3). When a
 *      `Retrieve` declared its output with `range: "All"`, the table
 *      records `rangeIsAll: true` and any Object-slot consumer of that
 *      variable gets the explicit `range: "First"` suggestion in the
 *      error message.
 *
 * Scope and limitations (deliberate, documented as TODOs):
 *
 *   - **`CallMicroflow.outputVariableName` type** is left "Object" as a
 *     best-effort default because resolving the called microflow's
 *     `returnType` requires loading it (async, IModel-coupled). The check
 *     therefore catches the empty-target case and undefined-reference case
 *     but cannot verify Object-vs-List of the produced variable. Same for
 *     `RestOperationCall.outputVariableName` / `bodyVariableName`.
 *
 *   - **`Retrieve(Association)`** is treated as Object by default. Mendix
 *     associations can return Object (1:1, child→parent of 1:N) or List
 *     (parent→children of 1:N) depending on the association's multiplicity.
 *     Without the IModel we can't disambiguate. The Object default covers
 *     the common case; downstream List-only slots receiving such a
 *     variable will throw, which is the safer failure direction.
 *
 *   - **`ShowPage`, `CallNanoflow`, `JavaScriptAction`, `Synchronize`,
 *     `CancelSynchronize`** are not yet scanned. They have variable refs
 *     that should be checked in a follow-up.
 *
 *   - **`CallMicroflow` argument kind matching.** The argument expression is
 *     scanned for undefined-reference and list-attribute traversal, but the
 *     kind of each argument is not checked against the callee microflow's
 *     parameter type. Passing a List to an Object parameter is not yet
 *     caught at write-time.
 *
 * Validator is wired into:
 *
 *   - `microflowBuilder.ts createMicroflow` — top-level + LoopedActivity
 *     inner scope, recursive.
 *   - `microflowOperations.ts createMicroflowActivities` — reconstructs
 *     VarTable from the loaded microflow, extends with new specs, validates.
 *   - `microflowOperations.ts insertBeforeActivity` — same, single-spec.
 *   - `microflowOperations.ts modifyMicroflowActivity` — validates any
 *     supplied change_variable / commit_variable / delete_variable /
 *     rollback_variable against the loaded microflow's table.
 *
 * The modify-path entry points (`validateAppendSpecActivities`,
 * `validateModifyActivityRefs`) treat the whole microflow as one flat
 * namespace (LoopedActivity iterator + inner activity outputs included)
 * for the variable-type table — this matches the CE0111 uniqueness rule
 * and is permissive in the right direction (never false-positives on the
 * kind / undefined-reference checks).
 *
 * Planner-facing rationale lives in
 * `specs/rules/microflow_reference_correctness.md`.
 */
import { microflows } from "mendixmodelsdk";
import type { ActivitySpec, AppendActivitySpec, ModifyMicroflowActivityArgs, ParameterSpec } from "./types.js";
export type VarKind = "Object" | "List" | "Primitive";
export interface VarDecl {
    /** Variable identifier (e.g. "Counter"). */
    name: string;
    /** Object / List / Primitive. Drives consumer kind-checks. */
    kind: VarKind;
    /** Entity qualified name when kind ∈ {Object, List}. May be undefined for
     *  Association-traversal Retrieves where the entity isn't recorded in the
     *  spec (see file-header limitations). */
    entityQN?: string;
    /** Primitive type name (String / Integer / Boolean / etc.) when kind === Primitive. */
    primitive?: string;
    /** Human-readable description of where the variable was declared. Used in
     *  error messages so the planner can fix the source, not the consumer. */
    declaredVia: string;
    /** True when the source is a Retrieve with range:"All". Used to suggest
     *  range:"First" on Object-slot mismatches. */
    rangeIsAll?: boolean;
}
export type VarTable = Map<string, VarDecl>;
/**
 * Build the variable-type table from microflow parameters and a flat list of
 * activity specs. Only declarations are collected here — references are
 * walked separately by `validateActivityReferences`. Does NOT recurse into
 * LoopedActivity inner activities (the caller handles inner scope).
 */
export declare function collectDeclarations(parameters: ReadonlyArray<ParameterSpec>, activities: ReadonlyArray<ActivitySpec>): VarTable;
/**
 * Validate every activity's references against the supplied table. Recurses
 * into LoopedActivity bodies with an extended inner-scope table.
 */
export declare function validateActivityReferences(activities: ReadonlyArray<ActivitySpec>, table: VarTable): void;
/**
 * Entry point. Builds the table from parameters + activities, then validates
 * every activity's references. Throws on the first violation.
 */
export declare function validateMicroflowReferences(parameters: ReadonlyArray<ParameterSpec>, activities: ReadonlyArray<ActivitySpec>): void;
/**
 * Walk a loaded microflow's object graph and return a VarTable. Used by the
 * modify path before validating new / inserted / modified activities.
 *
 * Includes LoopedActivity iterators AND inner-activity outputs in the flat
 * top-level table (see above).
 */
export declare function collectDeclarationsFromLoaded(loaded: microflows.MicroflowBase): VarTable;
/**
 * Entry point for the modify path: build a table from the loaded microflow,
 * extend it with each new spec's declared output as we walk, and validate
 * every spec's reference slots.
 *
 * The `scope` argument is included in error messages so the planner can tell
 * the validator fired during `create_microflow_activities` /
 * `insert_before_activity` rather than the original `create_microflow`.
 */
export declare function validateAppendSpecActivities(loaded: microflows.MicroflowBase, specs: ReadonlyArray<AppendActivitySpec>, scope: string): void;
/**
 * Entry point for `modify_microflow_activity`: validates any variable-
 * reference field being assigned. The activity at `position` is identified
 * from `loaded`; we build a flat-namespace table and check each provided
 * args field against it.
 *
 * Fields not validated here (caption / disabled / commit / refresh_in_client /
 * with_events / use_return_variable) don't reference variables.
 */
export declare function validateModifyActivityRefs(loaded: microflows.MicroflowBase, args: ModifyMicroflowActivityArgs, scope: string): void;
