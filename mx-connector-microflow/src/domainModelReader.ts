import { IModel, domainmodels, projects } from "mendixmodelsdk";
import type { ReadDomainModelArgs } from "./types.js";

// ─── Result shapes ───────────────────────────────────────────────────────────

export interface AttributeReadResult {
  name: string;
  type: string;
  valueType: "stored" | "calculated";
  defaultValue: string | null;
  calculatedMicroflow: string | null;
}

export interface AssociationReadResult {
  name: string;
  parent: string;
  child: string;
  type: "one-to-many" | "many-to-many";
  parentDeleteBehavior: string;
  childDeleteBehavior: string;
  owner: "Default" | "Both";
}

export interface GeneralizationReadResult {
  hasGeneralization: true;
  parent: string;
}

export interface EntityReadResult {
  name: string;
  qualifiedName: string;
  generalization: GeneralizationReadResult | null;
  attributes: AttributeReadResult[];
  associations: AssociationReadResult[];
  eventHandlers: null;
}

export interface ModuleReadResult {
  moduleName: string;
  entities: EntityReadResult[];
}

export interface ReadDomainModelResponse {
  success: true;
  status: "success";
  message: string;
  data: ModuleReadResult[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function attributeTypeToString(t: domainmodels.AttributeType | null | undefined): string {
  if (!t) return "Unknown";
  if (t instanceof domainmodels.StringAttributeType) return "String";
  if (t instanceof domainmodels.IntegerAttributeType) return "Integer";
  if (t instanceof domainmodels.LongAttributeType) return "Long";
  if (t instanceof domainmodels.DecimalAttributeType) return "Decimal";
  if (t instanceof domainmodels.BooleanAttributeType) return "Boolean";
  if (t instanceof domainmodels.DateTimeAttributeType) return "DateTime";
  if (t instanceof domainmodels.AutoNumberAttributeType) return "AutoNumber";
  if (t instanceof domainmodels.BinaryAttributeType) return "Binary";
  if (t instanceof domainmodels.HashedStringAttributeType) return "HashedString";
  return t.constructor?.name ?? "Unknown";
}

/**
 * Resolve an EnumerationAttributeType to the spec's display string
 * `"Enumeration (Val1/Val2/...)"`. The enumeration reference is a lazy stub —
 * `.values` on the unloaded reference returns an empty list silently, so we MUST
 * call `.load()` first per SPECS.md Tool 16 Behavior step 4.
 */
async function enumerationTypeToString(
  t: domainmodels.EnumerationAttributeType
): Promise<string> {
  const enumRef = t.enumeration;
  if (!enumRef) return "Enumeration";
  const loaded = await enumRef.load();
  const names = loaded.values.map((v) => v.name).join("/");
  return `Enumeration (${names})`;
}

function deletingBehaviorToString(b: domainmodels.DeletingBehavior | null | undefined): string {
  if (b === domainmodels.DeletingBehavior.DeleteMeAndReferences) return "delete_me_and_references";
  if (b === domainmodels.DeletingBehavior.DeleteMeIfNoReferences) return "delete_me_if_no_references";
  return "delete_me_but_keep_references";
}

function associationTypeToString(
  t: domainmodels.AssociationType
): "one-to-many" | "many-to-many" {
  return t === domainmodels.AssociationType.ReferenceSet ? "many-to-many" : "one-to-many";
}

function associationOwnerToString(
  o: domainmodels.AssociationOwner
): "Default" | "Both" {
  return o === domainmodels.AssociationOwner.Both ? "Both" : "Default";
}

/** Strip module prefix from a FQN (`Module.Entity` → `Entity`). */
function stripModule(qn: string | null | undefined, fallback: string): string {
  if (!qn) return fallback;
  const idx = qn.lastIndexOf(".");
  return idx >= 0 ? qn.slice(idx + 1) : qn;
}

async function readAttribute(attr: domainmodels.Attribute): Promise<AttributeReadResult> {
  let typeStr: string;
  if (attr.type instanceof domainmodels.EnumerationAttributeType) {
    typeStr = await enumerationTypeToString(attr.type);
  } else {
    typeStr = attributeTypeToString(attr.type);
  }

  let valueType: "stored" | "calculated" = "stored";
  let defaultValue: string | null = null;
  let calculatedMicroflow: string | null = null;

  if (attr.value instanceof domainmodels.StoredValue) {
    valueType = "stored";
    // SDK exposes defaultValue as a string ("" when not set). Map empty → null
    // to match the studio-pro convention shown in SPECS examples.
    defaultValue = attr.value.defaultValue || null;
  } else if (attr.value instanceof domainmodels.CalculatedValue) {
    valueType = "calculated";
    calculatedMicroflow = attr.value.microflow?.qualifiedName ?? null;
  }

  return {
    name: attr.name,
    type: typeStr,
    valueType,
    defaultValue,
    calculatedMicroflow,
  };
}

function readGeneralization(entity: domainmodels.Entity): GeneralizationReadResult | null {
  const g = entity.generalization;
  if (g instanceof domainmodels.Generalization) {
    return {
      hasGeneralization: true,
      parent: g.generalization?.qualifiedName ?? "<unknown>",
    };
  }
  return null;
}

function readAssociation(
  assoc: domainmodels.Association | domainmodels.CrossAssociation
): AssociationReadResult {
  const parentName = assoc.parent?.name ?? stripModule(assoc.parent?.qualifiedName, "<unknown>");

  let childName: string;
  if (assoc instanceof domainmodels.CrossAssociation) {
    childName =
      assoc.child?.name ??
      stripModule(assoc.childQualifiedName, "<unknown>") ??
      stripModule(assoc.child?.qualifiedName, "<unknown>");
  } else {
    childName = assoc.child?.name ?? stripModule(assoc.child?.qualifiedName, "<unknown>");
  }

  return {
    name: assoc.name,
    parent: parentName,
    child: childName,
    type: associationTypeToString(assoc.type),
    parentDeleteBehavior: deletingBehaviorToString(assoc.deleteBehavior?.parentDeleteBehavior),
    childDeleteBehavior: deletingBehaviorToString(assoc.deleteBehavior?.childDeleteBehavior),
    owner: associationOwnerToString(assoc.owner),
  };
}

function involvesEntity(
  ref: domainmodels.IEntity | null | undefined,
  entity: domainmodels.Entity
): boolean {
  if (!ref) return false;
  return ref.qualifiedName === entity.qualifiedName;
}

async function readEntity(
  entity: domainmodels.Entity,
  dm: domainmodels.DomainModel
): Promise<EntityReadResult> {
  const attributes: AttributeReadResult[] = [];
  for (const attr of entity.attributes) {
    attributes.push(await readAttribute(attr));
  }

  // All associations from BOTH same-module and cross-module collections where
  // the current entity participates as parent or child. Inherited associations
  // (from a generalization parent in another module) are NOT walked — per
  // SPECS.md Tool 16 Behavior step 4, we iterate only this domain model.
  const associations: AssociationReadResult[] = [];
  for (const a of dm.associations) {
    if (involvesEntity(a.parent, entity) || involvesEntity(a.child, entity)) {
      associations.push(readAssociation(a));
    }
  }
  for (const a of dm.crossAssociations) {
    if (involvesEntity(a.parent, entity) || involvesEntity(a.child, entity)) {
      associations.push(readAssociation(a));
    }
  }

  return {
    name: entity.name,
    qualifiedName: entity.qualifiedName ?? `${entity.containerAsDomainModel?.containerAsModule?.name ?? ""}.${entity.name}`,
    generalization: readGeneralization(entity),
    attributes,
    associations,
    eventHandlers: null,
  };
}

async function readModule(mod: projects.IModule): Promise<ModuleReadResult> {
  const dm = await mod.domainModel.load();
  const entities: EntityReadResult[] = [];
  for (const entity of dm.entities) {
    entities.push(await readEntity(entity, dm));
  }
  return { moduleName: mod.name, entities };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function readDomainModel(
  model: IModel,
  args: ReadDomainModelArgs
): Promise<ReadDomainModelResponse> {
  const moduleName = args.moduleName?.trim();

  let modulesToRead: projects.IModule[];
  if (moduleName) {
    const mod = model.root.modules.find((m) => m.name === moduleName);
    if (!mod) {
      throw new Error(`Module '${moduleName}' not found in working copy.`);
    }
    modulesToRead = [mod];
  } else {
    modulesToRead = model.root.modules.filter((m) => m.fromAppStore === false);
  }

  const data: ModuleReadResult[] = [];
  for (const mod of modulesToRead) {
    data.push(await readModule(mod));
  }

  const n = data.length;
  const message = `Domain models retrieved from ${n} ${n === 1 ? "module" : "modules"}`;

  return {
    success: true,
    status: "success",
    message,
    data,
  };
}
