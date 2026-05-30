import { IModel, microflows } from "mendixmodelsdk";
import type { CreateMicroflowArgs, ActivitySpec, FlowSpec, ReturnTypeSpec } from "./types.js";
/**
 * Builder mode. `"microflow"` (default) — the historical behaviour: every
 * activity type in the `ActivitySpec` union is accepted. `"nanoflow"` —
 * the new nanoflow-only activity handlers (`CallNanoflow`, `JavaScriptAction`,
 * `Synchronize`, `CancelSynchronize`) are accepted, and the allow-list /
 * reject-list is enforced by the caller (`nanoflowBuilder.ts`) before this
 * module is invoked.
 *
 * The `mode` is threaded into `createActivity` and the inner-loop builder so
 * the activity switch can branch on it for the few activity types that exist
 * only in one of the two flow kinds.
 */
export type FlowBuilderMode = "microflow" | "nanoflow";
export interface MicroflowBuildContext {
    autoTranslateEnumLiterals: boolean;
    warnings: string[];
}
export type DataTypeTarget = {
    kind: "returnType";
    mf: microflows.MicroflowBase;
} | {
    kind: "paramObj";
    param: microflows.MicroflowParameterObject;
} | {
    kind: "varAction";
    action: microflows.CreateVariableAction;
};
export declare function applyDataType(spec: ReturnTypeSpec, target: DataTypeTarget, model: IModel): void;
export declare function validateGraph(activities: ActivitySpec[], flows: FlowSpec[], isInner: boolean, loopOpts?: {
    hasBreakCondition: boolean;
}): void;
/**
 * Walk an ActivitySpec tree and collect every variable name it DECLARES, with
 * the owning activity id. Recurses into LoopedActivity inner activities — those
 * share the parent microflow's flat variable scope, so duplicates across the
 * loop boundary also trigger CE0111.
 *
 * Variable-DECLARING slots:
 *   - CreateObject.outputVariableName
 *   - Retrieve.outputVariableName
 *   - CreateVariable.variableName
 *   - CallMicroflow.outputVariableName  (treated as declared; the flag for
 *     useReturnVariable isn't on the spec, so if the planner sets a name we
 *     reserve it)
 *   - AggregateList.outputVariableName
 *   - ListOperation.outputVariableName
 *   - RestOperationCall.outputVariableName, .bodyVariableName
 *   - CallNanoflow.outputVariableName
 *   - JavaScriptAction.outputVariableName
 *   - LoopedActivity.iteratorVariableName
 *
 * Variable-REFERENCING slots intentionally omitted (ChangeObject.variable,
 * ChangeVariable.variable, CommitObject.variable, DeleteObject.variable).
 */
export declare function collectSpecVariableDeclarations(activities: ActivitySpec[], collected: Map<string, string>, duplicates: Array<{
    name: string;
    firstId: string;
    secondId: string;
}>): void;
/**
 * Pre-flight check: throw if any variable name is declared by two different
 * activities (CE0111). Used by `create_microflow` and mirrored by
 * `create_microflow_activities` / `insert_before_activity` /
 * `modify_microflow_activity` in microflowOperations.ts.
 */
export declare function validateUniqueVariableNames(parameters: {
    name: string;
}[] | undefined, activities: ActivitySpec[], scope: string): void;
type MfObject = microflows.MicroflowObject;
export declare function createActivity(model: IModel, mf: microflows.MicroflowBase, oc: microflows.MicroflowObjectCollection, spec: ActivitySpec, ctx: MicroflowBuildContext, mode?: FlowBuilderMode): Promise<MfObject>;
export interface EndEventConfig {
    /** Microflow's return type — controls whether returnValue should be set on a new EndEvent. */
    returnType: ReturnTypeSpec;
    /** Variable name used as the returnValue expression `$<name>`. Required if returnType !== Void. */
    returnVariableName?: string;
}
export interface WiredFlow {
    flow: microflows.SequenceFlow;
    origin: MfObject;
    destination: MfObject;
    /** True when this flow is drawn vertically (BOTTOM→TOP). */
    isBranch: boolean;
    /** True when the caller set `branch` explicitly on the FlowSpec — disables per-split auto-classification for the split this flow belongs to. */
    explicitBranch: boolean;
}
export declare function wireFlow(mf: microflows.MicroflowBase, oc: microflows.MicroflowObjectCollection, objectMap: Map<string, MfObject>, flowSpec: FlowSpec, activities: ActivitySpec[], endConfig: EndEventConfig, endEvents: microflows.EndEvent[], isInnerLoop?: boolean): WiredFlow;
/**
 * After all flows are wired, re-classify the happy/branch assignment per
 * decision split. The per-flow logic in `wireFlow` can't see siblings — when a
 * split has one outgoing flow going to a `ValidationFeedback` and the sibling
 * going to a happy activity, the sibling needs to become the main path
 * regardless of whether its case value is `"true"` or `"false"`.
 *
 * Splits where any FlowSpec carried an explicit `branch` are left alone — the
 * caller has taken control.
 */
export declare function reclassifySplitFlows(wired: WiredFlow[]): void;
export declare function insertMergeNodesAtConvergence(oc: microflows.MicroflowObjectCollection, mf: microflows.MicroflowBase, wired: WiredFlow[]): void;
/**
 * Outer-microflow auto-layout: places StartEvent at (0, 0), walks main flow
 * horizontally to the right, then for each ExclusiveSplit on the main path
 * walks its FALSE branch downward (y = Y_STEP) starting at the split's x.
 * Parameters (if any) are stacked vertically above the start.
 */
export declare function autoLayout(oc: microflows.MicroflowObjectCollection, startEvt: microflows.StartEvent, wired: WiredFlow[]): void;
export declare function createMicroflow(model: IModel, args: CreateMicroflowArgs, autoTranslateEnumLiterals?: boolean): Promise<{
    moduleName: string;
    microflowName: string;
    activitiesCreated: number;
    parametersCreated: number;
    alreadyExisted: boolean;
    overwritten: boolean;
    warnings: string[];
}>;
export {};
