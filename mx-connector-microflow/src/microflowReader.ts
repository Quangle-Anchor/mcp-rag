import {
  IModel,
  microflows,
  datatypes,
  projects,
  texts,
} from "mendixmodelsdk";
import type {
  ListMicroflowsArgs,
  ReadMicroflowDetailsArgs,
  ReadMicroflowSecurityArgs,
} from "./types.js";

const EN_US = "en_US";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isUserModule(mod: projects.IModule): boolean {
  return mod.fromAppStore === false;
}

function listProjectMicroflows(
  model: IModel
): Array<{ module: projects.IModule; mfs: microflows.IMicroflow[] }> {
  const out: Array<{ module: projects.IModule; mfs: microflows.IMicroflow[] }> = [];
  for (const mod of model.root.modules) {
    if (!isUserModule(mod)) continue;
    const mfs = mod.documents.filter(
      (d): d is microflows.IMicroflow => d instanceof microflows.Microflow
    );
    out.push({ module: mod, mfs });
  }
  return out;
}

function listProjectNanoflows(
  model: IModel
): Array<{ module: projects.IModule; nfs: microflows.INanoflow[] }> {
  const out: Array<{ module: projects.IModule; nfs: microflows.INanoflow[] }> = [];
  for (const mod of model.root.modules) {
    if (!isUserModule(mod)) continue;
    const nfs = mod.documents.filter(
      (d): d is microflows.INanoflow => d instanceof microflows.Nanoflow
    );
    out.push({ module: mod, nfs });
  }
  return out;
}

function shortName(qname: string | null | undefined): string {
  if (!qname) return "";
  const idx = qname.lastIndexOf(".");
  return idx >= 0 ? qname.substring(idx + 1) : qname;
}

function moduleOfQName(qname: string | null | undefined): string {
  if (!qname) return "";
  const idx = qname.lastIndexOf(".");
  return idx >= 0 ? qname.substring(0, idx) : "";
}

// ─── Tool 23: list_microflows ─────────────────────────────────────────────────

export async function listMicroflows(
  model: IModel,
  args: ListMicroflowsArgs
): Promise<string> {
  const moduleName = args.moduleName?.trim();

  if (moduleName) {
    const mod = model.root.modules.find((m) => m.name === moduleName);
    if (!mod) {
      const available = model.root.modules.map((m) => m.name).join(", ");
      throw new Error(
        `Module "${moduleName}" not found. Available modules: ${available}`
      );
    }
    const mfs = mod.documents.filter(
      (d): d is microflows.IMicroflow => d instanceof microflows.Microflow
    );
    if (mfs.length === 0) {
      return `No microflows found in module '${moduleName}'.`;
    }
    const sorted = [...mfs].sort((a, b) =>
      (a.qualifiedName ?? "").localeCompare(b.qualifiedName ?? "")
    );
    const lines = [
      `Microflows in module '${moduleName}' (${sorted.length} total):`,
    ];
    sorted.forEach((mf, i) => {
      lines.push(`  ${i + 1}. ${mf.qualifiedName ?? `${moduleName}.${mf.name}`}`);
    });
    return lines.join("\n");
  }

  // No moduleName: scan all user modules.
  const grouped = listProjectMicroflows(model).filter((g) => g.mfs.length > 0);
  const total = grouped.reduce((sum, g) => sum + g.mfs.length, 0);

  if (model.root.modules.filter(isUserModule).length === 0) {
    return "No modules found in working copy.";
  }
  if (total === 0) {
    return "Microflows in project (0 total):\n(no microflows found in any module)";
  }

  const lines = [`Microflows in project (${total} total):`];
  for (const g of grouped) {
    const sorted = [...g.mfs].sort((a, b) =>
      (a.qualifiedName ?? "").localeCompare(b.qualifiedName ?? "")
    );
    lines.push("");
    lines.push(`Module '${g.module.name}':`);
    sorted.forEach((mf, i) => {
      lines.push(`  ${i + 1}. ${mf.qualifiedName ?? `${g.module.name}.${mf.name}`}`);
    });
  }
  return lines.join("\n");
}

// ─── Resolve microflow (shared helper) ────────────────────────────────────────

export interface ResolvedMicroflow {
  microflow: microflows.IMicroflow;
  moduleName: string;
}

export function resolveMicroflow(
  model: IModel,
  microflowName: string,
  moduleName?: string
): ResolvedMicroflow {
  if (microflowName.includes(".")) {
    const mf = model.findMicroflowByQualifiedName(microflowName);
    if (!mf) {
      throw new Error(
        `Microflow '${microflowName}' not found. Provide a valid qualified name (Module.Microflow).`
      );
    }
    return { microflow: mf, moduleName: moduleOfQName(mf.qualifiedName) };
  }

  if (moduleName) {
    const mod = model.root.modules.find((m) => m.name === moduleName);
    if (!mod) {
      const available = model.root.modules.map((m) => m.name).join(", ");
      throw new Error(`Module '${moduleName}' not found. Available: ${available}.`);
    }
    const mfs = mod.documents.filter(
      (d): d is microflows.IMicroflow => d instanceof microflows.Microflow
    );
    const mf = mfs.find((m) => m.name === microflowName);
    if (!mf) {
      throw new Error(
        `Microflow '${microflowName}' not found in module '${moduleName}'.`
      );
    }
    return { microflow: mf, moduleName };
  }

  // Scan all user modules.
  for (const mod of model.root.modules) {
    if (!isUserModule(mod)) continue;
    const mfs = mod.documents.filter(
      (d): d is microflows.IMicroflow => d instanceof microflows.Microflow
    );
    const mf = mfs.find((m) => m.name === microflowName);
    if (mf) return { microflow: mf, moduleName: mod.name };
  }
  throw new Error(
    `Microflow '${microflowName}' not found. Provide qualified name or moduleName.`
  );
}

// ─── DataType reverse mapping ─────────────────────────────────────────────────

export function dataTypeToString(dt: datatypes.IDataType | null | undefined): string {
  if (!dt) return "Void";
  if (dt instanceof datatypes.VoidType) return "Void";
  if (dt instanceof datatypes.BooleanType) return "Boolean";
  if (dt instanceof datatypes.StringType) return "String";
  if (dt instanceof datatypes.IntegerType) return "Integer";
  if (dt instanceof datatypes.DecimalType) return "Decimal";
  if (dt instanceof datatypes.DateTimeType) return "DateTime";
  if (dt instanceof datatypes.ObjectType) {
    const qn = dt.entityQualifiedName ?? "<unknown>";
    return `Object [entity: ${qn}]`;
  }
  if (dt instanceof datatypes.ListType) {
    const qn = dt.entityQualifiedName ?? "<unknown>";
    return `List [entity: ${qn}]`;
  }
  // Fallback: any other DataType class
  return (dt as { constructor: { name: string } }).constructor.name.replace(/Type$/, "");
}

// ─── Tool 24: read_microflow_details ──────────────────────────────────────────

function commitEnumLabel(c: microflows.CommitEnum | undefined): string {
  if (!c) return "No";
  if (c === microflows.CommitEnum.Yes) return "Yes";
  if (c === microflows.CommitEnum.YesWithoutEvents) return "YesWithoutEvents";
  return "No";
}

function logLevelLabel(l: microflows.LogLevel | undefined): string {
  if (!l) return "Info";
  if (l === microflows.LogLevel.Trace) return "Trace";
  if (l === microflows.LogLevel.Debug) return "Debug";
  if (l === microflows.LogLevel.Info) return "Info";
  if (l === microflows.LogLevel.Warning) return "Warning";
  if (l === microflows.LogLevel.Error) return "Error";
  if (l === microflows.LogLevel.Critical) return "Critical";
  return "Info";
}

function showMessageTypeLabel(t: microflows.ShowMessageType | undefined): string {
  if (!t) return "Information";
  if (t === microflows.ShowMessageType.Information) return "Information";
  if (t === microflows.ShowMessageType.Warning) return "Warning";
  if (t === microflows.ShowMessageType.Error) return "Error";
  return "Information";
}

function aggregateFunctionLabel(
  f: microflows.AggregateFunctionEnum | undefined
): string {
  if (!f) return "Count";
  if (f === microflows.AggregateFunctionEnum.Count) return "Count";
  if (f === microflows.AggregateFunctionEnum.Sum) return "Sum";
  if (f === microflows.AggregateFunctionEnum.Average) return "Average";
  if (f === microflows.AggregateFunctionEnum.Minimum) return "Minimum";
  if (f === microflows.AggregateFunctionEnum.Maximum) return "Maximum";
  return "Count";
}

function rangeLabel(r: microflows.Range | null | undefined): string {
  if (!r) return "All";
  if (r instanceof microflows.ConstantRange) {
    return r.singleObject ? "First" : "All";
  }
  if (r instanceof microflows.CustomRange) return "CustomRange";
  return "All";
}

function templateText(t: microflows.StringTemplate | microflows.TextTemplate | null): string {
  if (!t) return "";
  if (t instanceof microflows.StringTemplate) return t.text ?? "";
  if (t instanceof microflows.TextTemplate) {
    const text = t.text;
    if (!text) return "";
    const tr = text.translations.find((x: texts.Translation) => x.languageCode === EN_US);
    return tr?.text ?? "";
  }
  return "";
}

interface ActivityLine {
  position: number;
  label: string; // first line "[N] <type> — caption: '<caption>'" or "[N] StartEvent"
  details: string[]; // indented detail lines
}

function describeActionActivity(
  act: microflows.ActionActivity
): { type: string; details: string[] } {
  const action = act.action;
  if (!action) return { type: "ActionActivity", details: [] };

  if (action instanceof microflows.CreateObjectAction) {
    return {
      type: "CreateObject",
      details: [
        `entity: ${action.entityQualifiedName ?? "<unknown>"}`,
        `outputVar: ${action.outputVariableName ?? ""}`,
        `commit: ${commitEnumLabel(action.commit)}`,
        `memberChanges: ${action.items?.length ?? 0}`,
      ],
    };
  }
  if (action instanceof microflows.ChangeObjectAction) {
    return {
      type: "ChangeObject",
      details: [
        `variable: ${action.changeVariableName ?? ""}`,
        `commit: ${commitEnumLabel(action.commit)}`,
        `refreshInClient: ${action.refreshInClient}`,
        `memberChanges: ${action.items?.length ?? 0}`,
      ],
    };
  }
  if (action instanceof microflows.CommitAction) {
    return {
      type: "CommitObject",
      details: [
        `variable: ${action.commitVariableName ?? ""}`,
        `withEvents: ${action.withEvents}`,
        `refreshInClient: ${action.refreshInClient}`,
      ],
    };
  }
  if (action instanceof microflows.DeleteAction) {
    return {
      type: "DeleteObject",
      details: [`variable: ${action.deleteVariableName ?? ""}`],
    };
  }
  if (action instanceof microflows.RetrieveAction) {
    const src = action.retrieveSource;
    if (src instanceof microflows.DatabaseRetrieveSource) {
      return {
        type: "Retrieve",
        details: [
          `source: Database`,
          `entity: ${src.entityQualifiedName ?? "<unknown>"}`,
          `outputVar: ${action.outputVariableName ?? ""}`,
          `range: ${rangeLabel(src.range)}`,
          `xpath: ${src.xPathConstraint ? src.xPathConstraint : "(none)"}`,
        ],
      };
    }
    if (src instanceof microflows.AssociationRetrieveSource) {
      return {
        type: "Retrieve",
        details: [
          `source: Association(${src.associationQualifiedName ?? "<unknown>"})`,
          `outputVar: ${action.outputVariableName ?? ""}`,
        ],
      };
    }
    return {
      type: "Retrieve",
      details: [`outputVar: ${action.outputVariableName ?? ""}`],
    };
  }
  if (action instanceof microflows.CreateVariableAction) {
    return {
      type: "CreateVariable",
      details: [
        `variableName: ${action.variableName ?? ""}`,
        `variableType: ${dataTypeToString(action.variableType)}`,
        `initialValue: ${action.initialValue ?? ""}`,
      ],
    };
  }
  if (action instanceof microflows.ChangeVariableAction) {
    return {
      type: "ChangeVariable",
      details: [
        `variable: ${action.changeVariableName ?? ""}`,
        `value: ${action.value ?? ""}`,
      ],
    };
  }
  if (action instanceof microflows.MicroflowCallAction) {
    const mfCall = action.microflowCall;
    const calleeQn = mfCall?.microflowQualifiedName ?? "<unknown>";
    const mappingCount = mfCall?.parameterMappings?.length ?? 0;
    return {
      type: "CallMicroflow",
      details: [
        `microflow: ${calleeQn}`,
        `outputVar: ${action.outputVariableName || "(none)"}`,
        `parameterMappings: ${mappingCount}`,
      ],
    };
  }
  if (action instanceof microflows.LogMessageAction) {
    return {
      type: "LogMessage",
      details: [
        `level: ${logLevelLabel(action.level)}`,
        `node: ${action.node ?? ""}`,
        `template: "${templateText(action.messageTemplate ?? null)}"`,
      ],
    };
  }
  if (action instanceof microflows.ShowMessageAction) {
    return {
      type: "ShowMessage",
      details: [
        `type: ${showMessageTypeLabel(action.type)}`,
        `blocking: ${action.blocking}`,
        `template: "${templateText(action.template ?? null)}"`,
      ],
    };
  }
  if (action instanceof microflows.ShowPageAction) {
    const pageQn = action.pageSettings?.pageQualifiedName ?? "<unknown>";
    return {
      type: "ShowPage",
      details: [
        `page: ${pageQn}`,
        `passedObject: ${action.passedObjectVariableName || "(none)"}`,
      ],
    };
  }
  if (action instanceof microflows.CloseFormAction) {
    return { type: "ClosePage", details: [] };
  }
  if (action instanceof microflows.ValidationFeedbackAction) {
    return {
      type: "ValidationFeedback",
      details: [
        `object: ${action.objectVariableName ?? ""}`,
        `attribute: ${action.attributeQualifiedName ?? "(none)"}`,
        `association: ${action.associationQualifiedName ?? "(none)"}`,
        `template: "${templateText(action.feedbackTemplate ?? null)}"`,
      ],
    };
  }
  if (action instanceof microflows.AggregateListAction) {
    return {
      type: "AggregateList",
      details: [
        `list: ${action.inputListVariableName ?? ""}`,
        `function: ${aggregateFunctionLabel(action.aggregateFunction)}`,
        `attribute: ${action.attributeQualifiedName ?? "(none)"}`,
        `outputVar: ${action.outputVariableName ?? ""}`,
      ],
    };
  }
  if (action instanceof microflows.ListOperationAction) {
    const op = action.operation;
    const opName = op
      ? (op as { constructor: { name: string } }).constructor.name
      : "Unknown";
    const list = (op as unknown as { listVariableName?: string })?.listVariableName ?? "";
    return {
      type: "ListOperation",
      details: [
        `operation: ${opName}`,
        `list: ${list}`,
        `outputVar: ${action.outputVariableName ?? ""}`,
      ],
    };
  }

  return {
    type: (action as { constructor: { name: string } }).constructor.name,
    details: [],
  };
}

function describeActivity(
  obj: microflows.MicroflowObject,
  position: number
): ActivityLine {
  if (obj instanceof microflows.StartEvent) {
    return { position, label: `[${position}] StartEvent`, details: [] };
  }
  if (obj instanceof microflows.EndEvent) {
    const ret = obj.returnValue;
    return {
      position,
      label: `[${position}] EndEvent`,
      details: ret ? [`returnValue: ${ret}`] : [],
    };
  }
  if (obj instanceof microflows.ContinueEvent) {
    return { position, label: `[${position}] ContinueEvent`, details: [] };
  }
  if (obj instanceof microflows.MicroflowParameterObject) {
    return {
      position,
      label: `[${position}] Parameter — name: "${obj.name}"`,
      details: [`type: ${dataTypeToString(obj.variableType)}`],
    };
  }
  if (obj instanceof microflows.ExclusiveSplit) {
    const cond = obj.splitCondition;
    let conditionType = "Unknown";
    let condition = "";
    if (cond instanceof microflows.ExpressionSplitCondition) {
      conditionType = "Expression";
      condition = cond.expression ?? "";
    }
    return {
      position,
      label: `[${position}] ExclusiveSplit — caption: "${obj.caption ?? ""}"`,
      details: [`conditionType: ${conditionType}`, `condition: ${condition}`],
    };
  }
  if (obj instanceof microflows.LoopedActivity) {
    const src = obj.loopSource;
    let listVar = "";
    let iterVar = "";
    if (src instanceof microflows.IterableList) {
      listVar = src.listVariableName ?? "";
      iterVar = src.variableName ?? "";
    }
    const innerCount = obj.objectCollection?.objects?.length ?? 0;
    return {
      position,
      label: `[${position}] LoopedActivity — caption: "${obj.documentation ?? ""}"`,
      details: [
        `list: ${listVar}`,
        `iterator: ${iterVar}`,
        `innerActivities: ${innerCount}`,
      ],
    };
  }
  if (obj instanceof microflows.ActionActivity) {
    const { type, details } = describeActionActivity(obj);
    const label = `[${position}] ${type} — caption: "${obj.caption ?? ""}"`;
    return { position, label, details };
  }
  // Fallback for other MicroflowObject subclasses.
  const cls = (obj as { constructor: { name: string } }).constructor.name;
  return { position, label: `[${position}] ${cls}`, details: [] };
}

export async function readMicroflowDetails(
  model: IModel,
  args: ReadMicroflowDetailsArgs
): Promise<string> {
  const { microflow, moduleName } = resolveMicroflow(
    model,
    args.microflowName,
    args.moduleName
  );

  const loaded = await microflow.load();
  // objectCollection is an in-unit element — children populate as part of microflow.load().

  const lines: string[] = [];
  lines.push(`Microflow: ${moduleName}.${loaded.name}`);
  lines.push(`Documentation: ${loaded.documentation ? loaded.documentation : "(none)"}`);
  lines.push(`Return type: ${dataTypeToString(loaded.microflowReturnType)}`);
  lines.push(
    `Return variable: ${loaded.returnVariableName ? loaded.returnVariableName : "(none)"}`
  );
  lines.push(`Allow concurrent execution: ${loaded.allowConcurrentExecution}`);
  lines.push(`Apply entity access: ${loaded.applyEntityAccess}`);
  lines.push(`URL: ${loaded.url ? loaded.url : "(none)"}`);
  lines.push("");

  // Parameters: walk objectCollection for MicroflowParameterObject, use them as the parameter source.
  const objects = Array.from(loaded.objectCollection?.objects ?? []);
  const paramObjects = objects.filter(
    (o): o is microflows.MicroflowParameterObject =>
      o instanceof microflows.MicroflowParameterObject
  );
  lines.push(`Parameters (${paramObjects.length}):`);
  paramObjects.forEach((p, i) => {
    lines.push(`  ${i + 1}. ${p.name}: ${dataTypeToString(p.variableType)}`);
  });
  lines.push("");

  // Activities: every non-Parameter object in creation order.
  const activityObjects = objects.filter(
    (o) => !(o instanceof microflows.MicroflowParameterObject)
  );
  lines.push(`Activities (${activityObjects.length}):`);
  activityObjects.forEach((obj, i) => {
    const desc = describeActivity(obj, i + 1);
    lines.push(`  ${desc.label}`);
    desc.details.forEach((d) => lines.push(`      ${d}`));
  });

  return lines.join("\n");
}

// ─── Tool 48: read_microflow_security ─────────────────────────────────────────

interface SecurityEntry {
  qualifiedName: string;
  isNanoflow: boolean;
  applyEntityAccess: boolean;
  allowedRoles: string[] | null; // null → not applicable / module security not configured
  notApplicableReason?: string;
}

async function readSecurityForMicroflow(
  mf: microflows.IMicroflow
): Promise<SecurityEntry> {
  const loaded = await mf.load();
  const roles = loaded.allowedModuleRolesQualifiedNames ?? [];
  return {
    qualifiedName: loaded.qualifiedName ?? mf.qualifiedName ?? mf.name,
    isNanoflow: false,
    applyEntityAccess: loaded.applyEntityAccess,
    allowedRoles: roles.map((qn) => shortName(qn)).filter((n) => n.length > 0),
  };
}

async function readSecurityForNanoflow(
  nf: microflows.INanoflow
): Promise<SecurityEntry> {
  const loaded = await nf.load();
  return {
    qualifiedName: loaded.qualifiedName ?? nf.qualifiedName ?? nf.name,
    isNanoflow: true,
    applyEntityAccess: false, // Nanoflow has no applyEntityAccess
    allowedRoles: null,
    notApplicableReason: "(N/A — nanoflows are not listed in ModuleSecurity)",
  };
}

export async function readMicroflowSecurity(
  model: IModel,
  args: ReadMicroflowSecurityArgs
): Promise<string> {
  const includeNanoflows = args.include_nanoflows === true;

  const entries: SecurityEntry[] = [];

  // Determine resolution mode.
  if (args.microflowName) {
    // Single microflow OR nanoflow (qualified or short).
    if (args.microflowName.includes(".")) {
      // Try as Microflow first, then Nanoflow if include_nanoflows.
      const mf = model.findMicroflowByQualifiedName(args.microflowName);
      if (mf) {
        entries.push(await readSecurityForMicroflow(mf));
      } else if (includeNanoflows) {
        // Try nanoflow lookup by walking modules.
        const moduleN = moduleOfQName(args.microflowName);
        const shortN = shortName(args.microflowName);
        const mod = model.root.modules.find((m) => m.name === moduleN);
        const nf = mod?.documents.find(
          (d) => d instanceof microflows.Nanoflow && d.name === shortN
        ) as microflows.INanoflow | undefined;
        if (!nf) throw new Error(`Microflow '${args.microflowName}' not found.`);
        entries.push(await readSecurityForNanoflow(nf));
      } else {
        throw new Error(`Microflow '${args.microflowName}' not found.`);
      }
    } else {
      // Short name. Resolve via moduleName or scan.
      try {
        const { microflow } = resolveMicroflow(
          model,
          args.microflowName,
          args.moduleName
        );
        entries.push(await readSecurityForMicroflow(microflow));
      } catch (e) {
        if (!includeNanoflows) throw e;
        // Try nanoflow.
        const candidates: microflows.INanoflow[] = [];
        for (const mod of model.root.modules) {
          if (!isUserModule(mod)) continue;
          if (args.moduleName && mod.name !== args.moduleName) continue;
          for (const d of mod.documents) {
            if (d instanceof microflows.Nanoflow && d.name === args.microflowName) {
              candidates.push(d);
            }
          }
        }
        if (candidates.length === 0)
          throw new Error(`Microflow '${args.microflowName}' not found.`);
        entries.push(await readSecurityForNanoflow(candidates[0]));
      }
    }
  } else if (args.moduleName) {
    const mod = model.root.modules.find((m) => m.name === args.moduleName);
    if (!mod) {
      const available = model.root.modules.map((m) => m.name).join(", ");
      throw new Error(
        `Module '${args.moduleName}' not found. Available: ${available}.`
      );
    }
    const mfs = mod.documents.filter(
      (d): d is microflows.IMicroflow => d instanceof microflows.Microflow
    );
    for (const mf of mfs) entries.push(await readSecurityForMicroflow(mf));
    if (includeNanoflows) {
      const nfs = mod.documents.filter(
        (d): d is microflows.INanoflow => d instanceof microflows.Nanoflow
      );
      for (const nf of nfs) entries.push(await readSecurityForNanoflow(nf));
    }
  } else {
    for (const g of listProjectMicroflows(model)) {
      for (const mf of g.mfs) entries.push(await readSecurityForMicroflow(mf));
    }
    if (includeNanoflows) {
      for (const g of listProjectNanoflows(model)) {
        for (const nf of g.nfs) entries.push(await readSecurityForNanoflow(nf));
      }
    }
  }

  if (entries.length === 0) {
    const scope = args.moduleName
      ? `module '${args.moduleName}'`
      : "project";
    return `No microflows found in ${scope}.`;
  }

  // Sort by qualified name.
  entries.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));

  const lines: string[] = [];
  lines.push(`Microflow security (${entries.length} microflow(s)):`);
  for (const e of entries) {
    lines.push("");
    const tag = e.isNanoflow ? " (Nanoflow)" : "";
    lines.push(`${e.qualifiedName}${tag}:`);
    lines.push(`  applyEntityAccess: ${e.applyEntityAccess}`);
    if (e.allowedRoles === null) {
      lines.push(`  allowedRoles: ${e.notApplicableReason ?? "(none)"}`);
    } else if (e.allowedRoles.length === 0) {
      lines.push(`  allowedRoles: (none — no roles defined)`);
    } else {
      lines.push(`  allowedRoles: ${e.allowedRoles.join(", ")}`);
    }
  }
  return lines.join("\n");
}

