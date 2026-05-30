import { IModel } from "mendixmodelsdk";
import type { ConfigureConstantValuesArgs, ConstantDataType, CreateConstantArgs, ListConstantsArgs, UpdateConstantArgs } from "./types.js";
export interface CreateConstantResult {
    qualifiedName: string;
    moduleName: string;
    constantName: string;
    dataType: ConstantDataType;
    defaultValue: string;
    exposedToClient: boolean;
    alreadyExisted: boolean;
    replaced: boolean;
    folderQualifiedName: string | null;
}
export declare function createConstant(model: IModel, args: CreateConstantArgs): Promise<CreateConstantResult>;
export interface ListConstantsEntry {
    name: string;
    qualifiedName: string;
    moduleName: string;
    folderQualifiedName: string | null;
    dataType: ConstantDataType | "Unknown";
    defaultValue: string;
    exposedToClient: boolean;
}
export interface ListConstantsResult {
    success: true;
    status: "success";
    message: string;
    data: ListConstantsEntry[];
}
export declare function listConstants(model: IModel, args: ListConstantsArgs): Promise<ListConstantsResult>;
export interface UpdateConstantResult {
    success: true;
    status: "success";
    message: string;
    data: {
        qualifiedName: string;
        moduleName: string;
        constantName: string;
        dataType: ConstantDataType | "Unknown";
        defaultValue: string;
        exposedToClient: boolean;
        documentation: string;
        changed: {
            defaultValue: boolean;
            exposedToClient: boolean;
            documentation: boolean;
        };
    };
}
export declare function updateConstant(model: IModel, args: UpdateConstantArgs): Promise<UpdateConstantResult>;
export interface ConfigureConstantValuesResult {
    success: true;
    status: "success";
    message: string;
    data: {
        configurationName: string;
        constantQualifiedName: string;
        value: string;
        created: boolean;
        valueKind: "shared" | "private" | "legacy";
    };
}
export declare function configureConstantValues(model: IModel, args: ConfigureConstantValuesArgs): Promise<ConfigureConstantValuesResult>;
