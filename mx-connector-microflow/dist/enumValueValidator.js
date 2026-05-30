// Validator for the "enum value as string-literal" defect described in
// docs/enum_value_in_expression_defect.md. Planner-facing rationale lives in
// specs/rules/enum_value_in_expression.md.
//
// In Mendix expression strings (NOT XPath), an enum value is referenced as
// `Module.Enum.VALUE`, not as the bare-quoted string `'VALUE'`. The SDK
// stores expression values verbatim, so the wrong form commits cleanly and
// only fails at Studio Pro's consistency check or at runtime with a type
// mismatch ("String, but Enumeration was expected").
//
// This helper detects the mistake at write time. Default behaviour: throw.
// Opt-in via `{ autoTranslate: true }`: rewrite `'VALUE'` → `Module.Enum.VALUE`
// and return a warning. The caller is responsible for surfacing the warning
// to the user.
import { domainmodels } from "mendixmodelsdk";
const STRING_LITERAL_RE = /^'([A-Za-z_][A-Za-z0-9_]*)'$/;
/**
 * Validate an expression value being written into a slot whose target type is
 * `attribute.type`. Non-enum slots and non-literal values pass through
 * unchanged. Enum slots receiving `'X'` either throw (default) or get rewritten
 * to `Module.Enum.X` (opt-in).
 */
export async function validateEnumLiteral(value, attribute, context, options = {}) {
    const type = attribute.type;
    if (!(type instanceof domainmodels.EnumerationAttributeType)) {
        return { value };
    }
    const m = STRING_LITERAL_RE.exec(value);
    if (!m) {
        return { value };
    }
    const bareName = m[1];
    const enumRef = type.enumeration;
    const enumQN = enumRef?.qualifiedName ?? "<unknown enum>";
    const attrQN = attribute.qualifiedName ?? "<unknown attr>";
    if (options.autoTranslate) {
        if (!enumRef) {
            throw new Error(`[${context}] auto-translate: cannot resolve enumeration for attribute ${attrQN}.`);
        }
        const loaded = await enumRef.load();
        const isValidValue = loaded.values.some((v) => v.name === bareName);
        if (!isValidValue) {
            const known = loaded.values.map((v) => v.name).join(", ");
            throw new Error(`[${context}] auto-translate: '${bareName}' is not a value of enum ${enumQN}. ` +
                `Valid values: ${known}.`);
        }
        return {
            value: `${enumQN}.${bareName}`,
            warning: `[${context}] Auto-translated '${bareName}' → ${enumQN}.${bareName} ` +
                `for enum attribute ${attrQN}.`,
        };
    }
    throw new Error(`[${context}] value ${value} for enum attribute ${attrQN} must be the FQN ` +
        `constant ${enumQN}.${bareName}, not a string literal. ` +
        `See docs/enum_value_in_expression_defect.md and ` +
        `specs/rules/enum_value_in_expression.md.`);
}
/**
 * Variant for slots whose target type is an enumeration declared on a microflow
 * parameter or variable (not an entity attribute). Same logic, different input
 * shape — we accept the enum's qualified name directly. Used by CreateVariable
 * with `variableType.type === "Enumeration"` and by CallMicroflow when the
 * target parameter is enum-typed.
 */
export async function validateEnumLiteralByEnumQN(value, enumQualifiedName, context, options = {}, loadValues) {
    const m = STRING_LITERAL_RE.exec(value);
    if (!m)
        return { value };
    const bareName = m[1];
    if (options.autoTranslate) {
        if (!loadValues) {
            throw new Error(`[${context}] auto-translate: no value loader provided for ${enumQualifiedName}.`);
        }
        const values = await loadValues();
        if (!values.includes(bareName)) {
            throw new Error(`[${context}] auto-translate: '${bareName}' is not a value of enum ${enumQualifiedName}. ` +
                `Valid values: ${values.join(", ")}.`);
        }
        return {
            value: `${enumQualifiedName}.${bareName}`,
            warning: `[${context}] Auto-translated '${bareName}' → ${enumQualifiedName}.${bareName}.`,
        };
    }
    throw new Error(`[${context}] value ${value} for enum-typed slot must be the FQN constant ` +
        `${enumQualifiedName}.${bareName}, not a string literal. ` +
        `See docs/enum_value_in_expression_defect.md and ` +
        `specs/rules/enum_value_in_expression.md.`);
}
//# sourceMappingURL=enumValueValidator.js.map