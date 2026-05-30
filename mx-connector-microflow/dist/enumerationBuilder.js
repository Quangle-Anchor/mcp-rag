import { enumerations, texts } from "mendixmodelsdk";
import { assertNotMendixEnumReservedWord } from "./mendixReservedWords.js";
const DEFAULT_LANGUAGE = "en_US";
function setCaption(value, caption) {
    const textEl = texts.Text.createInEnumerationValueUnderCaption(value);
    const translation = texts.Translation.createIn(textEl);
    translation.languageCode = DEFAULT_LANGUAGE;
    translation.text = caption;
}
/**
 * Create an Enumeration in a given module with the supplied values (+ captions).
 *
 * If an enumeration with the same name already exists in the module, it is replaced
 * (values cleared and rebuilt) so that the tool is idempotent.
 */
export async function createEnumeration(model, args) {
    const module = model.root.modules.find((m) => m.name === args.moduleName);
    if (!module) {
        throw new Error(`Module "${args.moduleName}" not found. Available: ${model
            .root.modules.map((m) => m.name)
            .join(", ")}`);
    }
    // Pre-flight: Mendix reserved-word check for the enumeration's own name and
    // every value name. Done before any mutation so the call is transactional.
    assertNotMendixEnumReservedWord(args.enumerationName, `an enumeration name in module '${args.moduleName}'`);
    for (const input of args.values) {
        assertNotMendixEnumReservedWord(input.name, `an enumeration value name in '${args.moduleName}.${args.enumerationName}'`);
    }
    // See if an enumeration with this name already lives under the module.
    let existing = model
        .allEnumerations()
        .find((e) => e.qualifiedName === `${args.moduleName}.${args.enumerationName}`);
    let enumeration;
    let replaced = false;
    if (existing) {
        enumeration = await existing.load();
        enumeration.values.clear();
        replaced = true;
    }
    else {
        enumeration = enumerations.Enumeration.createIn(module);
        enumeration.name = args.enumerationName;
        if (args.documentation)
            enumeration.documentation = args.documentation;
    }
    for (const input of args.values) {
        const value = enumerations.EnumerationValue.createIn(enumeration);
        value.name = input.name;
        setCaption(value, input.caption ?? input.name);
    }
    return {
        moduleName: args.moduleName,
        enumerationName: args.enumerationName,
        valuesCreated: args.values.length,
        replaced,
    };
}
// ─── Helpers shared by list / update / rename ───────────────────────────────
function userModules(model) {
    return model.root.modules.filter((m) => m.fromAppStore === false);
}
function collectEnumerationsRecursive(container, out, currentFolder) {
    for (const doc of container.documents) {
        if (doc instanceof enumerations.Enumeration) {
            out.push({ doc, folder: currentFolder });
        }
    }
    for (const folder of container.folders) {
        collectEnumerationsRecursive(folder, out, folder);
    }
}
function folderQualifiedNameOf(module, folder) {
    if (!folder)
        return null;
    const segments = [folder.name];
    let current = folder.containerAsFolderBase;
    while (current && current !== module) {
        const asFolder = current;
        if (typeof asFolder.name !== "string")
            break;
        segments.unshift(asFolder.name);
        current = asFolder.containerAsFolderBase;
    }
    return [module.name, ...segments].join(".");
}
function parseQualifiedName(raw, explicitModule, fieldLabel) {
    const trimmed = raw.trim();
    const dotIdx = trimmed.indexOf(".");
    if (dotIdx <= 0) {
        return { moduleName: explicitModule, localName: trimmed };
    }
    const prefixModule = trimmed.substring(0, dotIdx);
    const localName = trimmed.substring(dotIdx + 1);
    if (explicitModule && explicitModule !== prefixModule) {
        throw new Error(`${fieldLabel} prefix '${prefixModule}' conflicts with moduleName '${explicitModule}'.`);
    }
    return { moduleName: prefixModule, localName };
}
async function locateEnumeration(model, rawName, explicitModule, argFieldLabel) {
    const { moduleName, localName } = parseQualifiedName(rawName, explicitModule, argFieldLabel);
    if (!localName) {
        throw new Error(`${argFieldLabel} is required.`);
    }
    if (moduleName) {
        const mod = model.root.modules.find((m) => m.name === moduleName);
        if (!mod) {
            throw new Error(`Module '${moduleName}' not found in working copy.`);
        }
        const bucket = [];
        collectEnumerationsRecursive(mod, bucket, null);
        const match = bucket.find((b) => b.doc.name === localName);
        if (!match) {
            throw new Error(`Enumeration '${localName}' not found in module '${mod.name}'.`);
        }
        return { module: mod, doc: match.doc };
    }
    const candidates = [];
    for (const mod of userModules(model)) {
        const bucket = [];
        collectEnumerationsRecursive(mod, bucket, null);
        for (const entry of bucket) {
            if (entry.doc.name === localName) {
                candidates.push({ module: mod, doc: entry.doc });
            }
        }
    }
    if (candidates.length === 0) {
        throw new Error(`Enumeration '${localName}' not found in any module.`);
    }
    if (candidates.length > 1) {
        const moduleNames = candidates.map((c) => c.module.name).join(", ");
        throw new Error(`'${localName}' found in multiple modules: ${moduleNames}. Provide moduleName to disambiguate.`);
    }
    return candidates[0];
}
function readCaption(value) {
    const translations = value.caption?.translations;
    if (!translations || translations.length === 0) {
        return { text: value.name, language: null };
    }
    const enUs = translations.find((t) => t.languageCode === DEFAULT_LANGUAGE);
    if (enUs)
        return { text: enUs.text, language: enUs.languageCode };
    const fallback = translations[0];
    return { text: fallback.text ?? value.name, language: fallback.languageCode };
}
export async function listEnumerations(model, args) {
    let modules;
    if (args.moduleName?.trim()) {
        const mod = model.root.modules.find((m) => m.name === args.moduleName);
        if (!mod) {
            throw new Error(`Module '${args.moduleName}' not found in working copy.`);
        }
        modules = [mod];
    }
    else {
        modules = userModules(model);
    }
    const collected = [];
    for (const mod of modules) {
        const bucket = [];
        collectEnumerationsRecursive(mod, bucket, null);
        for (const entry of bucket) {
            collected.push({ module: mod, doc: entry.doc, folder: entry.folder });
        }
    }
    const data = [];
    for (const item of collected) {
        const loaded = await item.doc.load();
        const values = [];
        for (const v of loaded.values) {
            const loadedValue = await v.load();
            const { text, language } = readCaption(loadedValue);
            values.push({
                name: loadedValue.name,
                caption: text,
                captionLanguage: language,
            });
        }
        data.push({
            name: loaded.name,
            qualifiedName: loaded.qualifiedName ?? `${item.module.name}.${loaded.name}`,
            moduleName: item.module.name,
            folderQualifiedName: folderQualifiedNameOf(item.module, item.folder),
            documentation: loaded.documentation ?? "",
            valueCount: values.length,
            values,
            remote: loaded.remoteSource !== null,
        });
    }
    data.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
    return {
        success: true,
        status: "success",
        message: `Found ${data.length} enumeration(s)`,
        data,
    };
}
export async function updateEnumeration(model, args) {
    if (!args.enumerationName?.trim()) {
        throw new Error("enumerationName is required.");
    }
    const addValues = args.addValues ?? [];
    const removeValues = args.removeValues ?? [];
    if (addValues.length === 0 && removeValues.length === 0) {
        throw new Error("At least one of addValues or removeValues must be non-empty.");
    }
    // Detect duplicate names in addValues — caller input is malformed.
    const seenAdd = new Set();
    for (const entry of addValues) {
        if (!entry.name) {
            throw new Error("addValues entry is missing 'name'.");
        }
        if (seenAdd.has(entry.name)) {
            throw new Error(`addValues contains duplicate name '${entry.name}'.`);
        }
        seenAdd.add(entry.name);
        assertNotMendixEnumReservedWord(entry.name, `an enumeration value name in '${args.enumerationName}'`);
    }
    const { module, doc } = await locateEnumeration(model, args.enumerationName, args.moduleName, "enumerationName");
    const loaded = await doc.load();
    // Process removals first so the same name can be reused in addValues.
    const removed = [];
    const notRemoved = [];
    for (const name of removeValues) {
        const target = loaded.values.find((v) => v.name === name);
        if (!target) {
            notRemoved.push(name);
            continue;
        }
        target.delete();
        removed.push(name);
    }
    // Process additions.
    const added = [];
    const notAdded = [];
    for (const entry of addValues) {
        const collision = loaded.values.find((v) => v.name === entry.name);
        if (collision) {
            notAdded.push(entry.name);
            continue;
        }
        const newValue = enumerations.EnumerationValue.createIn(loaded);
        newValue.name = entry.name;
        const textEl = texts.Text.createInEnumerationValueUnderCaption(newValue);
        const tr = texts.Translation.createIn(textEl);
        tr.languageCode = DEFAULT_LANGUAGE;
        tr.text = entry.caption ?? entry.name;
        added.push(entry.name);
    }
    const finalValues = [];
    for (const v of loaded.values) {
        const loadedValue = await v.load();
        const { text } = readCaption(loadedValue);
        finalValues.push({ name: loadedValue.name, caption: text });
    }
    const qualifiedName = loaded.qualifiedName ?? `${module.name}.${loaded.name}`;
    return {
        success: true,
        status: "success",
        message: `Updated enumeration '${qualifiedName}' — added ${added.length}, removed ${removed.length}`,
        data: {
            qualifiedName,
            moduleName: module.name,
            enumerationName: loaded.name,
            added,
            removed,
            notAdded,
            notRemoved,
            finalValues,
        },
    };
}
// ─── Tool 60: rename_enumeration_value ──────────────────────────────────────
const VALUE_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
export async function renameEnumerationValue(model, args) {
    if (!args.enumerationName?.trim()) {
        throw new Error("enumerationName is required.");
    }
    const valueName = (args.valueName ?? "").trim();
    const newName = (args.newName ?? "").trim();
    if (!valueName)
        throw new Error("valueName is required.");
    if (!newName)
        throw new Error("newName is required.");
    if (valueName === newName) {
        throw new Error("newName must differ from valueName.");
    }
    if (newName.length > 200) {
        throw new Error(`'${newName}' is not a valid enumeration value name: exceeds maximum length of 200 characters.`);
    }
    if (!VALUE_NAME_RE.test(newName)) {
        throw new Error(`'${newName}' is not a valid enumeration value name: must start with a letter and contain only letters, digits, or underscores.`);
    }
    assertNotMendixEnumReservedWord(newName, `an enumeration value name in '${args.enumerationName}'`);
    const { module, doc } = await locateEnumeration(model, args.enumerationName, args.moduleName, "enumerationName");
    const loaded = await doc.load();
    const qualifiedName = loaded.qualifiedName ?? `${module.name}.${loaded.name}`;
    const target = loaded.values.find((v) => v.name === valueName);
    if (!target) {
        throw new Error(`Value '${valueName}' not found in enumeration '${qualifiedName}'.`);
    }
    if (loaded.values.some((v) => v.name === newName)) {
        throw new Error(`Value '${newName}' already exists in enumeration '${qualifiedName}'.`);
    }
    const loadedValue = await target.load();
    const { text: caption } = readCaption(loadedValue);
    loadedValue.name = newName;
    return {
        success: true,
        status: "success",
        message: `Renamed '${qualifiedName}.${valueName}' to '${qualifiedName}.${newName}'`,
        data: {
            enumerationQualifiedName: qualifiedName,
            moduleName: module.name,
            oldName: valueName,
            newName,
            oldQualifiedName: `${qualifiedName}.${valueName}`,
            newQualifiedName: `${qualifiedName}.${newName}`,
            caption,
            warning: "References to the old value are NOT automatically updated. Search microflow expressions, page conditions, and stored entity values for the old qualified name.",
        },
    };
}
//# sourceMappingURL=enumerationBuilder.js.map