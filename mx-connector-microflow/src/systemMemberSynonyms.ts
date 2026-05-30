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

interface SynonymRule {
  flag: string;
  builtIn: string;
  pattern: RegExp;
}

const ATTRIBUTE_SYNONYMS: SynonymRule[] = [
  {
    flag: "hasCreatedDate",
    builtIn: "createdDate",
    // Matches: CreatedAt, CreatedOn, CreatedDate, CreatedTime, CreateDate,
    // DateCreated, CreationDate (and underscored/spaced variants).
    pattern:
      /^(?:created|create|creation)[\s_-]*(?:date|on|at|time)?$|^date[\s_-]*(?:created|of[\s_-]*creation)$/i,
  },
  {
    flag: "hasChangedDate",
    builtIn: "changedDate",
    // Matches: ChangedAt/ModifiedAt/UpdatedAt, ModifiedDate, LastModified,
    // LastUpdated, LastChanged, DateModified, etc.
    pattern:
      /^(?:changed|modified|updated|last[\s_-]*(?:modified|updated|changed))[\s_-]*(?:date|on|at|time)?$|^date[\s_-]*(?:changed|modified|updated)$/i,
  },
];

const ASSOCIATION_SYNONYMS: SynonymRule[] = [
  {
    flag: "hasOwner",
    builtIn: "System.owner",
    // Matches `Owner`, `CreatedBy`, `Creator`, `Author`, and any Mendix-style
    // `Parent_Owner` / `Parent_CreatedBy` where the trailing segment satisfies
    // the pattern. The leading `(^|_)` anchors handle both bare names and the
    // `Parent_Child` association convention.
    pattern: /(^|_)(?:owner|created[\s_-]*by|creator|author)$/i,
  },
  {
    flag: "hasChangedBy",
    builtIn: "System.changedBy",
    pattern:
      /(^|_)(?:changed[\s_-]*by|modified[\s_-]*by|updated[\s_-]*by|last[\s_-]*edited[\s_-]*by)$/i,
  },
];

/**
 * Qualified names that are recognized as the "user" entity for ownership/audit
 * associations. We keep this to a literal list because walking generalization
 * chains at warning time is expensive and over-eager — a domain `Employee`
 * entity that *transitively* generalizes from `System.User` may legitimately
 * also have a separate `Owner` association distinct from the system member.
 */
const USER_LIKE_QNAMES: ReadonlySet<string> = new Set([
  "System.User",
  "Administration.Account",
]);

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
export function detectAttributeSynonym(
  attributeName: string,
  attributeType: string
): AttributeSynonymHit | null {
  if (attributeType !== "DateTime" && attributeType !== "String") return null;
  for (const rule of ATTRIBUTE_SYNONYMS) {
    if (rule.pattern.test(attributeName)) {
      return {
        flag: rule.flag as AttributeSynonymHit["flag"],
        builtIn: rule.builtIn as AttributeSynonymHit["builtIn"],
      };
    }
  }
  return null;
}

/**
 * Return the matched system-member rule if `associationName` resembles an
 * ownership/audit association AND its target entity qualified name is one of
 * the recognized user-like entities (`System.User`, `Administration.Account`),
 * otherwise null.
 */
export function detectAssociationSynonym(
  associationName: string,
  targetEntityQualifiedName: string
): AssociationSynonymHit | null {
  if (!USER_LIKE_QNAMES.has(targetEntityQualifiedName)) return null;
  for (const rule of ASSOCIATION_SYNONYMS) {
    if (rule.pattern.test(associationName)) {
      return {
        flag: rule.flag as AssociationSynonymHit["flag"],
        builtIn: rule.builtIn as AssociationSynonymHit["builtIn"],
      };
    }
  }
  return null;
}

export function buildAttributeSynonymWarning(
  hit: AttributeSynonymHit,
  attributeName: string,
  entityQualifiedName: string,
  attributeType: string
): string {
  return (
    `Attribute '${attributeName}' (${attributeType}) on '${entityQualifiedName}' ` +
    `looks like Mendix's built-in '${hit.builtIn}' system member. ` +
    `Prefer: set ${hit.flag}=true on the entity instead of creating this attribute — ` +
    `Mendix manages '${hit.builtIn}' automatically (no microflow, no consistency error on project load). ` +
    `If you intentionally need a separate column distinct from the built-in, choose a different name (e.g. 'ImportedAt'). ` +
    `See specs/rules/system_members.md.`
  );
}

export function buildAssociationSynonymWarning(
  hit: AssociationSynonymHit,
  associationName: string,
  parentEntityQualifiedName: string,
  targetEntityQualifiedName: string
): string {
  return (
    `Association '${associationName}' from '${parentEntityQualifiedName}' to '${targetEntityQualifiedName}' ` +
    `looks like Mendix's built-in '${hit.builtIn}' system member. ` +
    `Prefer: set ${hit.flag}=true on '${parentEntityQualifiedName}' instead of creating this association — ` +
    `Mendix manages '${hit.builtIn}' automatically. ` +
    `If this association represents a different domain role (assignee, reviewer, approver, …), rename it accordingly. ` +
    `See specs/rules/system_members.md.`
  );
}

// ─── Association name/slot mismatch (defect/association-name-slot-mismatch) ─

const PASCAL_TOKEN_RE = /^[A-Z][A-Za-z0-9]*$/;

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
export function detectAssociationNameSlotMismatch(
  associationName: string,
  parentLocalName: string,
  childLocalName: string
): "reversed" | null {
  const parts = associationName.split("_");
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (!PASCAL_TOKEN_RE.test(a) || !PASCAL_TOKEN_RE.test(b)) return null;
  if (a === childLocalName && b === parentLocalName) return "reversed";
  return null;
}

export function buildAssociationNameSlotMismatchWarning(
  associationName: string,
  parentEntityQualifiedName: string,
  childEntityQualifiedName: string
): string {
  const [aToken, bToken] = associationName.split("_");
  return (
    `Association '${associationName}': name implies parent=${aToken}, child=${bToken}, ` +
    `but slots are parent=${parentEntityQualifiedName}, child=${childEntityQualifiedName}. ` +
    `In Mendix the 'parent' slot is the FK holder ([*] side / owner). Did you mean to swap them? ` +
    `See specs/rules/association_parent_child.md.`
  );
}
