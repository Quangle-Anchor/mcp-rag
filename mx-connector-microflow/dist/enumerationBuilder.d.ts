import { IModel } from "mendixmodelsdk";
import type { CreateEnumerationArgs, ListEnumerationsArgs, RenameEnumerationValueArgs, UpdateEnumerationArgs } from "./types.js";
/**
 * Create an Enumeration in a given module with the supplied values (+ captions).
 *
 * If an enumeration with the same name already exists in the module, it is replaced
 * (values cleared and rebuilt) so that the tool is idempotent.
 */
export declare function createEnumeration(model: IModel, args: CreateEnumerationArgs): Promise<{
    moduleName: string;
    enumerationName: string;
    valuesCreated: number;
    replaced: boolean;
}>;
export interface ListEnumerationValueEntry {
    name: string;
    caption: string;
    captionLanguage: string | null;
}
export interface ListEnumerationsEntry {
    name: string;
    qualifiedName: string;
    moduleName: string;
    folderQualifiedName: string | null;
    documentation: string;
    valueCount: number;
    values: ListEnumerationValueEntry[];
    remote: boolean;
}
export interface ListEnumerationsResult {
    success: true;
    status: "success";
    message: string;
    data: ListEnumerationsEntry[];
}
export declare function listEnumerations(model: IModel, args: ListEnumerationsArgs): Promise<ListEnumerationsResult>;
export interface UpdateEnumerationResult {
    success: true;
    status: "success";
    message: string;
    data: {
        qualifiedName: string;
        moduleName: string;
        enumerationName: string;
        added: string[];
        removed: string[];
        notAdded: string[];
        notRemoved: string[];
        finalValues: Array<{
            name: string;
            caption: string;
        }>;
    };
}
export declare function updateEnumeration(model: IModel, args: UpdateEnumerationArgs): Promise<UpdateEnumerationResult>;
export interface RenameEnumerationValueResult {
    success: true;
    status: "success";
    message: string;
    data: {
        enumerationQualifiedName: string;
        moduleName: string;
        oldName: string;
        newName: string;
        oldQualifiedName: string;
        newQualifiedName: string;
        caption: string;
        warning: string;
    };
}
export declare function renameEnumerationValue(model: IModel, args: RenameEnumerationValueArgs): Promise<RenameEnumerationValueResult>;
