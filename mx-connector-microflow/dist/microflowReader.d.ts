import { IModel, microflows, datatypes } from "mendixmodelsdk";
import type { ListMicroflowsArgs, ReadMicroflowDetailsArgs, ReadMicroflowSecurityArgs } from "./types.js";
export declare function listMicroflows(model: IModel, args: ListMicroflowsArgs): Promise<string>;
export interface ResolvedMicroflow {
    microflow: microflows.IMicroflow;
    moduleName: string;
}
export declare function resolveMicroflow(model: IModel, microflowName: string, moduleName?: string): ResolvedMicroflow;
export declare function dataTypeToString(dt: datatypes.IDataType | null | undefined): string;
export declare function readMicroflowDetails(model: IModel, args: ReadMicroflowDetailsArgs): Promise<string>;
export declare function readMicroflowSecurity(model: IModel, args: ReadMicroflowSecurityArgs): Promise<string>;
