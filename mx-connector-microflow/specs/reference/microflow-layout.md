# Microflow Node Layout — Algorithm Reference

How `create_microflow` (Tool 25) and `microflow_arrange` (Tool 94) position
nodes on a microflow canvas. Both tools use the **same code path**
(`src/microflowBuilder.ts → autoLayout` and `src/microflowArranger.ts`),
so arranging an existing microflow produces the same geometry as creating
that microflow from scratch.

This document describes what the mx-connect server actually does. The
higher-level "Mendix layout conventions" in `microflow-commons.md` are a
MAIA-derived style guide; this is the implementation reference.

---

## TL;DR

- **Main path runs right.** Start at `(0, 0)`, advance `x += 220` per step
  on `y = 0`.
- **Branches drop down.** Each `ExclusiveSplit` / `InheritanceSplit`
  emits its non-happy outgoing flows one row below at `y += 160`,
  starting from the split's `x`. Multiple branches on the same split
  stack further down by `+160` per extra branch.
- **One happy flow per split.** The arranger classifies outgoing flows
  per split (not per flow): one happy outgoing → drawn `RIGHT→LEFT`;
  every other outgoing on that split → drawn `BOTTOM→TOP`. The happy
  flow is **not** always the `"true"` case — see the precedence rules
  below.
- **Coordinates are centers.** `obj.relativeMiddlePoint` is the center
  of the shape, not the top-left corner. Shape size is re-applied per
  type so the canvas renders correctly.
- **Connection indices are normalized.** Every `SequenceFlow` gets
  `originConnectionIndex` / `destinationConnectionIndex` written: main
  flows use `1→3` (RIGHT→LEFT), branches use `2→0` (BOTTOM→TOP).

---

## Coordinate system

| Term                  | Meaning                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `relativeMiddlePoint` | The **center** of an object on the canvas. `{ x, y }` integers. The arranger writes center coordinates directly; do not subtract half-width/height. |
| Outer canvas          | The top-level `mf.objectCollection.objects` — everything except the contents of any `LoopedActivity`.                                               |
| Inner canvas          | The local coordinate space inside a `LoopedActivity.objectCollection`. Each loop has its own origin.                                                |
| Row                   | A horizontal line at a fixed `y`. The main path lives on `y = 0` (outer) or `y = innerMainY = 100` (inner).                                         |
| `x` advances          | Strictly monotonic along the main path. Each step adds `X_STEP = 220`.                                                                              |
| `y` advances          | Strictly monotonic going _into_ branches. Each branch is one row deeper at `+Y_STEP = 160`.                                                         |

Compare with `arrange_domain_model` (entity canvas): there, `entity.location`
is the **top-left corner** and node size is computed from attribute count.
Microflow layout uses centers and fixed per-type sizes.

---

## Layout constants

Defined in `src/microflowArranger.ts:19-20` and mirrored by
`src/microflowBuilder.ts`.

| Constant            |                                                        Value | Where used                                                                               |
| ------------------- | -----------------------------------------------------------: | ---------------------------------------------------------------------------------------- |
| `X_STEP`            |                                                        `220` | Horizontal step along main path (outer + inner).                                         |
| `Y_STEP`            |                                                        `160` | Vertical step per branch row.                                                            |
| `innerStartX`       |                                                         `85` | First inner-loop object's `x` (loop body).                                               |
| `innerMainY`        |                                                        `100` | Main row inside a `LoopedActivity` (centers loop body vertically in the 200-tall frame). |
| Parameter column    |                                                     `x = -2` | All `MicroflowParameterObject` instances share this `x`.                                 |
| Parameter start `y` |                                                       `-170` | Topmost parameter relative to the StartEvent.                                            |
| Parameter step      |                                                        `+84` | Each subsequent parameter (downward in array order, toward the StartEvent at `y = 0`).   |
| Fallback row        | `y = 2 × Y_STEP` (outer) / `innerMainY + 2 × Y_STEP` (inner) | Where unreachable objects are placed so Studio Pro still renders them.                   |

---

## Shape sizes (re-applied per object)

Both tools call `setShapeSize` after positioning each object. The size
is **fixed per type** — never derived from content.

| Object type                                                           | Size (`width × height`) |
| --------------------------------------------------------------------- | ----------------------: |
| `StartEvent`, `EndEvent`, `ContinueEvent`, `BreakEvent`, `ErrorEvent` |               `20 × 20` |
| `ExclusiveSplit`, `InheritanceSplit`, `ExclusiveMerge`                |               `80 × 80` |
| `LoopedActivity`                                                      |             `228 × 200` |
| `MicroflowParameterObject`                                            |               `30 × 30` |
| Every other activity (`ActionActivity`, `RestCallAction`, …)          |              `140 × 50` |

> The outer-canvas size of a `LoopedActivity` is fixed at `228 × 200`,
> not derived from the inner activity count. Older versions of the
> spec documented dynamic sizing — that text is stale; trust the code.

---

## Per-split happy-flow classification (the non-obvious part)

Classification is done **per split, not per flow**. For each
`ExclusiveSplit` / `InheritanceSplit` the arranger picks exactly one
outgoing flow to be the _main_ (RIGHT→LEFT, continues right). Every
other outgoing flow on the same split becomes a _branch_ (BOTTOM→TOP,
drops one row).

Picking the happy flow, in **strict precedence order** (first rule that
matches wins):

1. **Explicit `branch` override on any flow of the split.**
   In `create_microflow`, when the caller sets `branch: true` or
   `branch: false` on any outgoing flow of a split, auto-classification
   is disabled for that whole split: every flow uses its own
   explicit/default `branch` value. The caller is fully in control.

2. **`branchOverrides` matched by split caption** (`microflow_arrange`
   only). Each `{ captionContains, mainCase }` entry is matched in
   order, first hit wins, case-insensitive substring against the
   `ExclusiveSplit.caption` / `InheritanceSplit.caption`. On match,
   the flow whose `EnumerationCase.value` equals `mainCase` becomes
   happy.

3. **ValidationFeedback sibling rule.** If at least one outgoing flow
   targets an `ActionActivity` whose `action` is a
   `ValidationFeedbackAction` AND at least one sibling flow does not,
   the first non-VF sibling is happy. ValidationFeedback is **never**
   the happy case, independent of its `EnumerationCase.value`.

4. **`"true"` case default.** The flow with
   `EnumerationCase.value === "true"`.

5. **First flow fallback.** If none of the above resolve, the first
   outgoing flow in declaration order.

Once the happy flow is picked, it gets `main` connection indices
(`1 → 3`, RIGHT→LEFT). Every other outgoing flow on the same split
gets `branch` indices (`2 → 0`, BOTTOM→TOP) — **regardless** of whether
its case value is `"true"` or `"false"`.

### Why this matters

A common Mendix pattern is the _inverted-happy-path_ validation split,
e.g. `empty($LeaveRequest/RequestedFor)`:

- `true` → the field is missing → unhappy (show validation error)
- `false` → the field is present → happy (continue)

Rule 3 (VF sibling) automatically classifies the non-VF side as happy
in this case, so the canvas matches user intent without any override.
For splits where neither the VF rule nor the `"true"` default produces
the desired layout — typically `empty(...)` / `isEmpty(...)` /
`not <expr>` checks that lead to non-VF activities — flip via:

- `create_microflow` flow input: `{ "branch": true }` on the unhappy
  flow + `{ "branch": false }` on the happy one (rule 1).
- `microflow_arrange` input:
  `{ "branchOverrides": [{ "captionContains": "empty(", "mainCase": "false" }] }`
  (rule 2).

---

## Connection-index convention

Studio Pro renders each `SequenceFlow` arrow leaving one side of the
origin shape and entering one side of the destination shape. The side
is chosen by index:

```
       0 (Top)
       │
3 (Left) ── shape ── 1 (Right)
       │
       2 (Bottom)
```

The arranger always normalizes both ends of every flow:

| Flow kind | `originConnectionIndex` | `destinationConnectionIndex` |
| --------- | ----------------------: | ---------------------------: |
| `main`    |             `1` (RIGHT) |                   `3` (LEFT) |
| `branch`  |            `2` (BOTTOM) |                    `0` (TOP) |

This is applied to **every** outer flow and recursively to every flow
inside each `LoopedActivity`. Re-arranging will reset any hand-edits to
these indices.

---

## Outer-canvas walk

The outer-canvas algorithm, in order:

1. **Find the entry.** `StartEvent` (first instance in `objects`) is
   placed at `(0, 0)`. If there is no `StartEvent` (unusual for a
   top-level microflow), the first non-parameter object is the implicit
   entry.

2. **Stack parameters above the start.** Each `MicroflowParameterObject`
   is placed at `x = -2`, with `y` starting at `-170` and stepping
   `+84` per parameter. The first parameter in the array is the
   topmost; the last sits closest to the StartEvent.

3. **Walk the main path right.** Starting from the entry's successor,
   place each visited object at `x += X_STEP`, keeping `y` on the
   current row. The "main successor" of a node is its single outgoing
   flow that is **not** classified as a branch (see above).

4. **At each split, queue branches.** When the walker places an
   `ExclusiveSplit` / `InheritanceSplit`, every outgoing flow on it
   that is **not** the happy one is recorded as a branch starting from
   the split's `x` on a new row.

5. **Recurse into each branch.** After the main-path walk completes,
   the algorithm visits each queued branch in order. The first branch
   starts at `y = rowY + Y_STEP`; subsequent branches on the same
   split go `+Y_STEP` deeper. Each branch is itself a sub-walk that
   can encounter its own splits and queue further branches recursively.

6. **VF vertical-continuation rule.** If a node was reached via a
   vertical (branch) flow AND it is a `ValidationFeedback` activity
   AND its single outgoing flow lands on an `EndEvent`, the `EndEvent`
   is placed _directly below_ the VF at `(x, y + Y_STEP)` and the
   connecting flow is **promoted to a branch** so Studio Pro draws it
   `BOTTOM→TOP`. A VF reached horizontally does NOT trigger this rule
   — the EndEvent goes to the right as usual. The rule applies only to
   the immediate `EndEvent`; any other downstream activity follows
   the standard horizontal continuation.

7. **Fallback row.** Any objects not reached by the walk are placed
   on a single fallback row at `y = 2 × Y_STEP`, spaced `X_STEP`
   apart starting from `x = 0`. This guarantees Studio Pro can render
   every object even if the graph is disconnected.

8. **Apply shape sizes** to every object (see the table above).

9. **Apply connection indices** to every outer flow.

10. **Recurse into LoopedActivities** — see next section.

---

## Inner-loop layout

For each `LoopedActivity` in the outer objects, its
`objectCollection` is laid out independently using the same algorithm
with two differences:

- **No `StartEvent`.** The first object in `innerOc.objects` (the
  auto-generated breakSplit if `breakCondition` was set, else the
  first user activity) is the implicit entry.
- **Different origin.** The main row is `y = innerMainY = 100`
  (vertically centered in the 200-tall loop frame) starting at
  `x = innerStartX = 85`.

Branches still go to `innerMainY + Y_STEP`. Inner-flow connection
indices are normalized the same way. Unreachable inner objects fall
back to `y = innerMainY + 2 × Y_STEP`.

Inner flows are identified by partitioning `mf.flows`: a flow is
_inner_ when both endpoints are in some `LoopedActivity.objectCollection`,
_outer_ when both endpoints are in `mf.objectCollection`.

---

## Differences between the two tools

| Aspect                     | `create_microflow` (Tool 25)                                                                                       | `microflow_arrange` (Tool 94)                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| When the layout runs       | After building all objects + flows from the declarative input, as the final step before returning.                 | On already-built microflows in the working copy.                                                              |
| How "happy flow" is chosen | Caller can set `branch: true/false` per flow (rule 1) to fully override classification. Otherwise rules 3–5 apply. | Caller can supply `branchOverrides` (rule 2) keyed by split caption. Rules 3–5 apply otherwise.               |
| Scope                      | Always the one microflow being created.                                                                            | Single microflow, single module, or all user modules (skips `System`, `Administration`, `NavigationLayouts`). |
| Commit                     | Caller is responsible (call `commit_working_copy`).                                                                | Same — no auto-commit.                                                                                        |
| Idempotency                | Re-running with `overwrite: true` deletes the old microflow and rebuilds from scratch.                             | Idempotent — re-running on an already-arranged microflow produces the same geometry.                          |

Both tools target the **same layout output**. The difference is the
override mechanism (per-flow `branch` vs per-split `captionContains`)
and the scope (one microflow vs many).

---

## Quick-reference: what gets written

For every object in an arranged microflow:

- `obj.relativeMiddlePoint` — center coordinates `{ x, y }`.
- `obj.size` — `{ width, height }` from the shape-size table.

For every `SequenceFlow`:

- `flow.originConnectionIndex` — `1` (main) or `2` (branch).
- `flow.destinationConnectionIndex` — `3` (main) or `0` (branch).

Nothing else is touched. The arranger does not modify
`condition`, `caption`, `action`, or any other semantic property —
only positions, sizes, and connection-side indices.

---

## Source pointers

- `mx-connect/src/microflowArranger.ts` — the arranger
  (`microflow_arrange` tool). Constants at lines 19-20, shape sizing
  at line 37, per-split classification at the top of
  `layoutMicroflow`, main walk at `placeMainPath` / `layoutSubtree`,
  VF vertical-continuation rule at `placeMainPath` lines 257-270.
- `mx-connect/src/microflowBuilder.ts` — the builder
  (`create_microflow` tool). `setShapeSize` at line 1464, `autoLayout`
  - `autoLayoutInnerLoop` further down the file. The arranger mirrors
    this code; keep them in sync when changing either.
- `mx-connect/specs/tools/microflows.md` — per-tool specs.
  - `create_microflow` Auto-layout section: lines 1220-1228.
  - `microflow_arrange` full spec: lines 2073-2248.
