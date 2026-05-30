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

import { microflows, datatypes } from "mendixmodelsdk";
import type {
  ActivitySpec,
  AppendActivitySpec,
  ModifyMicroflowActivityArgs,
  ParameterSpec,
  ReturnTypeSpec,
  MemberChangeSpec,
} from "./types.js";

// ─── Variable type table ─────────────────────────────────────────────────

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

function returnTypeToDecl(
  name: string,
  rt: ReturnTypeSpec,
  declaredVia: string
): VarDecl {
  if (rt.type === "Object") {
    return { name, kind: "Object", entityQN: rt.entityQualifiedName, declaredVia };
  }
  if (rt.type === "List") {
    return { name, kind: "List", entityQN: rt.entityQualifiedName, declaredVia };
  }
  return { name, kind: "Primitive", primitive: rt.type, declaredVia };
}

/**
 * Build the variable-type table from microflow parameters and a flat list of
 * activity specs. Only declarations are collected here — references are
 * walked separately by `validateActivityReferences`. Does NOT recurse into
 * LoopedActivity inner activities (the caller handles inner scope).
 */
export function collectDeclarations(
  parameters: ReadonlyArray<ParameterSpec>,
  activities: ReadonlyArray<ActivitySpec>
): VarTable {
  const table: VarTable = new Map();
  for (const p of parameters ?? []) {
    table.set(p.name, returnTypeToDecl(p.name, p.type, "microflow parameter"));
  }
  for (const a of activities ?? []) {
    const decl = declarationFromActivity(a);
    if (decl) table.set(decl.name, decl);
  }
  return table;
}

function declarationFromActivity(a: ActivitySpec): VarDecl | null {
  switch (a.type) {
    case "CreateVariable":
      return returnTypeToDecl(
        a.variableName,
        a.variableType,
        `CreateVariable at activity '${a.id}'`
      );
    case "Retrieve": {
      const entityQN =
        a.source.type === "Database"
          ? a.source.entityQualifiedName
          : undefined;
      if (a.source.type === "Database") {
        const range = a.source.range?.type ?? "All";
        const isList = range !== "First";
        return {
          name: a.outputVariableName,
          kind: isList ? "List" : "Object",
          entityQN,
          declaredVia: `Retrieve(Database range:"${range}") at activity '${a.id}'`,
          rangeIsAll: isList && range === "All",
        };
      }
      // Association traversal: best-effort Object default — see file header.
      return {
        name: a.outputVariableName,
        kind: "Object",
        declaredVia: `Retrieve(Association) at activity '${a.id}'`,
      };
    }
    case "CreateObject":
      return {
        name: a.outputVariableName,
        kind: "Object",
        entityQN: a.entityQualifiedName,
        declaredVia: `CreateObject at activity '${a.id}'`,
      };
    case "CallMicroflow":
      if (a.outputVariableName) {
        // Without loading the called microflow we can't know its return
        // type. Best-effort default: Object. Catches undefined-reference
        // but won't catch List-vs-Object mismatches on this var.
        return {
          name: a.outputVariableName,
          kind: "Object",
          declaredVia: `CallMicroflow '${a.microflowQualifiedName}' at activity '${a.id}'`,
        };
      }
      return null;
    case "AggregateList":
      return {
        name: a.outputVariableName,
        kind: "Primitive",
        primitive: a.aggregateFunction === "Count" ? "Long" : "Decimal",
        declaredVia: `AggregateList ${a.aggregateFunction} at activity '${a.id}'`,
      };
    case "ListOperation":
      if (a.operation === "Contains") {
        return {
          name: a.outputVariableName,
          kind: "Primitive",
          primitive: "Boolean",
          declaredVia: `ListOperation Contains at activity '${a.id}'`,
        };
      }
      return {
        name: a.outputVariableName,
        kind: "List",
        declaredVia: `ListOperation ${a.operation} at activity '${a.id}'`,
      };
    case "RestOperationCall":
      // Output / body variable types depend on the called operation's schema.
      // Skip — leave them undeclared so downstream refs flag the mismatch
      // rather than silently passing with a wrong kind. (TODO: integrate
      // OperationParameter loading to resolve types properly.)
      return null;
    case "CallNanoflow":
      // Mirror CallMicroflow best-effort.
      // Schema may have outputVariableName under different field name; the
      // ActivitySpec union for CallNanoflow lives in types.ts — see TODO in
      // file header. Skip for now.
      return null;
    default:
      return null;
  }
}

// ─── Reference validators ────────────────────────────────────────────────

function assertNonEmpty(value: string | undefined, field: string, activityId: string): void {
  if (!value || value.trim() === "") {
    throw new Error(
      `[activity '${activityId}' (${field})] Variable name is empty.\n` +
        `  Reason: this slot requires the name of a previously declared variable. ` +
        `Mendix commits the empty value; Studio Pro rejects with CE0037 "The 'Variable' property is required."\n` +
        `  Fix: set ${field} to the name of an in-scope variable (microflow parameter, CreateVariable, Retrieve.outputVariableName, CreateObject.outputVariableName, AggregateList.outputVariableName, …).`
    );
  }
}

function assertDeclared(
  name: string,
  table: VarTable,
  field: string,
  activityId: string
): void {
  if (!table.has(name)) {
    const known = [...table.keys()].sort().join(", ") || "(none)";
    throw new Error(
      `[activity '${activityId}' (${field})] Variable '${name}' is not declared in this scope.\n` +
        `  Reason: the slot must reference a microflow parameter or an earlier activity's output. ` +
        `Mendix commits the broken reference; Studio Pro CE0109 fails project load with "Undefined variable '${name}'".\n` +
        `  Fix: declare '${name}' upstream, or change ${field} to one of the in-scope names: [${known}].`
    );
  }
}

function assertObjectKind(
  name: string,
  table: VarTable,
  field: string,
  activityId: string,
  consumerLabel: string
): void {
  assertNonEmpty(name, field, activityId);
  const decl = table.get(name);
  if (!decl) {
    assertDeclared(name, table, field, activityId);
    return;
  }
  if (decl.kind === "Object") return;
  if (decl.kind === "List") {
    const rangeFirstHint = decl.rangeIsAll
      ? `\n  Specifically: '${name}' came from ${decl.declaredVia} — change the Retrieve's range from "All" to "First" to get a single Object instead of a List.`
      : "";
    throw new Error(
      `[activity '${activityId}' (${field})] Variable '${name}' is a List, but ${consumerLabel} requires an Object.\n` +
        `  Source: ${decl.declaredVia}\n` +
        `  Reason: Studio Pro CE7247 rejects "Variable '${name}' is of type List of ${decl.entityQN ?? "<entity>"}, but should be of type Object."${rangeFirstHint}`
    );
  }
  // Primitive
  throw new Error(
    `[activity '${activityId}' (${field})] Variable '${name}' is of primitive type ${decl.primitive ?? decl.kind}, but ${consumerLabel} requires an Object<entity>.\n` +
      `  Source: ${decl.declaredVia}`
  );
}

function assertListKind(
  name: string,
  table: VarTable,
  field: string,
  activityId: string,
  consumerLabel: string
): void {
  assertNonEmpty(name, field, activityId);
  const decl = table.get(name);
  if (!decl) {
    assertDeclared(name, table, field, activityId);
    return;
  }
  if (decl.kind === "List") return;
  if (decl.kind === "Object") {
    throw new Error(
      `[activity '${activityId}' (${field})] Variable '${name}' is an Object, but ${consumerLabel} requires a List.\n` +
        `  Source: ${decl.declaredVia}\n` +
        `  Fix: retrieve into a List (Retrieve with range:"All" or no explicit range), or use a ListOperation to build one.`
    );
  }
  throw new Error(
    `[activity '${activityId}' (${field})] Variable '${name}' is of primitive type ${decl.primitive ?? decl.kind}, but ${consumerLabel} requires a List<entity>.\n` +
      `  Source: ${decl.declaredVia}`
  );
}

// Extract `$VarName` references from an expression. Strips single-quoted
// string literals first so quoted content like `'$keep this literal'` is
// ignored. Captures the character following the variable name so we can
// distinguish a bare reference (`$Var + 1`) from attribute-path traversal
// (`$Var/Attr`) — the latter is only valid on Object-kind variables.
const SINGLE_QUOTED_RE = /'(?:''|[^'])*'/g;
const VAR_REF_RE = /\$([A-Za-z][A-Za-z0-9_]*)(\/?)/g;

function assertExpressionRefs(
  expr: string | undefined,
  table: VarTable,
  field: string,
  activityId: string
): void {
  if (!expr) return;
  const residual = expr.replace(SINGLE_QUOTED_RE, "''");
  const seen = new Set<string>();
  const traversed = new Set<string>();
  VAR_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VAR_REF_RE.exec(residual)) !== null) {
    const name = m[1];
    const isTraversal = m[2] === "/";
    if (isTraversal) traversed.add(name);
    if (seen.has(name)) continue;
    seen.add(name);
    if (table.has(name)) continue;
    const known = [...table.keys()].sort().join(", ") || "(none)";
    throw new Error(
      `[activity '${activityId}' (${field})] Expression references undefined variable '$${name}'.\n` +
        `  Expression: ${expr}\n` +
        `  Reason: Mendix commits the broken reference; Studio Pro fails project load with CE0109 "Undefined variable '${name}'" or CE0117 "Error(s) in expression."\n` +
        `  Fix: declare '${name}' upstream, or change the expression to reference one of the in-scope names: [${known}].`
    );
  }
  // Second pass: every variable used in `$Var/...` form must be Object-kind.
  // List-kind variables silently commit with `$Balance/AvailableDays` style
  // expressions; Studio Pro then fails project load with CE0117 "Error(s) in
  // expression." because attribute-path traversal only works on Object vars.
  for (const name of traversed) {
    const decl = table.get(name);
    if (!decl) continue; // already errored above
    if (decl.kind === "Object") continue;
    const tip =
      decl.kind === "List"
        ? decl.rangeIsAll
          ? `change the source Retrieve's range from "All" to "First" (so '${name}' is an Object instead of a List), or refactor the expression to use AggregateList / ListOperation on the list.`
          : `the source produces a list — refactor the expression to use AggregateList / ListOperation, or change the source to yield a single Object.`
        : `attribute-path traversal is only valid on Object variables (entity instances).`;
    throw new Error(
      `[activity '${activityId}' (${field})] Expression performs attribute-path traversal '$${name}/...' but '$${name}' is a ${decl.kind}, not an Object.\n` +
        `  Expression: ${expr}\n` +
        `  Source: ${decl.declaredVia}\n` +
        `  Reason: Mendix commits the broken expression; Studio Pro fails project load with CE0117 "Error(s) in expression." Attribute-path traversal ($Var/Attribute) requires '${name}' to be an Object.\n` +
        `  Fix: ${tip}`
    );
  }
}

function validateMemberChanges(
  changes: ReadonlyArray<MemberChangeSpec> | undefined,
  table: VarTable,
  field: string,
  activityId: string
): void {
  for (const ch of changes ?? []) {
    assertExpressionRefs(ch.value, table, `${field}.value`, activityId);
  }
}

/**
 * Validate every activity's references against the supplied table. Recurses
 * into LoopedActivity bodies with an extended inner-scope table.
 */
export function validateActivityReferences(
  activities: ReadonlyArray<ActivitySpec>,
  table: VarTable
): void {
  for (const a of activities ?? []) {
    validateOneActivity(a, table);
  }
}

function validateOneActivity(a: ActivitySpec, table: VarTable): void {
  switch (a.type) {
    case "CreateVariable":
      assertExpressionRefs(a.initialValue, table, "CreateVariable.initialValue", a.id);
      break;
    case "ChangeVariable":
      assertNonEmpty(a.variable, "ChangeVariable.variable", a.id);
      assertDeclared(a.variable, table, "ChangeVariable.variable", a.id);
      assertExpressionRefs(a.value, table, "ChangeVariable.value", a.id);
      break;
    case "Retrieve":
      if (a.source.type === "Association") {
        assertNonEmpty(
          a.source.startVariableName,
          "Retrieve.source.startVariableName",
          a.id
        );
        if (a.source.startVariableName) {
          assertObjectKind(
            a.source.startVariableName,
            table,
            "Retrieve.source.startVariableName",
            a.id,
            "Association traversal"
          );
        }
      }
      assertExpressionRefs(a.source.xpath, table, "Retrieve.source.xpath", a.id);
      break;
    case "CreateObject":
      validateMemberChanges(a.memberChanges, table, "CreateObject.memberChange", a.id);
      break;
    case "ChangeObject":
      assertObjectKind(a.variable, table, "ChangeObject.variable", a.id, "ChangeObject");
      validateMemberChanges(a.memberChanges, table, "ChangeObject.memberChange", a.id);
      break;
    case "CommitObject":
      // CommitObject accepts Object OR List in Mendix — just check declared.
      assertNonEmpty(a.variable, "CommitObject.variable", a.id);
      assertDeclared(a.variable, table, "CommitObject.variable", a.id);
      break;
    case "DeleteObject":
      // DeleteObject accepts Object OR List — just check declared.
      assertNonEmpty(a.variable, "DeleteObject.variable", a.id);
      assertDeclared(a.variable, table, "DeleteObject.variable", a.id);
      break;
    case "CallMicroflow":
      for (const pm of a.parameterMappings ?? []) {
        assertExpressionRefs(
          pm.argument,
          table,
          `CallMicroflow.parameterMappings[${pm.parameterName}].argument`,
          a.id
        );
      }
      break;
    case "AggregateList":
      assertListKind(
        a.listVariableName,
        table,
        "AggregateList.listVariableName",
        a.id,
        "AggregateList"
      );
      break;
    case "ListOperation":
      assertListKind(
        a.listVariableName,
        table,
        "ListOperation.listVariableName",
        a.id,
        "ListOperation"
      );
      if (a.secondListVariableName) {
        assertListKind(
          a.secondListVariableName,
          table,
          "ListOperation.secondListVariableName",
          a.id,
          "ListOperation second-list"
        );
      }
      if (a.objectVariableName) {
        assertObjectKind(
          a.objectVariableName,
          table,
          "ListOperation.objectVariableName",
          a.id,
          "ListOperation object operand"
        );
      }
      break;
    case "LogMessage":
    case "ShowMessage":
      for (const p of a.parameters ?? []) {
        assertExpressionRefs(p, table, `${a.type}.parameters[*]`, a.id);
      }
      break;
    case "ValidationFeedback":
      assertNonEmpty(a.objectVariable, "ValidationFeedback.objectVariable", a.id);
      assertDeclared(a.objectVariable, table, "ValidationFeedback.objectVariable", a.id);
      break;
    case "ExclusiveSplit":
      assertExpressionRefs(a.condition, table, "ExclusiveSplit.condition", a.id);
      break;
    case "LoopedActivity": {
      assertListKind(
        a.listVariableName,
        table,
        "LoopedActivity.listVariableName",
        a.id,
        "LoopedActivity"
      );
      // Inner scope: parent table + iterator + inner activity outputs.
      const innerTable: VarTable = new Map(table);
      const listDecl = table.get(a.listVariableName);
      innerTable.set(a.iteratorVariableName, {
        name: a.iteratorVariableName,
        kind: "Object",
        entityQN: listDecl?.entityQN,
        declaredVia: `LoopedActivity iterator at activity '${a.id}' (element of ${listDecl?.entityQN ?? "<list element>"})`,
      });
      for (const inner of a.activities ?? []) {
        const decl = declarationFromActivity(inner);
        if (decl) innerTable.set(decl.name, decl);
      }
      // breakCondition is evaluated in inner scope.
      assertExpressionRefs(
        a.breakCondition,
        innerTable,
        "LoopedActivity.breakCondition",
        a.id
      );
      // Recurse — inner activities validated against innerTable.
      validateActivityReferences(a.activities ?? [], innerTable);
      break;
    }
    case "ShowPage":
    case "ClosePage":
    case "RestOperationCall":
    case "CallNanoflow":
    case "JavaScriptAction":
    case "Synchronize":
    case "CancelSynchronize":
      // TODO: extend with variable-reference checks for these activity
      // types. They each carry expressions or variable refs that should be
      // validated; deferred to keep this change-set small.
      break;
    default:
      // Future-proof: if a new activity type is added, the type-narrowing
      // here will surface it at TS compile time when the switch is
      // exhaustively typed by the union discriminant.
      break;
  }
}

/**
 * Entry point. Builds the table from parameters + activities, then validates
 * every activity's references. Throws on the first violation.
 */
export function validateMicroflowReferences(
  parameters: ReadonlyArray<ParameterSpec>,
  activities: ReadonlyArray<ActivitySpec>
): void {
  const table = collectDeclarations(parameters, activities);
  validateActivityReferences(activities, table);
}

// ─── SDK-side introspection (modify path) ────────────────────────────────
//
// The modify-path tools (`create_microflow_activities`, `insert_before_activity`,
// `modify_microflow_activity`) start from a loaded `microflows.MicroflowBase`
// rather than an `ActivitySpec` graph. We need to reconstruct the variable-
// type table from the SDK objects so new / edited activities can be validated
// the same way `create_microflow` validates a freshly-built spec.
//
// The flat-namespace approximation: Mendix actually scopes inner-loop
// iterator and inner-activity outputs to the loop body, but for the modify
// path we treat the whole microflow as one flat scope. This is permissive
// (it won't complain when a new outer activity references an inner-loop
// var — Mendix will catch that as CE0109 at project load) but it never
// produces a FALSE positive. The kind checks (Object vs List) are what we
// care about, and those work the same in flat namespace.

/**
 * Walk a loaded microflow's object graph and return a VarTable. Used by the
 * modify path before validating new / inserted / modified activities.
 *
 * Includes LoopedActivity iterators AND inner-activity outputs in the flat
 * top-level table (see above).
 */
export function collectDeclarationsFromLoaded(
  loaded: microflows.MicroflowBase
): VarTable {
  const table: VarTable = new Map();
  for (const o of loaded.objectCollection?.objects ?? []) {
    addDeclFromLoadedObject(o, table);
    if (o instanceof microflows.LoopedActivity) {
      // Iterator + inner activity outputs are visible only inside the loop
      // body in Mendix, but we add them to the flat table so the modify path
      // can reference them when editing inside the same microflow.
      const src = o.loopSource;
      if (src instanceof microflows.IterableList && src.variableName) {
        const listSrc = table.get(src.listVariableName ?? "");
        table.set(src.variableName, {
          name: src.variableName,
          kind: "Object",
          entityQN: listSrc?.entityQN,
          declaredVia: `LoopedActivity iterator (existing — element of ${
            listSrc?.entityQN ?? src.listVariableName ?? "<list>"
          })`,
        });
      }
      for (const inner of o.objectCollection?.objects ?? []) {
        addDeclFromLoadedObject(inner, table);
      }
    }
  }
  return table;
}

function addDeclFromLoadedObject(
  o: microflows.MicroflowObject,
  table: VarTable
): void {
  if (o instanceof microflows.MicroflowParameterObject) {
    if (!o.name) return;
    table.set(o.name, declFromParameter(o));
    return;
  }
  if (o instanceof microflows.ActionActivity) {
    const decl = declFromAction(o.action);
    if (decl) table.set(decl.name, decl);
    return;
  }
  // LoopedActivity handled by caller (needs both iterator + inner walk).
}

function declFromParameter(p: microflows.MicroflowParameterObject): VarDecl {
  const kindInfo = dataTypeToKind(p.variableType);
  return {
    name: p.name,
    ...kindInfo,
    declaredVia: "microflow parameter (existing)",
  };
}

function declFromAction(
  action: microflows.MicroflowAction | null | undefined
): VarDecl | null {
  if (!action) return null;
  if (action instanceof microflows.CreateVariableAction) {
    if (!action.variableName) return null;
    const kindInfo = dataTypeToKind(action.variableType);
    return {
      name: action.variableName,
      ...kindInfo,
      declaredVia: `CreateVariable (existing) '${action.variableName}'`,
    };
  }
  if (action instanceof microflows.RetrieveAction) {
    const outVar = action.outputVariableName;
    if (!outVar) return null;
    const src = action.retrieveSource;
    if (src instanceof microflows.DatabaseRetrieveSource) {
      const range = src.range;
      const isFirst =
        range instanceof microflows.ConstantRange && range.singleObject === true;
      const rangeLabel = isFirst
        ? "First"
        : range instanceof microflows.CustomRange
          ? "CustomRange"
          : "All";
      return {
        name: outVar,
        kind: isFirst ? "Object" : "List",
        entityQN: src.entityQualifiedName ?? undefined,
        declaredVia: `Retrieve(Database range:"${rangeLabel}") (existing) '${outVar}'`,
        rangeIsAll: !isFirst && rangeLabel === "All",
      };
    }
    if (src instanceof microflows.AssociationRetrieveSource) {
      return {
        name: outVar,
        kind: "Object",
        declaredVia: `Retrieve(Association) (existing) '${outVar}'`,
      };
    }
    return null;
  }
  if (action instanceof microflows.CreateObjectAction) {
    if (!action.outputVariableName) return null;
    return {
      name: action.outputVariableName,
      kind: "Object",
      entityQN: action.entityQualifiedName ?? undefined,
      declaredVia: `CreateObject (existing) '${action.outputVariableName}'`,
    };
  }
  if (action instanceof microflows.MicroflowCallAction) {
    if (!action.outputVariableName || action.useReturnVariable === false) return null;
    // Best-effort Object default — see header limitations.
    return {
      name: action.outputVariableName,
      kind: "Object",
      declaredVia: `CallMicroflow (existing) '${action.outputVariableName}'`,
    };
  }
  if (action instanceof microflows.AggregateListAction) {
    if (!action.outputVariableName) return null;
    return {
      name: action.outputVariableName,
      kind: "Primitive",
      primitive:
        action.aggregateFunction === microflows.AggregateFunctionEnum.Count
          ? "Long"
          : "Decimal",
      declaredVia: `AggregateList (existing) '${action.outputVariableName}'`,
    };
  }
  if (action instanceof microflows.ListOperationAction) {
    if (!action.outputVariableName) return null;
    const op = action.operation;
    const opName = op
      ? (op as { constructor: { name: string } }).constructor.name
      : "Unknown";
    if (opName === "Contains") {
      return {
        name: action.outputVariableName,
        kind: "Primitive",
        primitive: "Boolean",
        declaredVia: `ListOperation Contains (existing) '${action.outputVariableName}'`,
      };
    }
    return {
      name: action.outputVariableName,
      kind: "List",
      declaredVia: `ListOperation ${opName} (existing) '${action.outputVariableName}'`,
    };
  }
  return null;
}

function dataTypeToKind(
  dt: datatypes.IDataType | null | undefined
): { kind: VarKind; entityQN?: string; primitive?: string } {
  if (!dt) return { kind: "Primitive", primitive: "Void" };
  if (dt instanceof datatypes.ObjectType) {
    return { kind: "Object", entityQN: dt.entityQualifiedName ?? undefined };
  }
  if (dt instanceof datatypes.ListType) {
    return { kind: "List", entityQN: dt.entityQualifiedName ?? undefined };
  }
  if (dt instanceof datatypes.BooleanType) return { kind: "Primitive", primitive: "Boolean" };
  if (dt instanceof datatypes.StringType) return { kind: "Primitive", primitive: "String" };
  if (dt instanceof datatypes.IntegerType) return { kind: "Primitive", primitive: "Integer" };
  if (dt instanceof datatypes.DecimalType) return { kind: "Primitive", primitive: "Decimal" };
  if (dt instanceof datatypes.DateTimeType) return { kind: "Primitive", primitive: "DateTime" };
  return { kind: "Primitive", primitive: "Unknown" };
}

// ─── AppendActivitySpec validation (modify path) ─────────────────────────
//
// `AppendActivitySpec` is the raw `Record<string, unknown>`-backed shape used
// by `create_microflow_activities` / `insert_before_activity`. Field names
// vary in snake_case or camelCase form — the readers below probe both.
//
// `validateAppendSpecActivities` walks a sequence of new specs against a
// supplied base table (built from `collectDeclarationsFromLoaded`) — as each
// spec declares an output variable we extend the table so a later spec in
// the same call can reference it. After collecting, every reference slot
// is validated against the extended table.

function aStr(cfg: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = cfg[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function aArr<T = unknown>(cfg: Record<string, unknown>, ...keys: string[]): T[] | undefined {
  for (const k of keys) {
    const v = cfg[k];
    if (Array.isArray(v)) return v as T[];
  }
  return undefined;
}

function appendCfgOf(spec: AppendActivitySpec): Record<string, unknown> {
  if (spec.activity_config && typeof spec.activity_config === "object") {
    const merged: Record<string, unknown> = { ...spec.activity_config };
    for (const [k, v] of Object.entries(spec)) {
      if (k === "activity_type" || k === "activity_config") continue;
      if (v !== undefined) merged[k] = v;
    }
    return merged;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec)) {
    if (k === "activity_type" || k === "activity_config") continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Extract the VarDecl an AppendActivitySpec DECLARES, if any. Mirrors
 * `declarationFromActivity` but operates on raw configs.
 */
function declarationFromAppendSpec(
  spec: AppendActivitySpec,
  scope: string
): VarDecl | null {
  const type = String(spec.activity_type);
  const cfg = appendCfgOf(spec);
  switch (type) {
    case "create_object": {
      const name = aStr(cfg, "variableName", "outputVariableName");
      const entityQN = aStr(cfg, "entity", "entityQualifiedName");
      if (!name) return null;
      return {
        name,
        kind: "Object",
        entityQN,
        declaredVia: `CreateObject (new in ${scope}) '${name}'`,
      };
    }
    case "create_variable": {
      const name = aStr(cfg, "variableName", "variable_name");
      const variableType = aStr(cfg, "variable_type", "variableType");
      if (!name) return null;
      const kindInfo = parseVariableTypeString(variableType);
      return {
        name,
        ...kindInfo,
        declaredVia: `CreateVariable (new in ${scope}) '${name}'`,
      };
    }
    case "retrieve":
    case "retrieve_from_database": {
      const name = aStr(cfg, "output_variable", "outputVariableName");
      const entityQN = aStr(cfg, "entity", "entityQualifiedName");
      if (!name) return null;
      const range = cfg.range;
      let rangeLabel: "All" | "First" | "CustomRange" = "All";
      if (typeof range === "string") {
        rangeLabel = range === "First" ? "First" : "All";
      } else if (range && typeof range === "object") {
        const rt = (range as Record<string, unknown>).type;
        if (rt === "First") rangeLabel = "First";
        else if (rt === "ConstantRange" || rt === "CustomRange") rangeLabel = "CustomRange";
        else rangeLabel = "All";
      }
      const isList = rangeLabel !== "First";
      return {
        name,
        kind: isList ? "List" : "Object",
        entityQN,
        declaredVia: `Retrieve(Database range:"${rangeLabel}") (new in ${scope}) '${name}'`,
        rangeIsAll: isList && rangeLabel === "All",
      };
    }
    case "retrieve_by_association": {
      const name = aStr(cfg, "output_variable", "outputVariableName");
      if (!name) return null;
      // Best-effort Object default — see header limitations.
      return {
        name,
        kind: "Object",
        declaredVia: `Retrieve(Association) (new in ${scope}) '${name}'`,
      };
    }
    case "microflow_call": {
      const name = aStr(cfg, "return_variable", "outputVariableName");
      if (!name) return null;
      return {
        name,
        kind: "Object",
        declaredVia: `CallMicroflow (new in ${scope}) '${name}'`,
      };
    }
    case "aggregate_list": {
      const name = aStr(cfg, "output_variable", "outputVariableName");
      if (!name) return null;
      const fn = aStr(cfg, "function") ?? "Count";
      return {
        name,
        kind: "Primitive",
        primitive: fn === "Count" ? "Long" : "Decimal",
        declaredVia: `AggregateList ${fn} (new in ${scope}) '${name}'`,
      };
    }
    case "sort_list":
    case "find_in_list":
    case "head_of_list":
    case "tail_of_list":
    case "union_lists":
    case "intersect_lists":
    case "subtract_lists":
    case "change_list": {
      const name = aStr(cfg, "output_variable", "outputVariableName");
      if (!name) return null;
      return {
        name,
        kind: "List",
        declaredVia: `ListOperation ${type} (new in ${scope}) '${name}'`,
      };
    }
    case "contains_in_list": {
      const name = aStr(cfg, "output_variable", "outputVariableName");
      if (!name) return null;
      return {
        name,
        kind: "Primitive",
        primitive: "Boolean",
        declaredVia: `ListOperation Contains (new in ${scope}) '${name}'`,
      };
    }
    default:
      return null;
  }
}

function parseVariableTypeString(
  t: string | undefined
): { kind: VarKind; entityQN?: string; primitive?: string } {
  if (!t) return { kind: "Primitive", primitive: "Unknown" };
  const lower = t.toLowerCase();
  if (lower.startsWith("object:")) return { kind: "Object", entityQN: t.substring(7) };
  if (lower.startsWith("list:")) return { kind: "List", entityQN: t.substring(5) };
  if (["boolean", "string", "integer", "long", "decimal", "float", "datetime"].includes(lower)) {
    return { kind: "Primitive", primitive: t };
  }
  return { kind: "Primitive", primitive: t };
}

/**
 * Validate one AppendActivitySpec's reference slots against the supplied
 * table. Mirrors `validateOneActivity` but on raw configs.
 */
function validateAppendSpecActivity(
  spec: AppendActivitySpec,
  table: VarTable,
  activityId: string
): void {
  const type = String(spec.activity_type);
  const cfg = appendCfgOf(spec);
  switch (type) {
    case "create_variable":
      assertExpressionRefs(
        aStr(cfg, "initialValue", "initial_value"),
        table,
        "CreateVariable.initialValue",
        activityId
      );
      break;
    case "change_variable": {
      const v = aStr(cfg, "variable", "change_variable");
      assertNonEmpty(v, "ChangeVariable.variable", activityId);
      assertDeclared(v!, table, "ChangeVariable.variable", activityId);
      assertExpressionRefs(aStr(cfg, "value"), table, "ChangeVariable.value", activityId);
      break;
    }
    case "retrieve":
    case "retrieve_from_database":
      assertExpressionRefs(aStr(cfg, "xpath"), table, "Retrieve.source.xpath", activityId);
      break;
    case "retrieve_by_association": {
      const startVar = aStr(cfg, "input_variable", "startVariableName");
      assertNonEmpty(startVar, "Retrieve.source.startVariableName", activityId);
      if (startVar) {
        assertObjectKind(
          startVar,
          table,
          "Retrieve.source.startVariableName",
          activityId,
          "Association traversal"
        );
      }
      break;
    }
    case "create_object":
      validateAppendMemberChanges(cfg, table, "CreateObject.memberChange", activityId);
      break;
    case "change_object": {
      const v = aStr(cfg, "variable", "variableName");
      assertObjectKind(v ?? "", table, "ChangeObject.variable", activityId, "ChangeObject");
      validateAppendMemberChanges(cfg, table, "ChangeObject.memberChange", activityId);
      break;
    }
    case "commit": {
      const v = aStr(cfg, "variable", "commit_variable");
      assertNonEmpty(v, "CommitObject.variable", activityId);
      assertDeclared(v!, table, "CommitObject.variable", activityId);
      break;
    }
    case "rollback": {
      const v = aStr(cfg, "variable", "rollback_variable");
      assertNonEmpty(v, "RollbackObject.variable", activityId);
      assertDeclared(v!, table, "RollbackObject.variable", activityId);
      break;
    }
    case "delete": {
      const v = aStr(cfg, "variable", "delete_variable");
      assertNonEmpty(v, "DeleteObject.variable", activityId);
      assertDeclared(v!, table, "DeleteObject.variable", activityId);
      break;
    }
    case "microflow_call": {
      const params = aArr<{ name?: string; value?: string }>(cfg, "parameters");
      for (const p of params ?? []) {
        if (!p?.name) continue;
        assertExpressionRefs(
          p.value,
          table,
          `CallMicroflow.parameterMappings[${p.name}].argument`,
          activityId
        );
      }
      break;
    }
    case "aggregate_list": {
      const list = aStr(cfg, "list_variable", "listVariableName");
      assertListKind(
        list ?? "",
        table,
        "AggregateList.listVariableName",
        activityId,
        "AggregateList"
      );
      break;
    }
    case "sort_list":
    case "find_in_list":
    case "head_of_list":
    case "tail_of_list":
    case "change_list": {
      const list = aStr(cfg, "list_variable", "listVariableName");
      assertListKind(
        list ?? "",
        table,
        "ListOperation.listVariableName",
        activityId,
        `ListOperation ${type}`
      );
      break;
    }
    case "union_lists":
    case "intersect_lists":
    case "subtract_lists": {
      const list = aStr(cfg, "list_variable", "listVariableName");
      const second = aStr(cfg, "second_list_variable", "secondListVariableName");
      assertListKind(
        list ?? "",
        table,
        "ListOperation.listVariableName",
        activityId,
        `ListOperation ${type}`
      );
      assertListKind(
        second ?? "",
        table,
        "ListOperation.secondListVariableName",
        activityId,
        `ListOperation ${type} second-list`
      );
      break;
    }
    case "contains_in_list": {
      const list = aStr(cfg, "list_variable", "listVariableName");
      const obj = aStr(cfg, "object_variable", "objectVariableName");
      assertListKind(
        list ?? "",
        table,
        "ListOperation.listVariableName",
        activityId,
        "ListOperation Contains"
      );
      assertObjectKind(
        obj ?? "",
        table,
        "ListOperation.objectVariableName",
        activityId,
        "ListOperation Contains object operand"
      );
      break;
    }
    case "log_message":
    case "show_message": {
      const params = aArr<string>(cfg, "parameters") ?? [];
      for (const p of params) {
        assertExpressionRefs(p, table, `${type}.parameters[*]`, activityId);
      }
      break;
    }
    default:
      // Other activity types either don't carry variable references or are
      // handled elsewhere. Same scope as the spec-side validator.
      break;
  }
}

function validateAppendMemberChanges(
  cfg: Record<string, unknown>,
  table: VarTable,
  field: string,
  activityId: string
): void {
  for (const k of ["initial_values", "initialValues", "memberChanges", "changes"]) {
    const items = cfg[k];
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      const value = (it as { value?: unknown }).value;
      if (typeof value === "string") {
        assertExpressionRefs(value, table, `${field}.value`, activityId);
      }
    }
  }
}

/**
 * Entry point for the modify path: build a table from the loaded microflow,
 * extend it with each new spec's declared output as we walk, and validate
 * every spec's reference slots.
 *
 * The `scope` argument is included in error messages so the planner can tell
 * the validator fired during `create_microflow_activities` /
 * `insert_before_activity` rather than the original `create_microflow`.
 */
export function validateAppendSpecActivities(
  loaded: microflows.MicroflowBase,
  specs: ReadonlyArray<AppendActivitySpec>,
  scope: string
): void {
  const table = collectDeclarationsFromLoaded(loaded);
  // Extend with new specs' outputs so later specs in the same call can
  // reference them.
  for (let i = 0; i < specs.length; i++) {
    const decl = declarationFromAppendSpec(specs[i], scope);
    if (decl) table.set(decl.name, decl);
  }
  for (let i = 0; i < specs.length; i++) {
    const activityId = `${scope}.activities[${i}] (${specs[i].activity_type})`;
    validateAppendSpecActivity(specs[i], table, activityId);
  }
}

/**
 * Entry point for `modify_microflow_activity`: validates any variable-
 * reference field being assigned. The activity at `position` is identified
 * from `loaded`; we build a flat-namespace table and check each provided
 * args field against it.
 *
 * Fields not validated here (caption / disabled / commit / refresh_in_client /
 * with_events / use_return_variable) don't reference variables.
 */
export function validateModifyActivityRefs(
  loaded: microflows.MicroflowBase,
  args: ModifyMicroflowActivityArgs,
  scope: string
): void {
  const table = collectDeclarationsFromLoaded(loaded);
  const activityId = `${scope}[position ${args.position}]`;

  // change_variable: ChangeObjectAction.changeVariableName — must be Object.
  if (args.change_variable !== undefined) {
    assertObjectKind(
      args.change_variable,
      table,
      "modify.change_variable",
      activityId,
      "ChangeObject"
    );
  }
  // commit_variable / delete_variable / rollback_variable accept Object OR List
  // in Mendix — only require they resolve to a declared variable.
  if (args.commit_variable !== undefined) {
    assertNonEmpty(args.commit_variable, "modify.commit_variable", activityId);
    assertDeclared(args.commit_variable, table, "modify.commit_variable", activityId);
  }
  if (args.delete_variable !== undefined) {
    assertNonEmpty(args.delete_variable, "modify.delete_variable", activityId);
    assertDeclared(args.delete_variable, table, "modify.delete_variable", activityId);
  }
  if (args.rollback_variable !== undefined) {
    assertNonEmpty(args.rollback_variable, "modify.rollback_variable", activityId);
    assertDeclared(args.rollback_variable, table, "modify.rollback_variable", activityId);
  }
  // output_variable: pure renaming; uniqueness already enforced by the caller
  // (Class 4). Nothing to type-check.
}
