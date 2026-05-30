import { microflows, constants, enumerations, pages, domainmodels, datatypes, texts, } from "mendixmodelsdk";
const EN_US = "en_US";
// ─── Shared helpers ──────────────────────────────────────────────────────────
function userModules(model) {
    return model.root.modules.filter((m) => m.fromAppStore === false);
}
function findModuleOrThrow(model, moduleName) {
    const mod = model.root.modules.find((m) => m.name === moduleName);
    if (!mod) {
        throw new Error(`Module '${moduleName}' not found in working copy.`);
    }
    return mod;
}
function documentTypeMatches(doc, documentType) {
    switch (documentType) {
        case "page":
            return doc instanceof pages.Page;
        case "microflow":
            return doc instanceof microflows.Microflow;
        case "nanoflow":
            return doc instanceof microflows.Nanoflow;
        case "snippet":
            return doc instanceof pages.Snippet;
        case "layout":
            return doc instanceof pages.Layout;
        case "buildingblock":
            return doc instanceof pages.BuildingBlock;
        default:
            return false;
    }
}
function extendedDocumentTypeMatches(doc, documentType) {
    if (documentType === "constant")
        return doc instanceof constants.Constant;
    if (documentType === "enumeration")
        return doc instanceof enumerations.Enumeration;
    return documentTypeMatches(doc, documentType);
}
function shortStructureName(stn) {
    const idx = stn.indexOf("$");
    return idx >= 0 ? stn.substring(idx + 1) : stn;
}
export async function queryModelElements(model, args) {
    const typeName = (args.typeName ?? "").trim();
    if (!typeName)
        throw new Error("Parameter 'typeName' must not be empty.");
    const maxResults = args.maxResults ?? 50;
    if (!Number.isInteger(maxResults) || maxResults < 1) {
        throw new Error("Parameter 'maxResults' must be a positive integer.");
    }
    const includeProperties = args.includeProperties === true;
    const needle = typeName.toLowerCase();
    let modules;
    if (args.moduleName) {
        modules = [findModuleOrThrow(model, args.moduleName)];
    }
    else {
        modules = userModules(model);
    }
    const wantsDomainModel = needle.includes("domainmodels$") ||
        needle.includes("entity") ||
        needle.includes("association");
    const collected = [];
    for (const mod of modules) {
        for (const doc of mod.documents) {
            const stn = doc.structureTypeName;
            if (!stn)
                continue;
            if (stn.toLowerCase().includes(needle)) {
                collected.push({
                    name: doc.name,
                    qualifiedName: doc.qualifiedName ??
                        `${mod.name}.${doc.name}`,
                    structureTypeName: stn,
                    moduleName: mod.name,
                    element: doc,
                });
            }
        }
        if (wantsDomainModel) {
            const dm = await mod.domainModel.load();
            for (const e of dm.entities) {
                const stn = e.structureTypeName;
                if (stn.toLowerCase().includes(needle)) {
                    collected.push({
                        name: e.name,
                        qualifiedName: e.qualifiedName ?? `${mod.name}.${e.name}`,
                        structureTypeName: stn,
                        moduleName: mod.name,
                        element: e,
                    });
                }
            }
            for (const a of dm.associations) {
                const stn = a.structureTypeName;
                if (stn.toLowerCase().includes(needle)) {
                    collected.push({
                        name: a.name,
                        qualifiedName: a.qualifiedName ?? `${mod.name}.${a.name}`,
                        structureTypeName: stn,
                        moduleName: mod.name,
                        element: a,
                    });
                }
            }
            for (const a of dm.crossAssociations) {
                const stn = a.structureTypeName;
                if (stn.toLowerCase().includes(needle)) {
                    collected.push({
                        name: a.name,
                        qualifiedName: a.qualifiedName ?? `${mod.name}.${a.name}`,
                        structureTypeName: stn,
                        moduleName: mod.name,
                        element: a,
                    });
                }
            }
        }
    }
    const truncated = collected.length > maxResults;
    const sliced = collected.slice(0, maxResults);
    const data = [];
    for (const c of sliced) {
        const entry = {
            name: c.name,
            qualifiedName: c.qualifiedName,
            structureTypeName: c.structureTypeName,
            moduleName: c.moduleName,
        };
        if (includeProperties) {
            const loaded = (await c.element.load());
            entry.documentation = loaded.documentation ?? null;
        }
        data.push(entry);
    }
    return {
        success: true,
        status: "success",
        message: `Found ${data.length} element(s) matching '${typeName}'`,
        truncated,
        data,
    };
}
const VALID_COPY_TYPES = new Set([
    "entity",
    "microflow",
    "constant",
    "enumeration",
]);
function findEnumerationInModule(mod, name) {
    return mod.documents.find((d) => d instanceof enumerations.Enumeration && d.name === name);
}
function findConstantInModule(mod, name) {
    return mod.documents.find((d) => d instanceof constants.Constant && d.name === name);
}
function findMicroflowInModule(mod, name) {
    return mod.documents.find((d) => d instanceof microflows.Microflow && d.name === name);
}
function copyConstantType(source, target) {
    if (source instanceof datatypes.StringType) {
        datatypes.StringType.createInConstantUnderType(target);
    }
    else if (source instanceof datatypes.IntegerType) {
        datatypes.IntegerType.createInConstantUnderType(target);
    }
    else if (source instanceof datatypes.BooleanType) {
        datatypes.BooleanType.createInConstantUnderType(target);
    }
    else if (source instanceof datatypes.DateTimeType) {
        datatypes.DateTimeType.createInConstantUnderType(target);
    }
    else if (source instanceof datatypes.DecimalType) {
        datatypes.DecimalType.createInConstantUnderType(target);
    }
    else if (source instanceof datatypes.FloatType) {
        datatypes.FloatType.createInConstantUnderType(target);
    }
    else {
        datatypes.StringType.createInConstantUnderType(target);
    }
}
function copyParameterType(source, target) {
    if (source instanceof datatypes.StringType) {
        datatypes.StringType.createInMicroflowParameterObjectUnderVariableType(target);
    }
    else if (source instanceof datatypes.IntegerType) {
        datatypes.IntegerType.createInMicroflowParameterObjectUnderVariableType(target);
    }
    else if (source instanceof datatypes.BooleanType) {
        datatypes.BooleanType.createInMicroflowParameterObjectUnderVariableType(target);
    }
    else if (source instanceof datatypes.DateTimeType) {
        datatypes.DateTimeType.createInMicroflowParameterObjectUnderVariableType(target);
    }
    else if (source instanceof datatypes.DecimalType) {
        datatypes.DecimalType.createInMicroflowParameterObjectUnderVariableType(target);
    }
    else if (source instanceof datatypes.FloatType) {
        datatypes.FloatType.createInMicroflowParameterObjectUnderVariableType(target);
    }
    else if (source instanceof datatypes.ObjectType) {
        const nt = datatypes.ObjectType.createInMicroflowParameterObjectUnderVariableType(target);
        if (source.entity)
            nt.entity = source.entity;
    }
    else if (source instanceof datatypes.ListType) {
        const nt = datatypes.ListType.createInMicroflowParameterObjectUnderVariableType(target);
        if (source.entity)
            nt.entity = source.entity;
    }
    else {
        datatypes.StringType.createInMicroflowParameterObjectUnderVariableType(target);
    }
}
function createAttributeType(attr, source) {
    if (source instanceof domainmodels.StringAttributeType) {
        const nt = domainmodels.StringAttributeType.createInAttributeUnderType(attr);
        if (typeof source.length === "number")
            nt.length = source.length;
    }
    else if (source instanceof domainmodels.IntegerAttributeType) {
        domainmodels.IntegerAttributeType.createInAttributeUnderType(attr);
    }
    else if (source instanceof domainmodels.LongAttributeType) {
        domainmodels.LongAttributeType.createInAttributeUnderType(attr);
    }
    else if (source instanceof domainmodels.DecimalAttributeType) {
        domainmodels.DecimalAttributeType.createInAttributeUnderType(attr);
    }
    else if (source instanceof domainmodels.BooleanAttributeType) {
        domainmodels.BooleanAttributeType.createInAttributeUnderType(attr);
    }
    else if (source instanceof domainmodels.DateTimeAttributeType) {
        const nt = domainmodels.DateTimeAttributeType.createInAttributeUnderType(attr);
        if (typeof source.localizeDate === "boolean")
            nt.localizeDate = source.localizeDate;
    }
    else if (source instanceof domainmodels.AutoNumberAttributeType) {
        domainmodels.AutoNumberAttributeType.createInAttributeUnderType(attr);
    }
    else if (source instanceof domainmodels.BinaryAttributeType) {
        domainmodels.BinaryAttributeType.createInAttributeUnderType(attr);
    }
    else if (source instanceof domainmodels.HashedStringAttributeType) {
        domainmodels.HashedStringAttributeType.createInAttributeUnderType(attr);
    }
    else if (source instanceof domainmodels.EnumerationAttributeType) {
        const nt = domainmodels.EnumerationAttributeType.createInAttributeUnderType(attr);
        if (source.enumeration)
            nt.enumeration = source.enumeration;
    }
    else {
        domainmodels.StringAttributeType.createInAttributeUnderType(attr);
    }
}
export async function copyModelElement(model, args) {
    const elementType = (args.elementType ?? "").trim();
    if (!VALID_COPY_TYPES.has(elementType)) {
        throw new Error("Invalid elementType. Must be one of: entity, microflow, constant, enumeration.");
    }
    const sourceName = (args.sourceName ?? "").trim();
    const newName = (args.newName ?? "").trim();
    if (!sourceName)
        throw new Error("Parameter 'sourceName' is required.");
    if (!newName)
        throw new Error("Parameter 'newName' is required.");
    // Resolve source module
    let sourceModule;
    if (args.sourceModule) {
        sourceModule = findModuleOrThrow(model, args.sourceModule);
    }
    else {
        const candidates = [];
        for (const m of userModules(model)) {
            let found = false;
            if (elementType === "entity") {
                const dm = await m.domainModel.load();
                if (dm.entities.find((e) => e.name === sourceName))
                    found = true;
            }
            else if (elementType === "microflow") {
                if (findMicroflowInModule(m, sourceName))
                    found = true;
            }
            else if (elementType === "constant") {
                if (findConstantInModule(m, sourceName))
                    found = true;
            }
            else if (elementType === "enumeration") {
                if (findEnumerationInModule(m, sourceName))
                    found = true;
            }
            if (found)
                candidates.push(m);
        }
        const cap = elementType[0].toUpperCase() + elementType.slice(1);
        if (candidates.length === 0) {
            throw new Error(`${cap} '${sourceName}' not found in working copy.`);
        }
        if (candidates.length > 1) {
            throw new Error(`'${sourceName}' found in multiple modules: ${candidates.map((m) => m.name).join(", ")}. Provide sourceModule to disambiguate.`);
        }
        sourceModule = candidates[0];
    }
    // Resolve target module
    const targetModule = args.targetModule
        ? findModuleOrThrow(model, args.targetModule)
        : sourceModule;
    // Conflict check
    const newNameClash = (() => {
        if (elementType === "entity")
            return false; // checked after dm load below
        if (elementType === "microflow")
            return !!findMicroflowInModule(targetModule, newName);
        if (elementType === "constant")
            return !!findConstantInModule(targetModule, newName);
        if (elementType === "enumeration")
            return !!findEnumerationInModule(targetModule, newName);
        return false;
    })();
    if (newNameClash) {
        throw new Error(`Element '${newName}' already exists in module '${targetModule.name}'.`);
    }
    let qualifiedName;
    let note = null;
    if (elementType === "constant") {
        const src = findConstantInModule(sourceModule, sourceName);
        if (!src)
            throw new Error(`Constant '${sourceName}' not found in working copy.`);
        const loadedSrc = await src.load();
        const newConst = constants.Constant.createIn(targetModule);
        newConst.name = newName;
        copyConstantType(loadedSrc.type, newConst);
        if (typeof loadedSrc.defaultValue === "string") {
            newConst.defaultValue = loadedSrc.defaultValue;
        }
        qualifiedName = `${targetModule.name}.${newName}`;
    }
    else if (elementType === "enumeration") {
        const src = findEnumerationInModule(sourceModule, sourceName);
        if (!src)
            throw new Error(`Enumeration '${sourceName}' not found in working copy.`);
        const loadedSrc = await src.load();
        const newEnum = enumerations.Enumeration.createIn(targetModule);
        newEnum.name = newName;
        if (loadedSrc.documentation)
            newEnum.documentation = loadedSrc.documentation;
        for (const v of loadedSrc.values) {
            const newVal = enumerations.EnumerationValue.createIn(newEnum);
            newVal.name = v.name;
            const captionTr = v.caption?.translations?.find((t) => t.languageCode === EN_US);
            const captionText = captionTr?.text ?? v.name;
            const textEl = texts.Text.createInEnumerationValueUnderCaption(newVal);
            const tr = texts.Translation.createIn(textEl);
            tr.languageCode = EN_US;
            tr.text = captionText;
        }
        qualifiedName = `${targetModule.name}.${newName}`;
    }
    else if (elementType === "entity") {
        const sourceDm = await sourceModule.domainModel.load();
        const srcEntity = sourceDm.entities.find((e) => e.name === sourceName);
        if (!srcEntity) {
            throw new Error(`Entity '${sourceName}' not found in working copy.`);
        }
        const targetDm = await targetModule.domainModel.load();
        if (targetDm.entities.find((e) => e.name === newName)) {
            throw new Error(`Element '${newName}' already exists in module '${targetModule.name}'.`);
        }
        const loadedSrc = await srcEntity.load();
        const newEntity = domainmodels.Entity.createIn(targetDm);
        newEntity.name = newName;
        for (const a of loadedSrc.attributes) {
            const newAttr = domainmodels.Attribute.createIn(newEntity);
            newAttr.name = a.name;
            if (a.type)
                createAttributeType(newAttr, a.type);
            if (a.value instanceof domainmodels.StoredValue) {
                const newSv = domainmodels.StoredValue.createIn(newAttr);
                if (typeof a.value.defaultValue === "string") {
                    newSv.defaultValue = a.value.defaultValue;
                }
            }
        }
        qualifiedName = `${targetModule.name}.${newName}`;
    }
    else {
        // microflow
        const src = findMicroflowInModule(sourceModule, sourceName);
        if (!src)
            throw new Error(`Microflow '${sourceName}' not found in working copy.`);
        const loadedSrc = await src.load();
        const newMf = microflows.Microflow.createIn(targetModule);
        newMf.name = newName;
        const newOc = microflows.MicroflowObjectCollection.createInMicroflowBaseUnderObjectCollection(newMf);
        const paramObjects = (loadedSrc.objectCollection?.objects ?? []).filter((o) => o instanceof microflows.MicroflowParameterObject);
        for (const p of paramObjects) {
            const np = microflows.MicroflowParameterObject.createIn(newOc);
            np.name = p.name;
            if (p.variableType)
                copyParameterType(p.variableType, np);
        }
        note =
            "Activities and flows are not copied. Add them manually after creation.";
        qualifiedName = `${targetModule.name}.${newName}`;
    }
    return {
        success: true,
        status: "success",
        message: `Copied ${elementType} '${sourceName}' to '${targetModule.name}.${newName}'`,
        data: {
            elementType,
            sourceName,
            sourceModule: sourceModule.name,
            newName,
            targetModule: targetModule.name,
            qualifiedName,
            note,
        },
    };
}
export async function deleteDocument(model, args) {
    const documentName = (args.documentName ?? "").trim();
    const moduleName = (args.moduleName ?? "").trim();
    if (!documentName)
        throw new Error("Parameter 'documentName' is required.");
    if (!moduleName)
        throw new Error("Parameter 'moduleName' is required.");
    const mod = findModuleOrThrow(model, moduleName);
    const docs = mod.documents.filter((d) => d.name === documentName);
    if (docs.length === 0) {
        throw new Error(`Document '${documentName}' not found in module '${moduleName}'.`);
    }
    let target;
    let resolvedTypeLabel;
    if (args.documentType) {
        const docType = args.documentType;
        target = docs.find((d) => documentTypeMatches(d, docType));
        if (!target) {
            throw new Error(`Document '${documentName}' in module '${moduleName}' is not of type '${args.documentType}'.`);
        }
        resolvedTypeLabel = args.documentType;
    }
    else {
        target = docs[0];
        resolvedTypeLabel = target.structureTypeName;
    }
    await target.load();
    target.delete();
    return {
        success: true,
        status: "success",
        message: `Deleted document '${documentName}' from module '${moduleName}'`,
        data: {
            documentName,
            moduleName,
            documentType: resolvedTypeLabel,
        },
    };
}
export async function excludeDocument(model, args) {
    const documentName = (args.documentName ?? "").trim();
    if (!documentName)
        throw new Error("Parameter 'documentName' is required.");
    const excluded = args.excluded ?? true;
    let mod;
    if (args.moduleName) {
        mod = findModuleOrThrow(model, args.moduleName);
        const docs = mod.documents.filter((d) => d.name === documentName);
        const filtered = args.documentType
            ? docs.filter((d) => documentTypeMatches(d, args.documentType))
            : docs;
        if (filtered.length === 0) {
            if (docs.length > 0 && args.documentType) {
                throw new Error(`Document '${documentName}' in module '${mod.name}' is not of type '${args.documentType}'.`);
            }
            throw new Error(`Document '${documentName}' not found in module '${mod.name}'.`);
        }
        const target = filtered[0];
        const loaded = (await target.load());
        loaded.excluded = excluded;
        return {
            success: true,
            status: "success",
            message: `Document '${documentName}' in '${mod.name}' is now ${excluded ? "excluded" : "included"}`,
            data: { documentName, moduleName: mod.name, excluded },
        };
    }
    // Search all user modules
    const candidates = [];
    for (const m of userModules(model)) {
        const docs = m.documents.filter((d) => d.name === documentName);
        const filtered = args.documentType
            ? docs.filter((d) => documentTypeMatches(d, args.documentType))
            : docs;
        if (filtered.length > 0)
            candidates.push(m);
    }
    if (candidates.length === 0) {
        throw new Error(`Document '${documentName}' not found in any module.`);
    }
    if (candidates.length > 1) {
        throw new Error(`'${documentName}' found in multiple modules: ${candidates.map((m) => m.name).join(", ")}. Provide moduleName to disambiguate.`);
    }
    mod = candidates[0];
    const docs = mod.documents.filter((d) => d.name === documentName);
    const filtered = args.documentType
        ? docs.filter((d) => documentTypeMatches(d, args.documentType))
        : docs;
    const target = filtered[0];
    const loaded = (await target.load());
    loaded.excluded = excluded;
    return {
        success: true,
        status: "success",
        message: `Document '${documentName}' in '${mod.name}' is now ${excluded ? "excluded" : "included"}`,
        data: { documentName, moduleName: mod.name, excluded },
    };
}
export async function renameDocument(model, args) {
    const rawName = (args.documentName ?? "").trim();
    const newName = (args.newName ?? "").trim();
    if (!rawName)
        throw new Error("Parameter 'documentName' is required.");
    if (!newName)
        throw new Error("Parameter 'newName' is required.");
    let parsedModule;
    let localName = rawName;
    const dotIdx = rawName.indexOf(".");
    if (dotIdx > 0) {
        parsedModule = rawName.substring(0, dotIdx);
        localName = rawName.substring(dotIdx + 1);
    }
    const moduleName = args.moduleName ?? parsedModule;
    const matches = (d) => {
        if (d.name !== localName)
            return false;
        if (!args.documentType)
            return true;
        return extendedDocumentTypeMatches(d, args.documentType);
    };
    let mod;
    let target;
    if (moduleName) {
        mod = findModuleOrThrow(model, moduleName);
        const docs = mod.documents.filter((d) => d.name === localName);
        if (docs.length === 0) {
            throw new Error(`Document '${rawName}' not found.`);
        }
        target = docs.find(matches);
        if (!target) {
            throw new Error(`Document '${rawName}' is not of type '${args.documentType}'.`);
        }
    }
    else {
        const candidates = [];
        for (const m of userModules(model)) {
            for (const d of m.documents) {
                if (matches(d))
                    candidates.push({ mod: m, doc: d });
            }
        }
        if (candidates.length === 0) {
            throw new Error(`Document '${rawName}' not found.`);
        }
        if (candidates.length > 1) {
            throw new Error(`'${rawName}' found in multiple modules: ${candidates.map((c) => c.mod.name).join(", ")}. Provide moduleName to disambiguate.`);
        }
        mod = candidates[0].mod;
        target = candidates[0].doc;
    }
    const loaded = (await target.load());
    const conflict = mod.documents.find((d) => d.name === newName && d !== target);
    if (conflict) {
        throw new Error(`Document '${newName}' already exists in module '${mod.name}'.`);
    }
    loaded.name = newName;
    return {
        success: true,
        status: "success",
        message: `Renamed '${localName}' to '${newName}' in module '${mod.name}'`,
        data: {
            oldName: localName,
            newName,
            moduleName: mod.name,
            qualifiedName: `${mod.name}.${newName}`,
            warning: "References to the old name are NOT automatically updated. Update microflow calls, page references, and navigation manually.",
        },
    };
}
const VALID_DOC_TYPES = new Set([
    "entity",
    "attribute",
    "association",
    "domain_model",
]);
export async function setDocumentation(model, args) {
    const elementType = (args.elementType ?? "").trim();
    if (!VALID_DOC_TYPES.has(elementType)) {
        throw new Error("Invalid elementType. Must be one of: entity, attribute, association, domain_model.");
    }
    if (typeof args.documentation !== "string") {
        throw new Error("Parameter 'documentation' must be a string.");
    }
    const documentation = args.documentation;
    if (elementType === "domain_model") {
        if (!args.moduleName) {
            throw new Error("Parameter 'moduleName' is required when elementType is 'domain_model'.");
        }
        const mod = findModuleOrThrow(model, args.moduleName);
        const dm = await mod.domainModel.load();
        dm.documentation = documentation;
        return {
            success: true,
            status: "success",
            message: `Documentation updated on domain_model '${mod.name}' in module '${mod.name}'`,
            data: {
                elementType,
                elementName: mod.name,
                moduleName: mod.name,
                documentation,
            },
        };
    }
    if (elementType === "entity") {
        const entityName = args.elementName ?? args.entityName;
        if (!entityName) {
            throw new Error("Parameter 'elementName' (or 'entityName') is required for elementType 'entity'.");
        }
        const { mod, dm } = await locateEntityModule(model, entityName, args.moduleName);
        const ent = dm.entities.find((e) => e.name === entityName);
        if (!ent) {
            throw new Error(`Entity '${entityName}' not found in module '${mod.name}'.`);
        }
        const loaded = await ent.load();
        loaded.documentation = documentation;
        return {
            success: true,
            status: "success",
            message: `Documentation updated on entity '${entityName}' in module '${mod.name}'`,
            data: {
                elementType,
                elementName: entityName,
                moduleName: mod.name,
                documentation,
            },
        };
    }
    if (elementType === "attribute") {
        const entityName = args.entityName;
        const attributeName = args.attributeName;
        if (!entityName || !attributeName) {
            throw new Error("Parameters 'entityName' and 'attributeName' are required for elementType 'attribute'.");
        }
        const { mod, dm } = await locateEntityModule(model, entityName, args.moduleName);
        const ent = dm.entities.find((e) => e.name === entityName);
        if (!ent) {
            throw new Error(`Entity '${entityName}' not found in module '${mod.name}'.`);
        }
        const loaded = await ent.load();
        const attr = loaded.attributes.find((a) => a.name === attributeName);
        if (!attr) {
            throw new Error(`Attribute '${attributeName}' not found on entity '${entityName}'.`);
        }
        attr.documentation = documentation;
        return {
            success: true,
            status: "success",
            message: `Documentation updated on attribute '${entityName}.${attributeName}' in module '${mod.name}'`,
            data: {
                elementType,
                elementName: `${entityName}.${attributeName}`,
                moduleName: mod.name,
                documentation,
            },
        };
    }
    // association
    const associationName = args.elementName;
    if (!associationName) {
        throw new Error("Parameter 'elementName' is required for elementType 'association'.");
    }
    let mod;
    let assoc;
    if (args.moduleName) {
        mod = findModuleOrThrow(model, args.moduleName);
        const dm = await mod.domainModel.load();
        assoc =
            dm.associations.find((a) => a.name === associationName) ??
                dm.crossAssociations.find((a) => a.name === associationName);
        if (!assoc) {
            throw new Error(`Association '${associationName}' not found in module '${mod.name}'.`);
        }
    }
    else {
        const candidates = [];
        for (const m of userModules(model)) {
            const dm = await m.domainModel.load();
            const found = dm.associations.find((a) => a.name === associationName) ??
                dm.crossAssociations.find((a) => a.name === associationName);
            if (found)
                candidates.push({ mod: m, assoc: found });
        }
        if (candidates.length === 0) {
            throw new Error(`Association '${associationName}' not found in module '<unknown>'.`);
        }
        if (candidates.length > 1) {
            throw new Error(`'${associationName}' found in multiple modules: ${candidates.map((c) => c.mod.name).join(", ")}. Provide moduleName to disambiguate.`);
        }
        mod = candidates[0].mod;
        assoc = candidates[0].assoc;
    }
    const loaded = (await assoc.load());
    loaded.documentation = documentation;
    return {
        success: true,
        status: "success",
        message: `Documentation updated on association '${associationName}' in module '${mod.name}'`,
        data: {
            elementType,
            elementName: associationName,
            moduleName: mod.name,
            documentation,
        },
    };
}
async function locateEntityModule(model, entityName, moduleName) {
    if (moduleName) {
        const mod = findModuleOrThrow(model, moduleName);
        const dm = await mod.domainModel.load();
        return { mod, dm };
    }
    const candidates = [];
    for (const m of userModules(model)) {
        const dm = await m.domainModel.load();
        if (dm.entities.find((e) => e.name === entityName)) {
            candidates.push({ mod: m, dm });
        }
    }
    if (candidates.length === 0) {
        throw new Error(`Entity '${entityName}' not found in module '<unknown>'.`);
    }
    if (candidates.length > 1) {
        throw new Error(`'${entityName}' found in multiple modules: ${candidates.map((c) => c.mod.name).join(", ")}. Provide moduleName to disambiguate.`);
    }
    return candidates[0];
}
export function validateName(args) {
    if (typeof args?.name !== "string") {
        throw new Error("Parameter 'name' is required and must be a string.");
    }
    const name = args.name;
    const autoFix = args.autoFix === true;
    let valid = true;
    let reason;
    if (name.length === 0) {
        valid = false;
        reason = "Name must not be empty.";
    }
    else if (name.length > 200) {
        valid = false;
        reason = "Name exceeds maximum length of 200 characters.";
    }
    else if (!/^[A-Za-z]/.test(name)) {
        valid = false;
        reason = "Name must start with a letter.";
    }
    else if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
        valid = false;
        reason =
            "Name contains invalid characters. Only letters, digits, and underscores are allowed.";
    }
    if (valid) {
        return {
            success: true,
            status: "success",
            message: `Name '${name}' is valid.`,
            data: { name, valid: true },
        };
    }
    if (!autoFix) {
        return {
            success: true,
            status: "success",
            message: `Name '${name}' is invalid.`,
            data: { name, valid: false, reason },
        };
    }
    let fixed = name.replace(/[^A-Za-z0-9_]/g, "_");
    if (fixed.length === 0 || /^[0-9_]/.test(fixed)) {
        fixed = "A" + fixed;
    }
    if (fixed.length > 200)
        fixed = fixed.substring(0, 200);
    return {
        success: true,
        status: "success",
        message: `Name '${name}' is invalid. Suggested fix: '${fixed}'.`,
        data: { name, valid: false, reason, fixedName: fixed },
    };
}
function collectMicroflowVariables(oc, out) {
    if (!oc)
        return;
    for (const obj of oc.objects) {
        if (obj instanceof microflows.MicroflowParameterObject) {
            if (obj.name)
                out.add(obj.name);
            continue;
        }
        if (obj instanceof microflows.LoopedActivity) {
            const src = obj.loopSource;
            if (src instanceof microflows.IterableList && src.variableName) {
                out.add(src.variableName);
            }
            collectMicroflowVariables(obj.objectCollection, out);
            continue;
        }
        if (obj instanceof microflows.ActionActivity) {
            const action = obj.action;
            if (action) {
                if (typeof action.outputVariableName === "string" && action.outputVariableName) {
                    out.add(action.outputVariableName);
                }
                if (typeof action.variableName === "string" && action.variableName) {
                    out.add(action.variableName);
                }
            }
            continue;
        }
    }
}
export async function checkVariableName(model, args) {
    const rawMfName = (args.microflowName ?? "").trim();
    const variableName = (args.variableName ?? "").trim();
    if (!rawMfName)
        throw new Error("Parameter 'microflowName' is required.");
    if (!variableName)
        throw new Error("Parameter 'variableName' is required.");
    let parsedModule;
    let localName = rawMfName;
    const dotIdx = rawMfName.indexOf(".");
    if (dotIdx > 0) {
        parsedModule = rawMfName.substring(0, dotIdx);
        localName = rawMfName.substring(dotIdx + 1);
    }
    const moduleName = args.moduleName ?? parsedModule;
    let mf;
    let modName;
    if (moduleName) {
        const mod = findModuleOrThrow(model, moduleName);
        mf = findMicroflowInModule(mod, localName);
        if (!mf) {
            throw new Error(`Microflow '${rawMfName}' not found in working copy.`);
        }
        modName = mod.name;
    }
    else {
        const candidates = [];
        for (const m of userModules(model)) {
            const found = findMicroflowInModule(m, localName);
            if (found)
                candidates.push({ mf: found, mod: m });
        }
        if (candidates.length === 0) {
            throw new Error(`Microflow '${rawMfName}' not found in working copy.`);
        }
        if (candidates.length > 1) {
            throw new Error(`'${rawMfName}' found in multiple modules: ${candidates.map((c) => c.mod.name).join(", ")}. Provide moduleName to disambiguate.`);
        }
        mf = candidates[0].mf;
        modName = candidates[0].mod.name;
    }
    const loaded = await mf.load();
    const set = new Set();
    collectMicroflowVariables(loaded.objectCollection, set);
    const existing = Array.from(set).sort();
    const qname = `${modName}.${loaded.name}`;
    const available = !set.has(variableName);
    if (available) {
        return {
            success: true,
            status: "success",
            message: `Variable '${variableName}' is available in microflow '${qname}'.`,
            data: {
                microflowName: qname,
                variableName,
                available: true,
                existingVariables: existing,
            },
        };
    }
    let suffix = 2;
    while (set.has(`${variableName}${suffix}`))
        suffix++;
    const suggestion = `${variableName}${suffix}`;
    return {
        success: true,
        status: "success",
        message: `Variable '${variableName}' is already used in microflow '${qname}'.`,
        data: {
            microflowName: qname,
            variableName,
            available: false,
            existingVariables: existing,
            suggestion,
        },
    };
}
// silence unused-import warnings for shortStructureName helper kept for future use
void shortStructureName;
//# sourceMappingURL=modelUtilities.js.map