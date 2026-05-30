/**
 * Soft-warning helpers shared by the three association builders. Two concerns
 * live here:
 *
 *   1. System-member synonym detection — attribute/association names that look
 *      like Mendix's four built-in system members (`createdDate`, `changedDate`,
 *      `System.owner`, `System.changedBy`). The warning recommends the equivalent
 *      `hasCreatedDate` / `hasChangedDate` / `hasOwner` / `hasChangedBy` flag.
 *      Planner-facing doc: `specs/rules/system_members.md`.
 *
 *   2. Association name/slot mismatch detection — an association whose
 *      `<PascalA>_<PascalB>` name is the exact reverse of the resolved
 *      `parentEntity`/`childEntity` slots (the silent-broken-model defect from
 *      `defect_reports/Closed/association-name-slot-mismatch.md`).
 *      Planner-facing doc: `specs/rules/association_parent_child.md`.
 *
 * Hard reserved-name enforcement (exact `id`/`createdDate`/`changedDate`/`owner`/
 * `changedBy` collisions) lives in `entityBuilder.ts`'s `assertNotReservedAttributeName`.
 * This module is purely advisory — it returns warning strings that callers append
 * to their tool response.
 */
export interface AttributeSynonymHit {
    flag: "hasCreatedDate" | "hasChangedDate";
    builtIn: "createdDate" | "changedDate";
}
export interface AssociationSynonymHit {
    flag: "hasOwner" | "hasChangedBy";
    builtIn: "System.owner" | "System.changedBy";
}
/**
 * Return the matched system-member rule if `attributeName` resembles a
 * Mendix `createdDate` / `changedDate` system attribute, otherwise null.
 *
 * Only fires for `DateTime` (the type of the actual built-ins) and `String`
 * (some callers store dates as strings) to avoid spamming on, e.g., a
 * numeric `CreatedRev` revision counter.
 */
export declare function detectAttributeSynonym(attributeName: string, attributeType: string): AttributeSynonymHit | null;
/**
 * Return the matched system-member rule if `associationName` resembles an
 * ownership/audit association AND its target entity qualified name is one of
 * the recognized user-like entities (`System.User`, `Administration.Account`),
 * otherwise null.
 */
export declare function detectAssociationSynonym(associationName: string, targetEntityQualifiedName: string): AssociationSynonymHit | null;
export declare function buildAttributeSynonymWarning(hit: AttributeSynonymHit, attributeName: string, entityQualifiedName: string, attributeType: string): string;
export declare function buildAssociationSynonymWarning(hit: AssociationSynonymHit, associationName: string, parentEntityQualifiedName: string, targetEntityQualifiedName: string): string;
/**
 * Return `"reversed"` iff `associationName` matches `<PascalA>_<PascalB>` AND
 * the tokens are the *exact reverse* of `[parentLocalName, childLocalName]` —
 * i.e. the caller named the association per the convention but swapped which
 * entity goes into the SDK `parent` vs `child` slot.
 *
 * Returns `null` for:
 *   - names that don't split cleanly into two PascalCase tokens (custom name,
 *     out of scope)
 *   - tokens that match the slots in the correct order (no mistake)
 *   - tokens where neither matches either entity (deliberately custom name)
 *   - tokens where only one matches (ambiguous; not the reversal failure mode)
 *
 * The narrow contract is deliberate: this catches the specific defect of
 * `Employee_Department` with `parentEntity=Department, childEntity=Employee`,
 * which silently inverts cardinality. See `specs/rules/association_parent_child.md`.
 */
export declare function detectAssociationNameSlotMismatch(associationName: string, parentLocalName: string, childLocalName: string): "reversed" | null;
export declare function buildAssociationNameSlotMismatchWarning(associationName: string, parentEntityQualifiedName: string, childEntityQualifiedName: string): string;
