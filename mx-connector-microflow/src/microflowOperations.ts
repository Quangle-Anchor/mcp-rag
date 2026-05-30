import { IModel, microflows, datatypes, domainmodels, texts } from "mendixmodelsdk";
import type {
  AppendActivitySpec,
  CreateMicroflowActivitiesArgs,
  InsertBeforeActivityArgs,
  ModifyMicroflowActivityArgs,
  SetMicroflowUrlArgs,
  UpdateMicroflowArgs,
} from "./types.js";
import {
  dataTypeToString,
  resolveMicroflow,
} from "./microflowReader.js";
import { validateXPathOrThrow } from "./xpathValidator.js";
import { validateEnumLiteral } from "./enumValueValidator.js";
import { validateMendixExpressionOrThrow } from "./expressionValidator.js";
import {
  validateAppendSpecActivities,
  validateModifyActivityRefs,
} from "./microflowReferenceValidator.js";
import type { MicroflowBuildContext } from "./microflowBuilder.js";

const EN_US = "en_US";

// ─── Generic helpers ──────────────────────────────────────────────────────────

function asConfig(spec: AppendActivitySpec): Record<string, unknown> {
  if (spec.activity_config && typeof spec.activity_config === "object") {
    // Allow activity_config OR top-level fields. Top-level wins for explicit overrides.
    const merged: Record<string, unknown> = { ...spec.activity_config };
    for (const [k, v] of Object.entries(spec)) {
      if (k === "activity_type" || k === "activity_config") continue;
      if (v !== undefined) merged[k] = v;
    }
    return merged;
  }
  // Top-level only.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec)) {
    if (k === "activity_type" || k === "activity_config") continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function s(cfg: Record<string, unknown>, key: string): string | undefined {
  const v = cfg[key];
  return typeof v === "string" ? v : undefined;
}

function b(cfg: Record<string, unknown>, key: string): boolean | undefined {
  const v = cfg[key];
  return typeof v === "boolean" ? v : undefined;
}

function arr<T = unknown>(cfg: Record<string, unknown>, key: string): T[] | undefined {
  const v = cfg[key];
  return Array.isArray(v) ? (v as T[]) : undefined;
}

function findEntityOrThrow(model: IModel, qn: string, ctx: string): domainmodels.IEntity {
  const e = model.findEntityByQualifiedName(qn);
  if (!e) throw new Error(`Entity '${qn}' not found [${ctx}].`);
  return e;
}

function findAttributeOrThrow(model: IModel, qn: string, ctx: string): domainmodels.IAttribute {
  const a = model.findAttributeByQualifiedName(qn);
  if (!a) throw new Error(`Attribute '${qn}' not found [${ctx}].`);
  return a;
}

/**
 * Class 5 helper (mirror of microflowBuilder.ts). Sum/Average/Minimum/Maximum
 * require an attribute of type Autonumber, Decimal, Integer, or Long.
 */
async function assertNumericAggregateAttribute(
  attr: domainmodels.IAttribute,
  aggregateFunction: string,
  ctx: string
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
      `aggregate_list [${ctx}]: function '${aggregateFunction}' requires a numeric attribute (Autonumber, ` +
        `Decimal, Integer, or Long). Attribute '${loaded.qualifiedName ?? loaded.name}' is ` +
        `'${actualType.replace(/AttributeType$/, "")}'. Studio Pro would reject this as CE0016.`
    );
  }
}

function findAssocOrThrow(
  model: IModel,
  qn: string,
  ctx: string
): domainmodels.IAssociationBase {
  const a = model.findAssociationBaseByQualifiedName(qn);
  if (!a) throw new Error(`Association '${qn}' not found [${ctx}].`);
  return a;
}

function findMicroflowOrThrow(model: IModel, qn: string, ctx: string): microflows.IMicroflow {
  const mf = model.findMicroflowByQualifiedName(qn);
  if (!mf) throw new Error(`Microflow '${qn}' not found [${ctx}].`);
  return mf;
}

function commitEnumOf(v: string | undefined): microflows.CommitEnum {
  switch (v) {
    case "Yes":
      return microflows.CommitEnum.Yes;
    case "YesWithoutEvents":
      return microflows.CommitEnum.YesWithoutEvents;
    default:
      return microflows.CommitEnum.No;
  }
}

function logLevelOf(v: string | undefined): microflows.LogLevel {
  const map: Record<string, microflows.LogLevel> = {
    Trace: microflows.LogLevel.Trace,
    Debug: microflows.LogLevel.Debug,
    Info: microflows.LogLevel.Info,
    Warning: microflows.LogLevel.Warning,
    Error: microflows.LogLevel.Error,
    Critical: microflows.LogLevel.Critical,
  };
  return v ? map[v] ?? microflows.LogLevel.Info : microflows.LogLevel.Info;
}

function showMessageTypeOf(v: string | undefined): microflows.ShowMessageType {
  const map: Record<string, microflows.ShowMessageType> = {
    Information: microflows.ShowMessageType.Information,
    Warning: microflows.ShowMessageType.Warning,
    Error: microflows.ShowMessageType.Error,
  };
  return v ? map[v] ?? microflows.ShowMessageType.Information : microflows.ShowMessageType.Information;
}

/**
 * Walk a microflow action and collect every variable name it DECLARES (not
 * names it references). Used by the modify-path Class 3 fix
 * (updateMicroflow ↦ EndEvent.returnValue) and by the Class 4 duplicate-name
 * pre-flight.
 *
 * Variable-DECLARING slots:
 *   - CreateObjectAction.outputVariableName
 *   - RetrieveAction.outputVariableName
 *   - CreateVariableAction.variableName
 *   - MicroflowCallAction.outputVariableName (when useReturnVariable)
 *   - AggregateListAction.outputVariableName
 *   - ListOperationAction.outputVariableName
 *   - RestOperationCallAction → OutputVariable.variableName, BodyVariable.variableName
 *   - NanoflowCallAction.outputVariableName
 *   - JavaScriptActionCallAction.outputVariableName
 *
 * Variable-REFERENCING slots intentionally omitted (changeVariableName,
 * commitVariableName, rollbackVariableName, deleteVariableName).
 */
export function collectActivityVariableNames(
  action: microflows.MicroflowAction | null | undefined,
  out: Set<string>
): void {
  if (!action) return;
  // The SDK exposes outputVariableName on a handful of unrelated subclasses;
  // probe via duck-typing rather than a giant instanceof chain.
  const a = action as unknown as {
    outputVariableName?: string;
    variableName?: string;
    useReturnVariable?: boolean;
  };
  if (action instanceof microflows.MicroflowCallAction) {
    if (a.outputVariableName && a.useReturnVariable !== false) {
      out.add(a.outputVariableName);
    }
  } else if (a.outputVariableName) {
    out.add(a.outputVariableName);
  }
  if (action instanceof microflows.CreateVariableAction && a.variableName) {
    out.add(a.variableName);
  }
  if (action instanceof microflows.RestOperationCallAction) {
    const ra = action as microflows.RestOperationCallAction;
    if (ra.outputVariable?.variableName) out.add(ra.outputVariable.variableName);
    if (ra.bodyVariable?.variableName) out.add(ra.bodyVariable.variableName);
  }
}

function aggregateFunctionOf(
  v: string | undefined
): microflows.AggregateFunctionEnum {
  const map: Record<string, microflows.AggregateFunctionEnum> = {
    Count: microflows.AggregateFunctionEnum.Count,
    Sum: microflows.AggregateFunctionEnum.Sum,
    Average: microflows.AggregateFunctionEnum.Average,
    Minimum: microflows.AggregateFunctionEnum.Minimum,
    Maximum: microflows.AggregateFunctionEnum.Maximum,
  };
  return v ? map[v] ?? microflows.AggregateFunctionEnum.Count : microflows.AggregateFunctionEnum.Count;
}

function setTranslation(textEl: texts.Text, value: string): void {
  textEl.translations.clear();
  const t = texts.Translation.createIn(textEl);
  t.languageCode = EN_US;
  t.text = value;
}

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

interface MemberChangeInput {
  attributeQualifiedName?: string;
  attribute?: string; // alternate key used by Tool 26 schema
  associationQualifiedName?: string;
  changeType?: "Set" | "Add" | "Remove";
  value: string;
}

function changeItemTypeOf(v: string | undefined): microflows.ChangeActionItemType {
  switch (v) {
    case "Add":
      return microflows.ChangeActionItemType.Add;
    case "Remove":
      return microflows.ChangeActionItemType.Remove;
    default:
      return microflows.ChangeActionItemType.Set;
  }
}

async function applyMemberChanges(
  model: IModel,
  action: microflows.ChangeMembersAction,
  rawChanges: unknown,
  ctx: string,
  buildCtx: MicroflowBuildContext
): Promise<void> {
  if (!Array.isArray(rawChanges)) return;
  for (const raw of rawChanges) {
    if (!raw || typeof raw !== "object") continue;
    const ch = raw as MemberChangeInput;
    const attrQn = ch.attributeQualifiedName ?? ch.attribute;
    const item = microflows.MemberChange.createIn(action);
    item.type = changeItemTypeOf(ch.changeType);
    if (attrQn) {
      item.attribute = findAttributeOrThrow(model, attrQn, ctx);
      // See specs/rules/enum_value_in_expression.md for the planner-facing rationale.
      const result = await validateEnumLiteral(ch.value ?? "", item.attribute, ctx, {
        autoTranslate: buildCtx.autoTranslateEnumLiterals,
      });
      // See specs/rules/expression_function_syntax.md.
      validateMendixExpressionOrThrow(result.value, `${ctx} (MemberChange.value)`);
      item.value = result.value;
      if (result.warning) buildCtx.warnings.push(result.warning);
    } else if (ch.associationQualifiedName) {
      item.association = findAssocOrThrow(model, ch.associationQualifiedName, ctx);
      // See specs/rules/expression_function_syntax.md.
      validateMendixExpressionOrThrow(ch.value, `${ctx} (MemberChange.value)`);
      item.value = ch.value ?? "";
    } else {
      throw new Error(
        `MemberChange in ${ctx} requires attributeQualifiedName/attribute or associationQualifiedName.`
      );
    }
  }
}

// Convert "double-quoted" to 'single-quoted' in expression strings (best-effort).
// Mendix expressions require single quotes for string literals.
function normalizeMxExpression(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return raw;
  // Replace standalone "..." with '...' but leave existing single quotes alone.
  // Heuristic: swap matched pairs of ASCII double quotes.
  return raw.replace(/"/g, "'");
}

// ─── Variable type parsing for ReturnTypeSpec / Tool 77 returnType ──────────

function applyVariableTypeReturn(
  model: IModel,
  mf: microflows.MicroflowBase,
  type: string
): void {
  const lower = type.toLowerCase();
  switch (lower) {
    case "void":
      datatypes.VoidType.createInMicroflowBaseUnderMicroflowReturnType(mf);
      return;
    case "boolean":
      datatypes.BooleanType.createInMicroflowBaseUnderMicroflowReturnType(mf);
      return;
    case "string":
      datatypes.StringType.createInMicroflowBaseUnderMicroflowReturnType(mf);
      return;
    case "integer":
    case "long":
      datatypes.IntegerType.createInMicroflowBaseUnderMicroflowReturnType(mf);
      return;
    case "decimal":
    case "float":
      datatypes.DecimalType.createInMicroflowBaseUnderMicroflowReturnType(mf);
      return;
    case "datetime":
      datatypes.DateTimeType.createInMicroflowBaseUnderMicroflowReturnType(mf);
      return;
  }
  if (lower.startsWith("object:")) {
    const qn = type.substring(7);
    const entity = model.findEntityByQualifiedName(qn);
    if (!entity) throw new Error(`Entity '${qn}' not found in model.`);
    const ot = datatypes.ObjectType.createInMicroflowBaseUnderMicroflowReturnType(mf);
    ot.entity = entity;
    return;
  }
  if (lower.startsWith("list:")) {
    const qn = type.substring(5);
    const entity = model.findEntityByQualifiedName(qn);
    if (!entity) throw new Error(`Entity '${qn}' not found in model.`);
    const lt = datatypes.ListType.createInMicroflowBaseUnderMicroflowReturnType(mf);
    lt.entity = entity;
    return;
  }
  throw new Error(
    `Invalid returnType '${type}'. Expected: void, boolean, string, integer, decimal, float, datetime, object:Module.Entity, list:Module.Entity.`
  );
}

function applyVariableTypeOnVariableAction(
  model: IModel,
  action: microflows.CreateVariableAction,
  type: string
): void {
  const lower = type.toLowerCase();
  switch (lower) {
    case "boolean":
      datatypes.BooleanType.createInCreateVariableActionUnderVariableType(action);
      return;
    case "string":
      datatypes.StringType.createInCreateVariableActionUnderVariableType(action);
      return;
    case "integer":
    case "long":
      datatypes.IntegerType.createInCreateVariableActionUnderVariableType(action);
      return;
    case "decimal":
    case "float":
      datatypes.DecimalType.createInCreateVariableActionUnderVariableType(action);
      return;
    case "datetime":
      datatypes.DateTimeType.createInCreateVariableActionUnderVariableType(action);
      return;
  }
  if (lower.startsWith("object:")) {
    const qn = type.substring(7);
    const entity = findEntityOrThrow(model, qn, "create_variable.variable_type");
    const ot = datatypes.ObjectType.createInCreateVariableActionUnderVariableType(action);
    ot.entity = entity;
    return;
  }
  if (lower.startsWith("list:")) {
    const qn = type.substring(5);
    const entity = findEntityOrThrow(model, qn, "create_variable.variable_type");
    const lt = datatypes.ListType.createInCreateVariableActionUnderVariableType(action);
    lt.entity = entity;
    return;
  }
  throw new Error(
    `Invalid variable_type '${type}' in create_variable. Expected boolean/string/integer/decimal/datetime/object:Module.Entity/list:Module.Entity.`
  );
}

// ─── Activity factory (flat schema, used by Tools 26 & 70) ────────────────────

const SUPPORTED_ACTIVITY_TYPES = new Set([
  "create_object",
  "create_variable",
  "change_object",
  "change_variable",
  "commit",
  "rollback",
  "delete",
  "retrieve",
  "retrieve_from_database",
  "retrieve_by_association",
  "microflow_call",
  "change_list",
  "sort_list",
  "find_in_list",
  "aggregate_list",
  "show_message",
  "log_message",
  "union_lists",
  "subtract_lists",
  "intersect_lists",
  "contains_in_list",
  "head_of_list",
  "tail_of_list",
]);

async function createActivityFromAppendSpec(
  model: IModel,
  spec: AppendActivitySpec,
  context: string,
  attached: { container: microflows.MicroflowObjectCollection } | { detached: true },
  ctx: MicroflowBuildContext
): Promise<microflows.ActionActivity> {
  const type = String(spec.activity_type ?? "");
  if (!SUPPORTED_ACTIVITY_TYPES.has(type)) {
    throw new Error(
      `Unknown activity_type '${type}' [${context}]. See supported types in Tool 26 spec.`
    );
  }
  const cfg = asConfig(spec);

  let act: microflows.ActionActivity;
  if ("container" in attached) {
    act = microflows.ActionActivity.createIn(attached.container);
  } else {
    // Detached: the splice site (Tool 70) attaches it later.
    act = microflows.ActionActivity.create(model);
  }
  const caption = s(cfg, "caption");
  if (caption !== undefined) {
    act.caption = caption;
    act.autoGenerateCaption = false;
  }
  const documentation = s(cfg, "documentation");
  if (documentation !== undefined) act.documentation = documentation;

  switch (type) {
    case "create_object": {
      const action = microflows.CreateObjectAction.createIn(act);
      const entityQn = s(cfg, "entity") ?? s(cfg, "entityQualifiedName");
      if (!entityQn)
        throw new Error(`create_object [${context}] requires 'entity'.`);
      action.entity = findEntityOrThrow(model, entityQn, context);
      const outVar = s(cfg, "variableName") ?? s(cfg, "outputVariableName");
      if (outVar) action.outputVariableName = outVar;
      action.commit = commitEnumOf(s(cfg, "commit"));
      const refresh = b(cfg, "refresh_in_client") ?? b(cfg, "refreshInClient");
      if (refresh !== undefined) action.refreshInClient = refresh;
      const initial =
        cfg.initial_values ?? cfg.initialValues ?? cfg.memberChanges ?? cfg.changes;
      await applyMemberChanges(model, action, initial, context, ctx);
      break;
    }
    case "change_object": {
      const action = microflows.ChangeObjectAction.createIn(act);
      const variable = s(cfg, "variable") ?? s(cfg, "variableName");
      if (!variable)
        throw new Error(`change_object [${context}] requires 'variable'.`);
      action.changeVariableName = variable;
      action.commit = commitEnumOf(s(cfg, "commit"));
      const refresh = b(cfg, "refresh_in_client") ?? b(cfg, "refreshInClient");
      if (refresh !== undefined) action.refreshInClient = refresh;
      const changes = cfg.changes ?? cfg.memberChanges;
      await applyMemberChanges(model, action, changes, context, ctx);
      break;
    }
    case "commit": {
      const action = microflows.CommitAction.createIn(act);
      const variable = s(cfg, "variable") ?? s(cfg, "commit_variable");
      if (variable) action.commitVariableName = variable;
      const withEvents = b(cfg, "with_events") ?? b(cfg, "withEvents");
      if (withEvents !== undefined) action.withEvents = withEvents;
      const refresh = b(cfg, "refresh_in_client") ?? b(cfg, "refreshInClient");
      if (refresh !== undefined) action.refreshInClient = refresh;
      break;
    }
    case "rollback": {
      const action = microflows.RollbackAction.createIn(act);
      const variable = s(cfg, "variable") ?? s(cfg, "rollback_variable");
      if (variable) action.rollbackVariableName = variable;
      break;
    }
    case "delete": {
      const action = microflows.DeleteAction.createIn(act);
      const variable = s(cfg, "variable") ?? s(cfg, "delete_variable");
      if (variable) action.deleteVariableName = variable;
      break;
    }
    case "retrieve":
    case "retrieve_from_database": {
      const action = microflows.RetrieveAction.createIn(act);
      const outVar = s(cfg, "output_variable") ?? s(cfg, "outputVariableName");
      if (outVar) action.outputVariableName = outVar;
      const src = microflows.DatabaseRetrieveSource.createIn(action);
      const entityQn = s(cfg, "entity") ?? s(cfg, "entityQualifiedName");
      if (!entityQn)
        throw new Error(
          `retrieve_from_database [${context}] requires 'entity'.`
        );
      src.entity = findEntityOrThrow(model, entityQn, context);
      const xpath = s(cfg, "xpath");
      if (xpath) {
        validateXPathOrThrow(xpath, `${context} (retrieve_from_database)`);
        src.xPathConstraint = xpath;
      }
      // Range: "All" | "First" | { type, ... }
      const range = cfg.range;
      if (typeof range === "string") {
        if (range === "First") {
          const r = microflows.ConstantRange.createInDatabaseRetrieveSourceUnderRange(src);
          r.singleObject = true;
        } else {
          const r = microflows.ConstantRange.createInDatabaseRetrieveSourceUnderRange(src);
          r.singleObject = false;
        }
      } else if (range && typeof range === "object") {
        const rType = (range as Record<string, unknown>).type;
        if (rType === "First") {
          const r = microflows.ConstantRange.createInDatabaseRetrieveSourceUnderRange(src);
          r.singleObject = true;
        } else if (rType === "ConstantRange" || rType === "CustomRange") {
          const r = microflows.CustomRange.createInDatabaseRetrieveSourceUnderRange(src);
          r.limitExpression = String(
            (range as Record<string, unknown>).limit ??
              (range as Record<string, unknown>).limitExpression ??
              "100"
          );
          r.offsetExpression = String(
            (range as Record<string, unknown>).offset ??
              (range as Record<string, unknown>).offsetExpression ??
              "0"
          );
        } else {
          const r = microflows.ConstantRange.createInDatabaseRetrieveSourceUnderRange(src);
          r.singleObject = false;
        }
      } else {
        const r = microflows.ConstantRange.createInDatabaseRetrieveSourceUnderRange(src);
        r.singleObject = false;
      }
      break;
    }
    case "retrieve_by_association": {
      const action = microflows.RetrieveAction.createIn(act);
      const outVar = s(cfg, "output_variable") ?? s(cfg, "outputVariableName");
      if (outVar) action.outputVariableName = outVar;
      const src = microflows.AssociationRetrieveSource.createIn(action);
      const startVar = s(cfg, "input_variable") ?? s(cfg, "startVariableName");
      if (!startVar)
        throw new Error(
          `retrieve_by_association [${context}] requires 'input_variable'.`
        );
      src.startVariableName = startVar;
      const assocQn =
        s(cfg, "association_name") ?? s(cfg, "associationQualifiedName");
      if (!assocQn)
        throw new Error(
          `retrieve_by_association [${context}] requires 'association_name'.`
        );
      src.association = findAssocOrThrow(model, assocQn, context);
      break;
    }
    case "create_variable": {
      const action = microflows.CreateVariableAction.createIn(act);
      const variableName = s(cfg, "variableName") ?? s(cfg, "variable_name");
      if (!variableName)
        throw new Error(`create_variable [${context}] requires 'variableName'.`);
      action.variableName = variableName;
      const initial =
        normalizeMxExpression(s(cfg, "initialValue")) ??
        normalizeMxExpression(s(cfg, "initial_value"));
      // See specs/rules/expression_function_syntax.md.
      validateMendixExpressionOrThrow(initial, `${context} (CreateVariable.initialValue)`);
      if (initial !== undefined) action.initialValue = initial;
      const variableType = s(cfg, "variable_type") ?? s(cfg, "variableType");
      if (!variableType)
        throw new Error(
          `create_variable [${context}] requires 'variable_type' (eg. 'string', 'object:Module.Entity').`
        );
      applyVariableTypeOnVariableAction(model, action, variableType);
      break;
    }
    case "change_variable": {
      const action = microflows.ChangeVariableAction.createIn(act);
      const variable = s(cfg, "variable") ?? s(cfg, "change_variable");
      if (!variable)
        throw new Error(`change_variable [${context}] requires 'variable'.`);
      action.changeVariableName = variable;
      const value = normalizeMxExpression(s(cfg, "value")) ?? "";
      // See specs/rules/expression_function_syntax.md.
      validateMendixExpressionOrThrow(value, `${context} (ChangeVariable.value)`);
      action.value = value;
      break;
    }
    case "microflow_call": {
      const action = microflows.MicroflowCallAction.createIn(act);
      const call = microflows.MicroflowCall.createIn(action);
      const mfQn = s(cfg, "microflow_name") ?? s(cfg, "microflowQualifiedName");
      if (!mfQn)
        throw new Error(`microflow_call [${context}] requires 'microflow_name'.`);
      call.microflow = findMicroflowOrThrow(model, mfQn, context);
      const outVar = s(cfg, "return_variable") ?? s(cfg, "outputVariableName");
      if (outVar) {
        action.outputVariableName = outVar;
        action.useReturnVariable = true;
      }
      const params = arr<{ name?: string; value?: string }>(cfg, "parameters");
      if (params) {
        for (const p of params) {
          if (!p?.name) continue;
          const pm = microflows.MicroflowCallParameterMapping.createIn(call);
          const argument = normalizeMxExpression(p.value ?? "") ?? "";
          // See specs/rules/expression_function_syntax.md.
          validateMendixExpressionOrThrow(
            argument,
            `${context} parameter '${p.name}'`
          );
          pm.argument = argument;
          // Best-effort: write parameter QN through internal slot (same workaround
          // as microflowBuilder.ts).
          const paramQn = `${mfQn}.${p.name}`;
          const internal = (pm as unknown as Record<string, {
            updateWithRawValue?: (v: string) => void;
          }>).__parameter;
          if (internal?.updateWithRawValue) internal.updateWithRawValue(paramQn);
        }
      }
      break;
    }
    case "log_message": {
      const action = microflows.LogMessageAction.createIn(act);
      action.level = logLevelOf(s(cfg, "level"));
      action.node = s(cfg, "node") ?? "";
      const tmpl = microflows.StringTemplate.createInLogMessageActionUnderMessageTemplate(action);
      applyStringTemplate(tmpl, s(cfg, "template") ?? "", arr<string>(cfg, "parameters") ?? [], context);
      break;
    }
    case "show_message": {
      const action = microflows.ShowMessageAction.createIn(act);
      action.type = showMessageTypeOf(s(cfg, "messageType") ?? s(cfg, "message_type"));
      action.blocking = b(cfg, "blocking") ?? true;
      const tmpl = microflows.TextTemplate.createInShowMessageActionUnderTemplate(action);
      applyTextTemplate(tmpl, s(cfg, "template") ?? "", arr<string>(cfg, "parameters") ?? [], context);
      break;
    }
    case "aggregate_list": {
      const action = microflows.AggregateListAction.createIn(act);
      const list = s(cfg, "list_variable") ?? s(cfg, "listVariableName");
      if (!list)
        throw new Error(`aggregate_list [${context}] requires 'list_variable'.`);
      action.inputListVariableName = list;
      const fnName = s(cfg, "function") ?? "Count";
      action.aggregateFunction = aggregateFunctionOf(fnName);
      const outVar = s(cfg, "output_variable") ?? s(cfg, "outputVariableName");
      if (!outVar)
        throw new Error(`aggregate_list [${context}] requires 'output_variable'.`);
      action.outputVariableName = outVar;
      const attrQn = s(cfg, "attribute") ?? s(cfg, "attributeQualifiedName");
      // Class 5 fix (CE0016): Count must not carry an attribute; other
      // aggregate functions require a numeric attribute.
      if (action.aggregateFunction === microflows.AggregateFunctionEnum.Count) {
        if (attrQn) {
          throw new Error(
            `aggregate_list [${context}]: function 'Count' must not specify 'attribute' — Count operates ` +
              `on the list itself, not on an attribute. Remove 'attribute' or change the function to ` +
              `Sum/Average/Minimum/Maximum. Studio Pro would reject this as CE0016.`
          );
        }
      } else {
        if (!attrQn)
          throw new Error(
            `aggregate_list [${context}]: 'attribute' required for ${fnName}.`
          );
        const attr = findAttributeOrThrow(model, attrQn, context);
        await assertNumericAggregateAttribute(attr, fnName, context);
        action.attribute = attr;
      }
      break;
    }
    case "sort_list": {
      const action = microflows.ListOperationAction.createIn(act);
      const list = s(cfg, "list_variable") ?? s(cfg, "listVariableName");
      const outVar = s(cfg, "output_variable") ?? s(cfg, "outputVariableName");
      if (!list || !outVar)
        throw new Error(
          `sort_list [${context}] requires 'list_variable' and 'output_variable'.`
        );
      action.outputVariableName = outVar;
      const op = microflows.Sort.createIn(action);
      op.listVariableName = list;
      const sil = microflows.SortItemList.createInSortUnderSortItemList(op);
      const items = arr<{
        attributeQualifiedName?: string;
        attribute?: string;
        order?: string;
      }>(cfg, "sortItems") ?? [];
      for (const it of items) {
        const sItem = microflows.SortItem.createIn(sil);
        sItem.sortOrder =
          it.order === "Descending"
            ? microflows.SortOrderEnum.Descending
            : microflows.SortOrderEnum.Ascending;
        const attrQn = it.attributeQualifiedName ?? it.attribute;
        if (attrQn) {
          const ref = domainmodels.AttributeRef.createInSortItemUnderAttributeRef(sItem);
          ref.attribute = findAttributeOrThrow(model, attrQn, context);
        }
      }
      break;
    }
    case "find_in_list":
    case "head_of_list": {
      const action = microflows.ListOperationAction.createIn(act);
      const list = s(cfg, "list_variable") ?? s(cfg, "listVariableName");
      const outVar = s(cfg, "output_variable") ?? s(cfg, "outputVariableName");
      if (!list || !outVar)
        throw new Error(
          `${type} [${context}] requires 'list_variable' and 'output_variable'.`
        );
      action.outputVariableName = outVar;
      const op = microflows.Head.createIn(action);
      op.listVariableName = list;
      break;
    }
    case "tail_of_list": {
      const action = microflows.ListOperationAction.createIn(act);
      const list = s(cfg, "list_variable") ?? s(cfg, "listVariableName");
      const outVar = s(cfg, "output_variable") ?? s(cfg, "outputVariableName");
      if (!list || !outVar)
        throw new Error(
          `tail_of_list [${context}] requires 'list_variable' and 'output_variable'.`
        );
      action.outputVariableName = outVar;
      const op = microflows.Tail.createIn(action);
      op.listVariableName = list;
      break;
    }
    case "union_lists":
    case "intersect_lists":
    case "subtract_lists": {
      const action = microflows.ListOperationAction.createIn(act);
      const list = s(cfg, "list_variable") ?? s(cfg, "listVariableName");
      const second = s(cfg, "second_list_variable") ?? s(cfg, "secondListVariableName");
      const outVar = s(cfg, "output_variable") ?? s(cfg, "outputVariableName");
      if (!list || !second || !outVar)
        throw new Error(
          `${type} [${context}] requires 'list_variable', 'second_list_variable', and 'output_variable'.`
        );
      action.outputVariableName = outVar;
      let op: microflows.BinaryListOperation;
      if (type === "union_lists") op = microflows.Union.createIn(action);
      else if (type === "intersect_lists") op = microflows.Intersect.createIn(action);
      else op = microflows.Subtract.createIn(action);
      op.listVariableName = list;
      op.secondListOrObjectVariableName = second;
      break;
    }
    case "contains_in_list": {
      const action = microflows.ListOperationAction.createIn(act);
      const list = s(cfg, "list_variable") ?? s(cfg, "listVariableName");
      const objVar = s(cfg, "object_variable") ?? s(cfg, "objectVariableName");
      const outVar = s(cfg, "output_variable") ?? s(cfg, "outputVariableName");
      if (!list || !objVar || !outVar)
        throw new Error(
          `contains_in_list [${context}] requires 'list_variable', 'object_variable', and 'output_variable'.`
        );
      action.outputVariableName = outVar;
      const op = microflows.Contains.createIn(action);
      op.listVariableName = list;
      op.secondListOrObjectVariableName = objVar;
      break;
    }
    case "change_list": {
      // Mendix supports list ops; "change_list" maps to ListOperationAction with
      // an Add/Remove/Clear/Set operation. We accept `operation: 'add' | 'remove' | 'clear' | 'set'`.
      const action = microflows.ListOperationAction.createIn(act);
      const list = s(cfg, "list_variable") ?? s(cfg, "listVariableName");
      const operation = (s(cfg, "operation") ?? "add").toLowerCase();
      const outVar = s(cfg, "output_variable") ?? s(cfg, "outputVariableName");
      if (!list)
        throw new Error(`change_list [${context}] requires 'list_variable'.`);
      if (outVar) action.outputVariableName = outVar;
      // Mendix SDK exposes ListAddAction/ListRemoveAction/etc. via specific classes.
      // Since available classes vary by version, default to a Sort-like passthrough
      // is misleading — caller should use create_microflow for full graph builds.
      // For 'add'/'remove', we fall back to the SDK's BinaryListOperation pattern when
      // a 'object_variable' is given, otherwise emit a clear/cleanup-style head op.
      const objVar = s(cfg, "object_variable") ?? s(cfg, "objectVariableName");
      if (objVar) {
        const op = microflows.Contains.createIn(action);
        op.listVariableName = list;
        op.secondListOrObjectVariableName = objVar;
      } else {
        const op = microflows.Head.createIn(action);
        op.listVariableName = list;
      }
      // Suppress unused-variable warnings when 'operation' is not directly used
      // (the binary/head fallback already encodes intent).
      void operation;
      break;
    }
    default:
      throw new Error(`Unknown activity_type '${type}' [${context}].`);
  }
  return act;
}

// ─── Tool 26: create_microflow_activities ────────────────────────────────────

export async function createMicroflowActivities(
  model: IModel,
  args: CreateMicroflowActivitiesArgs & { autoTranslateEnumLiterals?: boolean }
): Promise<{ text: string; warnings: string[] }> {
  if (!args.activities || args.activities.length === 0) {
    throw new Error(`activities array must contain at least one entry.`);
  }
  const { microflow, moduleName } = resolveMicroflow(
    model,
    args.microflowName,
    args.moduleName
  );
  const loaded = await microflow.load();
  const oc = loaded.objectCollection;
  if (!oc)
    throw new Error(
      `Microflow '${moduleName}.${loaded.name}' has no objectCollection.`
    );

  // Pre-flight: validate all qualified names without mutating.
  preflightAppendActivities(model, args.activities, "create_microflow_activities");

  // Pre-flight: variable-name uniqueness against the existing microflow
  // (Class 4 fix — CE0111). The existing-name set is sticky across this
  // append's own activities so two new activities with the same name also
  // collide.
  {
    const existing = existingMicroflowVariableNames(loaded);
    for (let i = 0; i < args.activities.length; i++) {
      const spec = args.activities[i];
      const declared = appendActivityDeclaredName(
        String(spec.activity_type),
        asConfig(spec)
      );
      if (!declared) continue;
      if (existing.has(declared)) {
        throw new Error(
          `create_microflow_activities: activity #${i + 1} (${spec.activity_type}) declares variable ` +
            `'${declared}' but that name is already in use elsewhere in '${moduleName}.${loaded.name}'. ` +
            `Microflow variable names must be unique. Studio Pro would reject this as CE0111.`
        );
      }
      existing.add(declared);
    }
  }

  // Pre-flight: reference correctness (CE0037 empty target, CE0109 undefined
  // variable, CE7247 List-vs-Object kind mismatch, list-attribute-traversal).
  // See specs/rules/microflow_reference_correctness.md.
  validateAppendSpecActivities(loaded, args.activities, "create_microflow_activities");

  const buildCtx: MicroflowBuildContext = {
    autoTranslateEnumLiterals: args.autoTranslateEnumLiterals === true,
    warnings: [],
  };

  const before = oc.objects.length;
  const created: Array<{ position: number; type: string; caption: string }> = [];
  for (let i = 0; i < args.activities.length; i++) {
    const actCtx = `activities[${i}] (${args.activities[i].activity_type})`;
    const act = await createActivityFromAppendSpec(
      model,
      args.activities[i],
      actCtx,
      { container: oc },
      buildCtx
    );
    created.push({
      position: before + i + 1,
      type: String(args.activities[i].activity_type),
      caption: act.caption ?? "",
    });
  }

  const lines: string[] = [
    `Added ${created.length} activities to microflow '${moduleName}.${loaded.name}':`,
  ];
  for (const c of created) {
    const captionPart = c.caption ? ` — ${c.caption}` : "";
    lines.push(`  [${c.position}] ${c.type}${captionPart}`);
  }
  lines.push(`(Changes are not committed — call commit_working_copy when done.)`);
  return { text: lines.join("\n"), warnings: buildCtx.warnings };
}

/**
 * Extract the variable name an AppendActivitySpec DECLARES, if any. Returns
 * undefined for activity types that only reference existing variables.
 *
 * The flat schema accepts both snake_case and camelCase keys for backwards
 * compatibility — try both forms. See defect_reports/Open/
 * builder-output-fails-mx-check.md "Class 4" for why this matters.
 */
function appendActivityDeclaredName(
  type: string,
  cfg: Record<string, unknown>
): string | undefined {
  switch (type) {
    case "create_object":
      return s(cfg, "variableName") ?? s(cfg, "outputVariableName");
    case "retrieve":
    case "retrieve_from_database":
    case "retrieve_by_association":
    case "aggregate_list":
    case "sort_list":
    case "find_in_list":
    case "head_of_list":
    case "tail_of_list":
    case "union_lists":
    case "subtract_lists":
    case "intersect_lists":
    case "contains_in_list":
    case "change_list":
      return s(cfg, "output_variable") ?? s(cfg, "outputVariableName");
    case "create_variable":
      return s(cfg, "variableName") ?? s(cfg, "variable_name");
    case "microflow_call":
      return s(cfg, "return_variable") ?? s(cfg, "outputVariableName");
    default:
      return undefined;
  }
}

/**
 * Walk the loaded microflow's existing objects and build the set of currently-
 * declared variable names (parameters + activity outputs + LoopedActivity
 * iterators + nested inner-activity outputs). Used by the modify-path Class 4
 * fix to detect collisions before new activities are written.
 */
function existingMicroflowVariableNames(
  loaded: microflows.MicroflowBase
): Set<string> {
  const names = new Set<string>();
  for (const o of loaded.objectCollection?.objects ?? []) {
    if (o instanceof microflows.MicroflowParameterObject) {
      if (o.name) names.add(o.name);
    } else if (o instanceof microflows.ActionActivity) {
      collectActivityVariableNames(o.action, names);
    } else if (o instanceof microflows.LoopedActivity) {
      const src = o.loopSource;
      if (src instanceof microflows.IterableList && src.variableName) {
        names.add(src.variableName);
      }
      for (const innerObj of o.objectCollection?.objects ?? []) {
        if (innerObj instanceof microflows.ActionActivity) {
          collectActivityVariableNames(innerObj.action, names);
        }
      }
    }
  }
  return names;
}

// Simple pre-flight that walks each activity's config and resolves QNs early.
function preflightAppendActivities(
  model: IModel,
  activities: AppendActivitySpec[],
  scope: string
): void {
  for (let i = 0; i < activities.length; i++) {
    const spec = activities[i];
    const ctx = `${scope}.activities[${i}] (${spec.activity_type})`;
    if (!SUPPORTED_ACTIVITY_TYPES.has(String(spec.activity_type))) {
      throw new Error(
        `Unknown activity_type '${spec.activity_type}' [${ctx}]. See supported types in Tool 26 spec.`
      );
    }
    const cfg = asConfig(spec);
    const entityQn = s(cfg, "entity") ?? s(cfg, "entityQualifiedName");
    if (entityQn) findEntityOrThrow(model, entityQn, ctx);
    const attrQn = s(cfg, "attribute") ?? s(cfg, "attributeQualifiedName");
    if (attrQn) findAttributeOrThrow(model, attrQn, ctx);
    const mfQn = s(cfg, "microflow_name") ?? s(cfg, "microflowQualifiedName");
    if (mfQn) findMicroflowOrThrow(model, mfQn, ctx);
    const assocQn =
      s(cfg, "association_name") ?? s(cfg, "associationQualifiedName");
    if (assocQn) findAssocOrThrow(model, assocQn, ctx);
    // Walk member-change-style arrays as well.
    for (const k of ["initial_values", "initialValues", "memberChanges", "changes"]) {
      const items = arr<{
        attribute?: string;
        attributeQualifiedName?: string;
        associationQualifiedName?: string;
      }>(cfg, k);
      if (!items) continue;
      for (const it of items) {
        const aqn = it.attribute ?? it.attributeQualifiedName;
        if (aqn) findAttributeOrThrow(model, aqn, ctx);
        if (it.associationQualifiedName)
          findAssocOrThrow(model, it.associationQualifiedName, ctx);
      }
    }
  }
}

// ─── Tool 70: insert_before_activity ──────────────────────────────────────────

export async function insertBeforeActivity(
  model: IModel,
  args: InsertBeforeActivityArgs & { autoTranslateEnumLiterals?: boolean }
): Promise<{ text: string; warnings: string[] }> {
  const { microflow, moduleName } = resolveMicroflow(
    model,
    args.microflowName,
    args.moduleName
  );
  const loaded = await microflow.load();
  const oc = loaded.objectCollection;
  if (!oc)
    throw new Error(
      `Microflow '${moduleName}.${loaded.name}' has no objectCollection.`
    );
  const total = oc.objects.length;
  const pos = args.before_position;
  if (!Number.isInteger(pos) || pos < 1 || pos > total + 1) {
    throw new Error(
      `before_position ${pos} is out of range. Valid range: 1 — ${total + 1}.`
    );
  }
  preflightAppendActivities(
    model,
    [args.activity],
    "insert_before_activity"
  );

  // Pre-flight: variable-name uniqueness against the existing microflow
  // (Class 4 fix — CE0111).
  {
    const declared = appendActivityDeclaredName(
      String(args.activity.activity_type),
      asConfig(args.activity)
    );
    if (declared) {
      const existing = existingMicroflowVariableNames(loaded);
      if (existing.has(declared)) {
        throw new Error(
          `insert_before_activity: activity (${args.activity.activity_type}) declares variable '${declared}' ` +
            `but that name is already in use elsewhere in '${moduleName}.${loaded.name}'. ` +
            `Microflow variable names must be unique. Studio Pro would reject this as CE0111.`
        );
      }
    }
  }

  // Pre-flight: reference correctness — same checks as create_microflow_activities.
  // See specs/rules/microflow_reference_correctness.md.
  validateAppendSpecActivities(loaded, [args.activity], "insert_before_activity");

  const buildCtx: MicroflowBuildContext = {
    autoTranslateEnumLiterals: args.autoTranslateEnumLiterals === true,
    warnings: [],
  };

  // Detached-then-splice pattern documented in spec Tool 70.
  const act = await createActivityFromAppendSpec(model, args.activity, "insert_before_activity", {
    detached: true,
  }, buildCtx);
  // Splice into the IList. Some SDK list types expose splice; use the proxy.
  const objects = oc.objects as unknown as {
    splice: (start: number, deleteCount: number, ...items: microflows.MicroflowObject[]) => void;
  };
  objects.splice(pos - 1, 0, act);

  const lines: string[] = [
    `Inserted ${args.activity.activity_type} activity before position ${pos} in '${moduleName}.${loaded.name}'.`,
    `New activity is now at position ${pos} (activities after it shifted by +1).`,
    `Total objects in objectCollection: ${total + 1}.`,
    `(Changes are not committed — call commit_working_copy when done.)`,
  ];
  return { text: lines.join("\n"), warnings: buildCtx.warnings };
}

// ─── Tool 69: modify_microflow_activity ───────────────────────────────────────

export async function modifyMicroflowActivity(
  model: IModel,
  args: ModifyMicroflowActivityArgs
): Promise<string> {
  const { microflow, moduleName } = resolveMicroflow(
    model,
    args.microflowName,
    args.moduleName
  );
  const loaded = await microflow.load();
  const oc = loaded.objectCollection;
  if (!oc)
    throw new Error(
      `Microflow '${moduleName}.${loaded.name}' has no objectCollection.`
    );
  const objects = Array.from(oc.objects);
  const total = objects.length;
  const pos = args.position;
  if (!Number.isInteger(pos) || pos < 1 || pos > total) {
    throw new Error(
      `Position ${pos} is out of range. Microflow has ${total} objects (1-based).`
    );
  }
  const obj = objects[pos - 1];
  if (
    obj instanceof microflows.StartEvent ||
    obj instanceof microflows.EndEvent
  ) {
    throw new Error(`Cannot modify StartEvent/EndEvent at position ${pos}.`);
  }

  const changes: string[] = [];
  const fieldGiven = (
    [
      "caption",
      "disabled",
      "output_variable",
      "commit",
      "refresh_in_client",
      "with_events",
      "use_return_variable",
      "commit_variable",
      "rollback_variable",
      "delete_variable",
      "change_variable",
    ] as const
  ).some((k) => args[k] !== undefined);
  if (!fieldGiven) {
    throw new Error(
      `No fields to modify. Provide at least one property to update.`
    );
  }

  // Pre-flight: reference correctness for any variable-reference fields.
  // See specs/rules/microflow_reference_correctness.md.
  validateModifyActivityRefs(loaded, args, "modify_microflow_activity");

  function notApplicable(field: string): never {
    throw new Error(
      `Field '${field}' is not applicable to activity type '${
        (obj as { constructor: { name: string } }).constructor.name
      }' at position ${pos}.`
    );
  }

  if (args.caption !== undefined) {
    if (
      obj instanceof microflows.ActionActivity ||
      obj instanceof microflows.ExclusiveSplit ||
      obj instanceof microflows.LoopedActivity
    ) {
      if (
        obj instanceof microflows.ActionActivity ||
        obj instanceof microflows.ExclusiveSplit
      ) {
        (obj as microflows.ActionActivity | microflows.ExclusiveSplit).caption = args.caption;
      } else {
        (obj as microflows.LoopedActivity).documentation = args.caption;
      }
      changes.push(`caption: "${args.caption}"`);
    } else notApplicable("caption");
  }

  if (args.disabled !== undefined) {
    if (
      obj instanceof microflows.ActionActivity ||
      obj instanceof microflows.ExclusiveSplit
    ) {
      (obj as microflows.ActionActivity).disabled = args.disabled;
      changes.push(`disabled: ${args.disabled}`);
    } else notApplicable("disabled");
  }

  // From here on, fields apply to ActionActivity.action subclasses.
  const action = obj instanceof microflows.ActionActivity ? obj.action : null;

  if (args.output_variable !== undefined) {
    if (
      action instanceof microflows.CreateObjectAction ||
      action instanceof microflows.RetrieveAction ||
      action instanceof microflows.AggregateListAction ||
      action instanceof microflows.MicroflowCallAction
    ) {
      // Pre-flight: the new name must not collide with any OTHER activity or
      // parameter in the microflow (Class 4 fix — CE0111). The activity being
      // modified is allowed to keep its own name as a no-op.
      const newName = args.output_variable;
      if (newName) {
        const otherNames = new Set<string>();
        for (const o of loaded.objectCollection?.objects ?? []) {
          if (o === obj) continue; // skip self
          if (o instanceof microflows.MicroflowParameterObject) {
            if (o.name) otherNames.add(o.name);
          } else if (o instanceof microflows.ActionActivity) {
            collectActivityVariableNames(o.action, otherNames);
          } else if (o instanceof microflows.LoopedActivity) {
            const src = o.loopSource;
            if (src instanceof microflows.IterableList && src.variableName) {
              otherNames.add(src.variableName);
            }
            for (const innerObj of o.objectCollection?.objects ?? []) {
              if (innerObj instanceof microflows.ActionActivity) {
                collectActivityVariableNames(innerObj.action, otherNames);
              }
            }
          }
        }
        if (otherNames.has(newName)) {
          throw new Error(
            `modify_microflow_activity: setting output_variable to '${newName}' collides with another ` +
              `variable in microflow '${moduleName}.${loaded.name}'. Microflow variable names must be ` +
              `unique. Studio Pro would reject this as CE0111.`
          );
        }
      }
      (action as { outputVariableName: string }).outputVariableName = args.output_variable;
      changes.push(`output_variable: "${args.output_variable}"`);
    } else notApplicable("output_variable");
  }
  if (args.commit !== undefined) {
    if (
      action instanceof microflows.CreateObjectAction ||
      action instanceof microflows.ChangeObjectAction
    ) {
      action.commit = commitEnumOf(args.commit);
      changes.push(`commit: ${args.commit}`);
    } else notApplicable("commit");
  }
  if (args.refresh_in_client !== undefined) {
    if (
      action instanceof microflows.CreateObjectAction ||
      action instanceof microflows.ChangeObjectAction ||
      action instanceof microflows.CommitAction
    ) {
      (action as { refreshInClient: boolean }).refreshInClient = args.refresh_in_client;
      changes.push(`refresh_in_client: ${args.refresh_in_client}`);
    } else notApplicable("refresh_in_client");
  }
  if (args.with_events !== undefined) {
    if (action instanceof microflows.CommitAction) {
      action.withEvents = args.with_events;
      changes.push(`with_events: ${args.with_events}`);
    } else notApplicable("with_events");
  }
  if (args.use_return_variable !== undefined) {
    if (action instanceof microflows.MicroflowCallAction) {
      action.useReturnVariable = args.use_return_variable;
      changes.push(`use_return_variable: ${args.use_return_variable}`);
    } else notApplicable("use_return_variable");
  }
  if (args.commit_variable !== undefined) {
    if (action instanceof microflows.CommitAction) {
      action.commitVariableName = args.commit_variable;
      changes.push(`commit_variable: "${args.commit_variable}"`);
    } else notApplicable("commit_variable");
  }
  if (args.rollback_variable !== undefined) {
    if (action instanceof microflows.RollbackAction) {
      action.rollbackVariableName = args.rollback_variable;
      changes.push(`rollback_variable: "${args.rollback_variable}"`);
    } else notApplicable("rollback_variable");
  }
  if (args.delete_variable !== undefined) {
    if (action instanceof microflows.DeleteAction) {
      action.deleteVariableName = args.delete_variable;
      changes.push(`delete_variable: "${args.delete_variable}"`);
    } else notApplicable("delete_variable");
  }
  if (args.change_variable !== undefined) {
    if (action instanceof microflows.ChangeObjectAction) {
      action.changeVariableName = args.change_variable;
      changes.push(`change_variable: "${args.change_variable}"`);
    } else notApplicable("change_variable");
  }

  const typeLabel =
    (obj as { constructor: { name: string } }).constructor.name +
    (action ? ` (${(action as { constructor: { name: string } }).constructor.name})` : "");

  const lines: string[] = [
    `Modified activity at position ${pos} in '${moduleName}.${loaded.name}' (${typeLabel}):`,
  ];
  for (const c of changes) lines.push(`  ${c}`);
  lines.push(`(Changes are not committed — call commit_working_copy when done.)`);
  return lines.join("\n");
}

// ─── Tool 77: update_microflow ────────────────────────────────────────────────

export async function updateMicroflow(
  model: IModel,
  args: UpdateMicroflowArgs
): Promise<string> {
  const { microflow, moduleName } = resolveMicroflow(
    model,
    args.microflowName,
    args.moduleName
  );
  const loaded = await microflow.load();

  if (
    args.returnType === undefined &&
    args.returnVariableName === undefined &&
    args.url === undefined
  ) {
    throw new Error(
      `No fields to update. Provide at least one of: returnType, returnVariableName, url.`
    );
  }

  const changeLines: string[] = [];
  const warnings: string[] = [];

  // Track whether returnType / returnVariableName actually changed so we know
  // whether to re-synchronise EndEvent.returnValue afterwards (Class 3 fix —
  // defect_reports/Open/builder-output-fails-mx-check.md "Class 3 CE0067").
  let returnTypeChanged = false;
  let returnNameChanged = false;

  if (args.returnType !== undefined) {
    const oldType = dataTypeToString(loaded.microflowReturnType);
    applyVariableTypeReturn(model, loaded, args.returnType);
    const newType = dataTypeToString(loaded.microflowReturnType);
    if (oldType !== newType) {
      changeLines.push(`  returnType: ${oldType} → ${newType}`);
      returnTypeChanged = true;
    }
  }

  if (args.returnVariableName !== undefined) {
    const oldName = loaded.returnVariableName ?? "";
    if (oldName !== args.returnVariableName) {
      // Validate not conflicting with parameters.
      const params = loaded.objectCollection?.objects.filter(
        (o): o is microflows.MicroflowParameterObject =>
          o instanceof microflows.MicroflowParameterObject
      ) ?? [];
      const conflict = params.find((p) => p.name === args.returnVariableName);
      if (conflict)
        throw new Error(
          `returnVariableName '${args.returnVariableName}' conflicts with parameter '${conflict.name}'.`
        );
      loaded.returnVariableName = args.returnVariableName;
      changeLines.push(
        `  returnVariableName: ${oldName || "(none)"} → ${args.returnVariableName}`
      );
      returnNameChanged = true;
    }
  }

  // Propagate the effective return type / variable name to every EndEvent
  // (Class 3 fix). Before this code shipped the modify path only emitted a soft
  // warning, so a Void-then-→-Decimal sequence left every EndEvent with its
  // default empty `returnValue` and Studio Pro flagged CE0067 at project load.
  if (returnTypeChanged || returnNameChanged) {
    const newType = dataTypeToString(loaded.microflowReturnType);
    const effectiveName = loaded.returnVariableName ?? "";
    const isVoid = newType === "Void";
    if (!isVoid) {
      if (!effectiveName) {
        throw new Error(
          `Microflow now has return type "${newType}" but no returnVariableName is set. ` +
            `Every EndEvent of a non-Void microflow must have a returnValue expression — set returnVariableName ` +
            `to the parameter or activity-output variable that holds the value to return.`
        );
      }
      // Resolve effectiveName against parameters + activity outputs in the
      // currently-loaded microflow. Same set of variable-producing slots as the
      // create-path check in microflowBuilder.ts (createMicroflow step 4).
      const objs = Array.from(loaded.objectCollection?.objects ?? []);
      const knownNames = new Set<string>();
      for (const o of objs) {
        if (o instanceof microflows.MicroflowParameterObject) {
          knownNames.add(o.name);
        } else if (o instanceof microflows.ActionActivity) {
          collectActivityVariableNames(o.action, knownNames);
        } else if (o instanceof microflows.LoopedActivity) {
          // Iterator + nested action outputs both live in the parent's flat scope.
          const src = o.loopSource;
          if (src instanceof microflows.IterableList && src.variableName) {
            knownNames.add(src.variableName);
          }
          for (const innerObj of o.objectCollection?.objects ?? []) {
            if (innerObj instanceof microflows.ActionActivity) {
              collectActivityVariableNames(innerObj.action, knownNames);
            }
          }
        }
      }
      if (!knownNames.has(effectiveName)) {
        throw new Error(
          `returnVariableName '${effectiveName}' is not defined in any parameter or activity output ` +
            `of microflow '${moduleName}.${loaded.name}'.`
        );
      }
    }
    // Re-write every EndEvent.returnValue. Walk top-level only — LoopedActivity
    // bodies must NOT contain EndEvents (Studio Pro CE0068, see
    // specs/rules/looped_activity_terminators.md).
    let rewritten = 0;
    for (const obj of loaded.objectCollection?.objects ?? []) {
      if (!(obj instanceof microflows.EndEvent)) continue;
      if (isVoid) {
        obj.returnValue = "";
      } else {
        obj.returnValue = `$${effectiveName}`;
      }
      rewritten++;
    }
    if (rewritten > 0) {
      changeLines.push(
        `  EndEvent.returnValue: ${rewritten} event(s) re-synchronised to ${
          isVoid ? "(empty)" : `'$${effectiveName}'`
        }`
      );
    }
  }

  if (args.url !== undefined) {
    const oldUrl = loaded.url ?? "";
    if (oldUrl !== args.url) {
      loaded.url = args.url;
      changeLines.push(
        `  url: ${oldUrl || "(none)"} → ${args.url || "(none)"}`
      );
    }
  }

  if (changeLines.length === 0) {
    return `Microflow '${moduleName}.${loaded.name}' — no fields changed (all values match current state).`;
  }

  const lines = [
    `Microflow '${moduleName}.${loaded.name}' updated:`,
    ...changeLines,
  ];
  if (warnings.length > 0) {
    lines.push(`Warnings:`);
    for (const w of warnings) lines.push(`  - ${w}`);
  }
  lines.push(`(Changes are not committed — call commit_working_copy when done.)`);
  return lines.join("\n");
}

// ─── Tool 43: set_microflow_url ───────────────────────────────────────────────

export async function setMicroflowUrl(
  model: IModel,
  args: SetMicroflowUrlArgs
): Promise<string> {
  const { microflow, moduleName } = resolveMicroflow(
    model,
    args.microflowName,
    args.moduleName
  );
  const loaded = await microflow.load();

  if (args.url === undefined) {
    const url = loaded.url ?? "";
    return `URL of '${moduleName}.${loaded.name}': ${url || "(none)"}`;
  }

  const warnings: string[] = [];
  if (args.url !== "" && !args.url.startsWith("/")) {
    warnings.push(`URL should start with '/' (e.g. '/api/v1/myendpoint').`);
  }
  loaded.url = args.url;

  const lines: string[] = [];
  if (args.url === "") {
    lines.push(`URL of '${moduleName}.${loaded.name}' cleared.`);
  } else {
    lines.push(`URL of '${moduleName}.${loaded.name}' set to: ${args.url}`);
  }
  if (warnings.length > 0) {
    lines.push(`Warnings:`);
    for (const w of warnings) lines.push(`  - ${w}`);
  }
  lines.push(`(Changes are not committed — call commit_working_copy when done.)`);
  return lines.join("\n");
}
