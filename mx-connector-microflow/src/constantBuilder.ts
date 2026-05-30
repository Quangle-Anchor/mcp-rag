import { IModel, constants, datatypes, projects, settings } from "mendixmodelsdk";
import type {
  ConfigureConstantValuesArgs,
  ConstantDataType,
  CreateConstantArgs,
  ListConstantsArgs,
  UpdateConstantArgs,
} from "./types.js";

function findModule(model: IModel, moduleName: string): projects.IModule {
  const module = model.root.modules.find((m) => m.name === moduleName);
  if (!module) {
    throw new Error(
      `Module "${moduleName}" not found. Available: ${model.root.modules
        .map((m) => m.name)
        .join(", ")}`
    );
  }
  return module;
}

function findFolderByQN(
  module: projects.IModule,
  folderQN: string
): projects.Folder | null {
  const parts = folderQN.split(".");
  if (parts.length < 2 || parts[0] !== module.name) return null;
  let current: projects.IFolderBase = module;
  for (let i = 1; i < parts.length; i++) {
    const next = current.folders.find((f) => f.name === parts[i]);
    if (!next) return null;
    current = next;
  }
  return current as projects.Folder;
}

function createDataTypeForConstant(
  kind: ConstantDataType,
  constant: constants.Constant
): datatypes.DataType {
  switch (kind) {
    case "String":
      return datatypes.StringType.createInConstantUnderType(constant);
    case "Integer":
      return datatypes.IntegerType.createInConstantUnderType(constant);
    case "Decimal":
      return datatypes.DecimalType.createInConstantUnderType(constant);
    case "Boolean":
      return datatypes.BooleanType.createInConstantUnderType(constant);
    case "DateTime":
      return datatypes.DateTimeType.createInConstantUnderType(constant);
    default:
      throw new Error(`Unsupported constant data type: ${kind as string}`);
  }
}

function findExistingConstant(
  container: projects.IFolderBase,
  name: string
): constants.IConstant | null {
  for (const doc of container.documents) {
    if (doc.name === name && doc instanceof constants.Constant) {
      return doc;
    }
  }
  return null;
}

export interface CreateConstantResult {
  qualifiedName: string;
  moduleName: string;
  constantName: string;
  dataType: ConstantDataType;
  defaultValue: string;
  exposedToClient: boolean;
  alreadyExisted: boolean;
  replaced: boolean;
  folderQualifiedName: string | null;
}

export async function createConstant(
  model: IModel,
  args: CreateConstantArgs
): Promise<CreateConstantResult> {
  if (!args.moduleName?.trim()) throw new Error("moduleName is required.");
  if (!args.constantName?.trim()) throw new Error("constantName is required.");
  if (!args.dataType) throw new Error("dataType is required.");

  const module = findModule(model, args.moduleName);

  let container: projects.IFolderBase = module;
  if (args.folderQualifiedName) {
    const folder = findFolderByQN(module, args.folderQualifiedName);
    if (!folder) {
      throw new Error(
        `Folder '${args.folderQualifiedName}' not found in module '${args.moduleName}'.`
      );
    }
    container = folder;
  }

  const existing = findExistingConstant(container, args.constantName);
  let replaced = false;
  if (existing) {
    if (!args.overwrite) {
      // Idempotent return: surface the existing constant rather than throw,
      // matching the convention used by create_consumed_rest_service.
      const loaded = await existing.load();
      return {
        qualifiedName: loaded.qualifiedName ?? `${args.moduleName}.${args.constantName}`,
        moduleName: args.moduleName,
        constantName: args.constantName,
        dataType: dataTypeShortNameFor(loaded.type) ?? args.dataType,
        defaultValue: loaded.defaultValue ?? "",
        exposedToClient: loaded.exposedToClient,
        alreadyExisted: true,
        replaced: false,
        folderQualifiedName: args.folderQualifiedName ?? null,
      };
    }
    existing.delete();
    replaced = true;
  }

  const constant = constants.Constant.createIn(container);
  constant.name = args.constantName;
  createDataTypeForConstant(args.dataType, constant);
  constant.defaultValue = args.defaultValue ?? "";
  constant.exposedToClient = args.exposedToClient ?? false;
  if (args.documentation !== undefined) {
    constant.documentation = args.documentation;
  }

  return {
    qualifiedName: constant.qualifiedName ?? `${args.moduleName}.${args.constantName}`,
    moduleName: args.moduleName,
    constantName: args.constantName,
    dataType: args.dataType,
    defaultValue: constant.defaultValue,
    exposedToClient: constant.exposedToClient,
    alreadyExisted: false,
    replaced,
    folderQualifiedName: args.folderQualifiedName ?? null,
  };
}

function dataTypeShortNameFor(
  dt: datatypes.IDataType | datatypes.DataType | null
): ConstantDataType | null {
  if (!dt) return null;
  if (dt instanceof datatypes.StringType) return "String";
  if (dt instanceof datatypes.IntegerType) return "Integer";
  if (dt instanceof datatypes.DecimalType) return "Decimal";
  if (dt instanceof datatypes.BooleanType) return "Boolean";
  if (dt instanceof datatypes.DateTimeType) return "DateTime";
  return null;
}

// ─── Recursive constant collection helpers ─────────────────────────────────

function collectConstantsRecursive(
  container: projects.IFolderBase,
  out: Array<{ doc: constants.IConstant; folder: projects.Folder | null }>,
  currentFolder: projects.Folder | null
): void {
  for (const doc of container.documents) {
    if (doc instanceof constants.Constant) {
      out.push({ doc, folder: currentFolder });
    }
  }
  for (const folder of container.folders) {
    collectConstantsRecursive(folder, out, folder as projects.Folder);
  }
}

function folderQualifiedNameOf(
  module: projects.IModule,
  folder: projects.Folder | null
): string | null {
  if (!folder) return null;
  const segments: string[] = [folder.name];
  let current: projects.IFolderBase = folder.containerAsFolderBase;
  while (current && current !== module) {
    const asFolder = current as unknown as projects.Folder;
    if (typeof asFolder.name !== "string") break;
    segments.unshift(asFolder.name);
    current = asFolder.containerAsFolderBase;
  }
  return [module.name, ...segments].join(".");
}

function userModules(model: IModel): projects.IModule[] {
  return model.root.modules.filter((m) => m.fromAppStore === false);
}

// ─── Tool 18: list_constants ────────────────────────────────────────────────

export interface ListConstantsEntry {
  name: string;
  qualifiedName: string;
  moduleName: string;
  folderQualifiedName: string | null;
  dataType: ConstantDataType | "Unknown";
  defaultValue: string;
  exposedToClient: boolean;
}

export interface ListConstantsResult {
  success: true;
  status: "success";
  message: string;
  data: ListConstantsEntry[];
}

export async function listConstants(
  model: IModel,
  args: ListConstantsArgs
): Promise<ListConstantsResult> {
  let modules: projects.IModule[];
  if (args.moduleName?.trim()) {
    const mod = model.root.modules.find((m) => m.name === args.moduleName);
    if (!mod) {
      throw new Error(`Module '${args.moduleName}' not found in working copy.`);
    }
    modules = [mod];
  } else {
    modules = userModules(model);
  }

  const collected: Array<{
    module: projects.IModule;
    doc: constants.IConstant;
    folder: projects.Folder | null;
  }> = [];
  for (const mod of modules) {
    const bucket: Array<{
      doc: constants.IConstant;
      folder: projects.Folder | null;
    }> = [];
    collectConstantsRecursive(mod, bucket, null);
    for (const entry of bucket) {
      collected.push({ module: mod, doc: entry.doc, folder: entry.folder });
    }
  }

  const data: ListConstantsEntry[] = [];
  for (const item of collected) {
    const loaded = await item.doc.load();
    data.push({
      name: loaded.name,
      qualifiedName:
        loaded.qualifiedName ?? `${item.module.name}.${loaded.name}`,
      moduleName: item.module.name,
      folderQualifiedName: folderQualifiedNameOf(item.module, item.folder),
      dataType: dataTypeShortNameFor(loaded.type) ?? "Unknown",
      defaultValue: loaded.defaultValue ?? "",
      exposedToClient: loaded.exposedToClient,
    });
  }

  data.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));

  return {
    success: true,
    status: "success",
    message: `Found ${data.length} constant(s)`,
    data,
  };
}

// ─── Tool 63: update_constant ───────────────────────────────────────────────

export interface UpdateConstantResult {
  success: true;
  status: "success";
  message: string;
  data: {
    qualifiedName: string;
    moduleName: string;
    constantName: string;
    dataType: ConstantDataType | "Unknown";
    defaultValue: string;
    exposedToClient: boolean;
    documentation: string;
    changed: {
      defaultValue: boolean;
      exposedToClient: boolean;
      documentation: boolean;
    };
  };
}

function parseQualifiedName(
  raw: string,
  explicitModule: string | undefined,
  fieldLabel: string
): { moduleName: string | undefined; localName: string } {
  const trimmed = raw.trim();
  const dotIdx = trimmed.indexOf(".");
  if (dotIdx <= 0) {
    return { moduleName: explicitModule, localName: trimmed };
  }
  const prefixModule = trimmed.substring(0, dotIdx);
  const localName = trimmed.substring(dotIdx + 1);
  if (explicitModule && explicitModule !== prefixModule) {
    throw new Error(
      `${fieldLabel} prefix '${prefixModule}' conflicts with moduleName '${explicitModule}'.`
    );
  }
  return { moduleName: prefixModule, localName };
}

async function locateConstant(
  model: IModel,
  rawName: string,
  explicitModule: string | undefined,
  argFieldLabel: string
): Promise<{
  module: projects.IModule;
  doc: constants.IConstant;
}> {
  const { moduleName, localName } = parseQualifiedName(
    rawName,
    explicitModule,
    argFieldLabel
  );
  if (!localName) {
    throw new Error(`${argFieldLabel} is required.`);
  }

  if (moduleName) {
    const mod = model.root.modules.find((m) => m.name === moduleName);
    if (!mod) {
      throw new Error(`Module '${moduleName}' not found in working copy.`);
    }
    const bucket: Array<{
      doc: constants.IConstant;
      folder: projects.Folder | null;
    }> = [];
    collectConstantsRecursive(mod, bucket, null);
    const match = bucket.find((b) => b.doc.name === localName);
    if (!match) {
      throw new Error(
        `Constant '${localName}' not found in module '${mod.name}'.`
      );
    }
    return { module: mod, doc: match.doc };
  }

  const candidates: Array<{
    module: projects.IModule;
    doc: constants.IConstant;
  }> = [];
  for (const mod of userModules(model)) {
    const bucket: Array<{
      doc: constants.IConstant;
      folder: projects.Folder | null;
    }> = [];
    collectConstantsRecursive(mod, bucket, null);
    for (const entry of bucket) {
      if (entry.doc.name === localName) {
        candidates.push({ module: mod, doc: entry.doc });
      }
    }
  }
  if (candidates.length === 0) {
    throw new Error(`Constant '${localName}' not found in any module.`);
  }
  if (candidates.length > 1) {
    const moduleNames = candidates.map((c) => c.module.name).join(", ");
    throw new Error(
      `'${localName}' found in multiple modules: ${moduleNames}. Provide moduleName to disambiguate.`
    );
  }
  return candidates[0];
}

export async function updateConstant(
  model: IModel,
  args: UpdateConstantArgs
): Promise<UpdateConstantResult> {
  if (!args.constantName?.trim()) {
    throw new Error("constantName is required.");
  }
  const hasDefaultValue = args.defaultValue !== undefined;
  const hasExposedToClient = args.exposedToClient !== undefined;
  const hasDocumentation = args.documentation !== undefined;
  if (!hasDefaultValue && !hasExposedToClient && !hasDocumentation) {
    throw new Error(
      "At least one of defaultValue, exposedToClient, or documentation must be provided."
    );
  }

  const { module, doc } = await locateConstant(
    model,
    args.constantName,
    args.moduleName,
    "constantName"
  );

  const loaded = await doc.load();

  if (hasDefaultValue) loaded.defaultValue = args.defaultValue!;
  if (hasExposedToClient) loaded.exposedToClient = args.exposedToClient!;
  if (hasDocumentation) loaded.documentation = args.documentation!;

  const qualifiedName =
    loaded.qualifiedName ?? `${module.name}.${loaded.name}`;
  return {
    success: true,
    status: "success",
    message: `Updated constant '${qualifiedName}'`,
    data: {
      qualifiedName,
      moduleName: module.name,
      constantName: loaded.name,
      dataType: dataTypeShortNameFor(loaded.type) ?? "Unknown",
      defaultValue: loaded.defaultValue ?? "",
      exposedToClient: loaded.exposedToClient,
      documentation: loaded.documentation ?? "",
      changed: {
        defaultValue: hasDefaultValue,
        exposedToClient: hasExposedToClient,
        documentation: hasDocumentation,
      },
    },
  };
}

// ─── Tool 79: configure_constant_values ─────────────────────────────────────

export interface ConfigureConstantValuesResult {
  success: true;
  status: "success";
  message: string;
  data: {
    configurationName: string;
    constantQualifiedName: string;
    value: string;
    created: boolean;
    valueKind: "shared" | "private" | "legacy";
  };
}

async function findProjectConfiguration(
  model: IModel,
  configurationName: string
): Promise<settings.Configuration> {
  const projectSettingsList = model.allProjectSettings();
  if (projectSettingsList.length === 0) {
    throw new Error("Project has no ProjectSettings document.");
  }
  const projectSettings = await projectSettingsList[0].load();
  const configSettings = projectSettings.settingsParts.find(
    (p) => p instanceof settings.ConfigurationSettings
  ) as settings.ConfigurationSettings | undefined;
  if (!configSettings) {
    throw new Error(
      "Project has no ConfigurationSettings — open the project in Studio Pro at least once to initialize it."
    );
  }
  const config = configSettings.configurations.find(
    (c) => c.name === configurationName
  );
  if (!config) {
    const available = configSettings.configurations
      .map((c) => c.name)
      .join(", ");
    throw new Error(
      `Configuration '${configurationName}' not found. Available: ${available || "(none)"}.`
    );
  }
  return config;
}

export async function configureConstantValues(
  model: IModel,
  args: ConfigureConstantValuesArgs
): Promise<ConfigureConstantValuesResult> {
  if (!args.configurationName?.trim()) {
    throw new Error("configurationName is required.");
  }
  if (!args.constantName?.trim()) {
    throw new Error("constantName is required.");
  }
  if (typeof args.value !== "string") {
    throw new Error(
      "Parameter 'value' is required (use '' to set an empty override)."
    );
  }

  const { module, doc } = await locateConstant(
    model,
    args.constantName,
    args.moduleName,
    "constantName"
  );
  const loadedConstant = await doc.load();
  const constantQN =
    loadedConstant.qualifiedName ?? `${module.name}.${loadedConstant.name}`;

  const configuration = await findProjectConfiguration(
    model,
    args.configurationName
  );

  let created = false;
  let cv = configuration.constantValues.find(
    (c) => c.constant?.qualifiedName === constantQN
  ) as settings.ConstantValue | undefined;

  if (!cv) {
    cv = settings.ConstantValue.createIn(configuration);
    cv.constant = loadedConstant;
    created = true;
  }

  const cvProto = cv as unknown as {
    sharedOrPrivateValue?: settings.SharedOrPrivateValue | null;
    value?: string;
  };

  let valueKind: "shared" | "private" | "legacy";
  if ("sharedOrPrivateValue" in cvProto) {
    // Mendix 10.9+: write SharedValue. Replace PrivateValue if present —
    // PrivateValue indicates the value lives outside the model, which is not
    // authorable from the SDK.
    const existingSpv = cvProto.sharedOrPrivateValue;
    if (existingSpv instanceof settings.SharedValue) {
      existingSpv.value = args.value;
    } else {
      const sv = settings.SharedValue.create(model);
      sv.value = args.value;
      cv.sharedOrPrivateValue = sv;
    }
    valueKind = "shared";
  } else {
    // Legacy path (Mendix < 10.9).
    (cv as unknown as { value: string }).value = args.value;
    valueKind = "legacy";
  }

  return {
    success: true,
    status: "success",
    message: `Set '${constantQN}' = '${args.value}' in configuration '${args.configurationName}'`,
    data: {
      configurationName: args.configurationName,
      constantQualifiedName: constantQN,
      value: args.value,
      created,
      valueKind,
    },
  };
}
