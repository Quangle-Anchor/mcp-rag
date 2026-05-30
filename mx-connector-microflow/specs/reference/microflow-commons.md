# Microflow Creation – MANDATORY Pre-Creation Checklist

Before creating a microflow model, you MUST:

**Trace all flow paths on paper/mentally:**
- List each possible path from Start to End
- Count how many paths lead to each End Event
- **Critical:** If ANY End Event or Action Activity has >1 incoming path → plan a Merge

**Verify gateway rules:**
- ExclusiveSplit: Does EVERY possible case value have a flow?
- InheritanceSplit: Is there a flow for EACH subtype + empty string?
- End Events: Does each have EXACTLY one incoming flow?

**Check loop boundaries:**
- Are all flows between loop-internal objects staying within the loop?
- Are no flows crossing between `/objects` and `/objects/N/objects`?

**Validate the flow structure before building JSON:**
- Draw or list the flow connections
- Verify connection indices (0=top, 1=right, 2=bottom, 3=left)
- Confirm main flow goes left-to-right, errors go top-to-bottom

> ⚠️ **CRITICAL:** If you cannot mentally trace valid paths for all cases, STOP and redesign before creating.

---

# Microflow Naming Conventions

This skill enables you to create properly named microflows following Mendix best practices. Consistent naming improves code maintainability and helps developers quickly understand a microflow's purpose and trigger.

## Naming Pattern

**Format:** `{PREFIX}_{Entity/Purpose}_{Operation}`

**Example:** `ACT_Vendor_StartWorkflow`

- **PREFIX:** Indicates the event type or trigger (see categories below)
- **Entity/Purpose:** The domain entity or general purpose
- **Operation:** The specific action being performed

## Prefixes

| Prefix | Usage |
|--------|-------|
| `ACT_{Purpose}` | Action button/menu item |
| `CAL_{Entity}_{Attribute}` | Calculated attribute |
| `VAL_{Entity}_{Attribute}` | Validation |
| `OCH_{Purpose}` | On change (input elements) |
| `DS_{Purpose}` | Data source (list/grid/view) |
| `SUB_{Purpose}` | Sub-microflow |
| `TEST_{Purpose}` or `UT_{Purpose}` | Unit test |

## Common Patterns

- **Calculated attributes:** `CAL_Customer_FullName`, `CAL_Order_Total`
- **Validation:** `VAL_Product_Price`, `VAL_Customer_Email`
- **Button actions:** `ACT_Customer_Export`, `ACT_Order_Calculate`
- **Data sources:** `DS_Customer_ActiveList`, `DS_Product_FilteredGrid`
- **Input events:** `OCH_SearchTerm_Filter`
- **Sub-microflows:** `SUB_Email_FormatAddress`, `SUB_Date_CalculateAge`

## Anti-Patterns (DO NOT USE)

- ❌ Generic names without prefixes: `ProcessOrder`, `ValidateData`
- ❌ Inconsistent casing: `act_customer_create`, `ACT_Customer_Create` in same module
- ❌ Wrong prefix for event type: Using `ACT_` for a before-commit event
- ❌ Overly long names: `ACT_Customer_ValidateAndProcessAndSendEmailAndUpdateStatus`
- ❌ Abbreviations without context: `ACT_Cust_Proc` (unclear what "Proc" means)
- ❌ Missing entity/purpose: `ACT_Process`, `SUB_Calculate`

## Best Practices

- ✅ Be specific: `ACT_Order_CalculateTotal` is better than `ACT_Order_Calculate`
- ✅ Use consistent terminology: If you use "Create" in one place, don't use "New" elsewhere
- ✅ Keep operations descriptive: Use action verbs like Create, Update, Delete, Validate, Calculate, Send
- ✅ Include entity name: Makes it clear what data the microflow operates on
- ✅ Group related microflows: Similar prefixes help organize in the App Explorer

## Critical Constraints

> ⚠️ Always use the appropriate prefix for the microflow's trigger or purpose  
> ⚠️ Maintain consistency within a module and across the application  
> ⚠️ Use underscores as separators, not camelCase or spaces  
> ⚠️ Keep names concise but descriptive – aim for clarity over brevity  
> ⚠️ Match the prefix to the actual event – using wrong prefixes leads to confusion  

---

# Mendix Microflow Layout Rules

This skill enables you to create well-structured, readable microflow diagrams following Mendix layout conventions. Microflows are visual business logic diagrams with activities, events, splits, and parameters connected by flows.

## Core Layout Principles

- **Primary flow direction:** Left-to-right (happy path/main flow)
- **Alternative flows:** Top-to-bottom (error handling, edge cases)
- **Grid alignment:** All elements snap to grid for consistency
- **Consistent spacing:** Maintain uniform distances between elements
- **Logical grouping:** Related activities positioned close together
- **Readability first:** Avoid crossing flows when possible

## Parameter Layout

Parameters are input values passed into a microflow (pentagon/house shapes pointing right).

**Positioning Rules:**
- **CRITICAL:** Position directly above the Start Event
- **CRITICAL:** Stack vertically with 100 pixels spacing on the y-axis
- Stack order: Newest parameters go on top

```
[Parameter 3]  ← newest
(+100 px vertical space)
[Parameter 2]
(+100 px vertical space)
[Parameter 1]
(+100 px vertical space)
[Start Event]
```

## Activity Spacing

**Horizontal spacing (left-to-right flow):**
- Standard activities: 200 pixels between activity centers
- After decisions: Position branches with adequate separation

**Vertical spacing (alternative flows):**
- Standard activities: 100 pixels between activity centers
- Split paths: 100 pixels between parallel branches
- Error handlers: Position below main flow with clear separation

## Decision Split Layout

For exclusive splits (XOR/Decision):
- **True/Yes path:** Continue to the right (main flow)
- **False/No path:** Branch downward (alternative)
- Label connections clearly
- Merge paths when logic reconverges

```
[Activity] → [Decision]
                 ↓ (false)
              [Alt Path]
                 ↓
             → [Merge] → [Continue path]
```

## Error Handling Layout

- Error handlers position below the main flow
- Use consistent vertical offset: 200 pixels down
- Connect error paths to appropriate end events or recovery logic
- Keep error handling visually distinct from happy path

## Common Patterns

**Linear Flow (Simple)**
```
[Start] → [Retrieve] → [Change] → [Commit] → [End]
```

**Conditional Flow with Merge**
```
[Start] → [Decision] → [Process A] → [Merge] → [End]
               ↓                        ↑
           [Process B] ─────────────────┘
```

**Conditional Flow without Merge**
```
[Start] → [Decision] → [Process A] → [End]
               ↓
           [Process B]
               ↓
           [End]
```

**Loop Pattern**
```
[Start] → [Retrieve List] → [Loop [Process Sub steps]] → [End]
```

**Error Handling Pattern**
```
[Start] → [Activity (with error handler)] → (success) [End]
                   ↓ (error)
               [Log Error]
                   ↓
               [End Error]
```

## Flows

### Direction

When objects are on the same axis (share the same x or y value), ensure the origin index and destination index align depending on the direction of the flow.

**Horizontal**
```
[Activity] ──────────────→ [Activity]
(origin index right)        (destination index left)
```

**Vertical**
```
[Activity] (origin index bottom)
    ↓
[Activity] (destination index top)
```

## Best Practices

- ✅ Minimize flow crossings: Reorganize activities to avoid crossed lines
- ✅ Keep related logic together: Group activities that work on same data
- ✅ Use annotations: Add documentation for complex logic sections
- ✅ Align elements: Use grid snapping for professional appearance
- ✅ Balance flow direction: Don't overcomplicate vertical flows
- ✅ Clear end events: Every path should lead to an appropriate end event
- ✅ Extract cohesive reusable logic: When logic is cohesive and reusable, extract it into a separate Microflow and call it from our main Microflow

## Anti-Patterns (DO NOT USE)

- ❌ Spaghetti flows: Multiple crossing lines that make logic hard to follow
- ❌ Inconsistent spacing: Random distances between elements
- ❌ Backward flows: Avoid right-to-left flows in main path
- ❌ Crowded diagrams: Too many activities without visual breathing room
- ❌ Unlabeled decision paths: Always label true/false or condition outcomes
- ❌ Orphaned elements: All activities must connect to flow

## Critical Constraints

> ⚠️ Parameters MUST be positioned above Start Event with 100px vertical spacing  
> ⚠️ Main flow direction is left-to-right – maintain this convention  
> ⚠️ All paths must lead to an End Event – no dangling flows  
> ⚠️ Use consistent spacing throughout the microflow for readability  
> ⚠️ Align elements to grid for professional appearance  

---

# XPath Constraints vs Expressions – CRITICAL DISTINCTION

> ⚠️ You MUST use the right syntax and skill for the right context.

| Context | Syntax | Skill |
|---------|--------|-------|
| Database query | XPath constraint with square brackets | `microflow-xpath` skill |
| Everything else | Expressions without brackets | `microflow-expressions` skill |
