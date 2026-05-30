import { domainmodels } from "mendixmodelsdk";
// ─── Helpers ─────────────────────────────────────────────────────────────────
function attributeTypeToString(t) {
    if (!t)
        return "Unknown";
    if (t instanceof domainmodels.StringAttributeType)
        return "String";
    if (t instanceof domainmodels.IntegerAttributeType)
        return "Integer";
    if (t instanceof domainmodels.LongAttributeType)
        return "Long";
    if (t instanceof domainmodels.DecimalAttributeType)
        return "Decimal";
    if (t instanceof domainmodels.BooleanAttributeType)
        return "Boolean";
    if (t instanceof domainmodels.DateTimeAttributeType)
        return "DateTime";
    if (t instanceof domainmodels.AutoNumberAttributeType)
        return "AutoNumber";
    if (t instanceof domainmodels.BinaryAttributeType)
        return "Binary";
    if (t instanceof domainmodels.HashedStringAttributeType)
        return "HashedString";
    return t.constructor?.name ?? "Unknown";
}
/**
 * Resolve an EnumerationAttributeType to the spec's display string
 * `"Enumeration (Val1/Val2/...)"`. The enumeration reference is a lazy stub —
 * `.values` on the unloaded reference returns an empty list silently, so we MUST
 * call `.load()` first per SPECS.md Tool 16 Behavior step 4.
 */
async function enumerationTypeToString(t) {
    const enumRef = t.enumeration;
    if (!enumRef)
        return "Enumeration";
    const loaded = await enumRef.load();
    const names = loaded.values.map((v) => v.name).join("/");
    return `Enumeration (${names})`;
}
function deletingBehaviorToString(b) {
    if (b === domainmodels.DeletingBehavior.DeleteMeAndReferences)
        return "delete_me_and_references";
    if (b === domainmodels.DeletingBehavior.DeleteMeIfNoReferences)
        return "delete_me_if_no_references";
    return "delete_me_but_keep_references";
}
function associationTypeToString(t) {
    return t === domainmodels.AssociationType.ReferenceSet ? "many-to-many" : "one-to-many";
}
function associationOwnerToString(o) {
    return o === domainmodels.AssociationOwner.Both ? "Both" : "Default";
}
/** Strip module prefix from a FQN (`Module.Entity` → `Entity`). */
function stripModule(qn, fallback) {
    if (!qn)
        return fallback;
    const idx = qn.lastIndexOf(".");
    return idx >= 0 ? qn.slice(idx + 1) : qn;
}
async function readAttribute(attr) {
    let typeStr;
    if (attr.type instanceof domainmodels.EnumerationAttributeType) {
        typeStr = await enumerationTypeToString(attr.type);
    }
    else {
        typeStr = attributeTypeToString(attr.type);
    }
    let valueType = "stored";
    let defaultValue = null;
    let calculatedMicroflow = null;
    if (attr.value instanceof domainmodels.StoredValue) {
        valueType = "stored";
        // SDK exposes defaultValue as a string ("" when not set). Map empty → null
        // to match the studio-pro convention shown in SPECS examples.
        defaultValue = attr.value.defaultValue || null;
    }
    else if (attr.value instanceof domainmodels.CalculatedValue) {
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
function readGeneralization(entity) {
    const g = entity.generalization;
    if (g instanceof domainmodels.Generalization) {
        return {
            hasGeneralization: true,
            parent: g.generalization?.qualifiedName ?? "<unknown>",
        };
    }
    return null;
}
function readAssociation(assoc) {
    const parentName = assoc.parent?.name ?? stripModule(assoc.parent?.qualifiedName, "<unknown>");
    let childName;
    if (assoc instanceof domainmodels.CrossAssociation) {
        childName =
            assoc.child?.name ??
                stripModule(assoc.childQualifiedName, "<unknown>") ??
                stripModule(assoc.child?.qualifiedName, "<unknown>");
    }
    else {
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
function involvesEntity(ref, entity) {
    if (!ref)
        return false;
    return ref.qualifiedName === entity.qualifiedName;
}
async function readEntity(entity, dm) {
    const attributes = [];
    for (const attr of entity.attributes) {
        attributes.push(await readAttribute(attr));
    }
    // All associations from BOTH same-module and cross-module collections where
    // the current entity participates as parent or child. Inherited associations
    // (from a generalization parent in another module) are NOT walked — per
    // SPECS.md Tool 16 Behavior step 4, we iterate only this domain model.
    const associations = [];
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
async function readModule(mod) {
    const dm = await mod.domainModel.load();
    const entities = [];
    for (const entity of dm.entities) {
        entities.push(await readEntity(entity, dm));
    }
    return { moduleName: mod.name, entities };
}
// ─── Main ────────────────────────────────────────────────────────────────────
export async function readDomainModel(model, args) {
    const moduleName = args.moduleName?.trim();
    let modulesToRead;
    if (moduleName) {
        const mod = model.root.modules.find((m) => m.name === moduleName);
        if (!mod) {
            throw new Error(`Module '${moduleName}' not found in working copy.`);
        }
        modulesToRead = [mod];
    }
    else {
        modulesToRead = model.root.modules.filter((m) => m.fromAppStore === false);
    }
    const data = [];
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
//# sourceMappingURL=domainModelReader.js.map