export interface AttributeInput {
    name: string;
    type: string;
    documentation?: string;
    defaultValue?: string;
    length?: number;
    enumerationName?: string;
    enumerationModule?: string;
}
export interface EntityInput {
    name: string;
    documentation?: string;
    location?: {
        x: number;
        y: number;
    };
    attributes?: AttributeInput[];
    persistable?: boolean;
    hasCreatedDate?: boolean;
    hasChangedDate?: boolean;
    hasOwner?: boolean;
    hasChangedBy?: boolean;
    /**
     * Optional entity inheritance (Mendix generalization). If provided, this entity
     * becomes a specialization of `parentEntity` — a qualified name such as
     * `Administration.Account`. When set, the `persistable`, `hasCreatedDate`,
     * `hasChangedDate`, `hasOwner`, and `hasChangedBy` flags are ignored because
     * they are inherited from the parent.
     */
    generalization?: {
        parentEntity: string;
    };
}
export interface DeleteBehaviorInput {
    parentDeleteBehavior?: string;
    childDeleteBehavior?: string;
}
export interface AssociationInput {
    name: string;
    parentEntity: string;
    childEntity: string;
    type?: string;
    owner?: string;
    /** If true and an association with the same name already exists, delete it and recreate with the new definition. */
    overwrite?: boolean;
    documentation?: string;
    deleteBehavior?: DeleteBehaviorInput;
}
export interface CreateAssociationArgs {
    moduleName: string;
    associations: AssociationInput[];
}
/**
 * Args for `create_cross_module_association`.
 *
 * Shares the `AssociationInput` shape with `create_association`, but the tool-level
 * semantics enforce:
 *   - `parentEntity` must belong to `moduleName` (same-unit Entity on AssociationBase.parent).
 *   - `childEntity` must be a FQN whose module prefix is DIFFERENT from `moduleName`.
 * These checks are performed in the cross-module builder's pre-flight.
 */
export interface CreateCrossModuleAssociationArgs {
    moduleName: string;
    associations: AssociationInput[];
}
/**
 * Args for `read_domain_model`. Read-only inspector — returns the domain model
 * structure (entities, attributes, associations, generalizations) for one
 * module or for all non-Marketplace modules in the open working copy.
 * See SPECS.md Tool 16.
 */
export interface ReadDomainModelArgs {
    /** Optional module to read. When omitted, reads all `fromAppStore === false` modules. */
    moduleName?: string;
}
/**
 * Args for `delete_association`. Destructive — removes one or more Association or
 * CrossAssociation entries from a module's domain model. Searches both
 * `dm.associations` and `dm.crossAssociations`. Short-name input only (no FQN).
 * See SPECS.md Tool 15.
 */
export interface DeleteAssociationsArgs {
    moduleName: string;
    associationNames: string[];
    /** Default: "error". Controls behavior when a name is not found in either collection. */
    ifMissing?: "error" | "skip";
    /** Default: false. If true, resolves the plan but does not call `.delete()`. */
    dryRun?: boolean;
}
export interface DomainModelInput {
    entities: EntityInput[];
    associations?: AssociationInput[];
}
export interface CreateDomainModelArgs {
    moduleName: string;
    branchName?: string;
    commitMessage?: string;
    domainModel?: DomainModelInput;
    entity?: EntityInput;
}
/**
 * Args for `create_entity`.
 *
 * Appends a single entity to an existing domain model without clearing or modifying
 * other entities / associations. If `overwrite` is true and an entity with the same
 * name exists, it is deleted first (associations referencing it will be broken).
 */
export interface CreateEntityArgs {
    moduleName: string;
    overwrite?: boolean;
    entity: EntityInput;
}
/**
 * Per-entity input for `create_multiple_entities`. Mirrors the field shape of
 * `EntityInput` but flattens `name` to `entityName` and includes per-entity
 * `moduleName` and `overwrite` overrides.
 */
export interface CreateMultipleEntitiesEntityInput {
    entityName: string;
    moduleName?: string;
    overwrite?: boolean;
    documentation?: string;
    location?: {
        x: number;
        y: number;
    };
    persistable?: boolean;
    hasCreatedDate?: boolean;
    hasChangedDate?: boolean;
    hasOwner?: boolean;
    hasChangedBy?: boolean;
    generalization?: {
        parentEntity: string;
    };
    attributes?: AttributeInput[];
}
/**
 * Args for `create_multiple_entities`. Top-level `moduleName` is the default
 * module for entities that do not specify one. Fail-fast on first error.
 */
export interface CreateMultipleEntitiesArgs {
    moduleName?: string;
    entities: CreateMultipleEntitiesEntityInput[];
}
/**
 * Args for `create_multiple_associations`. Each association entry can be
 * same-module or cross-module (auto-detected from childEntity FQN). The tool
 * runs full pre-flight validation across the whole array before mutating.
 */
export interface CreateMultipleAssociationsArgs {
    moduleName: string;
    associations: AssociationInput[];
}
export interface OpenWorkingCopyArgs {
    branchName?: string;
    commitId?: string;
}
export interface CommitWorkingCopyArgs {
    commitMessage?: string;
    branchName?: string;
}
export interface DiscardWorkingCopyArgs {
    reason?: string;
}
export interface CreateModuleArgs {
    moduleName: string;
}
export interface EnumerationValueInput {
    name: string;
    caption?: string;
}
export interface CreateEnumerationArgs {
    moduleName: string;
    enumerationName: string;
    values: EnumerationValueInput[];
    documentation?: string;
}
export interface CreatePageArgs {
    moduleName: string;
    pageName: string;
    title?: string;
    layoutQualifiedName?: string;
    popup?: boolean;
    popupWidth?: number;
    popupHeight?: number;
    /**
     * Optional entity QN ("Module.Entity"). When provided, the page is given a
     * `pages.PageParameter` of `ObjectType(entity)` named after `parameterName`
     * (default: the entity short name). Required for any page whose top-level
     * DataView is bound to context (the standard NewEdit-form pattern).
     */
    entityQualifiedName?: string;
    /** Name of the auto-created PageParameter when `entityQualifiedName` is set. Default: entity short name. */
    parameterName?: string;
}
/** Supported widget types for add_widget. */
export type SupportedWidgetType = "TextBox" | "TextArea" | "Label" | "ActionButton" | "DatePicker" | "DropDown" | "ReferenceSelector" | "RadioButtonGroup" | "DataView" | "DivContainer" | "GroupBox" | "LayoutGrid";
export type EditableValue = "Always" | "Never" | "Conditional";
export interface AddWidgetArgs {
    moduleName: string;
    pageName: string;
    widgetType: SupportedWidgetType;
    widgetName: string;
    /**
     * If omitted, widget is placed into the page's main LayoutCallArgument (first argument
     * on the page's LayoutCall, typically the "Content" placeholder).
     * If provided, walks the widget tree of the page to find the named parent; the parent
     * must be a container widget (DataView, DivContainer, GroupBox, or LayoutCallArgument-alias).
     */
    parentWidgetName?: string;
    /** Optional argument-name on the page-level LayoutCall (ignored when parentWidgetName set). */
    layoutArgumentName?: string;
    /** Caption text for Label / ActionButton. */
    caption?: string;
    /**
     * Form-field label rendered next to the widget (writes `InputWidget.labelTemplate`).
     * Applies to TextBox, TextArea, DatePicker, DropDown, ReferenceSelector,
     * RadioButtonGroup, CheckBox. Ignored (with a note) on non-InputWidget types.
     */
    label?: string;
    /** For attribute-bound widgets (TextBox, TextArea, DatePicker, DropDown, RadioButtonGroup): attribute QN ("Module.Entity.Attr"). */
    attributeQualifiedName?: string;
    /** For ReferenceSelector: association QN ("Module.Entity_RelatedEntity"). */
    associationQualifiedName?: string;
    /**
     * For `ConditionallyEditableWidget` subclasses (TextBox, TextArea, DatePicker,
     * DropDown, ReferenceSelector, RadioButtonGroup, CustomWidget). Same semantics
     * as `set_widget_property` with property=editable; applied at creation time so
     * read-only form fields can be authored in a single tool call.
     */
    editable?: EditableValue;
    /**
     * For `widgetType=DataView` only. When omitted (and the DataView is added at
     * the top of the page), the DataView's source is auto-bound to the page's
     * first PageParameter via `DataViewSource` + `PageVariable.pageParameter`.
     * When explicitly named, it must match an existing PageParameter on the page.
     */
    pageParameterName?: string;
    /**
     * For `widgetType=DataView` only (Mendix 10.7+). Sets `DataView.editability`,
     * which propagates read-only behavior to all child input widgets. Use this on
     * a read-only variant of a form page to avoid touching every child.
     */
    dataViewEditability?: EditableValue;
}
export interface SetWidgetPropertyArgs {
    moduleName: string;
    pageName: string;
    widgetName: string;
    property: string;
    value: unknown;
}
export interface ReturnTypeSpec {
    type: "Void" | "Boolean" | "String" | "Integer" | "Long" | "Decimal" | "DateTime" | "Object" | "List";
    entityQualifiedName?: string;
}
export interface ParameterSpec {
    name: string;
    type: ReturnTypeSpec;
}
export interface MemberChangeSpec {
    attributeQualifiedName?: string;
    associationQualifiedName?: string;
    changeType?: "Set" | "Add" | "Remove";
    value: string;
}
export interface SortItemSpec {
    attributeQualifiedName: string;
    order: "Ascending" | "Descending";
}
export interface RangeSpec {
    type: "All" | "First" | "ConstantRange" | "CustomRange";
    limit?: number;
    offset?: number;
    limitExpression?: string;
    offsetExpression?: string;
}
export interface ParameterMappingSpec {
    parameterName: string;
    argument: string;
}
interface BaseActivitySpec {
    id: string;
    caption?: string;
    backgroundColor?: string;
    documentation?: string;
    /**
     * Studio Pro's per-activity error handling. Optional — when omitted the
     * builder uses the mode-specific SDK default: `Rollback` in microflow
     * context, `Abort` in nanoflow context.
     *
     * Allowed values per context (Studio Pro `CE6035` rejects anything outside
     * these sets):
     *  - microflow: `Rollback` | `Custom` | `CustomWithoutRollBack` | `Continue`
     *    (and `Continue` itself is only valid on `CallMicroflow` or `LoopedActivity`).
     *  - nanoflow:  `Abort` | `CustomWithoutRollBack`.
     *
     * `Custom` and `CustomWithoutRollBack` require a separate error-handler
     * subtree the builder does not yet wire — the builder accepts the value and
     * emits a warning so the planner remembers to add the flow in Studio Pro.
     */
    errorHandlingType?: "Rollback" | "Custom" | "CustomWithoutRollBack" | "Continue" | "Abort";
}
export interface CreateObjectActivitySpec extends BaseActivitySpec {
    type: "CreateObject";
    entityQualifiedName: string;
    outputVariableName: string;
    commit?: "No" | "Yes" | "YesWithoutEvents";
    refreshInClient?: boolean;
    memberChanges?: MemberChangeSpec[];
}
export interface ChangeObjectActivitySpec extends BaseActivitySpec {
    type: "ChangeObject";
    variable: string;
    commit?: "No" | "Yes" | "YesWithoutEvents";
    refreshInClient?: boolean;
    memberChanges?: MemberChangeSpec[];
}
export interface CommitObjectActivitySpec extends BaseActivitySpec {
    type: "CommitObject";
    variable: string;
    withEvents?: boolean;
    refreshInClient?: boolean;
}
export interface DeleteObjectActivitySpec extends BaseActivitySpec {
    type: "DeleteObject";
    variable: string;
}
export interface RetrieveActivitySpec extends BaseActivitySpec {
    type: "Retrieve";
    outputVariableName: string;
    source: {
        type: "Database" | "Association";
        entityQualifiedName?: string;
        xpath?: string;
        range?: RangeSpec;
        sortItems?: SortItemSpec[];
        startVariableName?: string;
        associationQualifiedName?: string;
    };
}
export interface CreateVariableActivitySpec extends BaseActivitySpec {
    type: "CreateVariable";
    variableName: string;
    variableType: ReturnTypeSpec;
    initialValue?: string;
}
export interface ChangeVariableActivitySpec extends BaseActivitySpec {
    type: "ChangeVariable";
    variable: string;
    value: string;
}
export interface CallMicroflowActivitySpec extends BaseActivitySpec {
    type: "CallMicroflow";
    microflowQualifiedName: string;
    outputVariableName?: string;
    parameterMappings?: ParameterMappingSpec[];
}
export interface LogMessageActivitySpec extends BaseActivitySpec {
    type: "LogMessage";
    level?: "Trace" | "Debug" | "Info" | "Warning" | "Error" | "Critical";
    node?: string;
    template?: string;
    parameters?: string[];
}
export interface AggregateListActivitySpec extends BaseActivitySpec {
    type: "AggregateList";
    listVariableName: string;
    aggregateFunction: "Count" | "Sum" | "Average" | "Minimum" | "Maximum";
    attributeQualifiedName?: string;
    outputVariableName: string;
}
export interface ListOperationActivitySpec extends BaseActivitySpec {
    type: "ListOperation";
    operation: "Union" | "Intersect" | "Subtract" | "Contains" | "Sort" | "Head" | "Tail";
    listVariableName: string;
    outputVariableName: string;
    secondListVariableName?: string;
    objectVariableName?: string;
    sortItems?: SortItemSpec[];
}
export interface ShowMessageActivitySpec extends BaseActivitySpec {
    type: "ShowMessage";
    messageType?: "Information" | "Warning" | "Error";
    template?: string;
    parameters?: string[];
    blocking?: boolean;
}
export interface ShowPageParameterMappingSpec {
    /** Name of the target page's PageParameter. */
    parameterName: string;
    /** Microflow expression used to populate the parameter (e.g. "$LeaveRequest"). */
    argument: string;
}
export interface ShowPageActivitySpec extends BaseActivitySpec {
    type: "ShowPage";
    pageQualifiedName: string;
    /**
     * Legacy single-parameter API (Mendix metamodel < 9.18). Sets
     * `ShowPageAction.passedObjectVariableName`. On metamodel ≥ 9.18 the property
     * was deleted; the builder auto-translates this to a `parameterMappings`
     * entry against the page's first parameter when `parameterMappings` is not
     * provided. Prefer `parameterMappings` for new code.
     */
    passedObjectVariableName?: string;
    /**
     * Mendix metamodel ≥ 9.7 page-parameter mappings. Takes precedence over
     * `passedObjectVariableName` when both are present.
     */
    parameterMappings?: ShowPageParameterMappingSpec[];
}
export interface ClosePageActivitySpec extends BaseActivitySpec {
    type: "ClosePage";
}
export interface ValidationFeedbackActivitySpec extends BaseActivitySpec {
    type: "ValidationFeedback";
    objectVariable: string;
    attributeQualifiedName?: string;
    associationQualifiedName?: string;
    message: string;
}
export interface ExclusiveSplitActivitySpec extends BaseActivitySpec {
    type: "ExclusiveSplit";
    conditionType?: "Expression" | "Enumeration";
    condition: string;
    enumerationQualifiedName?: string;
}
export interface LoopedActivitySpec extends BaseActivitySpec {
    type: "LoopedActivity";
    listVariableName: string;
    iteratorVariableName: string;
    breakCondition?: string;
    activities: ActivitySpec[];
    flows: FlowSpec[];
}
/**
 * Maps a microflow expression onto a `rest.OperationParameter` of the target
 * RestOperation. `parameterName` is the path-parameter short name (matching the
 * `{Name}` placeholder in the operation's path template); `argument` is the
 * Microflow expression stored verbatim on `RestOperationParameterMapping.value`.
 */
export interface RestOperationParameterMappingSpec {
    parameterName: string;
    argument: string;
}
/**
 * Maps a microflow expression onto a `rest.QueryParameter` of the target
 * RestOperation. Available from Mendix meta-model 11.0+. `included` controls
 * the runtime conditional inclusion of the parameter.
 */
export interface RestQueryParameterMappingSpec {
    parameterName: string;
    argument: string;
    included?: "Yes" | "No" | "WhenNotNull";
}
/**
 * Calls a `rest.RestOperation` (consumed REST) from a microflow. Materialises a
 * `microflows.RestOperationCallAction`. Available from Mendix meta-model 10.1+;
 * `bodyVariableName` requires 10.5+; `outputVariableName` requires 10.4+;
 * `queryParameterMappings` requires 11.0+.
 */
export interface RestOperationCallActivitySpec extends BaseActivitySpec {
    type: "RestOperationCall";
    operationQualifiedName: string;
    /** Variable name for the response output (Mendix 10.4+). */
    outputVariableName?: string;
    /**
     * Variable name carrying the request body (Mendix 10.5+). Only meaningful
     * when the target operation uses a body-bearing method (POST/PUT/PATCH).
     */
    bodyVariableName?: string;
    /** Path-parameter expressions. Each entry must reference a path parameter on the operation. */
    parameterMappings?: RestOperationParameterMappingSpec[];
    /** Query-parameter expressions (Mendix 11.0+). */
    queryParameterMappings?: RestQueryParameterMappingSpec[];
}
/**
 * Calls another Nanoflow inline from a Nanoflow context. The SDK class is
 * `microflows.NanoflowCallAction`, which wraps a `NanoflowCall` and a list of
 * `NanoflowCallParameterMapping`. Available from metamodel 8.0.0.
 */
export interface CallNanoflowActivitySpec extends BaseActivitySpec {
    type: "CallNanoflow";
    nanoflowQualifiedName: string;
    outputVariableName?: string;
    parameterMappings?: ParameterMappingSpec[];
}
/**
 * Calls a JavaScript action (client-side custom code) from a Nanoflow. The SDK
 * class is `microflows.JavaScriptActionCallAction`. Arguments use
 * `BasicCodeActionParameterValue` (a string expression). Available from
 * metamodel 7.21.0.
 */
export interface CallJavaScriptActionActivitySpec extends BaseActivitySpec {
    type: "JavaScriptAction";
    javaScriptActionQualifiedName: string;
    outputVariableName?: string;
    parameterMappings?: ParameterMappingSpec[];
}
/**
 * Synchronizes pending offline changes against the server. SDK class
 * `microflows.SynchronizeAction`. Available from metamodel 7.22.0; the
 * `type` / `variableNames` fields are 8.10.0+. The SDK enum value
 * `Specific` is also exposed here under the spec-friendly alias `Selective`.
 */
export interface SynchronizeActivitySpec extends BaseActivitySpec {
    type: "Synchronize";
    /** `All` syncs every offline-enabled entity. `Selective`/`Specific` syncs only `entitiesToSynchronize`. Default `All`. */
    synchronizationType?: "All" | "Selective" | "Specific" | "Unsynchronized";
    /** Entity FQNs to sync. Required when `synchronizationType` is `Selective`/`Specific`. */
    entitiesToSynchronize?: string[];
}
/**
 * Cancels an in-flight synchronization. SDK class
 * `microflows.CancelSynchronizationAction`. Available from metamodel 11.8.0.
 */
export interface CancelSynchronizeActivitySpec extends BaseActivitySpec {
    type: "CancelSynchronize";
}
export type ActivitySpec = CreateObjectActivitySpec | ChangeObjectActivitySpec | CommitObjectActivitySpec | DeleteObjectActivitySpec | RetrieveActivitySpec | CreateVariableActivitySpec | ChangeVariableActivitySpec | CallMicroflowActivitySpec | LogMessageActivitySpec | AggregateListActivitySpec | ListOperationActivitySpec | ShowMessageActivitySpec | ShowPageActivitySpec | ClosePageActivitySpec | ValidationFeedbackActivitySpec | ExclusiveSplitActivitySpec | LoopedActivitySpec | RestOperationCallActivitySpec | CallNanoflowActivitySpec | CallJavaScriptActionActivitySpec | SynchronizeActivitySpec | CancelSynchronizeActivitySpec;
export interface FlowSpec {
    from: string;
    to: string;
    condition?: string;
    /**
     * Optional explicit override for the layout direction of this flow.
     * - `true`  → this flow is a branch (drawn downward, BOTTOM→TOP connection).
     * - `false` → this flow is the main path (drawn right, RIGHT→LEFT connection).
     *
     * When omitted, the default rule applies: outgoing flows from an Expression
     * `ExclusiveSplit` are classified by their `condition` ("true" = main,
     * "false" = branch). Use `branch` to flip that convention — e.g. for
     * `empty($field)` checks where the semantically happy path is `false`,
     * pass `{ condition: "false", branch: false }` on the happy flow and
     * `{ condition: "true",  branch: true  }` on the validation-failure flow.
     *
     * Only affects layout / connection-index assignment; the `condition` field
     * still controls the EnumerationCase label Studio Pro renders.
     */
    branch?: boolean;
}
export interface CreateMicroflowArgs {
    moduleName: string;
    microflowName: string;
    documentation?: string;
    returnType?: ReturnTypeSpec;
    returnVariableName?: string;
    allowConcurrentExecution?: boolean;
    applyEntityAccess?: boolean;
    overwrite?: boolean;
    parameters?: ParameterSpec[];
    activities: ActivitySpec[];
    flows: FlowSpec[];
}
/**
 * Args for `create_nanoflow` (Tool 124). Mirrors `CreateMicroflowArgs` minus
 * the server-only properties (`allowConcurrentExecution`, `applyEntityAccess`,
 * `url`). `useListParameterByReference` requires metamodel 11.9.0+; on older
 * metamodels the field is dropped with a warning.
 */
export interface CreateNanoflowArgs {
    moduleName: string;
    nanoflowName: string;
    documentation?: string;
    returnType?: ReturnTypeSpec;
    returnVariableName?: string;
    useListParameterByReference?: boolean;
    overwrite?: boolean;
    parameters?: ParameterSpec[];
    activities: ActivitySpec[];
    flows: FlowSpec[];
}
/**
 * Args for `update_nanoflow` (Tool 125). Mirrors `UpdateMicroflowArgs` minus
 * `url` (nanoflows have no REST endpoint). Same `returnType` shorthand as
 * `update_microflow`.
 */
export interface UpdateNanoflowArgs {
    nanoflowName: string;
    moduleName?: string;
    returnType?: string;
    returnVariableName?: string;
    useListParameterByReference?: boolean;
}
export type DeleteModelElementType = "entity" | "attribute" | "association" | "microflow" | "constant" | "enumeration";
export interface DeleteModelElementArgs {
    elementType: DeleteModelElementType;
    moduleName?: string;
    entityName?: string;
    attributeName?: string;
    associationName?: string;
    documentName?: string;
    elementName?: string;
    ifMissing?: "error" | "skip";
}
export interface DiagnoseAssociationsArgs {
    moduleName?: string;
}
export interface SetEntityGeneralizationArgs {
    moduleName?: string;
    entityName: string;
    parentEntity: string;
    parentModule?: string;
}
export interface RemoveEntityGeneralizationArgs {
    moduleName?: string;
    entityName: string;
}
export type EventHandlerEvent = "create" | "commit" | "delete" | "rollback";
export type EventHandlerMoment = "before" | "after";
export interface AddEventHandlerArgs {
    moduleName?: string;
    entityName: string;
    event: EventHandlerEvent;
    moment: EventHandlerMoment;
    microflow: string;
    raiseErrorOnFalse?: boolean;
}
export interface AddAttributeArgs {
    moduleName?: string;
    entityName: string;
    attributeName: string;
    attributeType: string;
    defaultValue?: string;
    enumerationValues?: string[];
    enumerationName?: string;
}
export interface SetCalculatedAttributeArgs {
    moduleName?: string;
    entityName: string;
    attributeName: string;
    microflow: string;
}
export interface UpdateAttributeArgs {
    moduleName?: string;
    entityName: string;
    attributeName: string;
    type?: string;
    defaultValue?: string;
    maxLength?: number;
    localizeDate?: boolean;
}
export interface UpdateAssociationArgs {
    moduleName?: string;
    associationName: string;
    owner?: "Default" | "Both";
    type?: "Reference" | "ReferenceSet";
    parentDeleteBehavior?: "DeleteMeAndReferences" | "DeleteMeButKeepReferences" | "DeleteMeIfNoReferences";
    childDeleteBehavior?: "DeleteMeAndReferences" | "DeleteMeButKeepReferences" | "DeleteMeIfNoReferences";
}
export interface QueryAssociationsArgs {
    moduleName?: string;
    entityName?: string;
    secondEntity?: string;
    direction?: "parent" | "child" | "both";
}
export interface ReadAttributeDetailsArgs {
    moduleName?: string;
    entityName: string;
    attributeName: string;
}
export interface MicroflowArrangeArgs {
    microflowName?: string;
    moduleName?: string;
    /**
     * Per-split overrides for which case is the "main" (happy) path. By default,
     * `microflow_arrange` treats the `true` case of an Expression
     * `ExclusiveSplit`/`InheritanceSplit` as the main path and the `false` case
     * as the branch drawn downward. This list lets the caller flip that for
     * specific splits, identified by case-insensitive substring match against
     * the split's `caption`.
     *
     * Example: to mark every split whose caption contains `empty(` as inverted
     * (so the `false` case becomes the main right-going path):
     *   `[{ captionContains: "empty(", mainCase: "false" }]`
     *
     * The list is matched in order; the first matching entry wins for a given
     * split. Splits with no matching entry use the default `true = main` rule.
     * Omit or pass `[]` to keep the default convention.
     */
    branchOverrides?: Array<{
        captionContains: string;
        mainCase: "true" | "false";
    }>;
}
export interface ArrangeDomainModelArgs {
    moduleName: string;
    rootEntity?: string;
    connectionPointsOnly?: boolean;
}
export interface ListPagesArgs {
    moduleName?: string;
    includeExcluded?: boolean;
}
export interface ReadPageDetailsArgs {
    pageName: string;
    moduleName?: string;
    maxDepth?: number;
}
/**
 * Per-entity name overrides for components of the NewEdit page. Any field that
 * is omitted falls back to the default Studio Pro auto-numbering pattern
 * (`layoutGrid1`, `dataView1`, `textBox1`, `datePicker1`, ..., `comboBox1`,
 * `btn_save`, `btn_cancel`).
 */
export interface NewEditPageNames {
    /** Top-level LayoutGrid name. Default: `"layoutGrid1"`. */
    layoutGrid?: string;
    /** DataView name inside the LayoutGrid column. Default: `"dataView1"`. */
    dataView?: string;
    /** Save ActionButton name. Default: `"btn_save"`. */
    saveButton?: string;
    /** Cancel ActionButton name. Default: `"btn_cancel"`. */
    cancelButton?: string;
    /**
     * Map of attribute name → input widget name. Applies to TextBox, DatePicker,
     * CheckBox, and RadioButtonGroup widgets bound to that attribute. Attributes
     * not present in this map use the per-type counter default (`textBox1`,
     * `textBox2`, ...).
     */
    attributeWidgets?: Record<string, string>;
    /**
     * Map of association name → ComboBox CustomWidget name. Associations not
     * present in this map use the per-page counter default (`comboBox1`,
     * `comboBox2`, ...).
     */
    associationWidgets?: Record<string, string>;
}
export interface GenerateOverviewPagesArgs {
    entityNames: string[];
    moduleName?: string;
    referenceOverviewPage?: string;
    /**
     * Per-entity NewEdit name overrides. Keyed by entity short name (matching
     * an entry in `entityNames`). Any entity without an entry uses defaults.
     */
    newEditNames?: Record<string, NewEditPageNames>;
    generateIndexSnippet?: boolean;
}
export interface ListMicroflowsArgs {
    moduleName?: string;
}
export interface ReadMicroflowDetailsArgs {
    microflowName: string;
    moduleName?: string;
}
export interface AppendActivitySpec {
    activity_type: string;
    activity_config?: Record<string, unknown>;
    [key: string]: unknown;
}
export interface CreateMicroflowActivitiesArgs {
    moduleName?: string;
    microflowName: string;
    activities: AppendActivitySpec[];
}
export interface ModifyMicroflowActivityArgs {
    microflowName: string;
    moduleName?: string;
    position: number;
    caption?: string;
    disabled?: boolean;
    output_variable?: string;
    commit?: "Yes" | "YesWithoutEvents" | "No";
    refresh_in_client?: boolean;
    with_events?: boolean;
    use_return_variable?: boolean;
    commit_variable?: string;
    rollback_variable?: string;
    delete_variable?: string;
    change_variable?: string;
}
export interface InsertBeforeActivityArgs {
    microflowName: string;
    moduleName?: string;
    before_position: number;
    activity: AppendActivitySpec;
}
export interface UpdateMicroflowArgs {
    microflowName: string;
    moduleName?: string;
    returnType?: string;
    returnVariableName?: string;
    url?: string;
}
export interface SetMicroflowUrlArgs {
    microflowName: string;
    moduleName?: string;
    url?: string;
}
export interface ReadMicroflowSecurityArgs {
    microflowName?: string;
    moduleName?: string;
    include_nanoflows?: boolean;
}
export interface QueryModelElementsArgs {
    typeName: string;
    moduleName?: string;
    includeProperties?: boolean;
    maxResults?: number;
}
export interface CopyModelElementArgs {
    elementType: "entity" | "microflow" | "constant" | "enumeration";
    sourceName: string;
    newName: string;
    sourceModule?: string;
    targetModule?: string;
}
export interface DeleteDocumentArgs {
    documentName: string;
    moduleName: string;
    documentType?: "page" | "microflow" | "nanoflow" | "snippet" | "layout" | "buildingblock";
}
export interface ExcludeDocumentArgs {
    documentName: string;
    moduleName?: string;
    excluded?: boolean;
    documentType?: "page" | "microflow" | "nanoflow" | "snippet" | "layout" | "buildingblock";
}
export interface RenameDocumentArgs {
    documentName: string;
    newName: string;
    moduleName?: string;
    documentType?: "page" | "microflow" | "nanoflow" | "snippet" | "layout" | "buildingblock" | "constant" | "enumeration";
}
export interface SetDocumentationArgs {
    elementType: "entity" | "attribute" | "association" | "domain_model";
    documentation: string;
    elementName?: string;
    moduleName?: string;
    entityName?: string;
    attributeName?: string;
}
export interface ValidateNameArgs {
    name: string;
    autoFix?: boolean;
}
export interface CheckVariableNameArgs {
    microflowName: string;
    variableName: string;
    moduleName?: string;
}
/**
 * One field on a generated form page. The widget type is picked explicitly
 * (so the caller decides whether e.g. a String attribute is a TextBox or a
 * TextArea). The field may be either:
 *   - **Bound** — `attributeName` references an attribute on the page's
 *     entity. The widget is created with an AttributeRef.
 *   - **Static** — `widgetType: "Label"` with `caption` (used for inline
 *     validation-error placeholders or section headings).
 */
export interface FormPageFieldSpec {
    /** Widget name (used as `mx-name-<name>` selector). */
    name: string;
    /**
     * Widget kind. Subset of SupportedWidgetType applicable inside a form
     * DataView. ComboBox is a separate tool (`create_combobox`).
     */
    widgetType: "TextBox" | "TextArea" | "DatePicker" | "DropDown" | "RadioButtonGroup" | "Label";
    /** Attribute short name on the page's entity. Required for non-Label widgets. */
    attributeName?: string;
    /** Static caption for `widgetType=Label`. */
    caption?: string;
    /**
     * Form-field label shown next to the input. Defaults to a humanized
     * `attributeName` (e.g. `StartDate` → "Start Date") when omitted on input
     * widgets. Pass an empty string to suppress the label. Ignored for `Label`.
     */
    label?: string;
    /**
     * Per-field override for editability. Optional. On a `readOnly=true` page
     * the DataView is set to `editability=Never` (Mendix 10.7+), which propagates
     * read-only behavior to every child — so a per-field value is normally not
     * needed. Pass an explicit value here only to deviate from the parent's
     * read-only state (e.g. force a single field editable on a read-only form).
     * Static Labels are not `ConditionallyEditableWidget` and ignore this.
     */
    editable?: EditableValue;
}
/**
 * A page-level button on the generated form. Wired to either a microflow
 * (`microflowQualifiedName` → `pages.MicroflowClientAction`) or a built-in
 * close-page action (`onClick: "ClosePage"` → `pages.ClosePageClientAction`).
 * Exactly one of the two should be specified; when both are missing the button
 * is created without an action and a warning is returned.
 *
 * Buttons are placed in the DataView's **footer** by default (matching the
 * Studio Pro convention — "page action buttons go in the DataView footer").
 * The legacy in-body placement is no longer supported; this is intentional so
 * the generated page matches the Atlas form-page reference layout.
 */
export interface FormPageButtonSpec {
    /** Widget name. */
    name: string;
    /** Button caption text. */
    caption: string;
    /** `"Primary"` | `"Success"` | `"Default"`. Default: `"Default"`. */
    style?: "Primary" | "Success" | "Default";
    /** Microflow QN (e.g. `RequestsOverview.ACT_LeaveRequest_Save`). Mutually exclusive with `onClick`. */
    microflowQualifiedName?: string;
    /**
     * Built-in client action. `"ClosePage"` wires `pages.ClosePageClientAction`
     * (the Studio Pro "Close page" action used by Cancel / Close buttons).
     * Mutually exclusive with `microflowQualifiedName`.
     */
    onClick?: "ClosePage";
}
export interface CreateFormPageArgs {
    /** Target module short name. */
    moduleName: string;
    /** New page name (e.g. `LeaveRequest_NewEdit_ReadOnly`). */
    pageName: string;
    /** Page title (defaults to humanized `pageName`). */
    title?: string;
    /** Entity QN whose attributes back the form. Creates a PageParameter. */
    entityQualifiedName: string;
    /** PageParameter name. Default: entity short name. */
    parameterName?: string;
    /** Layout QN. Default candidates: `Atlas_Core.PopupLayout`, `Atlas_Core.Atlas_Default`. */
    layoutQualifiedName?: string;
    /**
     * Top-level LayoutGrid widget name. The grid is created as
     * `LayoutGrid(1 row, 1 column, auto-fill)` and the DataView is placed inside
     * the column — matching the Mendix Atlas form-page convention. Default:
     * `layoutGrid1`.
     */
    layoutGridName?: string;
    /** Top-level DataView widget name. Default: `dataView_<entity>`. */
    dataViewName?: string;
    /** Fields to render inside the DataView, in order. */
    fields: FormPageFieldSpec[];
    /**
     * Page-level action buttons (Save / Cancel / Close / etc.). Always placed in
     * the **DataView footer** — matches the Studio Pro convention where page
     * actions live in the footer and the body contains only data fields. Buttons
     * can be wired to a microflow (`microflowQualifiedName`) or to the built-in
     * close-page action (`onClick: "ClosePage"`).
     */
    buttons?: FormPageButtonSpec[];
    /**
     * When true, the DataView is marked `editability=Never` (Mendix 10.7+).
     * Read-only behavior propagates to every child input widget automatically;
     * per-field `editable` is **not** forced (callers can still override
     * individual fields via `FormPageFieldSpec.editable`).
     *
     * Pair with `readOnlyStyle` to control how the read-only inputs render in
     * the client.
     */
    readOnly?: boolean;
    /**
     * For read-only DataViews (Mendix 10.7+): controls how disabled inputs are
     * rendered. `"Control"` (default) keeps each field as a non-editable input
     * control; `"Text"` renders the value as plain text. Ignored when
     * `readOnly` is false.
     */
    readOnlyStyle?: "Control" | "Text";
    /** Popup-style page (sets popupWidth/popupHeight). Default false. */
    popup?: boolean;
    popupWidth?: number;
    popupHeight?: number;
}
/**
 * Data types for module Constants. Matches the subset of `datatypes.DataType`
 * that `constants.Constant.type` legitimately accepts in 10.x metamodel. Long
 * is intentionally absent — see `RestParameterDataType` for the rationale.
 */
export type ConstantDataType = "String" | "Integer" | "Decimal" | "Boolean" | "DateTime";
export interface CreateConstantArgs {
    moduleName: string;
    constantName: string;
    dataType: ConstantDataType;
    /**
     * Optional default value, stored verbatim on `Constant.defaultValue`. The SDK
     * does not validate the string against `dataType`; callers must pass a form
     * Studio Pro will accept (e.g. `"0"` for Integer, `"true"` for Boolean,
     * ISO-8601 for DateTime). Omit to leave empty.
     */
    defaultValue?: string;
    documentation?: string;
    /**
     * Whether the constant is exposed to the client (`Constant.exposedToClient`,
     * Mendix 8.2+). Defaults to false — the Studio Pro default for new
     * constants.
     */
    exposedToClient?: boolean;
    /**
     * Optional folder qualified name (e.g. `"MyModule.Settings"`). When omitted,
     * the constant is created at module root.
     */
    folderQualifiedName?: string;
    /**
     * If a constant with the same name already exists at the resolved container,
     * `overwrite: true` deletes the old one before creating the new one.
     * Defaults to false — the tool errors instead.
     */
    overwrite?: boolean;
}
export interface ListConstantsArgs {
    moduleName?: string;
}
export interface UpdateConstantArgs {
    constantName: string;
    moduleName?: string;
    defaultValue?: string;
    exposedToClient?: boolean;
    documentation?: string;
}
export interface ConfigureConstantValuesArgs {
    configurationName: string;
    constantName: string;
    moduleName?: string;
    value: string;
}
export interface ListEnumerationsArgs {
    moduleName?: string;
}
export interface UpdateEnumerationArgs {
    enumerationName: string;
    moduleName?: string;
    addValues?: EnumerationValueInput[];
    removeValues?: string[];
}
export interface RenameEnumerationValueArgs {
    enumerationName: string;
    valueName: string;
    newName: string;
    moduleName?: string;
}
export type RestHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
/**
 * Data type for REST OperationParameter values.
 *
 * The SDK's `datatypes` namespace only exposes `IntegerType` — there is no
 * separate `LongType` and no precision/size flag — so attempting to model a
 * Long here would silently collapse to Integer at write time and read back as
 * Integer. Long is intentionally omitted from this enum to avoid that
 * fidelity gap; callers expecting a Long should use `Integer` and rely on the
 * Mendix Studio Pro UI to render the Integer/Long distinction from context.
 */
export type RestParameterDataType = "String" | "Integer" | "Decimal" | "Boolean" | "DateTime";
export interface RestAuthenticationSpec {
    type: "none" | "basic";
    username?: string;
    password?: string;
    usernameConstantQN?: string;
    passwordConstantQN?: string;
}
export interface CreateConsumedRestServiceArgs {
    moduleName: string;
    serviceName: string;
    baseUrl: string;
    documentation?: string;
    folderQualifiedName?: string;
    authentication?: RestAuthenticationSpec;
}
export interface ListConsumedRestServicesArgs {
    moduleName?: string;
}
export interface ReadConsumedRestServiceArgs {
    serviceQualifiedName: string;
}
export interface ConfigureRestAuthenticationArgs {
    serviceQualifiedName: string;
    authentication: RestAuthenticationSpec;
}
export interface RestPathParameterSpec {
    name: string;
    dataType?: RestParameterDataType;
}
export interface RestQueryParameterSpec {
    name: string;
    usage?: "required" | "optional";
    included?: boolean;
    testValue?: string;
}
export interface RestHeaderSpec {
    name: string;
    value: string;
}
export interface RestBodySpec {
    type: "none" | "json" | "jsonWithExportMapping" | "string";
    exportMappingQualifiedName?: string;
    rawExpression?: string;
}
export interface RestResponseHandlingSpec {
    type: "none" | "implicitMapping";
    importMappingQualifiedName?: string;
    statusCode?: number;
    contentType?: string;
}
export interface AddRestOperationArgs {
    serviceQualifiedName: string;
    operationName: string;
    method: RestHttpMethod;
    path: string;
    timeout?: number;
    pathParameters?: RestPathParameterSpec[];
    queryParameters?: RestQueryParameterSpec[];
    headers?: RestHeaderSpec[];
    body?: RestBodySpec;
    responseHandling?: RestResponseHandlingSpec;
}
export interface UpdateRestOperationArgs {
    operationQualifiedName: string;
    newName?: string;
    method?: RestHttpMethod;
    path?: string;
    timeout?: number;
    pathParameters?: RestPathParameterSpec[];
    queryParameters?: RestQueryParameterSpec[];
    headers?: RestHeaderSpec[];
    body?: RestBodySpec;
    responseHandling?: RestResponseHandlingSpec;
}
export interface ImportOpenApiSpecOptions {
    overwriteExistingOperations?: boolean;
    generateStructures?: boolean;
    structuresFolder?: string;
    mappingsFolder?: string;
    tagFilter?: string[];
    operationFilter?: string[];
    allowInsecureHttp?: boolean;
}
export interface ImportOpenApiSpecArgs {
    moduleName: string;
    serviceName: string;
    source: {
        type: "url" | "inline" | "file";
        url?: string;
        content?: string;
        path?: string;
    };
    options?: ImportOpenApiSpecOptions;
}
/**
 * One credential constant for the orchestrator. Materialised via Tool 17
 * (`create_constant`). `value` is stored verbatim on `Constant.defaultValue`
 * — pass an empty string when the real secret will be set in Mendix Cloud
 * configuration. `moduleName` defaults to the `service.moduleName`.
 */
export interface DefineRestCallCredentialSpec {
    name: string;
    value?: string;
    dataType?: ConstantDataType;
    documentation?: string;
    exposedToClient?: boolean;
    folderQualifiedName?: string;
    moduleName?: string;
    overwrite?: boolean;
}
/**
 * Service half of the orchestrator envelope. Mirrors
 * `CreateConsumedRestServiceArgs` 1:1 — the orchestrator forwards each field
 * to Tool 95. When the service already exists and `authentication` is
 * supplied, the orchestrator re-applies it via Tool 101.
 */
export interface DefineRestCallServiceSpec {
    moduleName: string;
    serviceName: string;
    baseUrl: string;
    documentation?: string;
    folderQualifiedName?: string;
    authentication?: RestAuthenticationSpec;
}
/**
 * Operation half of the orchestrator envelope. Same shape as
 * `AddRestOperationArgs` minus `serviceQualifiedName` (derived from
 * `service.moduleName.serviceName`) and with `operationName` renamed to
 * `name` for terseness. Mutually exclusive with `import` at the
 * orchestrator level.
 */
export interface DefineRestCallOperationSpec {
    name: string;
    method: RestHttpMethod;
    path: string;
    timeout?: number;
    pathParameters?: RestPathParameterSpec[];
    queryParameters?: RestQueryParameterSpec[];
    headers?: RestHeaderSpec[];
    body?: RestBodySpec;
    responseHandling?: RestResponseHandlingSpec;
}
/**
 * OpenAPI-import variant of the operation half. The orchestrator dispatches
 * to Tool 98 when this is supplied. Mutually exclusive with `operation`.
 * When `import` is used, `call.operationQualifiedName` must be supplied
 * explicitly because the spec may produce many operations.
 */
export interface DefineRestCallImportSpec {
    source: ImportOpenApiSpecArgs["source"];
    options?: ImportOpenApiSpecOptions;
}
/**
 * Microflow-call half of the orchestrator envelope. Creates a thin
 * microflow with a single `RestOperationCall` activity wired between
 * `start` and `end`. The caller controls the microflow's parameters and
 * return type — the orchestrator does not auto-derive them from the
 * operation, by design.
 *
 * `operationQualifiedName` is optional when `operation` is present in the
 * envelope (the orchestrator resolves it from
 * `<service>.<operation.name>`); it is required when `import` is used,
 * since the OpenAPI document may produce many operations.
 */
export interface DefineRestCallCallSpec {
    moduleName?: string;
    microflowName: string;
    documentation?: string;
    returnType?: ReturnTypeSpec;
    returnVariableName?: string;
    overwrite?: boolean;
    parameters?: ParameterSpec[];
    caption?: string;
    activityId?: string;
    operationQualifiedName?: string;
    parameterMappings?: RestOperationParameterMappingSpec[];
    queryParameterMappings?: RestQueryParameterMappingSpec[];
    bodyVariableName?: string;
    outputVariableName?: string;
}
/**
 * Top-level input for `define_rest_call`. Single canonical envelope that an
 * upstream caller assembles once; the orchestrator splits it into Tools
 * 17 → 95 → 99|98 → 101 (when re-applying on an existing service) → 25.
 *
 * - `service` is always required.
 * - `credentials[]` is optional — populate when `service.authentication`
 *   references `*ConstantQN` slots that do not yet exist.
 * - `operation` XOR `import` (or neither, if `call` references an
 *   already-existing operation by qualified name).
 * - `call` is optional — when omitted, the orchestrator stops after the
 *   service/operation are authored.
 */
export interface DefineRestCallArgs {
    service: DefineRestCallServiceSpec;
    credentials?: DefineRestCallCredentialSpec[];
    operation?: DefineRestCallOperationSpec;
    import?: DefineRestCallImportSpec;
    call?: DefineRestCallCallSpec;
}
export {};
