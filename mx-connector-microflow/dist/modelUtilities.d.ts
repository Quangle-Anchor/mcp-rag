import { IModel } from "mendixmodelsdk";
import type { QueryModelElementsArgs, CopyModelElementArgs, DeleteDocumentArgs, ExcludeDocumentArgs, RenameDocumentArgs, SetDocumentationArgs, ValidateNameArgs, CheckVariableNameArgs } from "./types.js";
export interface QueryModelElementsResult {
    success: true;
    status: "success";
    message: string;
    truncated: boolean;
    data: Array<{
        name: string;
        qualifiedName: string;
        structureTypeName: string;
        moduleName: string;
        documentation?: string | null;
    }>;
}
export declare function queryModelElements(model: IModel, args: QueryModelElementsArgs): Promise<QueryModelElementsResult>;
export interface CopyModelElementResult {
    success: true;
    status: "success";
    message: string;
    data: {
        elementType: string;
        sourceName: string;
        sourceModule: string;
        newName: string;
        targetModule: string;
        qualifiedName: string;
        note: string | null;
    };
}
export declare function copyModelElement(model: IModel, args: CopyModelElementArgs): Promise<CopyModelElementResult>;
export interface DeleteDocumentResult {
    success: true;
    status: "success";
    message: string;
    data: {
        documentName: string;
        moduleName: string;
        documentType: string;
    };
}
export declare function deleteDocument(model: IModel, args: DeleteDocumentArgs): Promise<DeleteDocumentResult>;
export interface ExcludeDocumentResult {
    success: true;
    status: "success";
    message: string;
    data: {
        documentName: string;
        moduleName: string;
        excluded: boolean;
    };
}
export declare function excludeDocument(model: IModel, args: ExcludeDocumentArgs): Promise<ExcludeDocumentResult>;
export interface RenameDocumentResult {
    success: true;
    status: "success";
    message: string;
    data: {
        oldName: string;
        newName: string;
        moduleName: string;
        qualifiedName: string;
        warning: string;
    };
}
export declare function renameDocument(model: IModel, args: RenameDocumentArgs): Promise<RenameDocumentResult>;
export interface SetDocumentationResult {
    success: true;
    status: "success";
    message: string;
    data: {
        elementType: string;
        elementName: string;
        moduleName: string;
        documentation: string;
    };
}
export declare function setDocumentation(model: IModel, args: SetDocumentationArgs): Promise<SetDocumentationResult>;
export interface ValidateNameResult {
    success: true;
    status: "success";
    message: string;
    data: {
        name: string;
        valid: boolean;
        reason?: string;
        fixedName?: string;
    };
}
export declare function validateName(args: ValidateNameArgs): ValidateNameResult;
export interface CheckVariableNameResult {
    success: true;
    status: "success";
    message: string;
    data: {
        microflowName: string;
        variableName: string;
        available: boolean;
        existingVariables: string[];
        suggestion?: string;
    };
}
export declare function checkVariableName(model: IModel, args: CheckVariableNameArgs): Promise<CheckVariableNameResult>;
