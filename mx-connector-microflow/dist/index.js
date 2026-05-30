#!/usr/bin/env node
console.log = console.error;
console.info = console.error;
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { setPlatformConfig } from "mendixplatformsdk";
import { appendRulePointers } from "./ruleTelemetry.js";
import { openWorkingCopy, commitWorkingCopy, discardWorkingCopy, } from "./workingCopyManager.js";
import { listEnumerations } from "./enumerationBuilder.js";
import { listConstants } from "./constantBuilder.js";
import { readDomainModel } from "./domainModelReader.js";
import { createMicroflow } from "./microflowBuilder.js";
import { listMicroflows, readMicroflowDetails, readMicroflowSecurity, } from "./microflowReader.js";
import { createMicroflowActivities, insertBeforeActivity, modifyMicroflowActivity, setMicroflowUrl, updateMicroflow, } from "./microflowOperations.js";
import { arrangeMicroflows } from "./microflowArranger.js";
import { queryModelElements, copyModelElement, deleteDocument, excludeDocument, renameDocument, setDocumentation, validateName, checkVariableName, } from "./modelUtilities.js";
import { state, getClient, requireAppId, requireWorkingCopy, } from "./session.js";
// Suppress unused-import warning — requireAppId is kept for forward-compat
void requireAppId;
const server = new Server({ name: "mx-connector-microflow", version: "0.1.0" }, { capabilities: { tools: {} } });
const tools = [
    // ─── Session setup ───────────────────────────────────────────────────────
    {
        name: "configure_token",
        description: "Configure the Mendix Personal Access Token (PAT) used to authenticate with the Mendix Platform. Must be called before any other tool.",
        inputSchema: {
            type: "object",
            properties: {
                token: {
                    type: "string",
                    description: "Mendix Personal Access Token (created at https://warden.mendix.com)",
                },
            },
            required: ["token"],
        },
    },
    {
        name: "configure_app",
        description: "Configure the Mendix App ID to work with. Requires configure_token to be called first.",
        inputSchema: {
            type: "object",
            properties: {
                appId: {
                    type: "string",
                    description: "Mendix App ID (also known as project ID)",
                },
            },
            required: ["appId"],
        },
    },
    {
        name: "ping",
        description: "Health check — returns pong with an optional echoed message.",
        inputSchema: {
            type: "object",
            properties: {
                message: {
                    type: "string",
                    description: "Optional message to echo back",
                },
            },
        },
    },
    // ─── Working copy lifecycle ──────────────────────────────────────────────
    {
        name: "open_working_copy",
        description: "Open an online working copy from the configured app on the given branch and store the handle in session state. Subsequent builder tools operate against this working copy until commit_working_copy is called. If a working copy is already open in the session, the existing handle is returned with reused=true and the branchName argument is silently ignored. Session state is in-memory only: if the server process crashes between open_working_copy and commit_working_copy, the handle is lost and the full chain (configure_token → configure_app → open_working_copy) must be re-run.",
        inputSchema: {
            type: "object",
            properties: {
                branchName: {
                    type: "string",
                    description: "Branch to base the working copy on. Defaults to 'main' (Git) or 'trunk' (SVN). Stored in session state and used as the default for commit_working_copy.",
                },
                commitId: {
                    type: "string",
                    description: "Optional commit id to start the working copy from.",
                },
            },
        },
    },
    {
        name: "commit_working_copy",
        description: "Flush in-memory model changes to the online working copy, commit the working copy to the repository, and clear the session's working-copy handle. Requires open_working_copy to have been called. If flushChanges() or commitToRepository() throws, the error is propagated and the session handle is NOT cleared — the caller may retry commit_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                commitMessage: {
                    type: "string",
                    description: "Commit message. Defaults to 'Update via mx-connector-microflow'.",
                },
                branchName: {
                    type: "string",
                    description: "Optional branch name override. Defaults to the branch the working copy was opened on.",
                },
            },
        },
    },
    {
        name: "discard_working_copy",
        description: "Abandon the current session's working copy WITHOUT committing. Clears the in-memory handle so that the next open_working_copy creates a fresh one. Requires open_working_copy to have been called.",
        inputSchema: {
            type: "object",
            properties: {
                reason: {
                    type: "string",
                    description: "Optional free-text reason for abandoning the working copy.",
                },
            },
        },
    },
    // ─── Read context tools (domain model, enumerations, constants) ──────────
    {
        name: "read_domain_model",
        description: "Read-only inspector: returns the domain model (entities, attributes, associations, generalizations) for one module or for all non-Marketplace modules in the open working copy. Use this to discover entity QNs, attribute names, and association names needed for microflow authoring. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                moduleName: {
                    type: "string",
                    description: "Module to read (e.g. 'RequestsOverview'). If omitted, all modules with fromAppStore=false are returned.",
                },
            },
        },
    },
    {
        name: "list_enumerations",
        description: "Read-only enumerator for Enumeration documents. Returns each enumeration's qualified name, documentation, ordered values with en_US captions. Use this to discover enum value names for microflow expressions. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                moduleName: {
                    type: "string",
                    description: "Optional. Restrict to a single module. Searches all non-Marketplace modules if omitted.",
                },
            },
        },
    },
    {
        name: "list_constants",
        description: "Read-only enumerator for Constant documents. Returns name, qualifiedName, moduleName, dataType, defaultValue, exposedToClient. Use to discover constant QNs for microflow expressions. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                moduleName: {
                    type: "string",
                    description: "Optional. Restrict to a single module. Searches all non-Marketplace modules if omitted.",
                },
            },
        },
    },
    // ─── Microflow read tools ────────────────────────────────────────────────
    {
        name: "list_microflows",
        description: "List all Microflows in a module, or across the whole project when moduleName is omitted. Reads directly from the open working copy. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                moduleName: {
                    type: "string",
                    description: "Optional module to scope the listing. When omitted, returns microflows from every non-Marketplace module.",
                },
            },
        },
    },
    {
        name: "read_microflow_details",
        description: "Read the full configuration of a single Microflow: parameters with types, return type, settings (allowConcurrentExecution, applyEntityAccess, url), and every activity in objectCollection order (1-based position). Use this to find the position values needed by modify_microflow_activity and insert_before_activity. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                microflowName: {
                    type: "string",
                    description: "Microflow name or qualified name (e.g. 'Module.ACT_Foo'). Qualified name is preferred for deterministic resolution.",
                },
                moduleName: {
                    type: "string",
                    description: "Optional module name. Required when microflowName is a short name and the same name exists in multiple modules.",
                },
            },
            required: ["microflowName"],
        },
    },
    {
        name: "read_microflow_security",
        description: "Read the security configuration of one or more Microflows (and optionally Nanoflows): the module roles allowed to execute the flow and the applyEntityAccess flag. Read-only. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                microflowName: {
                    type: "string",
                    description: "Optional. Microflow short name or qualified name. Omit to scan all microflows in scope.",
                },
                moduleName: {
                    type: "string",
                    description: "Optional. Scopes the scan to a single module.",
                },
                include_nanoflows: { type: "boolean", default: false },
            },
        },
    },
    // ─── Microflow write tools ───────────────────────────────────────────────
    {
        name: "create_microflow",
        description: "Create a new Microflow in a module with parameters, activities, and flows. Supports all common activity types: CreateObject, ChangeObject, CommitObject, DeleteObject, Retrieve, CreateVariable, ChangeVariable, CallMicroflow, LogMessage, AggregateList, ListOperation, ShowMessage, ShowPage, ClosePage, ValidationFeedback, ExclusiveSplit, LoopedActivity. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                moduleName: {
                    type: "string",
                    description: "Module where the microflow will be created.",
                },
                microflowName: {
                    type: "string",
                    description: "Microflow name. Convention: ACT_ (action), VAL_ (validation), SUB_ (sub-flow), SCH_ (scheduled).",
                },
                documentation: { type: "string" },
                returnType: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: [
                                "Void",
                                "Boolean",
                                "String",
                                "Integer",
                                "Long",
                                "Decimal",
                                "DateTime",
                                "Object",
                                "List",
                            ],
                        },
                        entityQualifiedName: {
                            type: "string",
                            description: "Required for Object/List types.",
                        },
                    },
                    required: ["type"],
                },
                returnVariableName: {
                    type: "string",
                    description: "Variable to return (must exist in parameters or activity outputs).",
                },
                allowConcurrentExecution: { type: "boolean", default: true },
                applyEntityAccess: { type: "boolean", default: true },
                overwrite: {
                    type: "boolean",
                    default: false,
                    description: "If true and microflow exists, delete and recreate it.",
                },
                parameters: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            type: {
                                type: "object",
                                properties: {
                                    type: {
                                        type: "string",
                                        enum: [
                                            "Boolean",
                                            "String",
                                            "Integer",
                                            "Long",
                                            "Decimal",
                                            "DateTime",
                                            "Object",
                                            "List",
                                        ],
                                    },
                                    entityQualifiedName: { type: "string" },
                                },
                                required: ["type"],
                            },
                        },
                        required: ["name", "type"],
                    },
                },
                activities: {
                    type: "array",
                    description: "List of activity objects. Each must have 'id' (unique) and 'type'.",
                    items: { type: "object" },
                },
                flows: {
                    type: "array",
                    description: "Sequence flows connecting activities. Use 'start'/'end' for the terminal events.",
                    items: {
                        type: "object",
                        properties: {
                            from: { type: "string" },
                            to: { type: "string" },
                            condition: {
                                type: "string",
                                description: "Required for ExclusiveSplit outgoing flows.",
                            },
                            branch: {
                                type: "boolean",
                                description: "Optional layout override. true = draw this flow as a branch (downward); false = draw as main path (right).",
                            },
                        },
                        required: ["from", "to"],
                    },
                },
                autoTranslateEnumLiterals: {
                    type: "boolean",
                    description: "Opt-in: when a value expression like \"'VALUE'\" is written into an " +
                        "enum-typed slot, rewrite it to the FQN form `Module.Enum.VALUE` instead of " +
                        "throwing. Default: false (throw). See specs/rules/enum_value_in_expression.md.",
                    default: false,
                },
            },
            required: ["moduleName", "microflowName", "activities", "flows"],
        },
    },
    {
        name: "create_microflow_activities",
        description: "Append one or more activities to the end of an existing Microflow. Activities use the flat activity_type schema (see Tool 26 spec). Pre-flight resolves all qualified names before mutating; nothing is created if any QN is invalid. Does NOT create SequenceFlows — caller must wire the new activities or use create_microflow with full graph instead. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                microflowName: {
                    type: "string",
                    description: "Microflow name or qualified name.",
                },
                moduleName: {
                    type: "string",
                    description: "Module containing the microflow. Required for short-name lookups across multiple modules.",
                },
                activities: {
                    type: "array",
                    minItems: 1,
                    items: { type: "object" },
                    description: "Each entry must have an 'activity_type' (eg. 'create_object', 'log_message') and the corresponding configuration fields.",
                },
                autoTranslateEnumLiterals: {
                    type: "boolean",
                    description: "Opt-in enum literal auto-translation. Default: false.",
                    default: false,
                },
            },
            required: ["microflowName", "activities"],
        },
    },
    {
        name: "modify_microflow_activity",
        description: "Edit properties on a single activity inside a Microflow at a given 1-based position (use read_microflow_details to find the position). Throws if position points to StartEvent/EndEvent or a field is not applicable to the activity's type. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                microflowName: { type: "string" },
                moduleName: { type: "string" },
                position: {
                    type: "integer",
                    minimum: 1,
                    description: "1-based position of the activity in objectCollection.objects.",
                },
                caption: { type: "string" },
                disabled: { type: "boolean" },
                output_variable: { type: "string" },
                commit: { type: "string", enum: ["Yes", "YesWithoutEvents", "No"] },
                refresh_in_client: { type: "boolean" },
                with_events: { type: "boolean" },
                use_return_variable: { type: "boolean" },
                commit_variable: { type: "string" },
                rollback_variable: { type: "string" },
                delete_variable: { type: "string" },
                change_variable: { type: "string" },
            },
            required: ["microflowName", "position"],
        },
    },
    {
        name: "insert_before_activity",
        description: "Insert a new activity into an existing Microflow before the activity at before_position (1-based). Uses the detached-then-splice pattern so children of an attached objectCollection are not disturbed. Does NOT auto-create or rewire SequenceFlows — caller must verify the flow graph after insert. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                microflowName: { type: "string" },
                moduleName: { type: "string" },
                before_position: {
                    type: "integer",
                    minimum: 1,
                    description: "Insert position; activities at and after this position shift by +1. Range 1..N+1 (where N = current object count).",
                },
                activity: {
                    type: "object",
                    description: "Activity spec using the same flat activity_type schema as create_microflow_activities.",
                },
                autoTranslateEnumLiterals: {
                    type: "boolean",
                    description: "Opt-in enum literal auto-translation. Default: false.",
                    default: false,
                },
            },
            required: ["microflowName", "before_position", "activity"],
        },
    },
    {
        name: "update_microflow",
        description: "Update the return type, return variable name, and/or REST URL on an existing Microflow. Only provided fields are touched. Note: changing returnType does NOT update existing EndEvent return-value expressions — recreate the microflow with create_microflow + overwrite if the return type changes. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                microflowName: { type: "string" },
                moduleName: { type: "string" },
                returnType: {
                    type: "string",
                    description: "void | boolean | string | integer | long | decimal | float | datetime | object:Module.Entity | list:Module.Entity",
                },
                returnVariableName: { type: "string" },
                url: {
                    type: "string",
                    description: "REST URL path. Pass an empty string to clear it.",
                },
            },
            required: ["microflowName"],
        },
    },
    {
        name: "set_microflow_url",
        description: "Read or set the REST URL path of a Microflow. Without 'url' the current value is returned (or '(none)' if unset). Pass 'url' (empty string clears) to write. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                microflowName: { type: "string" },
                moduleName: { type: "string" },
                url: {
                    type: "string",
                    description: "URL path (e.g. '/api/v1/myendpoint'). Omit to read the current value. Empty string clears.",
                },
            },
            required: ["microflowName"],
        },
    },
    {
        name: "microflow_arrange",
        description: "Auto-arrange a microflow canvas using the flow-aware algorithm: StartEvent at (0,0), main flow drawn horizontally to the right (X_STEP=220), ExclusiveSplit/InheritanceSplit branches (false case) drawn downward (Y_STEP=160). Scope: single microflow (microflowName), all microflows in a module (moduleName), or all user-module microflows in the project (neither given). Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                microflowName: {
                    type: "string",
                    description: "Short name or FQN of a single microflow to arrange. Provide moduleName to disambiguate short names.",
                },
                moduleName: {
                    type: "string",
                    description: "Module name. Without microflowName: arranges all microflows in the module. With microflowName: narrows the search scope.",
                },
                branchOverrides: {
                    type: "array",
                    description: "Per-split overrides for which case is the main (happy) path. Default rule: 'true' = main (drawn right), 'false' = branch (drawn down).",
                    items: {
                        type: "object",
                        properties: {
                            captionContains: {
                                type: "string",
                                description: "Case-insensitive substring matched against the ExclusiveSplit/InheritanceSplit caption.",
                            },
                            mainCase: {
                                type: "string",
                                enum: ["true", "false"],
                                description: "Which case value becomes the main (right-going) path for matching splits.",
                            },
                        },
                        required: ["captionContains", "mainCase"],
                    },
                },
            },
            required: [],
        },
    },
    // ─── Model utilities (microflow-relevant subset) ─────────────────────────
    {
        name: "query_model_elements",
        description: "Read-only generic query over the working copy's metamodel. Filters elements by case-insensitive substring of their structureTypeName (e.g. 'Microflows$Microflow'). Returns up to maxResults entries (default 50). Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                typeName: {
                    type: "string",
                    description: "Substring of structureTypeName to match (case-insensitive). Examples: 'Microflows$Microflow', 'DomainModels$Entity'.",
                },
                moduleName: {
                    type: "string",
                    description: "Optional. Limit search to a specific module. If omitted, scans all non-Marketplace modules.",
                },
                includeProperties: {
                    type: "boolean",
                    default: false,
                    description: "If true, load each match and include 'documentation' on the output.",
                },
                maxResults: {
                    type: "integer",
                    minimum: 1,
                    default: 50,
                    description: "Cap on returned entries.",
                },
            },
            required: ["typeName"],
        },
    },
    {
        name: "copy_model_element",
        description: "Deep-copy a single microflow (or entity/constant/enumeration) to a new name in the same module or a different module. Microflow: copies parameters only — activities and flows are NOT copied (the result is an empty microflow with the same parameter list). Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                elementType: {
                    type: "string",
                    enum: ["entity", "microflow", "constant", "enumeration"],
                },
                sourceName: { type: "string" },
                newName: { type: "string" },
                sourceModule: {
                    type: "string",
                    description: "Optional. Module containing the source element. If omitted, searches all non-Marketplace modules.",
                },
                targetModule: {
                    type: "string",
                    description: "Optional. Defaults to sourceModule.",
                },
            },
            required: ["elementType", "sourceName", "newName"],
        },
    },
    {
        name: "delete_document",
        description: "Delete a Document (microflow, nanoflow, etc.) from a specific module. moduleName is REQUIRED. Pass documentType to filter when multiple documents share a name. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                documentName: { type: "string" },
                moduleName: { type: "string" },
                documentType: {
                    type: "string",
                    enum: [
                        "page",
                        "microflow",
                        "nanoflow",
                        "snippet",
                        "layout",
                        "buildingblock",
                    ],
                    description: "Optional type filter to disambiguate documents sharing a name.",
                },
            },
            required: ["documentName", "moduleName"],
        },
    },
    {
        name: "exclude_document",
        description: "Toggle the 'excluded' flag on a Document so it is skipped during compile/deploy. Pass excluded=false to include the document again. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                documentName: { type: "string" },
                moduleName: { type: "string" },
                excluded: {
                    type: "boolean",
                    default: true,
                    description: "true to exclude (default), false to re-include.",
                },
                documentType: {
                    type: "string",
                    enum: [
                        "page",
                        "microflow",
                        "nanoflow",
                        "snippet",
                        "layout",
                        "buildingblock",
                    ],
                },
            },
            required: ["documentName"],
        },
    },
    {
        name: "rename_document",
        description: "Rename a Document (microflow, etc.) by setting its .name. WARNING: this tool does NOT propagate the rename to references. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                documentName: {
                    type: "string",
                    description: "Current name (short name or qualified 'Module.Name').",
                },
                newName: { type: "string" },
                moduleName: { type: "string" },
                documentType: {
                    type: "string",
                    enum: [
                        "page",
                        "microflow",
                        "nanoflow",
                        "snippet",
                        "layout",
                        "buildingblock",
                        "constant",
                        "enumeration",
                    ],
                },
            },
            required: ["documentName", "newName"],
        },
    },
    {
        name: "set_documentation",
        description: "Write documentation text on an entity, attribute, association, or domain model. Pass an empty string to clear. Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                elementType: {
                    type: "string",
                    enum: ["entity", "attribute", "association", "domain_model"],
                },
                documentation: { type: "string" },
                elementName: { type: "string" },
                moduleName: { type: "string" },
                entityName: { type: "string" },
                attributeName: { type: "string" },
            },
            required: ["elementType", "documentation"],
        },
    },
    {
        name: "validate_name",
        description: "Local utility — does NOT require a working copy. Checks whether a candidate string is a valid Mendix identifier. When autoFix=true and the name is invalid, returns a sanitized fixedName suggestion.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string" },
                autoFix: {
                    type: "boolean",
                    default: false,
                    description: "If true and name is invalid, returns a sanitized 'fixedName' suggestion.",
                },
            },
            required: ["name"],
        },
    },
    {
        name: "check_variable_name",
        description: "Inspect a single Microflow and report whether a candidate variable name is already used. Walks parameters and every action's outputVariableName / variableName, recursing into LoopedActivity bodies. When the name is taken, returns a numeric-suffix suggestion ('foo' → 'foo2', 'foo3', ...). Requires open_working_copy.",
        inputSchema: {
            type: "object",
            properties: {
                microflowName: {
                    type: "string",
                    description: "Short name or qualified 'Module.Microflow'.",
                },
                variableName: { type: "string" },
                moduleName: { type: "string" },
            },
            required: ["microflowName", "variableName"],
        },
    },
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
function textResult(text) {
    return { content: [{ type: "text", text }] };
}
function extractErrorMessage(err) {
    if (err instanceof Error) {
        return err.message || err.name || err.toString() || "<empty Error>";
    }
    if (typeof err === "string")
        return err;
    if (err !== null && err !== undefined && typeof err === "object") {
        const e = err;
        if (typeof e.message === "string" && e.message.length > 0)
            return e.message;
        if (typeof e.toString === "function") {
            const s = e.toString();
            if (s && s !== "[object Object]")
                return s;
        }
        try {
            const json = JSON.stringify(err);
            if (json && json !== "{}")
                return json;
        }
        catch {
            /* fall through */
        }
    }
    return String(err);
}
async function dispatchTool(request) {
    try {
        const { name, arguments: args } = request.params;
        switch (name) {
            case "configure_token": {
                const { token } = args;
                if (!token?.trim())
                    throw new Error("token must be a non-empty string.");
                state.token = token.trim();
                setPlatformConfig({ mendixToken: state.token });
                return textResult("Access token configured successfully.");
            }
            case "configure_app": {
                const { appId } = args;
                if (!appId?.trim())
                    throw new Error("appId must be a non-empty string.");
                const client = getClient();
                client.getApp(appId.trim());
                state.appId = appId.trim();
                return textResult(`Configured app: ${state.appId}`);
            }
            case "ping": {
                const message = args?.message;
                return textResult(message ? `pong: ${message}` : "pong");
            }
            case "open_working_copy": {
                const result = await openWorkingCopy((args ?? {}));
                return textResult(result.reused
                    ? `Reusing open working copy: ${result.workingCopyId} (branch: ${result.branchName}).`
                    : `Opened working copy: ${result.workingCopyId} (branch: ${result.branchName}).`);
            }
            case "commit_working_copy": {
                const result = await commitWorkingCopy((args ?? {}));
                return textResult(`Committed working copy ${result.workingCopyId} to branch ${result.branchName}. Message: "${result.commitMessage}"`);
            }
            case "discard_working_copy": {
                const result = await discardWorkingCopy((args ?? {}));
                return textResult(`Discarded working copy ${result.workingCopyId} (branch: ${result.branchName}). ` +
                    `Reason: ${result.reason}. ` +
                    `Call open_working_copy to start a fresh session-bound working copy.`);
            }
            // ─── Read context ──────────────────────────────────────────────────────
            case "read_domain_model": {
                const { model } = requireWorkingCopy();
                const input = (args ?? {});
                const result = await readDomainModel(model, input);
                return textResult(JSON.stringify(result, null, 2));
            }
            case "list_enumerations": {
                const { model } = requireWorkingCopy();
                const input = (args ?? {});
                const result = await listEnumerations(model, input);
                return textResult(JSON.stringify(result, null, 2));
            }
            case "list_constants": {
                const { model } = requireWorkingCopy();
                const input = (args ?? {});
                const result = await listConstants(model, input);
                return textResult(JSON.stringify(result, null, 2));
            }
            // ─── Microflow read ────────────────────────────────────────────────────
            case "list_microflows": {
                const { model } = requireWorkingCopy();
                const input = (args ?? {});
                const text = await listMicroflows(model, input);
                return textResult(text);
            }
            case "read_microflow_details": {
                const { model } = requireWorkingCopy();
                const input = args;
                const text = await readMicroflowDetails(model, input);
                return textResult(text);
            }
            case "read_microflow_security": {
                const { model } = requireWorkingCopy();
                const input = (args ?? {});
                const text = await readMicroflowSecurity(model, input);
                return textResult(text);
            }
            // ─── Microflow write ───────────────────────────────────────────────────
            case "create_microflow": {
                const { model } = requireWorkingCopy();
                const input = args;
                const autoTranslate = args.autoTranslateEnumLiterals === true;
                const result = await createMicroflow(model, input, autoTranslate);
                if (result.alreadyExisted) {
                    return textResult(`Microflow "${result.moduleName}.${result.microflowName}" already exists — no changes made.`);
                }
                return textResult([
                    `Microflow ${result.overwritten ? "replaced" : "created"}: ${result.moduleName}.${result.microflowName}`,
                    `Activities: ${result.activitiesCreated}`,
                    `Parameters: ${result.parametersCreated}`,
                    ...(result.warnings.length
                        ? [
                            `Warnings:\n${result.warnings.map((w) => `  - ${w}`).join("\n")}`,
                        ]
                        : []),
                ].join("\n"));
            }
            case "create_microflow_activities": {
                const { model } = requireWorkingCopy();
                const rawArgs = args;
                const autoTranslate = rawArgs.autoTranslateEnumLiterals === true;
                const input = {
                    ...args,
                    autoTranslateEnumLiterals: autoTranslate,
                };
                const result = await createMicroflowActivities(model, input);
                return textResult([
                    result.text,
                    ...(result.warnings.length
                        ? [
                            `Warnings:\n${result.warnings.map((w) => `  - ${w}`).join("\n")}`,
                        ]
                        : []),
                ].join("\n"));
            }
            case "modify_microflow_activity": {
                const { model } = requireWorkingCopy();
                const input = args;
                const text = await modifyMicroflowActivity(model, input);
                return textResult(text);
            }
            case "insert_before_activity": {
                const { model } = requireWorkingCopy();
                const rawArgs = args;
                const autoTranslate = rawArgs.autoTranslateEnumLiterals === true;
                const input = {
                    ...args,
                    autoTranslateEnumLiterals: autoTranslate,
                };
                const result = await insertBeforeActivity(model, input);
                return textResult([
                    result.text,
                    ...(result.warnings.length
                        ? [
                            `Warnings:\n${result.warnings.map((w) => `  - ${w}`).join("\n")}`,
                        ]
                        : []),
                ].join("\n"));
            }
            case "update_microflow": {
                const { model } = requireWorkingCopy();
                const input = args;
                const text = await updateMicroflow(model, input);
                return textResult(text);
            }
            case "set_microflow_url": {
                const { model } = requireWorkingCopy();
                const input = args;
                const text = await setMicroflowUrl(model, input);
                return textResult(text);
            }
            case "microflow_arrange": {
                const { model } = requireWorkingCopy();
                const input = args;
                const result = await arrangeMicroflows(model, input);
                const suffix = `\n(Changes are not committed — call commit_working_copy when done.)`;
                if (result.scope === "single") {
                    return textResult(`Arranged microflow '${result.singleFqn}' (${result.singleObjectCount} objects).${suffix}`);
                }
                if (result.scope === "module") {
                    if (result.empty) {
                        return textResult(`No microflows found in module '${result.moduleName}'.`);
                    }
                    const nameList = (result.microflowNames ?? []).join(", ");
                    return textResult(`Arranged ${result.microflowCount} microflow(s) in module '${result.moduleName}': ${nameList}.${suffix}`);
                }
                if (result.noUserModules) {
                    return textResult(`No user modules found in working copy.`);
                }
                if (result.empty) {
                    return textResult(`No microflows found in project.`);
                }
                return textResult(`Arranged ${result.microflowCount} microflow(s) across ${result.moduleCount} module(s).${suffix}`);
            }
            // ─── Model utilities ───────────────────────────────────────────────────
            case "query_model_elements": {
                const { model } = requireWorkingCopy();
                const input = args;
                const result = await queryModelElements(model, input);
                return textResult(JSON.stringify(result, null, 2));
            }
            case "copy_model_element": {
                const { model } = requireWorkingCopy();
                const input = args;
                const result = await copyModelElement(model, input);
                return textResult(JSON.stringify(result, null, 2));
            }
            case "delete_document": {
                const { model } = requireWorkingCopy();
                const input = args;
                const result = await deleteDocument(model, input);
                return textResult(JSON.stringify(result, null, 2));
            }
            case "exclude_document": {
                const { model } = requireWorkingCopy();
                const input = args;
                const result = await excludeDocument(model, input);
                return textResult(JSON.stringify(result, null, 2));
            }
            case "rename_document": {
                const { model } = requireWorkingCopy();
                const input = args;
                const result = await renameDocument(model, input);
                return textResult(JSON.stringify(result, null, 2));
            }
            case "set_documentation": {
                const { model } = requireWorkingCopy();
                const input = args;
                const result = await setDocumentation(model, input);
                return textResult(JSON.stringify(result, null, 2));
            }
            case "validate_name": {
                const input = args;
                const result = validateName(input);
                return textResult(JSON.stringify(result, null, 2));
            }
            case "check_variable_name": {
                const { model } = requireWorkingCopy();
                const input = args;
                const result = await checkVariableName(model, input);
                return textResult(JSON.stringify(result, null, 2));
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (err) {
        return {
            content: [{ type: "text", text: `Error: ${extractErrorMessage(err)}` }],
            isError: true,
        };
    }
}
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const result = await dispatchTool(request);
    const isError = result.isError === true;
    if (!isError &&
        Array.isArray(result.content) &&
        result.content[0]?.type === "text" &&
        typeof result.content[0].text === "string") {
        result.content[0].text = appendRulePointers(result.content[0].text, toolName);
    }
    return result;
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("mx-connector-microflow MCP server running on stdio");
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map