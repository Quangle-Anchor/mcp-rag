import { IModel } from "mendixmodelsdk";
import type { ReadDomainModelArgs } from "./types.js";
export interface AttributeReadResult {
    name: string;
    type: string;
    valueType: "stored" | "calculated";
    defaultValue: string | null;
    calculatedMicroflow: string | null;
}
export interface AssociationReadResult {
    name: string;
    parent: string;
    child: string;
    type: "one-to-many" | "many-to-many";
    parentDeleteBehavior: string;
    childDeleteBehavior: string;
    owner: "Default" | "Both";
}
export interface GeneralizationReadResult {
    hasGeneralization: true;
    parent: string;
}
export interface EntityReadResult {
    name: string;
    qualifiedName: string;
    generalization: GeneralizationReadResult | null;
    attributes: AttributeReadResult[];
    associations: AssociationReadResult[];
    eventHandlers: null;
}
export interface ModuleReadResult {
    moduleName: string;
    entities: EntityReadResult[];
}
export interface ReadDomainModelResponse {
    success: true;
    status: "success";
    message: string;
    data: ModuleReadResult[];
}
export declare function readDomainModel(model: IModel, args: ReadDomainModelArgs): Promise<ReadDomainModelResponse>;
