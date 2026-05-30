/**
 * Mendix reserved words for enumeration names and enumeration value names.
 *
 * Source: https://docs.mendix.com/refguide/enumerations/
 *
 * Mendix added `com` to this list in Studio Pro 11.2 (release notes:
 * https://docs.mendix.com/releasenotes/studio-pro/11.2/) after an
 * enumeration value or caption set to `com` was found to cause a compilation
 * error. The list is maintained by the Mendix platform and may grow on minor
 * upgrades — keep this constant aligned when bumping `mendixmodelsdk`.
 *
 * Scope: the Mendix documentation lists these words specifically as reserved
 * for **enumeration names and enumeration value names** ("The name cannot be
 * a reserved word"). Per the docs the same list is NOT applied to attribute
 * names, entity names, or module names — those use the separate
 * `RESERVED_ATTRIBUTE_NAMES` list in `entityBuilder.ts`. If a future Mendix
 * release extends the scope, widen the call sites that use
 * `assertNotMendixEnumReservedWord` accordingly.
 *
 * Casing: the comparison is case-insensitive. The docs do not explicitly call
 * this out, but the offending identifiers (`COM` / `com` / `Com`) all collide
 * with the same internal token at compile time. The canonical casing in the
 * docs is preserved in this list for diagnostic output.
 */
export const MENDIX_ENUM_RESERVED_WORDS = [
    "_",
    "abstract",
    "assert",
    "boolean",
    "break",
    "byte",
    "case",
    "catch",
    "changedby",
    "changeddate",
    "char",
    "class",
    "com",
    "con",
    "const",
    "context",
    "continue",
    "createddate",
    "currentUser",
    "default",
    "do",
    "double",
    "else",
    "empty",
    "enum",
    "extends",
    "false",
    "final",
    "finally",
    "float",
    "for",
    "goto",
    "guid",
    "id",
    "if",
    "implements",
    "import",
    "instanceof",
    "int",
    "interface",
    "long",
    "MendixObject",
    "native",
    "new",
    "null",
    "object",
    "owner",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "short",
    "static",
    "strictfp",
    "submetaobjectname",
    "super",
    "switch",
    "synchronized",
    "this",
    "throw",
    "throws",
    "transient",
    "true",
    "try",
    "type",
    "void",
    "volatile",
    "while",
];
const lookup = new Set(MENDIX_ENUM_RESERVED_WORDS.map((w) => w.toLowerCase()));
export function isMendixEnumReservedWord(name) {
    if (!name)
        return false;
    return lookup.has(name.toLowerCase());
}
export function assertNotMendixEnumReservedWord(name, context) {
    if (isMendixEnumReservedWord(name)) {
        throw new Error(`'${name}' is a Mendix reserved word and cannot be used as ${context} ` +
            `(case-insensitive match). Source: https://docs.mendix.com/refguide/enumerations/. ` +
            `Pick a different identifier — e.g. append a suffix like '_VAL' or use a longer descriptive name.`);
    }
}
//# sourceMappingURL=mendixReservedWords.js.map