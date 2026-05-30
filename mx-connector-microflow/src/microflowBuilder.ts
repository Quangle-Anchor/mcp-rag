import {
  IModel,
  microflows,
  datatypes,
  domainmodels,
  texts,
  projects,
  pages,
  javascriptactions,
} from "mendixmodelsdk";
import type {
  CreateMicroflowArgs,
  ActivitySpec,
  FlowSpec,
  ReturnTypeSpec,
  MemberChangeSpec,
  SortItemSpec,
  RangeSpec,
  LoopedActivitySpec,
  ListOperationActivitySpec,
} from "./types.js";
import { validateXPathOrThrow } from "./xpathValidator.js";
import { validateEnumLiteral, validateEnumLiteralByEnumQN } from "./enumValueValidator.js";
import { validateMendixExpressionOrThrow } from "./expressionValidator.js";
import { validateMicroflowReferences } from "./microflowReferenceValidator.js";

const DEFAULT_LANGUAGE = "en_US";
const NAMING_PREFIXES = ["ACT_", "VAL_", "SUB_", "SCH_", "IVK_", "OCH_"];

/**
 * Builder mode. `"microflow"` (default) — the historical behaviour: every
 * activity type in the `ActivitySpec` union is accepted. `"nanoflow"` —
 * the new nanoflow-only activity handlers (`CallNanoflow`, `JavaScriptAction`,
 * `Synchronize`, `CancelSynchronize`) are accepted, and the allow-list /
 * reject-list is enforced by the caller (`nanoflowBuilder.ts`) before this
 * module is invoked.
 *
 * The `mode` is threaded into `createActivity` and the inner-loop builder so
 * the activity switch can branch on it for the few activity types that exist
 * only in one of the two flow kinds.
 */
export type FlowBuilderMode = "microflow" | "nanoflow";

export interface MicroflowBuildContext {
  autoTranslateEnumLiterals: boolean;
  warnings: string[];
}

// ─── Caption helpers ─────────────────────────────────────────────────────────

/**
 * Heal the raw qualified-name slot on a typed-reference property of a
 * Microflow mapping element.
 *
 * Two distinct SDK bugs converge here:
 *
 *   1. The typed setter on `RestOperationParameterMapping.parameter` (and
 *      `QueryParameterMapping.queryParameter`) writes the SDK-computed
 *      `target.qualifiedName` into the underlying `__<property>` slot.
 *   2. The SDK's QN walker (`AbstractElement._getQualifiedName`) only
 *      prepends container names whose class is `_declaredAsNamespace`.
 *      `Rest$RestOperation` is NOT marked as a namespace, so when the
 *      SDK computes the QN of an `OperationParameter` it SKIPS the
 *      operation segment and produces e.g.
 *      `"MyMod.MyService.Id"` instead of
 *      `"MyMod.MyService.GetCustomer.Id"`.
 *
 * Studio Pro's `RestOperationParameterMapping.set_ParameterId` deserializer
 * cannot resolve the truncated QN and stores `null`, throwing
 * `ArgumentNullException` at project load. The healer therefore writes
 * the operation-prefixed full QN via the internal slot's
 * `updateWithRawValue`, overriding what the typed setter wrote.
 *
 * Take the corrected QN as a string parameter rather than computing it
 * here — callers already have the loaded operation in scope and can
 * build `${operation.qualifiedName}.${parameter.name}` cheaply.
 */
function healMappingQualifiedName(
  mapping: object,
  internalPropName: string,
  correctedQualifiedName: string,
  publicPropName: string,
  spec: { id: string }
): void {
  if (!correctedQualifiedName) {
    throw new Error(
      `Cannot heal ${publicPropName} reference [activity '${spec.id}']: empty correctedQualifiedName.`
    );
  }
  const prop = (mapping as unknown as Record<string, {
    updateWithRawValue?: (v: string) => void;
  }>)[internalPropName];
  if (!prop || typeof prop.updateWithRawValue !== "function") {
    throw new Error(
      `SDK shape changed: could not access internal '${internalPropName}.updateWithRawValue' on mapping element [activity '${spec.id}']. Inspect the generated Mendix SDK and update healMappingQualifiedName().`
    );
  }
  prop.updateWithRawValue(correctedQualifiedName);
}

function shortName(qname: string | undefined): string {
  if (!qname) return "";
  const idx = qname.lastIndexOf(".");
  return idx >= 0 ? qname.substring(idx + 1) : qname;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.substring(0, max - 3)}...` : text;
}

function defaultCaption(spec: ActivitySpec): string {
  switch (spec.type) {
    case "CreateObject":
      return `Create ${shortName(spec.entityQualifiedName)}`;
    case "ChangeObject":
      return `Change ${spec.variable}`;
    case "CommitObject":
      return `Commit ${spec.variable}`;
    case "DeleteObject":
      return `Delete ${spec.variable}`;
    case "Retrieve":
      return spec.source.type === "Database"
        ? `Retrieve ${shortName(spec.source.entityQualifiedName)} from DB`
        : `Retrieve over ${shortName(spec.source.associationQualifiedName)}`;
    case "CreateVariable":
      return `Create variable ${spec.variableName}`;
    case "ChangeVariable":
      return `Change ${spec.variable}`;
    case "CallMicroflow":
      return `Call ${shortName(spec.microflowQualifiedName)}`;
    case "LogMessage":
      return `Log ${spec.level ?? "Info"} message`;
    case "AggregateList":
      return `${spec.aggregateFunction} ${spec.listVariableName}`;
    case "ListOperation":
      return `${spec.operation} ${spec.listVariableName}`;
    case "ShowMessage":
      return `Show ${(spec.messageType ?? "Information").toLowerCase()} message`;
    case "ShowPage":
      return `Show ${shortName(spec.pageQualifiedName)}`;
    case "ClosePage":
      return `Close page`;
    case "ValidationFeedback":
      return `Validate ${spec.objectVariable}`;
    case "ExclusiveSplit":
      return truncate(spec.condition, 60);
    case "LoopedActivity":
      return `Iterate ${spec.listVariableName}`;
    case "RestOperationCall":
      return `Call ${shortName(spec.operationQualifiedName)}`;
    case "CallNanoflow":
      return `Call ${shortName(spec.nanoflowQualifiedName)}`;
    case "JavaScriptAction":
      return `Call ${shortName(spec.javaScriptActionQualifiedName)}`;
    case "Synchronize":
      return `Synchronize${
        spec.synchronizationType ? ` (${spec.synchronizationType})` : ""
      }`;
    case "CancelSynchronize":
      return `Cancel synchronization`;
    default:
      return (spec as ActivitySpec).type;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setTranslation(textEl: texts.Text, value: string): void {
  textEl.translations.clear();
  const t = texts.Translation.createIn(textEl);
  t.languageCode = DEFAULT_LANGUAGE;
  t.text = value;
}

function findEntityOrThrow(model: IModel, qname: string, context: string): domainmodels.IEntity {
  const e = model.findEntityByQualifiedName(qname);
  if (!e) throw new Error(`Entity "${qname}" not found [${context}].`);
  return e;
}

function findAttributeOrThrow(model: IModel, qname: string, context: string): domainmodels.IAttribute {
  const a = model.findAttributeByQualifiedName(qname);
  if (!a) throw new Error(`Attribute "${qname}" not found [${context}].`);
  return a;
}

/**
 * Class 5 helper. Mendix `AggregateList` with function Sum/Average/Minimum/
 * Maximum requires the bound attribute to be Autonumber, Decimal, Integer, or
 * Long. Studio Pro's CE0016 error string is literally:
 *   "Attribute must be of type Autonumber, Decimal, Integer, or Long."
 * The SDK accepts any attribute reference silently, so this guard enforces the
 * constraint at write-time.
 */
async function assertNumericAggregateAttribute(
  attr: domainmodels.IAttribute,
  aggregateFunction: string,
  activityId: string
): Promise<void> {
  const loaded = await attr.load();
  const t = loaded.type;
  const isNumeric =
    t instanceof domainmodels.IntegerAttributeType ||
    t instanceof domainmodels.LongAttributeType ||
    t instanceof domainmodels.DecimalAttributeType ||
    t instanceof domainmodels.AutoNumberAttributeType;
  if (!isNumeric) {
    const actualType = (t as { constructor: { name: string } } | null)?.constructor?.name ?? "<unknown>";
    throw new Error(
      `AggregateList '${activityId}': function '${aggregateFunction}' requires a numeric attribute ` +
        `(Autonumber, Decimal, Integer, or Long). Attribute '${loaded.qualifiedName ?? loaded.name}' is ` +
        `'${actualType.replace(/AttributeType$/, "")}'. Studio Pro would reject this as CE0016.`
    );
  }
}

function findAssocOrThrow(
  model: IModel,
  qname: string,
  context: string
): domainmodels.IAssociationBase {
  const a = model.findAssociationBaseByQualifiedName(qname);
  if (!a) throw new Error(`Association "${qname}" not found [${context}].`);
  return a as domainmodels.IAssociationBase;
}

// ─── DataType factory ─────────────────────────────────────────────────────────

export type DataTypeTarget =
  | { kind: "returnType"; mf: microflows.MicroflowBase }
  | { kind: "paramObj"; param: microflows.MicroflowParameterObject }
  | { kind: "varAction"; action: microflows.CreateVariableAction };

export function applyDataType(spec: ReturnTypeSpec, target: DataTypeTarget, model: IModel): void {
  switch (spec.type) {
    case "Void":
      if (target.kind === "returnType")
        datatypes.VoidType.createInMicroflowBaseUnderMicroflowReturnType(target.mf);
      break;
    case "Boolean":
      if (target.kind === "returnType")
        datatypes.BooleanType.createInMicroflowBaseUnderMicroflowReturnType(target.mf);
      else if (target.kind === "paramObj")
        datatypes.BooleanType.createInMicroflowParameterObjectUnderVariableType(target.param);
      else datatypes.BooleanType.createInCreateVariableActionUnderVariableType(target.action);
      break;
    case "String":
      if (target.kind === "returnType")
        datatypes.StringType.createInMicroflowBaseUnderMicroflowReturnType(target.mf);
      else if (target.kind === "paramObj")
        datatypes.StringType.createInMicroflowParameterObjectUnderVariableType(target.param);
      else datatypes.StringType.createInCreateVariableActionUnderVariableType(target.action);
      break;
    case "Integer":
    case "Long":
      if (target.kind === "returnType")
        datatypes.IntegerType.createInMicroflowBaseUnderMicroflowReturnType(target.mf);
      else if (target.kind === "paramObj")
        datatypes.IntegerType.createInMicroflowParameterObjectUnderVariableType(target.param);
      else datatypes.IntegerType.createInCreateVariableActionUnderVariableType(target.action);
      break;
    case "Decimal":
      if (target.kind === "returnType")
        datatypes.DecimalType.createInMicroflowBaseUnderMicroflowReturnType(target.mf);
      else if (target.kind === "paramObj")
        datatypes.DecimalType.createInMicroflowParameterObjectUnderVariableType(target.param);
      else datatypes.DecimalType.createInCreateVariableActionUnderVariableType(target.action);
      break;
    case "DateTime":
      if (target.kind === "returnType")
        datatypes.DateTimeType.createInMicroflowBaseUnderMicroflowReturnType(target.mf);
      else if (target.kind === "paramObj")
        datatypes.DateTimeType.createInMicroflowParameterObjectUnderVariableType(target.param);
      else datatypes.DateTimeType.createInCreateVariableActionUnderVariableType(target.action);
      break;
    case "Object": {
      if (!spec.entityQualifiedName)
        throw new Error(`ReturnTypeSpec Object requires entityQualifiedName.`);
      const entity = findEntityOrThrow(model, spec.entityQualifiedName, "returnType/paramType");
      if (target.kind === "returnType") {
        const ot = datatypes.ObjectType.createInMicroflowBaseUnderMicroflowReturnType(target.mf);
        ot.entity = entity;
      } else if (target.kind === "paramObj") {
        const ot = datatypes.ObjectType.createInMicroflowParameterObjectUnderVariableType(target.param);
        ot.entity = entity;
      } else {
        const ot = datatypes.ObjectType.createInCreateVariableActionUnderVariableType(target.action);
        ot.entity = entity;
      }
      break;
    }
    case "List": {
      if (!spec.entityQualifiedName)
        throw new Error(`ReturnTypeSpec List requires entityQualifiedName.`);
      const entity = findEntityOrThrow(model, spec.entityQualifiedName, "returnType/paramType");
      if (target.kind === "returnType") {
        const lt = datatypes.ListType.createInMicroflowBaseUnderMicroflowReturnType(target.mf);
        lt.entity = entity;
      } else if (target.kind === "paramObj") {
        const lt = datatypes.ListType.createInMicroflowParameterObjectUnderVariableType(target.param);
        lt.entity = entity;
      } else {
        const lt = datatypes.ListType.createInCreateVariableActionUnderVariableType(target.action);
        lt.entity = entity;
      }
      break;
    }
    default:
      throw new Error(`Unknown ReturnTypeSpec type: ${(spec as ReturnTypeSpec).type}`);
  }
}

// ─── MemberChange helper ─────────────────────────────────────────────────────

async function applyMemberChanges(
  model: IModel,
  action: microflows.ChangeMembersAction,
  changes: MemberChangeSpec[],
  context: string,
  options: { autoTranslateEnumLiterals?: boolean; warnings: string[] }
): Promise<void> {
  const typeMap: Record<string, microflows.ChangeActionItemType> = {
    Set: microflows.ChangeActionItemType.Set,
    Add: microflows.ChangeActionItemType.Add,
    Remove: microflows.ChangeActionItemType.Remove,
  };

  for (const ch of changes) {
    const item = microflows.MemberChange.createIn(action);
    item.type = typeMap[ch.changeType ?? "Set"] ?? microflows.ChangeActionItemType.Set;

    if (ch.attributeQualifiedName) {
      item.attribute = findAttributeOrThrow(model, ch.attributeQualifiedName, context);
      // See specs/rules/enum_value_in_expression.md for the planner-facing rationale.
      const result = await validateEnumLiteral(ch.value, item.attribute, context, {
        autoTranslate: options.autoTranslateEnumLiterals,
      });
      // See specs/rules/expression_function_syntax.md.
      validateMendixExpressionOrThrow(result.value, `${context} (MemberChange.value)`);
      item.value = result.value;
      if (result.warning) options.warnings.push(result.warning);
    } else if (ch.associationQualifiedName) {
      item.association = findAssocOrThrow(model, ch.associationQualifiedName, context);
      // See specs/rules/expression_function_syntax.md.
      validateMendixExpressionOrThrow(ch.value, `${context} (MemberChange.value)`);
      item.value = ch.value;
    } else {
      throw new Error(
        `MemberChange must have attributeQualifiedName or associationQualifiedName [${context}].`
      );
    }
  }
}

// ─── SortItemList helper ─────────────────────────────────────────────────────

function applySortItems(
  model: IModel,
  sil: microflows.SortItemList,
  sortItems: SortItemSpec[],
  context: string
): void {
  for (const si of sortItems) {
    const item = microflows.SortItem.createIn(sil);
    item.sortOrder =
      si.order === "Descending"
        ? microflows.SortOrderEnum.Descending
        : microflows.SortOrderEnum.Ascending;
    const ref = domainmodels.AttributeRef.createInSortItemUnderAttributeRef(item);
    ref.attribute = findAttributeOrThrow(model, si.attributeQualifiedName, context);
  }
}

// ─── StringTemplate helper ────────────────────────────────────────────────────

function applyStringTemplate(
  tmpl: microflows.StringTemplate,
  template: string,
  parameters: string[],
  context: string = "StringTemplate"
): void {
  tmpl.text = template;
  parameters.forEach((param, i) => {
    const arg = microflows.TemplateArgument.createIn(tmpl);
    // See specs/rules/expression_function_syntax.md.
    validateMendixExpressionOrThrow(param, `${context} (parameter ${i + 1})`);
    arg.expression = param;
  });
}

// ─── TextTemplate helper ──────────────────────────────────────────────────────

function applyTextTemplate(
  tmpl: microflows.TextTemplate,
  template: string,
  parameters: string[],
  context: string = "TextTemplate"
): void {
  const textObj = texts.Text.createInTextTemplateUnderText(tmpl);
  setTranslation(textObj, template);
  parameters.forEach((param, i) => {
    const arg = microflows.TemplateArgument.createIn(tmpl);
    // See specs/rules/expression_function_syntax.md.
    validateMendixExpressionOrThrow(param, `${context} (parameter ${i + 1})`);
    arg.expression = param;
  });
}

// ─── Pre-flight validation ───────────────────────────────────────────────────

export function validateGraph(
  activities: ActivitySpec[],
  flows: FlowSpec[],
  isInner: boolean,
  loopOpts?: { hasBreakCondition: boolean }
): void {
  const ids = new Set<string>();
  for (const a of activities) {
    if (ids.has(a.id)) throw new Error(`Duplicate activity id: '${a.id}'`);
    ids.add(a.id);
  }

  const validFrom = new Set(["start", ...ids]);
  // Outer microflows: terminal keyword is "end" (→ EndEvent).
  // Inner LoopedActivity bodies: terminal keywords are "continue" (→ ContinueEvent)
  // and "break" (→ BreakEvent). The legacy keyword "end" is still accepted at
  // validation time for back-compat — buildInnerLoop auto-rewrites it to
  // "continue" with a warning before wiring. See specs/rules/looped_activity_terminators.md.
  const validTo = isInner
    ? new Set(["end", "continue", "break", ...ids])
    : new Set(["end", ...ids]);

  for (const f of flows) {
    if (!validFrom.has(f.from))
      throw new Error(`Flow references unknown source id: '${f.from}'`);
    if (!validTo.has(f.to))
      throw new Error(`Flow references unknown destination id: '${f.to}'`);
  }

  // Collect incoming/outgoing counts
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const a of activities) {
    incoming.set(a.id, 0);
    outgoing.set(a.id, 0);
  }

  for (const f of flows) {
    if (ids.has(f.to)) incoming.set(f.to, (incoming.get(f.to) ?? 0) + 1);
    if (ids.has(f.from)) outgoing.set(f.from, (outgoing.get(f.from) ?? 0) + 1);
  }

  // Inner-loop orphan check (Studio Pro CE0102: "A loop should only have one
  // start event"). Every inner activity must have an inbound edge except the
  // implicit entry:
  //   - If a `breakCondition` is set, the auto-generated breakSplit is the
  //     implicit entry, and its `false` branch flows to whatever activity the
  //     planner's `from: "start"` flow targets. That activity is therefore
  //     reachable even though it has no flow in `flows` pointing AT it (the
  //     "start" flow is consumed by the breakSplit, not wired as-is).
  //   - Otherwise activities[0] is the implicit entry (first in innerOc.objects).
  if (isInner) {
    const implicitEntries = new Set<string>();
    if (loopOpts?.hasBreakCondition) {
      const startFlow = flows.find((f) => f.from === "start");
      if (startFlow && ids.has(startFlow.to)) implicitEntries.add(startFlow.to);
    } else if (activities[0]) {
      implicitEntries.add(activities[0].id);
    }

    const orphans: string[] = [];
    for (const a of activities) {
      if ((incoming.get(a.id) ?? 0) === 0 && !implicitEntries.has(a.id)) {
        orphans.push(a.id);
      }
    }
    if (orphans.length > 0) {
      throw new Error(
        `LoopedActivity inner graph: activity '${orphans[0]}' has no inbound flow ` +
          `(orphans: [${orphans.map((id) => `'${id}'`).join(", ")}]). ` +
          `Add a flow {from: "<prev>", to: "${orphans[0]}"} or remove the activity. ` +
          `Studio Pro would reject this as CE0102 "A loop should only have one start event". ` +
          `See specs/rules/looped_activity_terminators.md.`
      );
    }
  }

  for (const a of activities) {
    if ((outgoing.get(a.id) ?? 0) === 0 && a.type !== "ExclusiveSplit") {
      const isTerminal =
        flows.some(
          (f) => f.from === a.id && (f.to === "end" || f.to === "continue" || f.to === "break")
        ) ||
        outgoing.get(a.id) === 0;
      if (!flows.some((f) => f.from === a.id)) {
        throw new Error(`Dead-end activity: '${a.id}' has no outgoing flows.`);
      }
    }
  }

  // Validate ExclusiveSplit flows
  for (const a of activities) {
    if (a.type === "ExclusiveSplit") {
      const outFlows = flows.filter((f) => f.from === a.id);
      if (outFlows.length < 2) {
        throw new Error(
          `ExclusiveSplit '${a.id}' must have at least 2 outgoing flows (found ${outFlows.length}).`
        );
      }
      for (const f of outFlows) {
        if (!f.condition) {
          throw new Error(
            `ExclusiveSplit '${a.id}': each outgoing flow must have a 'condition' field.`
          );
        }
      }

      // Expression-type splits: enforce exactly 2 flows with conditions {true, false}
      // (case-insensitive). This is what Studio Pro renders as the true/false labels.
      const condType = a.conditionType ?? "Expression";
      if (condType === "Expression") {
        if (outFlows.length !== 2) {
          throw new Error(
            `ExclusiveSplit '${a.id}' (Expression): must have exactly 2 outgoing flows ("true" and "false"), got ${outFlows.length}.`
          );
        }
        const conds = outFlows.map((f) => (f.condition ?? "").trim().toLowerCase());
        const set = new Set(conds);
        if (set.size !== 2 || !set.has("true") || !set.has("false")) {
          throw new Error(
            `ExclusiveSplit '${a.id}' (Expression): outgoing flow conditions must be exactly "true" and "false" (case-insensitive). Got [${outFlows.map((f) => `'${f.condition}'`).join(", ")}].`
          );
        }
      }
    }
  }
}

// ─── Variable-name uniqueness pre-flight (CE0111) ─────────────────────────────

/**
 * Walk an ActivitySpec tree and collect every variable name it DECLARES, with
 * the owning activity id. Recurses into LoopedActivity inner activities — those
 * share the parent microflow's flat variable scope, so duplicates across the
 * loop boundary also trigger CE0111.
 *
 * Variable-DECLARING slots:
 *   - CreateObject.outputVariableName
 *   - Retrieve.outputVariableName
 *   - CreateVariable.variableName
 *   - CallMicroflow.outputVariableName  (treated as declared; the flag for
 *     useReturnVariable isn't on the spec, so if the planner sets a name we
 *     reserve it)
 *   - AggregateList.outputVariableName
 *   - ListOperation.outputVariableName
 *   - RestOperationCall.outputVariableName, .bodyVariableName
 *   - CallNanoflow.outputVariableName
 *   - JavaScriptAction.outputVariableName
 *   - LoopedActivity.iteratorVariableName
 *
 * Variable-REFERENCING slots intentionally omitted (ChangeObject.variable,
 * ChangeVariable.variable, CommitObject.variable, DeleteObject.variable).
 */
export function collectSpecVariableDeclarations(
  activities: ActivitySpec[],
  collected: Map<string, string>,
  duplicates: Array<{ name: string; firstId: string; secondId: string }>
): void {
  const claim = (name: string | undefined, ownerId: string): void => {
    if (!name) return;
    const existing = collected.get(name);
    if (existing !== undefined && existing !== ownerId) {
      duplicates.push({ name, firstId: existing, secondId: ownerId });
    } else {
      collected.set(name, ownerId);
    }
  };
  for (const a of activities) {
    switch (a.type) {
      case "CreateObject":
        claim(a.outputVariableName, a.id);
        break;
      case "Retrieve":
        claim(a.outputVariableName, a.id);
        break;
      case "CreateVariable":
        claim(a.variableName, a.id);
        break;
      case "CallMicroflow":
        claim(a.outputVariableName, a.id);
        break;
      case "AggregateList":
        claim(a.outputVariableName, a.id);
        break;
      case "ListOperation":
        claim(a.outputVariableName, a.id);
        break;
      case "RestOperationCall":
        claim(a.outputVariableName, a.id);
        claim(a.bodyVariableName, a.id);
        break;
      case "CallNanoflow":
        claim(a.outputVariableName, a.id);
        break;
      case "JavaScriptAction":
        claim(a.outputVariableName, a.id);
        break;
      case "LoopedActivity":
        claim(a.iteratorVariableName, a.id);
        collectSpecVariableDeclarations(a.activities ?? [], collected, duplicates);
        break;
      default:
        // ChangeObject / ChangeVariable / CommitObject / DeleteObject /
        // LogMessage / ShowMessage / ShowPage / ClosePage /
        // ValidationFeedback / ExclusiveSplit / Synchronize /
        // CancelSynchronize do not declare new variables.
        break;
    }
  }
}

/**
 * Pre-flight check: throw if any variable name is declared by two different
 * activities (CE0111). Used by `create_microflow` and mirrored by
 * `create_microflow_activities` / `insert_before_activity` /
 * `modify_microflow_activity` in microflowOperations.ts.
 */
export function validateUniqueVariableNames(
  parameters: { name: string }[] | undefined,
  activities: ActivitySpec[],
  scope: string
): void {
  const collected = new Map<string, string>();
  const duplicates: Array<{ name: string; firstId: string; secondId: string }> = [];
  for (const p of parameters ?? []) {
    if (p.name) collected.set(p.name, `parameter '${p.name}'`);
  }
  collectSpecVariableDeclarations(activities, collected, duplicates);
  if (duplicates.length > 0) {
    const d = duplicates[0];
    throw new Error(
      `${scope}: duplicate variable name '${d.name}' declared by ${d.firstId} and ${d.secondId}. ` +
        `Microflow variable names must be unique across all activities (including LoopedActivity ` +
        `inner activities). Studio Pro would reject this as CE0111. Rename one of them.`
    );
  }
}

// ─── errorHandlingType helper (Class 6 / CE6035) ──────────────────────────────

/**
 * Mendix Studio Pro enforces a different allow-list of `errorHandlingType`
 * values depending on whether the containing flow is a microflow or a
 * nanoflow. The SDK exposes all five values on `microflows.ErrorHandlingType`
 * with `Rollback` as the universal default, so without a builder-side guard
 * every action committed inside a nanoflow ends up with `Rollback` — which
 * Studio Pro rejects at project-load time as `CE6035`.
 *
 * Source: https://docs.mendix.com/refguide/error-handling-in-microflows/
 *         https://docs.mendix.com/refguide/error-handling-in-nanoflows/
 */
const ERROR_HANDLING_TYPES_BY_MODE: Record<FlowBuilderMode, ReadonlySet<string>> = {
  microflow: new Set(["Rollback", "Custom", "CustomWithoutRollBack", "Continue"]),
  nanoflow: new Set(["Abort", "CustomWithoutRollBack"]),
};

const ERROR_HANDLING_TYPE_ENUM: Record<string, microflows.ErrorHandlingType> = {
  Rollback: microflows.ErrorHandlingType.Rollback,
  Custom: microflows.ErrorHandlingType.Custom,
  CustomWithoutRollBack: microflows.ErrorHandlingType.CustomWithoutRollBack,
  Continue: microflows.ErrorHandlingType.Continue,
  Abort: microflows.ErrorHandlingType.Abort,
};

/**
 * Apply an explicit / default `errorHandlingType` to an `ExclusiveSplit`,
 * `LoopedActivity`, or `MicroflowAction` "carrier" (each of which exposes the
 * SDK property at the same name).
 *
 * - When the planner provided a value, validate it against the mode-specific
 *   allow-list above and the `Continue` restriction, then write it.
 * - When the planner did not provide a value: override the SDK's universal
 *   `Rollback` default with `Abort` for nanoflow mode; leave `Rollback` in
 *   place for microflow mode.
 *
 * `Custom` / `CustomWithoutRollBack` need a separate error-handler subtree
 * which this builder does not wire; the value is accepted but the caller is
 * warned via `ctx.warnings`.
 */
function applyErrorHandlingType(
  carrier: { errorHandlingType: microflows.ErrorHandlingType },
  spec: ActivitySpec,
  mode: FlowBuilderMode,
  ctx: MicroflowBuildContext
): void {
  const requested = spec.errorHandlingType;
  if (requested !== undefined) {
    const allowed = ERROR_HANDLING_TYPES_BY_MODE[mode];
    if (!allowed.has(requested)) {
      const allowedList = Array.from(allowed).map((v) => `"${v}"`).join(", ");
      throw new Error(
        `activity '${spec.id}': errorHandlingType "${requested}" is not supported in ${mode} context. ` +
          `Allowed values: ${allowedList}. Studio Pro would reject this as CE6035.`
      );
    }
    if (mode === "microflow" && requested === "Continue") {
      if (spec.type !== "CallMicroflow" && spec.type !== "LoopedActivity") {
        throw new Error(
          `activity '${spec.id}': errorHandlingType "Continue" is only allowed on ` +
            `"CallMicroflow" or "LoopedActivity" in microflow context (got "${spec.type}"). ` +
            `Studio Pro would reject this as CE6035.`
        );
      }
    }
    if (requested === "Custom" || requested === "CustomWithoutRollBack") {
      ctx.warnings.push(
        `activity '${spec.id}': errorHandlingType "${requested}" requires a separate error-handler ` +
          `flow which the builder does not yet wire. Add it manually in Studio Pro, or change to ` +
          `"Rollback" / "Abort" / "Continue".`
      );
    }
    carrier.errorHandlingType = ERROR_HANDLING_TYPE_ENUM[requested];
    return;
  }
  if (mode === "nanoflow") {
    carrier.errorHandlingType = ERROR_HANDLING_TYPE_ENUM.Abort;
  }
}

// ─── Activity creation ────────────────────────────────────────────────────────

type MfObject = microflows.MicroflowObject;

export async function createActivity(
  model: IModel,
  mf: microflows.MicroflowBase,
  oc: microflows.MicroflowObjectCollection,
  spec: ActivitySpec,
  ctx: MicroflowBuildContext,
  mode: FlowBuilderMode = "microflow"
): Promise<MfObject> {
  if (spec.type === "ExclusiveSplit") {
    const split = microflows.ExclusiveSplit.createIn(oc);
    split.caption = spec.caption ?? defaultCaption(spec);
    if (spec.documentation) split.documentation = spec.documentation;

    const cond = microflows.ExpressionSplitCondition.createIn(split);
    // TODO(enum-literal-validator): wire a best-effort regex scan here for the
    // pattern `$Var/Attr = 'NAME'` where Attr resolves to an enum. Today the
    // validator doesn't fire for ExclusiveSplit because parsing the expression
    // is out of scope. See specs/rules/enum_value_in_expression.md.
    // See specs/rules/expression_function_syntax.md.
    validateMendixExpressionOrThrow(spec.condition, `activity '${spec.id}' (ExclusiveSplit.condition)`);
    cond.expression = spec.condition;
    applyErrorHandlingType(split, spec, mode, ctx);
    return split;
  }

  if (spec.type === "LoopedActivity") {
    const loop = microflows.LoopedActivity.createIn(oc);
    if (spec.caption) loop.documentation = spec.caption; // LoopedActivity has no caption, use documentation
    if (spec.documentation) loop.documentation = spec.documentation;

    const iterableList = microflows.IterableList.createIn(loop);
    iterableList.listVariableName = spec.listVariableName;
    iterableList.variableName = spec.iteratorVariableName;

    const innerOc = microflows.MicroflowObjectCollection.createInLoopedActivityUnderObjectCollection(loop);
    await buildInnerLoop(model, mf, innerOc, spec, ctx, mode);

    applyErrorHandlingType(loop, spec, mode, ctx);
    return loop;
  }

  // Regular ActionActivity
  const act = microflows.ActionActivity.createIn(oc);
  act.caption = spec.caption ?? defaultCaption(spec);
  act.autoGenerateCaption = false;
  if (spec.documentation) act.documentation = spec.documentation;

  if (spec.backgroundColor) {
    const colorMap: Record<string, microflows.ActionActivityColor> = {
      Default: microflows.ActionActivityColor.Default,
      Blue: microflows.ActionActivityColor.Blue,
      Gray: microflows.ActionActivityColor.Gray,
      Green: microflows.ActionActivityColor.Green,
      LightBlue: microflows.ActionActivityColor.LightBlue,
      Orange: microflows.ActionActivityColor.Orange,
      Purple: microflows.ActionActivityColor.Purple,
      Red: microflows.ActionActivityColor.Red,
      Yellow: microflows.ActionActivityColor.Yellow,
    };
    const color = colorMap[spec.backgroundColor];
    if (color) act.backgroundColor = color;
  }

  switch (spec.type) {
    case "CreateObject": {
      const action = microflows.CreateObjectAction.createIn(act);
      action.entity = findEntityOrThrow(model, spec.entityQualifiedName, `activity '${spec.id}'`);
      action.outputVariableName = spec.outputVariableName;
      action.commit = commitEnumOf(spec.commit);
      action.refreshInClient = spec.refreshInClient ?? false;
      if (spec.memberChanges?.length) {
        await applyMemberChanges(model, action, spec.memberChanges, `activity '${spec.id}'`, {
          autoTranslateEnumLiterals: ctx.autoTranslateEnumLiterals,
          warnings: ctx.warnings,
        });
      }
      break;
    }

    case "ChangeObject": {
      const action = microflows.ChangeObjectAction.createIn(act);
      action.changeVariableName = spec.variable;
      action.commit = commitEnumOf(spec.commit);
      action.refreshInClient = spec.refreshInClient ?? false;
      if (spec.memberChanges?.length) {
        await applyMemberChanges(model, action, spec.memberChanges, `activity '${spec.id}'`, {
          autoTranslateEnumLiterals: ctx.autoTranslateEnumLiterals,
          warnings: ctx.warnings,
        });
      }
      break;
    }

    case "CommitObject": {
      const action = microflows.CommitAction.createIn(act);
      action.commitVariableName = spec.variable;
      action.withEvents = spec.withEvents ?? true;
      action.refreshInClient = spec.refreshInClient ?? false;
      break;
    }

    case "DeleteObject": {
      const action = microflows.DeleteAction.createIn(act);
      action.deleteVariableName = spec.variable;
      break;
    }

    case "Retrieve": {
      const action = microflows.RetrieveAction.createIn(act);
      action.outputVariableName = spec.outputVariableName;

      if (spec.source.type === "Database") {
        const src = microflows.DatabaseRetrieveSource.createIn(action);
        src.entity = findEntityOrThrow(
          model,
          spec.source.entityQualifiedName!,
          `activity '${spec.id}'`
        );
        if (spec.source.xpath) {
          validateXPathOrThrow(spec.source.xpath, `activity '${spec.id}' (Retrieve)`);
          src.xPathConstraint = spec.source.xpath;
        }
        applyRange(src, spec.source.range);
        if (spec.source.sortItems?.length) {
          const sil = microflows.SortItemList.createInDatabaseRetrieveSourceUnderSortItemList(src);
          applySortItems(model, sil, spec.source.sortItems, spec.id);
        }
      } else {
        const src = microflows.AssociationRetrieveSource.createIn(action);
        src.startVariableName = spec.source.startVariableName!;
        src.association = findAssocOrThrow(
          model,
          spec.source.associationQualifiedName!,
          `activity '${spec.id}'`
        );
      }
      break;
    }

    case "CreateVariable": {
      const action = microflows.CreateVariableAction.createIn(act);
      action.variableName = spec.variableName;
      // NOTE: When `variableType` gains Enumeration support, wire validateEnumLiteralByEnumQN
      // here per specs/rules/enum_value_in_expression.md (Task 6 in the enum-literal fix plan).
      // See specs/rules/expression_function_syntax.md.
      validateMendixExpressionOrThrow(
        spec.initialValue,
        `activity '${spec.id}' (CreateVariable.initialValue)`
      );
      if (spec.initialValue) action.initialValue = spec.initialValue;
      applyDataType(spec.variableType, { kind: "varAction", action }, model);
      break;
    }

    case "ChangeVariable": {
      const action = microflows.ChangeVariableAction.createIn(act);
      action.changeVariableName = spec.variable;
      // TODO(enum-literal-validator): wire validateEnumLiteralByEnumQN here once
      // variable-scope resolution lands. Today the validator doesn't fire for
      // ChangeVariable because the named variable's declared type requires walking
      // the microflow's lexical scope. See specs/rules/enum_value_in_expression.md
      // and docs/enum_value_in_expression_defect.md "Affected microflows" list.
      // See specs/rules/expression_function_syntax.md.
      validateMendixExpressionOrThrow(
        spec.value,
        `activity '${spec.id}' (ChangeVariable.value)`
      );
      action.value = spec.value;
      break;
    }

    case "CallMicroflow": {
      const action = microflows.MicroflowCallAction.createIn(act);
      const mfCall = microflows.MicroflowCall.createIn(action);
      const targetMfRef = model.findMicroflowByQualifiedName(spec.microflowQualifiedName);
      if (!targetMfRef)
        throw new Error(
          `Microflow "${spec.microflowQualifiedName}" not found [activity '${spec.id}'].`
        );
      mfCall.microflow = targetMfRef;
      if (spec.outputVariableName) action.outputVariableName = spec.outputVariableName;

      // Resolve target parameters by walking objectCollection.objects.
      //
      // Why not pm.parameter = param? Two reasons:
      //  1. findMicroflowParameterByQualifiedName indexes Microflows$MicroflowParameter
      //     (semantic), but the SDK creates parameters as Microflows$MicroflowParameterObject
      //     (visual) — the index never populates and returns null.
      //  2. The pm.parameter setter calls param._getQualifiedName() and stores the
      //     string. For a freshly-created MicroflowParameterObject, that walk returns
      //     null/undefined (container chain not fully resolved in-session), and
      //     ByNameReferenceProperty.set's `=== null` check treats undefined as valid,
      //     storing null silently. Studio Pro then throws ArgumentNullException on
      //     MicroflowCallParameterMapping.set_ParameterId at project load.
      //
      // Workaround: walk objectCollection.objects by name to find the target parameter
      // (used here only to validate the mapping name resolves and to populate the
      // "available" diagnostic on miss), then write the qualified name directly via
      // ByNameReferenceProperty.updateWithRawValue. Same pattern as
      // pageBuilder.ts:healNullLayoutArgumentParameters.
      const mappings = spec.parameterMappings ?? [];
      if (mappings.length > 0) {
        const loadedTarget = await targetMfRef.load();
        const targetParams = loadedTarget.objectCollection.objects.filter(
          (obj): obj is microflows.MicroflowParameterObject =>
            obj instanceof microflows.MicroflowParameterObject
        );

        for (const mapping of mappings) {
          const param = targetParams.find((p) => p.name === mapping.parameterName);
          if (!param) {
            const available = targetParams.map((p) => p.name).join(", ") || "<none>";
            throw new Error(
              `Parameter "${mapping.parameterName}" not found on microflow "${spec.microflowQualifiedName}" [activity '${spec.id}']. Available: ${available}.`
            );
          }
          const pm = microflows.MicroflowCallParameterMapping.createIn(mfCall);
          const paramQn = `${spec.microflowQualifiedName}.${mapping.parameterName}`;
          const internalProp = (pm as unknown as Record<string, {
            updateWithRawValue?: (v: string) => void;
          }>).__parameter;
          if (!internalProp?.updateWithRawValue) {
            throw new Error(
              `Internal SDK shape changed: MicroflowCallParameterMapping.__parameter has no updateWithRawValue [activity '${spec.id}'].`
            );
          }
          internalProp.updateWithRawValue(paramQn);
          // See specs/rules/enum_value_in_expression.md.
          const paramVarType = (param as unknown as { variableType?: unknown }).variableType;
          if (paramVarType instanceof datatypes.EnumerationType) {
            const enumRef = paramVarType.enumeration;
            const enumQN = enumRef?.qualifiedName;
            if (enumQN) {
              const result = await validateEnumLiteralByEnumQN(
                mapping.argument,
                enumQN,
                `activity '${spec.id}' parameter '${mapping.parameterName}'`,
                { autoTranslate: ctx.autoTranslateEnumLiterals },
                async () => {
                  if (!enumRef) return [];
                  const loaded = await enumRef.load();
                  return loaded.values.map((v) => v.name);
                }
              );
              // See specs/rules/expression_function_syntax.md.
              validateMendixExpressionOrThrow(
                result.value,
                `activity '${spec.id}' parameter '${mapping.parameterName}'`
              );
              pm.argument = result.value;
              if (result.warning) ctx.warnings.push(result.warning);
            } else {
              // See specs/rules/expression_function_syntax.md.
              validateMendixExpressionOrThrow(
                mapping.argument,
                `activity '${spec.id}' parameter '${mapping.parameterName}'`
              );
              pm.argument = mapping.argument;
            }
          } else {
            // See specs/rules/expression_function_syntax.md.
            validateMendixExpressionOrThrow(
              mapping.argument,
              `activity '${spec.id}' parameter '${mapping.parameterName}'`
            );
            pm.argument = mapping.argument;
          }
        }
      }
      break;
    }

    case "LogMessage": {
      const action = microflows.LogMessageAction.createIn(act);
      action.level = logLevelOf(spec.level ?? "Info");
      action.node = spec.node ?? "";
      const tmpl = microflows.StringTemplate.createInLogMessageActionUnderMessageTemplate(action);
      applyStringTemplate(tmpl, spec.template ?? "", spec.parameters ?? [], `activity '${spec.id}'`);
      break;
    }

    case "AggregateList": {
      // Pre-validate required string fields. Without these guards, undefined
      // values flow into the SDK slots and produce an activity with an empty
      // List / Output-variable in Studio Pro (silent-failure class — same
      // shape as the LayoutCallArgument and RestOperationParameterMapping
      // bugs documented in CLAUDE.md).
      if (!spec.listVariableName || !String(spec.listVariableName).trim()) {
        throw new Error(
          `AggregateList '${spec.id}' requires 'listVariableName' (the variable name of the list to aggregate).`
        );
      }
      if (!spec.outputVariableName || !String(spec.outputVariableName).trim()) {
        throw new Error(
          `AggregateList '${spec.id}' requires 'outputVariableName' (the variable to receive the result).`
        );
      }
      const action = microflows.AggregateListAction.createIn(act);
      action.inputListVariableName = spec.listVariableName;
      action.aggregateFunction = aggregateFunctionOf(spec.aggregateFunction);
      action.outputVariableName = spec.outputVariableName;
      // Class 5 fix (CE0016): the 'Count' function operates on the list itself
      // and must NOT have an attribute bound. Sum/Average/Minimum/Maximum
      // require a numeric attribute (Autonumber, Decimal, Integer, Long).
      if (spec.aggregateFunction === "Count") {
        if (spec.attributeQualifiedName) {
          throw new Error(
            `AggregateList '${spec.id}': function 'Count' must not specify 'attributeQualifiedName' — ` +
              `Count operates on the list itself, not on an attribute. Remove 'attributeQualifiedName' ` +
              `or change the function to Sum/Average/Minimum/Maximum. Studio Pro would reject this as CE0016.`
          );
        }
      } else {
        if (!spec.attributeQualifiedName) {
          throw new Error(
            `AggregateList '${spec.id}': attributeQualifiedName required for ${spec.aggregateFunction}.`
          );
        }
        const attr = findAttributeOrThrow(
          model,
          spec.attributeQualifiedName,
          `activity '${spec.id}'`
        );
        await assertNumericAggregateAttribute(attr, spec.aggregateFunction, spec.id);
        action.attribute = attr;
      }
      break;
    }

    case "ListOperation": {
      const action = microflows.ListOperationAction.createIn(act);
      action.outputVariableName = spec.outputVariableName;

      switch (spec.operation) {
        case "Sort": {
          const op = microflows.Sort.createIn(action);
          op.listVariableName = spec.listVariableName;
          const sil = microflows.SortItemList.createInSortUnderSortItemList(op);
          if (spec.sortItems?.length) applySortItems(model, sil, spec.sortItems, spec.id);
          break;
        }
        case "Head": {
          const op = microflows.Head.createIn(action);
          op.listVariableName = spec.listVariableName;
          break;
        }
        case "Tail": {
          const op = microflows.Tail.createIn(action);
          op.listVariableName = spec.listVariableName;
          break;
        }
        case "Contains": {
          if (!spec.objectVariableName)
            throw new Error(
              `ListOperation.Contains '${spec.id}' requires objectVariableName (single object), not secondListVariableName.`
            );
          const op = microflows.Contains.createIn(action);
          op.listVariableName = spec.listVariableName;
          op.secondListOrObjectVariableName = spec.objectVariableName;
          break;
        }
        case "Union": {
          const op = microflows.Union.createIn(action);
          op.listVariableName = spec.listVariableName;
          op.secondListOrObjectVariableName = spec.secondListVariableName ?? "";
          break;
        }
        case "Intersect": {
          const op = microflows.Intersect.createIn(action);
          op.listVariableName = spec.listVariableName;
          op.secondListOrObjectVariableName = spec.secondListVariableName ?? "";
          break;
        }
        case "Subtract": {
          const op = microflows.Subtract.createIn(action);
          op.listVariableName = spec.listVariableName;
          op.secondListOrObjectVariableName = spec.secondListVariableName ?? "";
          break;
        }
        default:
          throw new Error(`Unsupported ListOperation: ${(spec as ListOperationActivitySpec).operation}`);
      }
      break;
    }

    case "ShowMessage": {
      const action = microflows.ShowMessageAction.createIn(act);
      action.blocking = spec.blocking ?? true;
      const typeMap: Record<string, microflows.ShowMessageType> = {
        Information: microflows.ShowMessageType.Information,
        Warning: microflows.ShowMessageType.Warning,
        Error: microflows.ShowMessageType.Error,
      };
      action.type = typeMap[spec.messageType ?? "Information"] ?? microflows.ShowMessageType.Information;
      const tmpl = microflows.TextTemplate.createInShowMessageActionUnderTemplate(action);
      applyTextTemplate(tmpl, spec.template ?? "", spec.parameters ?? [], `activity '${spec.id}'`);
      break;
    }

    case "ShowPage": {
      const action = microflows.ShowPageAction.createIn(act);
      const ps = pages.PageSettings.createInShowPageActionUnderPageSettings(action);
      const page = model.findPageByQualifiedName(spec.pageQualifiedName);
      if (!page)
        throw new Error(
          `Page "${spec.pageQualifiedName}" not found [activity '${spec.id}'].`
        );
      ps.page = page;

      // `ShowPageAction.passedObjectVariableName` was deleted from the metamodel
      // in 9.18.0 (Mendix 11). The replacement (`PageSettings.parameterMappings`)
      // exists from 9.7.0 onward. Branch on the metamodel version so the same
      // tool works on both Mendix 10 (≤ 9.17) and Mendix 11 (≥ 9.18). The
      // exported `Version` type is reachable on `IModel.metaModelVersion`; we
      // compare its `major`/`minor` fields directly so no extra SDK import is
      // required.
      const mmv = model.metaModelVersion;
      const legacyAvailable = mmv.major < 9 || (mmv.major === 9 && mmv.minor < 18);
      const explicitMappings = spec.parameterMappings ?? [];

      if (explicitMappings.length > 0) {
        // Modern API — works on Mendix 9.7+ / Mendix 10 / Mendix 11.
        const loadedPage = await page.load();
        for (const m of explicitMappings) {
          const param = loadedPage.parameters.find((p) => p.name === m.parameterName);
          if (!param)
            throw new Error(
              `Page parameter "${m.parameterName}" not found on "${spec.pageQualifiedName}" [activity '${spec.id}']. Available: ${loadedPage.parameters.map((p) => p.name).join(", ") || "(none)"}.`
            );
          const mapping = pages.PageParameterMapping.createIn(ps);
          mapping.parameter = param;
          // See specs/rules/expression_function_syntax.md.
          validateMendixExpressionOrThrow(
            m.argument,
            `activity '${spec.id}' page parameter '${m.parameterName}'`
          );
          mapping.argument = m.argument;
        }
      } else if (spec.passedObjectVariableName) {
        if (legacyAvailable) {
          // Mendix ≤ 10 (metamodel < 9.18): use the deprecated single-parameter slot.
          action.passedObjectVariableName = spec.passedObjectVariableName;
        } else {
          // Mendix 11 (metamodel ≥ 9.18): the legacy slot is gone. Translate
          // legacy spec → parameterMappings by binding the page's first parameter
          // to "$<variableName>". This preserves caller code that still uses the
          // older field while emitting forward-compatible model output.
          const loadedPage = await page.load();
          if (loadedPage.parameters.length === 0) {
            throw new Error(
              `ShowPage activity '${spec.id}' was given 'passedObjectVariableName="${spec.passedObjectVariableName}"' but page "${spec.pageQualifiedName}" has no parameters on metamodel ≥ 9.18. Provide explicit 'parameterMappings' instead.`
            );
          }
          const mapping = pages.PageParameterMapping.createIn(ps);
          mapping.parameter = loadedPage.parameters[0];
          mapping.argument = `$${spec.passedObjectVariableName}`;
        }
      }
      // If neither field is provided, the page is shown without input — supported
      // on both metamodels.
      break;
    }

    case "ClosePage": {
      microflows.CloseFormAction.createIn(act);
      break;
    }

    case "ValidationFeedback": {
      // Pre-validate required fields. Silent-undefined here produces a
      // ValidationFeedback whose Variable / Member / Feedback-template slots
      // all render blank in Studio Pro (observed on LeaveRequest3 build —
      // every ValidationFeedback came out with `object: ""` and caption
      // "Validate undefined" because `spec.objectVariable` was undefined).
      if (!spec.objectVariable || !String(spec.objectVariable).trim()) {
        throw new Error(
          `ValidationFeedback '${spec.id}' requires 'objectVariable' (the variable name of the object to validate).`
        );
      }
      if (!spec.attributeQualifiedName && !spec.associationQualifiedName) {
        throw new Error(
          `ValidationFeedback '${spec.id}' requires either 'attributeQualifiedName' or 'associationQualifiedName' (the member to attach the feedback to).`
        );
      }
      if (spec.attributeQualifiedName && spec.associationQualifiedName) {
        throw new Error(
          `ValidationFeedback '${spec.id}' must specify only one of 'attributeQualifiedName' or 'associationQualifiedName', not both.`
        );
      }
      if (!spec.message || !String(spec.message).trim()) {
        throw new Error(
          `ValidationFeedback '${spec.id}' requires a non-empty 'message' (the error text to display).`
        );
      }

      const action = microflows.ValidationFeedbackAction.createIn(act);
      action.objectVariableName = spec.objectVariable;
      if (spec.attributeQualifiedName) {
        action.attribute = findAttributeOrThrow(
          model,
          spec.attributeQualifiedName,
          `activity '${spec.id}'`
        );
      } else {
        action.association = findAssocOrThrow(
          model,
          spec.associationQualifiedName!,
          `activity '${spec.id}'`
        );
      }
      const tmpl =
        microflows.TextTemplate.createInValidationFeedbackActionUnderFeedbackTemplate(action);
      applyTextTemplate(tmpl, spec.message, [], `activity '${spec.id}'`);
      break;
    }

    case "RestOperationCall": {
      const action = microflows.RestOperationCallAction.createIn(act);
      const opStub = model.findRestOperationByQualifiedName(spec.operationQualifiedName);
      if (!opStub) {
        throw new Error(
          `RestOperation "${spec.operationQualifiedName}" not found [activity '${spec.id}'].`
        );
      }
      action.operation = opStub;

      // Output / body variable
      if (spec.outputVariableName) {
        const out = microflows.OutputVariable.createIn(action);
        out.variableName = spec.outputVariableName;
      }
      if (spec.bodyVariableName) {
        const bv = microflows.BodyVariable.createIn(action);
        bv.variableName = spec.bodyVariableName;
      }

      // Resolve path-parameter and query-parameter targets by loading the
      // operation. Without load() the stub's `.parameters` / `.queryParameters`
      // are empty lists in this session and lookups fail.
      const mappings = spec.parameterMappings ?? [];
      const queryMappings = spec.queryParameterMappings ?? [];
      if (mappings.length > 0 || queryMappings.length > 0) {
        const loadedOp = await opStub.load();

        for (const m of mappings) {
          const target = loadedOp.parameters.find((p) => p.name === m.parameterName);
          if (!target) {
            const available = loadedOp.parameters.map((p) => p.name).join(", ") || "<none>";
            throw new Error(
              `Path parameter "${m.parameterName}" not found on operation "${spec.operationQualifiedName}" [activity '${spec.id}']. Available: ${available}.`
            );
          }
          const pm = microflows.RestOperationParameterMapping.createIn(action);
          pm.parameter = target;
          // The SDK's typed setter writes `target.qualifiedName` into the
          // `__parameter` slot, but the SDK's QN walker SKIPS the
          // RestOperation segment because `Rest$RestOperation` is not
          // `_declaredAsNamespace`. Result: a truncated QN like
          // "Mod.Service.Id" instead of "Mod.Service.Operation.Id". Studio
          // Pro fails to resolve the truncated QN at project load and
          // throws ArgumentNullException at set_ParameterId. Overwrite the
          // slot with the operation-prefixed full QN.
          const correctedParamQN = `${loadedOp.qualifiedName}.${target.name}`;
          healMappingQualifiedName(pm, "__parameter", correctedParamQN, "parameter", spec);
          pm.value = m.argument;
        }

        for (const q of queryMappings) {
          const target = loadedOp.queryParameters.find((p) => p.name === q.parameterName);
          if (!target) {
            const available =
              loadedOp.queryParameters.map((p) => p.name).join(", ") || "<none>";
            throw new Error(
              `Query parameter "${q.parameterName}" not found on operation "${spec.operationQualifiedName}" [activity '${spec.id}']. Available: ${available}.`
            );
          }
          const qm = microflows.QueryParameterMapping.createIn(action);
          qm.queryParameter = target;
          // Same QN-truncation bug as RestOperationParameterMapping above
          // — RestOperation is skipped in the SDK's QN walk. Overwrite
          // with the operation-prefixed full QN.
          const correctedQueryQN = `${loadedOp.qualifiedName}.${target.name}`;
          healMappingQualifiedName(qm, "__queryParameter", correctedQueryQN, "queryParameter", spec);
          qm.value = q.argument;
          const includedMap: Record<string, microflows.IncludedOption> = {
            Yes: microflows.IncludedOption.Yes,
            No: microflows.IncludedOption.No,
            WhenNotNull: microflows.IncludedOption.WhenNotNull,
          };
          if (q.included) {
            const opt = includedMap[q.included];
            if (!opt) {
              throw new Error(
                `Unsupported included value "${q.included}" on query parameter "${q.parameterName}" [activity '${spec.id}']. Use 'Yes', 'No', or 'WhenNotNull'.`
              );
            }
            qm.included = opt;
          }
        }
      }
      break;
    }

    case "CallNanoflow": {
      // Nanoflow-only — see `nanoflowBuilder.ts`. Same QN-truncation healing
      // pattern as CallMicroflow because the SDK's typed setter on
      // `NanoflowCallParameterMapping.parameter` walks the parameter's
      // qualified name. For NanoflowCallParameterMapping the SDK's QN walk
      // is correct (Nanoflow is in a regular Module namespace), so we use the
      // typed setter directly here without the slot-rewrite trick.
      const action = microflows.NanoflowCallAction.createIn(act);
      const nfCall = microflows.NanoflowCall.createIn(action);
      const targetNfRef = model.findNanoflowByQualifiedName(spec.nanoflowQualifiedName);
      if (!targetNfRef)
        throw new Error(
          `Nanoflow "${spec.nanoflowQualifiedName}" not found [activity '${spec.id}'].`
        );
      nfCall.nanoflow = targetNfRef;
      if (spec.outputVariableName) action.outputVariableName = spec.outputVariableName;

      const mappings = spec.parameterMappings ?? [];
      if (mappings.length > 0) {
        const loadedTarget = await targetNfRef.load();
        const targetParams = loadedTarget.objectCollection.objects.filter(
          (obj): obj is microflows.MicroflowParameterObject =>
            obj instanceof microflows.MicroflowParameterObject
        );

        for (const mapping of mappings) {
          const param = targetParams.find((p) => p.name === mapping.parameterName);
          if (!param) {
            const available = targetParams.map((p) => p.name).join(", ") || "<none>";
            throw new Error(
              `Parameter "${mapping.parameterName}" not found on nanoflow "${spec.nanoflowQualifiedName}" [activity '${spec.id}']. Available: ${available}.`
            );
          }
          // Reuse the same slot-rewrite pattern as CallMicroflow above — the
          // SDK's typed setter writes a QN computed from the visual
          // MicroflowParameterObject, which can be unresolved at this point.
          const pm = microflows.NanoflowCallParameterMapping.createIn(nfCall);
          const paramQn = `${spec.nanoflowQualifiedName}.${mapping.parameterName}`;
          const internalProp = (pm as unknown as Record<string, {
            updateWithRawValue?: (v: string) => void;
          }>).__parameter;
          if (!internalProp?.updateWithRawValue) {
            throw new Error(
              `Internal SDK shape changed: NanoflowCallParameterMapping.__parameter has no updateWithRawValue [activity '${spec.id}'].`
            );
          }
          internalProp.updateWithRawValue(paramQn);
          // See specs/rules/expression_function_syntax.md.
          validateMendixExpressionOrThrow(
            mapping.argument,
            `activity '${spec.id}' nanoflow parameter '${mapping.parameterName}'`
          );
          pm.argument = mapping.argument;
        }
      }
      break;
    }

    case "JavaScriptAction": {
      // Nanoflow-only — Java actions are server-only. Resolve the JS action
      // via `findJavaScriptActionByQualifiedName`. Argument expressions are
      // stored on a `BasicCodeActionParameterValue` (a CodeActionParameterValue
      // subclass) attached to each `JavaScriptActionParameterMapping`.
      const action = microflows.JavaScriptActionCallAction.createIn(act);
      const jsAction = model.findJavaScriptActionByQualifiedName(
        spec.javaScriptActionQualifiedName
      );
      if (!jsAction) {
        throw new Error(
          `JavaScript action "${spec.javaScriptActionQualifiedName}" not found [activity '${spec.id}'].`
        );
      }
      action.javaScriptAction = jsAction;
      if (spec.outputVariableName) action.outputVariableName = spec.outputVariableName;

      const mappings = spec.parameterMappings ?? [];
      if (mappings.length > 0) {
        const loadedAction = await jsAction.load();
        // CodeAction exposes its parameters under `actionParameters`; each
        // entry is a `CodeActionParameter` and the corresponding mapping
        // expects an `IJavaScriptActionParameter` (a `JavaScriptAction`'s
        // `actionParameters` are guaranteed to be `JavaScriptActionParameter`
        // instances by the SDK, so the narrowing is safe).
        const params = loadedAction.actionParameters;
        for (const mapping of mappings) {
          const target = params.find((p) => p.name === mapping.parameterName);
          if (!target) {
            const available = params.map((p) => p.name).join(", ") || "<none>";
            throw new Error(
              `Parameter "${mapping.parameterName}" not found on JavaScript action "${spec.javaScriptActionQualifiedName}" [activity '${spec.id}']. Available: ${available}.`
            );
          }
          const pm = microflows.JavaScriptActionParameterMapping.createIn(action);
          pm.parameter = target as unknown as javascriptactions.IJavaScriptActionParameter;
          const val =
            microflows.BasicCodeActionParameterValue.createInJavaScriptActionParameterMappingUnderParameterValue(
              pm
            );
          // See specs/rules/expression_function_syntax.md.
          validateMendixExpressionOrThrow(
            mapping.argument,
            `activity '${spec.id}' JS action parameter '${mapping.parameterName}'`
          );
          val.argument = mapping.argument;
        }
      }
      break;
    }

    case "Synchronize": {
      // Nanoflow-only (offline apps). `type` + `variableNames` are 8.10.0+; the
      // builder degrades gracefully on older metamodels by only setting
      // `variableNames` when the metamodel supports it. `Selective` is an alias
      // for the SDK's `Specific` so the spec stays readable.
      const action = microflows.SynchronizeAction.createIn(act);
      const requested = spec.synchronizationType ?? "All";
      const normalized = requested === "Selective" ? "Specific" : requested;
      const typeMap: Record<string, microflows.SynchronizationType> = {
        All: microflows.SynchronizationType.All,
        Specific: microflows.SynchronizationType.Specific,
        Unsynchronized: microflows.SynchronizationType.Unsynchronized,
      };
      const mappedType = typeMap[normalized];
      if (!mappedType) {
        throw new Error(
          `Synchronize activity '${spec.id}': unsupported synchronizationType '${requested}'. Allowed: All, Selective, Specific, Unsynchronized.`
        );
      }
      action.type = mappedType;

      if (normalized === "Specific") {
        const entities = spec.entitiesToSynchronize ?? [];
        if (entities.length === 0) {
          throw new Error(
            `Synchronize activity '${spec.id}': synchronizationType '${requested}' requires non-empty 'entitiesToSynchronize'.`
          );
        }
        for (const entFqn of entities) {
          const ent = model.findEntityByQualifiedName(entFqn);
          if (!ent) {
            throw new Error(
              `Synchronize activity '${spec.id}': entity '${entFqn}' not found in model.`
            );
          }
          // Studio Pro persists the entity QN as a string on
          // `SynchronizeAction.variableNames`. The IList<string> exposes only
          // `add` here — push each resolved QN.
          (action.variableNames as unknown as { add: (v: string) => void }).add(
            ent.qualifiedName ?? entFqn
          );
        }
      } else if ((spec.entitiesToSynchronize ?? []).length > 0) {
        ctx.warnings.push(
          `Synchronize activity '${spec.id}': 'entitiesToSynchronize' is ignored when synchronizationType is '${requested}'.`
        );
      }
      break;
    }

    case "CancelSynchronize": {
      // Nanoflow-only (offline apps, metamodel 11.8.0+). Class has no fields.
      microflows.CancelSynchronizationAction.createIn(act);
      break;
    }

    default:
      throw new Error(`Unknown activity type: ${(spec as ActivitySpec).type}`);
  }

  // Class 6 fix (CE6035): the SDK initialises every action with
  // `errorHandlingType = Rollback`, which is fine in microflows but rejected
  // by Studio Pro inside nanoflows. `act.action` is the concrete
  // MicroflowAction the switch above just created; every case in the switch
  // calls `microflows.<X>Action.createIn(act)` so this is non-null here.
  if (act.action) {
    applyErrorHandlingType(act.action, spec, mode, ctx);
  }

  return act;
}

// ─── Inner loop builder ───────────────────────────────────────────────────────

async function buildInnerLoop(
  model: IModel,
  mf: microflows.MicroflowBase,
  innerOc: microflows.MicroflowObjectCollection,
  loopSpec: LoopedActivitySpec,
  ctx: MicroflowBuildContext,
  mode: FlowBuilderMode = "microflow"
): Promise<void> {
  // NOTE (Mendix loop convention): a LoopedActivity has NO inner StartEvent.
  // The first object in the inner ObjectCollection is the implicit entry point.
  // Creation order matters because we use `objects[0]` as the entry in
  // autoLayoutInnerLoop:
  //   1. breakSplit (if breakCondition is set) — becomes implicit entry
  //   2. user-declared inner activities — first one is implicit entry when no breakSplit
  //   3. BreakEvent (if any flow targets "break") — created lazily before ContinueEvent
  //   4. ContinueEvent — must be LAST so it never accidentally becomes the entry
  //      (matches the reference layout where ContinueEvent appears after the
  //      loop body activities).
  //
  // TERMINAL KEYWORDS INSIDE A LOOP (post-fix, see specs/rules/looped_activity_terminators.md):
  //   "continue" → ContinueEvent (next iteration / normal end of body)
  //   "break"    → BreakEvent    (exit loop, control returns to outer flow)
  //   "end"      → ILLEGAL inside a loop body (Studio Pro CE0068). For back-compat
  //                with older specs, the builder auto-rewrites `to: "end"` to
  //                `to: "continue"` with a warning before wiring.
  const innerMap = new Map<string, MfObject>();
  // "start" intentionally NOT mapped — there is no StartEvent inside a loop.
  // "end" intentionally NOT pre-mapped — auto-rewritten to "continue" below
  // (defense-in-depth: wireFlow also short-circuits "end" creation when
  // isInnerLoop=true, but that path is only reached if rewrite is skipped).

  // BACK-COMPAT REWRITE — translate legacy `to: "end"` (which used to mean
  // "exit loop early" per the old docs) into `to: "continue"`. This is wrong
  // for true break semantics, but it preserves the historical behaviour for
  // builds that previously committed cleanly with `to: "end"` (they all ended
  // up failing Studio Pro CE0068 anyway, so reverting to `to: "continue"` is
  // strictly less broken). Planners that intend an early loop exit should use
  // `to: "break"` explicitly.
  const rewrittenFlows: FlowSpec[] = loopSpec.flows.map((f) => {
    if (f.to === "end") {
      ctx.warnings.push(
        `LoopedActivity '${loopSpec.id}': flow {from: "${f.from}", to: "end"} is ` +
          `illegal inside a loop (Studio Pro CE0068). Auto-rewrote to ` +
          `{to: "continue"} for back-compat. Use {to: "break"} if you intend ` +
          `to exit the loop early, or {to: "continue"} for next-iteration. ` +
          `See specs/rules/looped_activity_terminators.md.`
      );
      return { ...f, to: "continue" };
    }
    return f;
  });

  // Pre-flight: validate the inner graph (orphan detection — CE0102) AFTER the
  // rewrite, so "end" → "continue" doesn't trigger an orphan throw for the
  // ContinueEvent. validateGraph(isInner=true) also accepts "break" as a
  // terminal keyword.
  validateGraph(loopSpec.activities, rewrittenFlows, true, {
    hasBreakCondition: !!loopSpec.breakCondition,
  });

  // LoopedActivity inner flows always run in a Void context (no microflow return value).
  const innerEndConfig: EndEventConfig = { returnType: { type: "Void" } };
  // `innerEndEvents` is never read after wiring inside the inner loop, but
  // wireFlow's signature requires the accumulator. Pass an empty array — no
  // EndEvent is legitimately created inside a loop, so this stays empty.
  const innerEndEvents: microflows.EndEvent[] = [];

  // If breakCondition: generate auto ExclusiveSplit at the top.
  // The breakSplit becomes the IMPLICIT entry of the loop (must be created first
  // so it appears first in innerOc.objects).
  let breakSplit: microflows.ExclusiveSplit | null = null;
  if (loopSpec.breakCondition) {
    breakSplit = microflows.ExclusiveSplit.createIn(innerOc);
    breakSplit.caption = truncate(loopSpec.breakCondition, 60);
    const cond = microflows.ExpressionSplitCondition.createIn(breakSplit);
    // See specs/rules/expression_function_syntax.md.
    validateMendixExpressionOrThrow(
      loopSpec.breakCondition,
      `LoopedActivity '${loopSpec.id}' (breakCondition)`
    );
    cond.expression = loopSpec.breakCondition;
    innerMap.set("__breakSplit__", breakSplit);
  }

  // Create inner activities (after breakSplit, before BreakEvent/ContinueEvent)
  for (const actSpec of loopSpec.activities) {
    const obj = await createActivity(model, mf, innerOc, actSpec, ctx, mode);
    innerMap.set(actSpec.id, obj);
  }

  // BreakEvent: created lazily, only if any flow targets "break" (either from
  // the planner's rewritten flows OR from the auto-generated breakSplit below).
  // Must appear in innerOc.objects BEFORE ContinueEvent so the layout reads as:
  // [breakSplit?] → [activities] → [BreakEvent?] → [ContinueEvent].
  const planRefersToBreak = rewrittenFlows.some((f) => f.to === "break");
  const needsBreakEvent = planRefersToBreak || !!breakSplit;
  if (needsBreakEvent) {
    const breakEvt = microflows.BreakEvent.createIn(innerOc);
    innerMap.set("break", breakEvt);
  }

  // ContinueEvent goes LAST in innerOc.objects so it never becomes the entry.
  const continueEvt = microflows.ContinueEvent.createIn(innerOc);
  innerMap.set("continue", continueEvt);

  // Wire inner flows. Filter out "from: start" flows (no StartEvent to wire from).
  // The destination of those flows is the implicit entry — already handled by
  // creation order (breakSplit first if present, else first activity).
  const innerWired: WiredFlow[] = [];
  for (const f of rewrittenFlows) {
    if (f.from === "start") continue; // implicit entry; no SequenceFlow needed
    innerWired.push(
      wireFlow(
        mf,
        innerOc,
        innerMap,
        f,
        loopSpec.activities,
        innerEndConfig,
        innerEndEvents,
        true // isInnerLoop — suppresses fresh-EndEvent creation
      )
    );
  }

  // Wire breakCondition auto-split:
  //   breakSplit (true)  → BreakEvent   (exit loop early)            → main flow (right)
  //   breakSplit (false) → first inner activity                       → branch flow (down)
  // Convention here: "true" = break (early exit on the right line, like the
  // standard Mendix early-exit pattern); "false" = continue with body (down).
  //
  // FIX (Class 2 / CE0068): the true branch used to create a fresh EndEvent
  // inside innerOc, which Studio Pro rejects as "End events cannot be placed
  // inside a loop". Mendix's correct primitive for "exit loop early" is
  // BreakEvent (`microflows.BreakEvent`, ref docs at
  // https://docs.mendix.com/refguide/break-event). The lazy BreakEvent created
  // above is reused here.
  if (breakSplit) {
    const breakEvt = innerMap.get("break") as microflows.BreakEvent | undefined;
    if (!breakEvt) {
      // Defensive: needsBreakEvent must be true when breakSplit is set (see
      // the `|| !!breakSplit` clause above). This throw guards against a
      // future refactor regressing that invariant.
      throw new Error(
        `LoopedActivity '${loopSpec.id}': breakCondition wired but BreakEvent ` +
          `was not created. This is an internal builder invariant violation.`
      );
    }
    const trueFlow = microflows.SequenceFlow.createIn(mf);
    trueFlow.origin = breakSplit;
    trueFlow.destination = breakEvt;
    setMainConnectionIndices(trueFlow);
    const breakTrueCase = microflows.EnumerationCase.createInSequenceFlowUnderCaseValues(trueFlow);
    breakTrueCase.value = "true";
    innerWired.push({
      flow: trueFlow,
      origin: breakSplit,
      destination: breakEvt,
      isBranch: false,
      explicitBranch: true,
    });

    // false branch → whatever "start" normally goes to (the user-declared first
    // activity inside the loop).
    const startTarget = rewrittenFlows.find((f) => f.from === "start");
    if (startTarget && startTarget.to !== "end") {
      const branchTarget = innerMap.get(startTarget.to);
      if (!branchTarget) {
        throw new Error(
          `LoopedActivity breakCondition wiring: 'start → ${startTarget.to}' target not found in inner activities.`
        );
      }
      const falseFlow = microflows.SequenceFlow.createIn(mf);
      falseFlow.origin = breakSplit;
      falseFlow.destination = branchTarget;
      setBranchConnectionIndices(falseFlow);
      const breakFalseCase = microflows.EnumerationCase.createInSequenceFlowUnderCaseValues(falseFlow);
      breakFalseCase.value = "false";
      innerWired.push({
        flow: falseFlow,
        origin: breakSplit,
        destination: branchTarget,
        isBranch: true,
        explicitBranch: true,
      });
    }
  }

  // Per-split reclassification for the inner-loop flows (no-op for the
  // breakSplit since its flows are marked `explicitBranch: true`).
  reclassifySplitFlows(innerWired);

  // Insert ExclusiveMerge nodes wherever inner-loop branches reconverge.
  insertMergeNodesAtConvergence(innerOc, mf, innerWired);

  // Layout inner loop (no StartEvent; implicit entry is the first object in innerOc.objects)
  autoLayoutInnerLoop(innerOc, innerWired);
}

// ─── Flow wiring ─────────────────────────────────────────────────────────────

export interface EndEventConfig {
  /** Microflow's return type — controls whether returnValue should be set on a new EndEvent. */
  returnType: ReturnTypeSpec;
  /** Variable name used as the returnValue expression `$<name>`. Required if returnType !== Void. */
  returnVariableName?: string;
}

/**
 * Connection index convention used by Studio Pro on a rectangular shape:
 *   0 = Top, 1 = Right, 2 = Bottom, 3 = Left.
 * Verified by inspecting RequestsOverview.ACT_LeaveType_GetRemainingBalance_2:
 *   main flow uses originIdx=1, destIdx=3 (right→left)
 *   branch flow uses originIdx=2, destIdx=0 (bottom→top)
 */
const SIDE_TOP = 0;
const SIDE_RIGHT = 1;
const SIDE_BOTTOM = 2;
const SIDE_LEFT = 3;

function setMainConnectionIndices(sf: microflows.SequenceFlow): void {
  sf.originConnectionIndex = SIDE_RIGHT;
  sf.destinationConnectionIndex = SIDE_LEFT;
}

function setBranchConnectionIndices(sf: microflows.SequenceFlow): void {
  sf.originConnectionIndex = SIDE_BOTTOM;
  sf.destinationConnectionIndex = SIDE_TOP;
}

export interface WiredFlow {
  flow: microflows.SequenceFlow;
  origin: MfObject;
  destination: MfObject;
  /** True when this flow is drawn vertically (BOTTOM→TOP). */
  isBranch: boolean;
  /** True when the caller set `branch` explicitly on the FlowSpec — disables per-split auto-classification for the split this flow belongs to. */
  explicitBranch: boolean;
}

export function wireFlow(
  mf: microflows.MicroflowBase,
  oc: microflows.MicroflowObjectCollection,
  objectMap: Map<string, MfObject>,
  flowSpec: FlowSpec,
  activities: ActivitySpec[],
  endConfig: EndEventConfig,
  endEvents: microflows.EndEvent[],
  isInnerLoop: boolean = false
): WiredFlow {
  const origin = objectMap.get(flowSpec.from);
  if (!origin)
    throw new Error(`Flow origin '${flowSpec.from}' not found in object map.`);

  // Per-flow EndEvent: each flow targeting "end" gets its own EndEvent with
  // its own returnValue. Studio Pro requires every EndEvent of a non-Void
  // microflow to have a return-value expression; sharing one EndEvent across
  // diverging branches is a model lint that Studio Pro flags.
  //
  // INSIDE A LOOP: this short-circuit is suppressed. Studio Pro rejects ANY
  // EndEvent inside a LoopedActivity's ObjectCollection (CE0068). The caller
  // (buildInnerLoop) auto-rewrites `to: "end"` → `to: "continue"` before
  // calling wireFlow, but as defense-in-depth we also drop the short-circuit
  // when isInnerLoop is true and let the objectMap lookup resolve "continue"
  // / "break" to the pre-mapped ContinueEvent / BreakEvent.
  let dest: MfObject;
  if (flowSpec.to === "end" && !isInnerLoop) {
    const endEvt = microflows.EndEvent.createIn(oc);
    if (endConfig.returnType.type !== "Void" && endConfig.returnVariableName) {
      endEvt.returnValue = `$${endConfig.returnVariableName}`;
    }
    endEvents.push(endEvt);
    dest = endEvt;
  } else {
    const lookup = objectMap.get(flowSpec.to);
    if (!lookup)
      throw new Error(`Flow destination '${flowSpec.to}' not found in object map.`);
    dest = lookup;
  }

  const sf = microflows.SequenceFlow.createIn(mf);
  sf.origin = origin;
  sf.destination = dest;

  // Determine main vs branch.
  // Precedence (highest first):
  //   1. Explicit per-flow override (flowSpec.branch) — caller knows best.
  //   2. Destination is a ValidationFeedbackAction — validation feedback is
  //      never the happy case, regardless of the split's case value.
  //   3. Default convention: case "false" leaving an Expression-type
  //      ExclusiveSplit is the non-happy branch (drawn downward); everything
  //      else is main flow.
  let isBranch = false;
  if (flowSpec.condition) {
    const srcSpec = activities.find((a) => a.id === flowSpec.from);
    if (srcSpec?.type === "ExclusiveSplit") {
      const condType = srcSpec.conditionType ?? "Expression";
      if (condType === "Enumeration") {
        if (flowSpec.condition === "[empty]") {
          microflows.NoCase.createInSequenceFlowUnderCaseValues(sf);
        } else {
          const ec = microflows.EnumerationCase.createInSequenceFlowUnderCaseValues(sf);
          ec.value = flowSpec.condition;
        }
      } else {
        // Expression split: BOTH outgoing flows MUST carry an explicit EnumerationCase
        // for Studio Pro to render the "true"/"false" labels on both branches.
        const normalized = flowSpec.condition.trim().toLowerCase();
        if (normalized === "true") {
          const ec = microflows.EnumerationCase.createInSequenceFlowUnderCaseValues(sf);
          ec.value = "true";
        } else if (normalized === "false") {
          const ec = microflows.EnumerationCase.createInSequenceFlowUnderCaseValues(sf);
          ec.value = "false";
          isBranch = true;
        } else {
          throw new Error(
            `ExclusiveSplit '${flowSpec.from}' (Expression): outgoing flow condition must be "true" or "false" (case-insensitive), got '${flowSpec.condition}'.`
          );
        }
      }
    }
  }

  // (2) Flows landing on a ValidationFeedbackAction are never the happy case.
  if (
    dest instanceof microflows.ActionActivity &&
    dest.action instanceof microflows.ValidationFeedbackAction
  ) {
    isBranch = true;
  }

  // (1) Explicit per-flow override — highest precedence. Lets the caller flip
  // the layout when neither the default nor the ValidationFeedback rule applies
  // (e.g. validation splits like `empty($field)` where `false` is happy).
  if (flowSpec.branch !== undefined) {
    isBranch = flowSpec.branch;
  }

  if (isBranch) {
    setBranchConnectionIndices(sf);
  } else {
    setMainConnectionIndices(sf);
  }

  return {
    flow: sf,
    origin,
    destination: dest,
    isBranch,
    explicitBranch: flowSpec.branch !== undefined,
  };
}

/**
 * After all flows are wired, re-classify the happy/branch assignment per
 * decision split. The per-flow logic in `wireFlow` can't see siblings — when a
 * split has one outgoing flow going to a `ValidationFeedback` and the sibling
 * going to a happy activity, the sibling needs to become the main path
 * regardless of whether its case value is `"true"` or `"false"`.
 *
 * Splits where any FlowSpec carried an explicit `branch` are left alone — the
 * caller has taken control.
 */
export function reclassifySplitFlows(wired: WiredFlow[]): void {
  const isSplitObj = (obj: MfObject): boolean =>
    obj instanceof microflows.ExclusiveSplit ||
    obj instanceof microflows.InheritanceSplit;
  const isVfTarget = (obj: MfObject): boolean =>
    obj instanceof microflows.ActionActivity &&
    obj.action instanceof microflows.ValidationFeedbackAction;
  const caseValueOf = (sf: microflows.SequenceFlow): string | undefined => {
    for (const cv of sf.caseValues) {
      if (cv instanceof microflows.EnumerationCase) {
        return cv.value.trim().toLowerCase();
      }
    }
    return undefined;
  };

  const bySplit = new Map<MfObject, WiredFlow[]>();
  for (const w of wired) {
    if (isSplitObj(w.origin)) {
      if (!bySplit.has(w.origin)) bySplit.set(w.origin, []);
      bySplit.get(w.origin)!.push(w);
    }
  }

  for (const splitFlows of bySplit.values()) {
    if (splitFlows.some((w) => w.explicitBranch)) continue;

    const nonVf = splitFlows.filter((w) => !isVfTarget(w.destination));
    let happy: WiredFlow | undefined;
    if (nonVf.length > 0 && nonVf.length < splitFlows.length) {
      happy = nonVf[0];
    } else {
      happy =
        splitFlows.find((w) => caseValueOf(w.flow) === "true") ?? splitFlows[0];
    }

    for (const w of splitFlows) {
      const shouldBeBranch = w !== happy;
      if (w.isBranch !== shouldBeBranch) {
        w.isBranch = shouldBeBranch;
        if (shouldBeBranch) {
          setBranchConnectionIndices(w.flow);
        } else {
          setMainConnectionIndices(w.flow);
        }
      }
    }
  }
}

/**
 * Insert an `ExclusiveMerge` node before every non-EndEvent destination that
 * has two or more incoming SequenceFlows. Mendix Studio Pro requires an
 * explicit `ExclusiveMerge` wherever exclusive branches converge on a single
 * non-terminal target — otherwise the model is invalid even though the SDK
 * does not reject it at write time.
 *
 * Behavior:
 *   1. Walk the wired flows and group them by destination.
 *   2. For every non-EndEvent / non-ExclusiveMerge destination with ≥ 2
 *      incoming flows, create a fresh `ExclusiveMerge` in the same
 *      `MicroflowObjectCollection`.
 *   3. Reroute every converging `SequenceFlow.destination` to the merge.
 *      `EnumerationCase` / `condition` values on each flow are untouched, so
 *      split labelling ("true" / "false") is preserved.
 *   4. Create a single new main `SequenceFlow` from `merge → originalTarget`
 *      and push the corresponding `WiredFlow` entry so downstream
 *      auto-layout sees it.
 *   5. Adjust connection indices: branch flows that previously drew
 *      BOTTOM→TOP into the original target now draw BOTTOM→BOTTOM into the
 *      merge (branches default to the row below the main row, so they
 *      approach the merge from underneath). Main flows still use RIGHT→LEFT.
 *
 * Must run AFTER `reclassifySplitFlows` (which inspects original destinations
 * to detect ValidationFeedback siblings) and BEFORE `autoLayout` (which uses
 * the final adjacency).
 *
 * EndEvents are intentionally excluded: `wireFlow` already creates a fresh
 * EndEvent per "to: end" flow, so they always have exactly one incoming.
 */
/**
 * True when `origin` sits on a branch row (i.e. below the main row). We walk
 * back through the predecessor chain via `wired`. The origin is on a branch
 * row if any predecessor flow on the unique path back has `isBranch === true`
 * AND we did not cross an `ExclusiveMerge` first (a merge brings the flow
 * back onto the main row).
 *
 * `wired[]` is mutated as merges are inserted, so this must be called with the
 * CURRENT array state — callers in the merge-insertion loop are correct.
 */
function originIsOnBranchRow(
  origin: MfObject,
  wired: WiredFlow[]
): boolean {
  // Build incoming map. After previous merge insertions in the same loop,
  // ExclusiveMerges may have ≥ 2 incoming flows; for the walk-back we only
  // need one entry per destination (we stop the walk at any merge anyway).
  const incomingMap = new Map<MfObject, WiredFlow>();
  for (const w of wired) {
    if (!incomingMap.has(w.destination)) {
      incomingMap.set(w.destination, w);
    }
  }
  let cur: MfObject | undefined = origin;
  const seen = new Set<MfObject>();
  while (cur) {
    if (seen.has(cur)) return false; // cycle guard (shouldn't happen outside loops)
    seen.add(cur);
    if (cur instanceof microflows.ExclusiveMerge) return false;
    const incoming = incomingMap.get(cur);
    if (!incoming) return false; // reached start / orphan
    if (incoming.isBranch) return true;
    cur = incoming.origin;
  }
  return false;
}

export function insertMergeNodesAtConvergence(
  oc: microflows.MicroflowObjectCollection,
  mf: microflows.MicroflowBase,
  wired: WiredFlow[]
): void {
  const incomingByDest = new Map<MfObject, WiredFlow[]>();
  for (const w of wired) {
    if (w.destination instanceof microflows.EndEvent) continue;
    if (w.destination instanceof microflows.ExclusiveMerge) continue;
    if (!incomingByDest.has(w.destination)) {
      incomingByDest.set(w.destination, []);
    }
    incomingByDest.get(w.destination)!.push(w);
  }

  for (const [origDest, incoming] of incomingByDest) {
    if (incoming.length < 2) continue;

    const merge = microflows.ExclusiveMerge.createIn(oc);

    for (const w of incoming) {
      w.flow.destination = merge;
      w.destination = merge;
      // Three distinct topologies feed a merge:
      //   1. The split itself goes directly to the merge target on its branch
      //      flow (no intermediate activity on the branch row). The split
      //      sits on the main row; the flow has to "dip down under the row
      //      and back up" to land on the merge — BOTTOM → BOTTOM.
      //   2. An activity that sits on a branch row (its predecessor chain
      //      passed through a branch flow without crossing a merge first)
      //      reconverges on the main row. The flow goes right out of the
      //      branch-row activity and lands on the merge's BOTTOM — RIGHT →
      //      BOTTOM.
      //   3. A main-row activity flows into the merge on the same row —
      //      RIGHT → LEFT.
      //
      // Without case 2, branch-row activities ended up with main-row connection
      // indices (RIGHT → LEFT) and Studio Pro rendered the arrow as a long
      // diagonal across rows. See defect_reports/Open/builder-output-fails-mx-check.md
      // (Class 7's sibling — connection-point regression in SUB_GenerateRequestCode).
      const directSplitBranch =
        w.isBranch &&
        (w.origin instanceof microflows.ExclusiveSplit ||
          w.origin instanceof microflows.InheritanceSplit);
      if (directSplitBranch) {
        w.flow.originConnectionIndex = SIDE_BOTTOM;
        w.flow.destinationConnectionIndex = SIDE_BOTTOM;
      } else if (originIsOnBranchRow(w.origin, wired)) {
        w.flow.originConnectionIndex = SIDE_RIGHT;
        w.flow.destinationConnectionIndex = SIDE_BOTTOM;
      } else {
        w.flow.originConnectionIndex = SIDE_RIGHT;
        w.flow.destinationConnectionIndex = SIDE_LEFT;
      }
    }

    const newSf = microflows.SequenceFlow.createIn(mf);
    newSf.origin = merge;
    newSf.destination = origDest;
    setMainConnectionIndices(newSf);

    wired.push({
      flow: newSf,
      origin: merge,
      destination: origDest,
      isBranch: false,
      explicitBranch: false,
    });
  }
}

// ─── Auto-layout ─────────────────────────────────────────────────────────────

const X_STEP = 220;
const Y_STEP = 160;

function setShapeSize(obj: MfObject): void {
  if (
    obj instanceof microflows.StartEvent ||
    obj instanceof microflows.EndEvent ||
    obj instanceof microflows.ContinueEvent ||
    obj instanceof microflows.BreakEvent
  ) {
    obj.size = { width: 20, height: 20 };
  } else if (
    obj instanceof microflows.ExclusiveSplit ||
    obj instanceof microflows.ExclusiveMerge
  ) {
    obj.size = { width: 80, height: 80 };
  } else if (obj instanceof microflows.LoopedActivity) {
    obj.size = { width: 228, height: 200 };
  } else if (obj instanceof microflows.MicroflowParameterObject) {
    obj.size = { width: 30, height: 30 };
  } else {
    // ActionActivity and friends
    obj.size = { width: 140, height: 50 };
  }
}

/**
 * Build adjacency lookup from wired flows: origin object → list of {destination, isBranch}.
 * Order is preserved (same order as wiring).
 */
interface AdjEntry {
  dest: MfObject;
  wired: WiredFlow;
  get isBranch(): boolean;
}

function buildAdjacency(wired: WiredFlow[]): Map<MfObject, AdjEntry[]> {
  const m = new Map<MfObject, AdjEntry[]>();
  for (const w of wired) {
    if (!m.has(w.origin)) m.set(w.origin, []);
    m.get(w.origin)!.push({
      dest: w.destination,
      wired: w,
      get isBranch() {
        return w.isBranch;
      },
    });
  }
  return m;
}

function isValidationFeedbackTarget(obj: MfObject): boolean {
  return (
    obj instanceof microflows.ActionActivity &&
    obj.action instanceof microflows.ValidationFeedbackAction
  );
}

/**
 * Walk forward along the main flow (isBranch === false) starting from `start`
 * and place each visited object at sequential x-positions on the given y row.
 * Returns the list of ExclusiveSplits encountered on the main path (with their
 * x positions), so that callers can lay out each split's FALSE branch.
 *
 * `incomingIsVertical` is true when `start` was reached via a vertical branch.
 * In that case, if `start` is a ValidationFeedback whose next node is an
 * EndEvent, the EndEvent is placed BELOW (y + Y_STEP) and its incoming flow is
 * promoted to a branch so it draws BOTTOM→TOP (point 2 of the layout spec).
 */
function placeMainPath(
  start: MfObject,
  startX: number,
  rowY: number,
  adjacency: Map<MfObject, AdjEntry[]>,
  placed: Set<MfObject>,
  incomingIsVertical: boolean
): { rightmostX: number; splits: Array<{ split: microflows.ExclusiveSplit; x: number }> } {
  const splits: Array<{ split: microflows.ExclusiveSplit; x: number }> = [];
  let x = startX;
  let y = rowY;
  let cur: MfObject | null = start;
  let isVerticalEntry = incomingIsVertical;

  while (cur && !placed.has(cur)) {
    cur.relativeMiddlePoint = { x, y };
    setShapeSize(cur);
    placed.add(cur);

    if (cur instanceof microflows.ExclusiveSplit) {
      splits.push({ split: cur, x });
    }

    const outs: AdjEntry[] = adjacency.get(cur) ?? [];
    const mainOut: AdjEntry | undefined = outs.find((o: AdjEntry) => !o.isBranch);
    if (!mainOut) break;

    if (
      isVerticalEntry &&
      isValidationFeedbackTarget(cur) &&
      mainOut.dest instanceof microflows.EndEvent
    ) {
      mainOut.wired.isBranch = true;
      setBranchConnectionIndices(mainOut.wired.flow);
      y += Y_STEP;
      cur = mainOut.dest;
      continue;
    }

    x += X_STEP;
    cur = mainOut.dest;
    isVerticalEntry = false;
  }

  return { rightmostX: x, splits };
}

/**
 * Recursive layout: walk the main path from `start`, then for every
 * ExclusiveSplit encountered, recursively lay out its FALSE branch at one row
 * lower (y + Y_STEP). Each call places nodes at sequential x positions.
 */
function layoutSubtree(
  start: MfObject,
  startX: number,
  rowY: number,
  adjacency: Map<MfObject, AdjEntry[]>,
  placed: Set<MfObject>,
  incomingIsVertical: boolean
): void {
  const result = placeMainPath(
    start,
    startX,
    rowY,
    adjacency,
    placed,
    incomingIsVertical
  );
  for (const { split, x: splitX } of result.splits) {
    const branchOut: AdjEntry | undefined = (adjacency.get(split) ?? []).find(
      (o: AdjEntry) => o.isBranch
    );
    if (!branchOut) continue;
    layoutSubtree(branchOut.dest, splitX, rowY + Y_STEP, adjacency, placed, true);
  }
}

/**
 * Outer-microflow auto-layout: places StartEvent at (0, 0), walks main flow
 * horizontally to the right, then for each ExclusiveSplit on the main path
 * walks its FALSE branch downward (y = Y_STEP) starting at the split's x.
 * Parameters (if any) are stacked vertically above the start.
 */
export function autoLayout(
  oc: microflows.MicroflowObjectCollection,
  startEvt: microflows.StartEvent,
  wired: WiredFlow[]
): void {
  const adjacency = buildAdjacency(wired);
  const placed = new Set<MfObject>();

  // Place StartEvent at (0, 0) and walk main flow to the right
  startEvt.relativeMiddlePoint = { x: 0, y: 0 };
  setShapeSize(startEvt);
  placed.add(startEvt);

  // Find the first hop from the StartEvent and lay out the entire reachable
  // subtree (main path + recursive FALSE branches one row deeper each level).
  const firstOut: AdjEntry | undefined = (adjacency.get(startEvt) ?? []).find(
    (o: AdjEntry) => !o.isBranch
  );
  if (firstOut) {
    layoutSubtree(firstOut.dest, X_STEP, 0, adjacency, placed, false);
  }

  // Place any remaining objects (parameters, leftover activities) above and to the left.
  let paramY = -170;
  for (const obj of oc.objects) {
    if (placed.has(obj)) continue;
    if (obj instanceof microflows.MicroflowParameterObject) {
      obj.relativeMiddlePoint = { x: -2, y: paramY };
      setShapeSize(obj);
      placed.add(obj);
      paramY += 84;
    }
  }

  // Place anything still unplaced at a fallback row to keep Studio Pro happy.
  let fallbackX = 0;
  for (const obj of oc.objects) {
    if (placed.has(obj)) continue;
    obj.relativeMiddlePoint = { x: fallbackX, y: 2 * Y_STEP };
    setShapeSize(obj);
    placed.add(obj);
    fallbackX += X_STEP;
  }
}

/**
 * Inner-loop auto-layout: no StartEvent. The first object in `oc.objects`
 * (typically the breakSplit if present, else the first user activity) is the
 * implicit entry point. Inner objects are placed at y ≈ 100 (vertically
 * centered inside a 200-tall LoopedActivity). Branches go down to y ≈ 100 + Y_STEP.
 */
function autoLayoutInnerLoop(
  oc: microflows.MicroflowObjectCollection,
  wired: WiredFlow[]
): void {
  const adjacency = buildAdjacency(wired);
  const placed = new Set<MfObject>();

  const innerMainY = 100;
  const innerStartX = 85;

  const objects = Array.from(oc.objects);
  if (objects.length === 0) return;

  // Implicit entry: first object in objects[]. Lay out main path + nested branches.
  const entry = objects[0];
  layoutSubtree(entry, innerStartX, innerMainY, adjacency, placed, false);

  // Fallback: place any unplaced inner objects on a row below the main row
  // so Studio Pro can still render them rather than rejecting size=(0,0).
  let fallbackX = innerStartX;
  for (const obj of objects) {
    if (placed.has(obj)) continue;
    obj.relativeMiddlePoint = { x: fallbackX, y: innerMainY + 2 * Y_STEP };
    setShapeSize(obj);
    placed.add(obj);
    fallbackX += X_STEP;
  }
}

// ─── Range helper ─────────────────────────────────────────────────────────────

function applyRange(
  src: microflows.DatabaseRetrieveSource,
  range?: RangeSpec
): void {
  const t = range?.type ?? "All";
  if (t === "First") {
    const r = microflows.ConstantRange.createInDatabaseRetrieveSourceUnderRange(src);
    r.singleObject = true;
  } else if (t === "ConstantRange") {
    const r = microflows.CustomRange.createInDatabaseRetrieveSourceUnderRange(src);
    r.limitExpression = String(range?.limit ?? 100);
    r.offsetExpression = String(range?.offset ?? 0);
  } else if (t === "CustomRange") {
    const r = microflows.CustomRange.createInDatabaseRetrieveSourceUnderRange(src);
    r.limitExpression = range?.limitExpression ?? "100";
    r.offsetExpression = range?.offsetExpression ?? "0";
  } else {
    // "All" → ConstantRange with singleObject=false
    const r = microflows.ConstantRange.createInDatabaseRetrieveSourceUnderRange(src);
    r.singleObject = false;
  }
}

// ─── Enum helpers ─────────────────────────────────────────────────────────────

function commitEnumOf(v?: string): microflows.CommitEnum {
  switch (v) {
    case "Yes": return microflows.CommitEnum.Yes;
    case "YesWithoutEvents": return microflows.CommitEnum.YesWithoutEvents;
    default: return microflows.CommitEnum.No;
  }
}

function logLevelOf(v: string): microflows.LogLevel {
  const map: Record<string, microflows.LogLevel> = {
    Trace: microflows.LogLevel.Trace,
    Debug: microflows.LogLevel.Debug,
    Info: microflows.LogLevel.Info,
    Warning: microflows.LogLevel.Warning,
    Error: microflows.LogLevel.Error,
    Critical: microflows.LogLevel.Critical,
  };
  return map[v] ?? microflows.LogLevel.Info;
}

function aggregateFunctionOf(v: string): microflows.AggregateFunctionEnum {
  const map: Record<string, microflows.AggregateFunctionEnum> = {
    Sum: microflows.AggregateFunctionEnum.Sum,
    Average: microflows.AggregateFunctionEnum.Average,
    Count: microflows.AggregateFunctionEnum.Count,
    Minimum: microflows.AggregateFunctionEnum.Minimum,
    Maximum: microflows.AggregateFunctionEnum.Maximum,
  };
  return map[v] ?? microflows.AggregateFunctionEnum.Count;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function createMicroflow(
  model: IModel,
  args: CreateMicroflowArgs,
  autoTranslateEnumLiterals = false
): Promise<{
  moduleName: string;
  microflowName: string;
  activitiesCreated: number;
  parametersCreated: number;
  alreadyExisted: boolean;
  overwritten: boolean;
  warnings: string[];
}> {
  const ctx: MicroflowBuildContext = {
    autoTranslateEnumLiterals: autoTranslateEnumLiterals ?? false,
    warnings: [],
  };
  const warnings = ctx.warnings;

  // ── Step 1: find module
  const module = model.root.modules.find((m) => m.name === args.moduleName);
  if (!module)
    throw new Error(
      `Module "${args.moduleName}" not found. Available: ${model.root.modules.map((m) => m.name).join(", ")}`
    );

  // ── Step 2: naming convention warning
  if (!NAMING_PREFIXES.some((p) => args.microflowName.startsWith(p))) {
    warnings.push(
      `microflowName '${args.microflowName}' does not follow naming convention (expected ACT_/VAL_/SUB_/SCH_/IVK_/OCH_ prefix)`
    );
  }

  // ── Step 3: pre-flight graph validation
  validateGraph(args.activities, args.flows, false);

  // ── Step 3a: pre-flight unique-variable-name validation
  // Mendix microflow variable names share a single flat namespace per microflow
  // (parameters + activity outputs + LoopedActivity iterators + inner-activity
  // outputs). Studio Pro rejects duplicates with CE0111. See
  // defect_reports/Open/builder-output-fails-mx-check.md "Class 4".
  validateUniqueVariableNames(
    args.parameters,
    args.activities,
    `Microflow '${args.moduleName}.${args.microflowName}'`
  );

  // ── Step 3b: pre-flight reference-correctness validation
  // Builds a variable-type table (kind=Object|List|Primitive + entity QN +
  // declaring activity) from parameters + activity outputs and verifies every
  // consumer slot. Blocks CE0037 (empty Variable property), CE0109 (undefined
  // variable reference), and CE7247 (Object slot fed a List or vice-versa) at
  // write-time. Recurses into LoopedActivity bodies with inner-scope tables.
  // See src/microflowReferenceValidator.ts.
  validateMicroflowReferences(args.parameters ?? [], args.activities ?? []);

  // ── Step 4: validate returnVariableName
  // For non-Void microflows, returnVariableName is REQUIRED. Without it, every
  // EndEvent silently keeps its default empty `returnValue` and Studio Pro flags
  // the microflow as "End event return value missing". For Void microflows,
  // returnVariableName is ignored.
  const returnType = args.returnType ?? { type: "Void" as const };
  if (returnType.type !== "Void") {
    if (!args.returnVariableName) {
      throw new Error(
        `Microflow has return type "${returnType.type}" but no returnVariableName was provided. ` +
          `Every EndEvent of a non-Void microflow must have a returnValue expression — set returnVariableName ` +
          `to the parameter or activity-output variable that holds the value to return.`
      );
    }
    const paramNames = new Set((args.parameters ?? []).map((p) => p.name));
    const outputNames = new Set<string>();
    for (const a of args.activities) {
      if ("outputVariableName" in a && a.outputVariableName)
        outputNames.add(a.outputVariableName);
      if ("variableName" in a && a.variableName) outputNames.add(a.variableName);
    }
    if (!paramNames.has(args.returnVariableName) && !outputNames.has(args.returnVariableName)) {
      throw new Error(
        `returnVariableName '${args.returnVariableName}' is not defined in any parameter or activity output.`
      );
    }
  }

  // ── Step 5: check if microflow exists
  const qname = `${args.moduleName}.${args.microflowName}`;
  const existing = model.findMicroflowByQualifiedName(qname);

  if (existing) {
    if (!args.overwrite) {
      return {
        moduleName: args.moduleName,
        microflowName: args.microflowName,
        activitiesCreated: 0,
        parametersCreated: 0,
        alreadyExisted: true,
        overwritten: false,
        warnings,
      };
    }
    // overwrite: delete existing
    const loaded = await existing.load();
    loaded.delete();
  }

  // ── Step 6: create Microflow
  const mf = microflows.Microflow.createIn(module as projects.IFolderBase);
  mf.name = args.microflowName;
  if (args.documentation) mf.documentation = args.documentation;
  mf.allowConcurrentExecution = args.allowConcurrentExecution ?? true;
  mf.applyEntityAccess = args.applyEntityAccess ?? true;

  // ── Step 7: object collection
  const oc = microflows.MicroflowObjectCollection.createInMicroflowBaseUnderObjectCollection(mf);

  // ── Step 8: set return type
  applyDataType(returnType, { kind: "returnType", mf }, model);
  if (returnType.type !== "Void" && args.returnVariableName) {
    mf.returnVariableName = args.returnVariableName;
  }

  // ── Step 9: create parameters
  const params = args.parameters ?? [];
  for (const pSpec of params) {
    const param = microflows.MicroflowParameterObject.createIn(oc);
    param.name = pSpec.name;
    applyDataType(pSpec.type, { kind: "paramObj", param }, model);
  }

  // ── Step 10: create start event only — EndEvents are created per "end"-targeting flow
  // (one EndEvent per diverging branch; sharing a single EndEvent across multiple
  // branches is a Studio Pro lint).
  const startEvt = microflows.StartEvent.createIn(oc);

  // ── Step 11: create activities
  const objectMap = new Map<string, MfObject>();
  objectMap.set("start", startEvt);
  // "end" intentionally NOT pre-mapped — wireFlow creates a fresh EndEvent each time.

  for (const actSpec of args.activities) {
    const obj = await createActivity(model, mf, oc, actSpec, ctx);
    objectMap.set(actSpec.id, obj);
  }

  // ── Step 12: wire flows (each "to: end" creates its own EndEvent with returnValue)
  const endEvents: microflows.EndEvent[] = [];
  const endConfig: EndEventConfig = {
    returnType,
    returnVariableName: args.returnVariableName,
  };
  const wiredFlows: WiredFlow[] = [];
  for (const flowSpec of args.flows) {
    wiredFlows.push(
      wireFlow(mf, oc, objectMap, flowSpec, args.activities, endConfig, endEvents)
    );
  }

  // Per-split reclassification — see reclassifySplitFlows. Fixes the case
  // where one outgoing flow goes to a ValidationFeedback (forced to branch by
  // wireFlow) but the sibling carries `condition: "false"` and was therefore
  // also (wrongly) classified as a branch by the per-flow default rule.
  reclassifySplitFlows(wiredFlows);

  // Insert ExclusiveMerge nodes wherever ≥ 2 SequenceFlows converge on the
  // same non-terminal target. Mendix Studio Pro requires an explicit merge
  // at every such convergence point.
  insertMergeNodesAtConvergence(oc, mf, wiredFlows);

  // ── Step 13: auto-layout (flow-aware: horizontal main, downward FALSE branches)
  autoLayout(oc, startEvt, wiredFlows);

  return {
    moduleName: args.moduleName,
    microflowName: args.microflowName,
    activitiesCreated: args.activities.length,
    parametersCreated: params.length,
    alreadyExisted: false,
    overwritten: existing != null,
    warnings,
  };
}

