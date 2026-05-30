import { IModel } from "mendixmodelsdk";
import type { MicroflowArrangeArgs } from "./types.js";
export interface MicroflowArrangeResult {
    scope: "single" | "module" | "project";
    microflowCount: number;
    moduleCount: number;
    empty: boolean;
    noUserModules?: boolean;
    singleFqn?: string;
    singleObjectCount?: number;
    moduleName?: string;
    microflowNames?: string[];
}
export declare function arrangeMicroflows(model: IModel, args: MicroflowArrangeArgs): Promise<MicroflowArrangeResult>;
