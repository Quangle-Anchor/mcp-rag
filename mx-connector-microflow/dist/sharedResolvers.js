/**
 * Shared lookup helpers for cross-module references in domain-model and attribute
 * builders.
 *
 * Three non-obvious behaviours these helpers fix once, centrally:
 *
 *  1. Enumeration name resolution — when an enum named `X` exists in more than
 *     one module, the original `allEnumerations().find(e => e.qualifiedName === qname
 *     || e.name === name)` matched whichever appeared first in iteration order, so
 *     an explicit `enumerationModule` qualifier could silently lose to a same-named
 *     enum elsewhere. `resolveEnumerationReference` is strict when a module
 *     qualifier is supplied (either via the dedicated argument or as a `Module.Enum`
 *     dot-form inside the name itself).
 *
 *  2. Generalization parent resolution — `model.findEntityByQualifiedName` only
 *     resolves entities whose owning module has been loaded into the working copy.
 *     Lazy marketplace modules stay unloaded until something touches them.
 *     `resolveEntityByFqn` eager-loads the owning module first.
 *
 *  3. **System.* generalization parents.** `mendixmodelsdk ^4.110` deliberately
 *     does NOT expose the System module (`allModules()`, `findModuleByQualifiedName`,
 *     `findEntityByQualifiedName` all return null/empty for `System.*`). System
 *     types ship with Studio Pro / the runtime and live in a separate "system
 *     project" the Platform SDK never loads — see the `isSystemProject` flag on
 *     `Project` in `gen/projects.js`. The user-facing consequence is that the
 *     typed setter `gen.generalization = parentEntity` cannot be used because we
 *     have no `IEntity` reference to assign.
 *
 *     Workaround (per https://www.mendix.com/blog/a-mendix-sdk-primer-part-2/):
 *     bypass the by-name reference's validation and write the raw qualified
 *     name directly into the underlying `ByNameReferenceProperty`. The typed
 *     setter calls `checkElementIsByNameReferrable(newValue, …)` which requires
 *     `_isAttached && _getQualifiedName() !== null` on the target — both fail
 *     for System entities. `updateWithRawValue("System.X")` skips the check.
 *     Studio Pro and the runtime resolve the qname at load time because they
 *     DO have access to the System module. This is what Studio Pro itself does
 *     under the hood.
 *
 *     A small allow-list (KNOWN_SYSTEM_PARENT_ENTITIES) protects against typos
 *     like `System.FileDocoment` — those would commit successfully but break
 *     Studio Pro at load with a "Broken reference" error that is annoying to
 *     diagnose.
 */
import { domainmodels, enumerations, } from "mendixmodelsdk";
/**
 * Allow-list of System-module entities that are valid generalization parents.
 *
 * Studio Pro exposes a handful of concrete System entities as canonical
 * "extends" targets. They are pre-defined in the metamodel and shipped with
 * the runtime — their qualified names are stable across Mendix versions.
 *
 * Keep this list narrow on purpose: an unknown `System.*` name passes through
 * the raw-write workaround and commits to the working copy, but Studio Pro
 * will refuse to load the project with a broken-reference error that is hard
 * to attribute. The allow-list converts that delayed failure into an
 * immediate, descriptive throw at build time.
 *
 * Add to this list when Mendix introduces a new specialization-eligible
 * System entity (e.g. a future `System.WorkflowTask`). User-defined
 * specializations of `System.User` typically go through `Administration.Account`,
 * but `System.User` is listed for completeness.
 */
export const KNOWN_SYSTEM_PARENT_ENTITIES = [
    "System.FileDocument",
    "System.Image",
    "System.User",
];
/**
 * Locate an enumeration by short or fully-qualified name.
 *
 *  - `enumerationName: "Module.Enum"` → treated as FQN (the dot-form takes
 *    precedence over a separate `enumerationModule` arg).
 *  - `enumerationName: "Enum"` + `enumerationModule: "Module"` → strict FQN match.
 *  - `enumerationName: "Enum"` alone → fallback (1) the entity's own module if
 *    `fallbackMod` is supplied, then (2) project-wide short-name match. The
 *    fallback path is only used when no qualifier is in play; it never overrides
 *    an explicit module.
 *
 * Throws with the list of available enumerations if not found.
 */
export function resolveEnumerationReference(model, enumerationName, enumerationModule, fallbackMod) {
    let modName = enumerationModule;
    let shortName = enumerationName;
    const dotIdx = enumerationName.indexOf(".");
    if (dotIdx > 0) {
        // FQN supplied inside enumerationName — split it.
        modName = enumerationName.slice(0, dotIdx);
        shortName = enumerationName.slice(dotIdx + 1);
    }
    const isQualified = Boolean(modName);
    const qname = isQualified ? `${modName}.${shortName}` : shortName;
    let found;
    if (isQualified) {
        found = model.allEnumerations().find((e) => e.qualifiedName === qname);
    }
    else if (fallbackMod) {
        found = fallbackMod.documents.find((d) => d instanceof enumerations.Enumeration && d.name === shortName);
        if (!found) {
            // Only when no fallback module match: try project-wide short-name match.
            found = model.allEnumerations().find((e) => e.name === shortName);
        }
    }
    else {
        found = model.allEnumerations().find((e) => e.name === shortName);
    }
    if (!found) {
        const available = model
            .allEnumerations()
            .map((e) => e.qualifiedName)
            .join(", ");
        throw new Error(`Enumeration '${qname}' not found. Available: ${available}.`);
    }
    return found;
}
/**
 * Pre-flight validation for a generalization parent FQN. Throws if the FQN is
 * malformed, the owning module is missing, or the entity does not exist within
 * it. For `System.*` parents it consults `KNOWN_SYSTEM_PARENT_ENTITIES` instead
 * of attempting an SDK lookup (which would always return null — see header
 * doc).
 *
 * Call this from the pre-flight phase before any mutation. The actual write is
 * done by `applyGeneralization`.
 */
export async function validateGeneralizationParent(model, parentFqn) {
    const dot = parentFqn.indexOf(".");
    if (dot <= 0 || dot === parentFqn.length - 1) {
        throw new Error(`Expected fully qualified entity name 'Module.Entity', got '${parentFqn}'.`);
    }
    const moduleName = parentFqn.slice(0, dot);
    if (moduleName === "System") {
        if (!KNOWN_SYSTEM_PARENT_ENTITIES.includes(parentFqn)) {
            throw new Error(`Unknown System.* parent '${parentFqn}'. The mendixmodelsdk does not expose the System module, so we maintain an allow-list of valid parents: ${KNOWN_SYSTEM_PARENT_ENTITIES.join(", ")}. ` +
                `If you need to specialize a different System entity (e.g. a future Mendix version added one), update KNOWN_SYSTEM_PARENT_ENTITIES in sharedResolvers.ts.`);
        }
        return;
    }
    await resolveEntityByFqn(model, parentFqn);
}
/**
 * Locate an entity by its fully qualified name (`Module.Entity`). Eager-loads
 * the owning module first so lazy marketplace modules resolve correctly.
 *
 * NOTE: This function does NOT handle `System.*` parents — those need the
 * raw-write workaround in `applyGeneralization`. Callers that want to support
 * System parents should use `applyGeneralization` (for writes) and
 * `validateGeneralizationParent` (for pre-flight checks) instead of calling
 * this directly.
 *
 * Throws if the FQN is malformed, the module is missing, or the entity does
 * not exist within it.
 */
export async function resolveEntityByFqn(model, qname) {
    const dot = qname.indexOf(".");
    if (dot <= 0 || dot === qname.length - 1) {
        throw new Error(`Expected fully qualified entity name 'Module.Entity', got '${qname}'.`);
    }
    const moduleName = qname.slice(0, dot);
    const mod = model.allModules().find((m) => m.name === moduleName);
    if (mod) {
        // Force the domain model to load so findEntityByQualifiedName below can see
        // entities in lazy marketplace modules.
        await mod.domainModel.load();
    }
    const found = model.findEntityByQualifiedName(qname);
    if (!found) {
        const isSystem = moduleName === "System";
        const hint = isSystem
            ? ` Note: the System module is not exposed by mendixmodelsdk — call applyGeneralization() / validateGeneralizationParent() instead of resolveEntityByFqn() for ${moduleName}.* parents.`
            : "";
        throw new Error(`Parent entity '${qname}' not found. Pass a fully qualified name (e.g. 'Administration.Account') of an entity that already exists in the model.${hint}`);
    }
    return found;
}
/**
 * Attach a Generalization to the child entity, parenting it on `parentFqn`.
 *
 *  - For user / marketplace / Administration modules: resolves the parent via
 *    `resolveEntityByFqn` and uses the typed setter
 *    `gen.generalization = parent`.
 *  - For `System.*` parents: creates the Generalization element, then writes
 *    the qname directly into the underlying `ByNameReferenceProperty` via
 *    `updateWithRawValue`, bypassing the SDK's reference validation. The
 *    Mendix runtime resolves the qname at load time. See header doc for the
 *    full rationale and SDK-primer reference.
 *
 * Returns the canonical qualified name of the parent (the one that ends up in
 * the working copy), useful for callers building their response payload.
 *
 * Pre-flight callers should still run `validateGeneralizationParent(model,
 * parentFqn)` before any mutation; this function will redo the check, but the
 * pre-flight call ensures no entity is created with a bad parent FQN.
 */
export async function applyGeneralization(model, childEntity, parentFqn) {
    const dot = parentFqn.indexOf(".");
    if (dot <= 0 || dot === parentFqn.length - 1) {
        throw new Error(`Expected fully qualified entity name 'Module.Entity', got '${parentFqn}'.`);
    }
    const moduleName = parentFqn.slice(0, dot);
    const childMutable = childEntity;
    if (moduleName === "System") {
        if (!KNOWN_SYSTEM_PARENT_ENTITIES.includes(parentFqn)) {
            throw new Error(`Unknown System.* parent '${parentFqn}'. Allowed: ${KNOWN_SYSTEM_PARENT_ENTITIES.join(", ")}. If a new Mendix version adds another, update KNOWN_SYSTEM_PARENT_ENTITIES in sharedResolvers.ts.`);
        }
        const gen = domainmodels.Generalization.createIn(childMutable);
        // The ByNameReferenceProperty workaround. The typed setter would call
        // checkElementIsByNameReferrable() which requires _isAttached on the
        // target — System entities aren't attached to the user model. Writing the
        // raw qname is what Studio Pro itself does under the hood.
        const genAny = gen;
        genAny.__generalization.updateWithRawValue(parentFqn);
        return { parentQualifiedName: parentFqn };
    }
    const parent = await resolveEntityByFqn(model, parentFqn);
    const gen = domainmodels.Generalization.createIn(childMutable);
    gen.generalization = parent;
    return { parentQualifiedName: parent.qualifiedName ?? parentFqn };
}
//# sourceMappingURL=sharedResolvers.js.map