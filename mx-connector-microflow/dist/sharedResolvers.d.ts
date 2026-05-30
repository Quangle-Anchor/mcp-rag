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
import { IModel, domainmodels, enumerations, projects } from "mendixmodelsdk";
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
export declare const KNOWN_SYSTEM_PARENT_ENTITIES: readonly ["System.FileDocument", "System.Image", "System.User"];
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
export declare function resolveEnumerationReference(model: IModel, enumerationName: string, enumerationModule?: string, fallbackMod?: projects.IModule): enumerations.IEnumeration;
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
export declare function validateGeneralizationParent(model: IModel, parentFqn: string): Promise<void>;
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
export declare function resolveEntityByFqn(model: IModel, qname: string): Promise<domainmodels.IEntity>;
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
export declare function applyGeneralization(model: IModel, childEntity: domainmodels.IEntity, parentFqn: string): Promise<{
    parentQualifiedName: string;
}>;
