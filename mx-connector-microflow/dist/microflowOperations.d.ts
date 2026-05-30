import { IModel, microflows } from "mendixmodelsdk";
import type { CreateMicroflowActivitiesArgs, InsertBeforeActivityArgs, ModifyMicroflowActivityArgs, SetMicroflowUrlArgs, UpdateMicroflowArgs } from "./types.js";
/**
 * Walk a microflow action and collect every variable name it DECLARES (not
 * names it references). Used by the modify-path Class 3 fix
 * (updateMicroflow ↦ EndEvent.returnValue) and by the Class 4 duplicate-name
 * pre-flight.
 *
 * Variable-DECLARING slots:
 *   - CreateObjectAction.outputVariableName
 *   - RetrieveAction.outputVariableName
 *   - CreateVariableAction.variableName
 *   - MicroflowCallAction.outputVariableName (when useReturnVariable)
 *   - AggregateListAction.outputVariableName
 *   - ListOperationAction.outputVariableName
 *   - RestOperationCallAction → OutputVariable.variableName, BodyVariable.variableName
 *   - NanoflowCallAction.outputVariableName
 *   - JavaScriptActionCallAction.outputVariableName
 *
 * Variable-REFERENCING slots intentionally omitted (changeVariableName,
 * commitVariableName, rollbackVariableName, deleteVariableName).
 */
export declare function collectActivityVariableNames(action: microflows.MicroflowAction | null | undefined, out: Set<string>): void;
export declare function createMicroflowActivities(model: IModel, args: CreateMicroflowActivitiesArgs & {
    autoTranslateEnumLiterals?: boolean;
}): Promise<{
    text: string;
    warnings: string[];
}>;
export declare function insertBeforeActivity(model: IModel, args: InsertBeforeActivityArgs & {
    autoTranslateEnumLiterals?: boolean;
}): Promise<{
    text: string;
    warnings: string[];
}>;
export declare function modifyMicroflowActivity(model: IModel, args: ModifyMicroflowActivityArgs): Promise<string>;
export declare function updateMicroflow(model: IModel, args: UpdateMicroflowArgs): Promise<string>;
export declare function setMicroflowUrl(model: IModel, args: SetMicroflowUrlArgs): Promise<string>;
