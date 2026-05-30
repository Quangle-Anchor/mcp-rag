import { domainmodels } from "mendixmodelsdk";
export interface EnumValueValidationOptions {
    /** When true, rewrite `'VALUE'` → `Module.Enum.VALUE` instead of throwing.
     *  An unknown value name still throws (we don't silently invent constants). */
    autoTranslate?: boolean;
}
export interface EnumValueValidationResult {
    /** The (possibly rewritten) expression value. */
    value: string;
    /** Populated only when auto-translate rewrote the value. */
    warning?: string;
}
/**
 * Validate an expression value being written into a slot whose target type is
 * `attribute.type`. Non-enum slots and non-literal values pass through
 * unchanged. Enum slots receiving `'X'` either throw (default) or get rewritten
 * to `Module.Enum.X` (opt-in).
 */
export declare function validateEnumLiteral(value: string, attribute: domainmodels.IAttribute, context: string, options?: EnumValueValidationOptions): Promise<EnumValueValidationResult>;
/**
 * Variant for slots whose target type is an enumeration declared on a microflow
 * parameter or variable (not an entity attribute). Same logic, different input
 * shape — we accept the enum's qualified name directly. Used by CreateVariable
 * with `variableType.type === "Enumeration"` and by CallMicroflow when the
 * target parameter is enum-typed.
 */
export declare function validateEnumLiteralByEnumQN(value: string, enumQualifiedName: string, context: string, options?: EnumValueValidationOptions, loadValues?: () => Promise<string[]>): Promise<EnumValueValidationResult>;
