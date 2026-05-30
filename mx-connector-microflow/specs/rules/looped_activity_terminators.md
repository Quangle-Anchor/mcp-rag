---
audiences: [spec-scan, tool-call]
triggers:
  spec-scan: "before reading any microflow spec document that contains a LoopedActivity (any spec describing a loop body — common phrasings: 'For each ...', 'Loop over ...', 'Iterate ...', or an explicit `LoopedActivity` / `inner flows` / `to: end` / `exit loop` / 'EndEvent inside the loop' mention)"
  tool-call: "before authoring any LoopedActivity inner-flow with `to: \"end\"`, `to: \"continue\"`, or `to: \"break\"`"
status: hard-enforced
enforcer: src/microflowBuilder.ts (buildInnerLoop pre-flight + wireFlow `isInnerLoop` guard + validateGraph orphan check)
---

# LoopedActivity Inner-Flow Terminators — Planning Guidance

Mendix microflows use **three different terminal events** depending on where
they live, and Studio Pro's consistency check rejects the wrong one with codes
that fire only at project load — long after the SDK has happily committed the
broken artefact.

The validators in `src/microflowBuilder.ts` block the most common mistake
(`EndEvent` inside a `LoopedActivity` body, `CE0068`) at write-time and auto-
rewrite the legacy `to: "end"` keyword to `to: "continue"`. This document
explains the *why* so the planner can reason about edge cases — and tells the
spec-scan audience what spec phrasing constitutes a defect.

---

## The split that causes the bug

| Where you are | Terminal event class | Inner-flow keyword | What it means |
|---|---|---|---|
| **Outer microflow** (top-level `flows`) | `EndEvent` | `"end"` | Microflow returns to its caller. Carries `returnValue` when the microflow's `returnType` is not Void. |
| **Inside a LoopedActivity body** | `ContinueEvent` | `"continue"` | Ends the current iteration, continues to the next list element. The canonical "normal end of body". |
| **Inside a LoopedActivity body** | `BreakEvent` | `"break"` | Exits the loop early; control returns to the outer flow after the `LoopedActivity`. See [Mendix Break Event reference](https://docs.mendix.com/refguide/break-event). |

`EndEvent` is **illegal** anywhere inside a `LoopedActivity`'s
`MicroflowObjectCollection`. Studio Pro flags every occurrence with
`CE0068 "End events cannot be placed inside a loop"`. The corollary failure
is `CE0102 "A loop should only have one start event"`, which fires when any
inner node has no inbound flow — including the auto-generated `ContinueEvent`
left orphaned because nothing was wired TO it.

---

## Decision rule for the planner (`tool-call` audience)

Before authoring any inner-flow of a `LoopedActivity`:

1. **Is the destination "normal iteration completion" (the typical end-of-body
   for that path)?** → use `to: "continue"`.
2. **Is the destination "stop iterating, leave the loop now" (early exit)?**
   → use `to: "break"`. This creates a `BreakEvent` inside the loop and a
   sequence flow to it. After the `LoopedActivity`, control returns to whatever
   the outer flow says to do next.
3. **Never write `to: "end"` inside a loop body.** The builder auto-rewrites it
   to `to: "continue"` with a warning, but that is a fallback for legacy specs
   — it loses the semantic distinction between *continue* and *break*. Always
   choose the correct one explicitly.
4. **Every inner activity must have at least one inbound flow** (except the
   implicit entry — `activities[0]` when there is no `breakCondition`, or the
   target of the planner's `from: "start"` flow when `breakCondition` is set).
   Activities with no inbound trigger `CE0102` at project load. The builder
   pre-flight throws with a `{from: "<prev>", to: "<orphan>"}` hint, so this
   never reaches commit, but the planner should still wire each activity
   deliberately rather than relying on the throw.

---

## Decision rule for the spec author (`spec-scan` audience)

The spec scanner walks user-supplied microflow specs (typically in
`project-documents/**/Outputs/*.md` or `*.yaml`) and flags any of the
following as a defect:

| Defect pattern in the spec document | Correction |
|---|---|
| Inner-flow entry with `to: end` / `→ end` / `to: "end"` inside a `LoopedActivity` definition | Rewrite to `to: break` (early loop exit) or `to: continue` (normal end of iteration). Spec authors must pick the correct semantic — the builder cannot guess. |
| Prose phrasing like "End event inside the loop", "go to End from inside the loop", "loop ends here" with no clarification of whether *that branch exits the loop early or just finishes its iteration* | Rewrite the prose: distinguish "exit loop early" (→ `BreakEvent` / `"break"`) from "next iteration" (→ `ContinueEvent` / `"continue"`). |
| Inner activities listed without any inbound flow described in the spec | Add an explicit `{from: <prev>, to: <activity>}` flow or restructure the spec so every inner activity is reachable. |
| The breakCondition is described as flowing to "an End event" or "the loop's End" | Rewrite as: "the auto-generated breakSplit's `true` branch flows to a `BreakEvent` (loop exit)". |

When the scanner emits a defect for one of these, the `mendix-implementation`
skill's `SPEC DEFECT REPORT` should suggest the corrected wording. On
**Option B** ("apply corrections during implementation"), the orchestrator
translates `to: "end"` → `to: "break"` or `to: "continue"` based on the
spec's intent before passing it to a tool call.

---

## What it looks like at runtime (`tool-call` audience)

### Auto-rewrite warning (legacy `to: "end"` inside a loop)
The microflow commits successfully, but `ctx.warnings` contains:

```
LoopedActivity 'loop_calc_days': flow {from: "act_continue", to: "end"}
is illegal inside a loop (Studio Pro CE0068). Auto-rewrote to
{to: "continue"} for back-compat. Use {to: "break"} if you intend to
exit the loop early, or {to: "continue"} for next-iteration.
See specs/rules/looped_activity_terminators.md.
```

### Orphan-activity pre-flight throw
The tool call fails with no partial state:

```
LoopedActivity inner graph: activity 'act_compute_holidays' has no inbound
flow (orphans: ['act_compute_holidays']). Add a flow {from: "<prev>",
to: "act_compute_holidays"} or remove the activity. Studio Pro would
reject this as CE0102 "A loop should only have one start event".
See specs/rules/looped_activity_terminators.md.
```

---

## Skip the prompt when…

- The string `"to": "end"` appears in an **outer** microflow's `flows` array
  (not inside a `LoopedActivity` body). That is the canonical EndEvent target
  and the only correct way to terminate a non-Void microflow.
- The spec describes a `BreakEvent` inside an `error handler` (Mendix error-
  flow construct) — that is a different metamodel context and outside this
  rule's scope.
- The activity has an explicit inbound described in prose but elided from the
  `flows:` array in the spec for brevity. The spec-scan check is on the
  authoritative `flows:` array; prose hints don't count.

---

## See also

- `../tools/microflows.md` — per-tool reference; `LoopedActivity` section
  reflects the corrected keyword set.
- `expression_function_syntax.md` — the matching dual-audience rule for
  Mendix-expression vs XPath dialect leakage inside microflow expression
  slots.
- `src/microflowBuilder.ts` — `buildInnerLoop` (auto-rewrite + `BreakEvent`
  lazy creation), `wireFlow` (`isInnerLoop` guard), `validateGraph`
  (orphan-activity pre-flight).
- [Mendix Break Event reference](https://docs.mendix.com/refguide/break-event)
- [Mendix Continue Event reference](https://docs.mendix.com/refguide/continue-event)
- `defect_reports/Open/builder-output-fails-mx-check.md` — the defect report
  that motivated this rule (Class 2: `CE0068 ×2 + CE0102 ×1` in
  `LeaveRequest3.SUB_CalculateDays`).
