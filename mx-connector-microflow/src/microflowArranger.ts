import { IModel, microflows, projects } from "mendixmodelsdk";
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

const SKIPPED_MODULES = ["System", "Administration", "NavigationLayouts"];

// ── Layout constants (match microflowBuilder.ts) ─────────────────────────────
const X_STEP = 220;
const Y_STEP = 160;

// Connection-index convention on a rectangular shape:
//   0 = Top, 1 = Right, 2 = Bottom, 3 = Left.
const SIDE_TOP = 0;
const SIDE_RIGHT = 1;
const SIDE_BOTTOM = 2;
const SIDE_LEFT = 3;

type MfObject = microflows.MicroflowObject;

function isUserModule(mod: projects.IModule): boolean {
  return mod.fromAppStore === false && !SKIPPED_MODULES.includes(mod.name);
}

// ── Shape sizing (matches microflowBuilder.setShapeSize) ─────────────────────

function setShapeSize(obj: MfObject): void {
  if (
    obj instanceof microflows.StartEvent ||
    obj instanceof microflows.EndEvent ||
    obj instanceof microflows.ContinueEvent ||
    obj instanceof microflows.BreakEvent ||
    obj instanceof microflows.ErrorEvent
  ) {
    obj.size = { width: 20, height: 20 };
  } else if (
    obj instanceof microflows.ExclusiveSplit ||
    obj instanceof microflows.InheritanceSplit ||
    obj instanceof microflows.ExclusiveMerge
  ) {
    obj.size = { width: 80, height: 80 };
  } else if (obj instanceof microflows.LoopedActivity) {
    obj.size = { width: 228, height: 200 };
  } else if (obj instanceof microflows.MicroflowParameterObject) {
    obj.size = { width: 30, height: 30 };
  } else {
    // ActionActivity and friends
    obj.size = { width: 140, height: 50 };
  }
}

// ── Branch detection ─────────────────────────────────────────────────────────
//
// Classification is **per split**, not per flow. For each split we pick the
// single "happy" outgoing flow that becomes the main path (drawn right,
// RIGHT→LEFT); every other outgoing flow is a branch (drawn down, BOTTOM→TOP).
//
// Picking the happy flow, in precedence order:
//   1. Caller-supplied `branchOverrides` matching the split's caption — the
//      flow whose case value equals `mainCase` is happy.
//   2. If at least one outgoing flow leads to a `ValidationFeedback` activity
//      AND at least one does not, the first non-VF flow is happy. VF is never
//      the happy case.
//   3. Default: the flow whose case value is `"true"`. If none, the first
//      outgoing flow.
//
// This per-split design ensures rule 1 of the layout spec — happy case →
// RIGHT→LEFT — holds regardless of whether the happy case carries `"true"` or
// `"false"`.

function isSplit(obj: MfObject): boolean {
  return (
    obj instanceof microflows.ExclusiveSplit ||
    obj instanceof microflows.InheritanceSplit
  );
}

function isValidationFeedbackTarget(obj: MfObject): boolean {
  return (
    obj instanceof microflows.ActionActivity &&
    obj.action instanceof microflows.ValidationFeedbackAction
  );
}

type BranchOverride = NonNullable<MicroflowArrangeArgs["branchOverrides"]>[number];

function getSplitCaption(obj: MfObject): string {
  if (obj instanceof microflows.ExclusiveSplit) return obj.caption ?? "";
  if (obj instanceof microflows.InheritanceSplit) return obj.caption ?? "";
  return "";
}

function findOverride(
  origin: MfObject,
  overrides: BranchOverride[]
): BranchOverride | undefined {
  const caption = getSplitCaption(origin);
  if (!caption) return undefined;
  const captionLc = caption.toLowerCase();
  for (const ov of overrides) {
    if (captionLc.includes(ov.captionContains.toLowerCase())) return ov;
  }
  return undefined;
}

function getCaseValue(flow: microflows.SequenceFlow): string | undefined {
  for (const cv of flow.caseValues) {
    if (cv instanceof microflows.EnumerationCase) {
      return cv.value.trim().toLowerCase();
    }
  }
  return undefined;
}

function pickHappyFlow(
  split: MfObject,
  outFlows: microflows.SequenceFlow[],
  overrides: BranchOverride[]
): microflows.SequenceFlow | undefined {
  if (outFlows.length === 0) return undefined;

  // (1) Explicit per-split override.
  const override = findOverride(split, overrides);
  if (override) {
    const target = override.mainCase.toLowerCase();
    const match = outFlows.find((f) => getCaseValue(f) === target);
    if (match) return match;
  }

  // (2) ValidationFeedback siblings are non-happy.
  const nonVf = outFlows.filter(
    (f) => f.destination && !isValidationFeedbackTarget(f.destination)
  );
  if (nonVf.length > 0 && nonVf.length < outFlows.length) {
    return nonVf[0];
  }

  // (3) Default: prefer the "true" case; fall back to the first flow.
  const trueFlow = outFlows.find((f) => getCaseValue(f) === "true");
  return trueFlow ?? outFlows[0];
}

interface WiredFlow {
  flow: microflows.SequenceFlow;
  origin: MfObject;
  destination: MfObject;
  isBranch: boolean;
}

function buildWiredFlows(
  flows: microflows.Flow[],
  overrides: BranchOverride[]
): WiredFlow[] {
  // Collect valid SequenceFlows and group split-origin flows by their split.
  const valid: microflows.SequenceFlow[] = [];
  const bySplit = new Map<MfObject, microflows.SequenceFlow[]>();
  for (const f of flows) {
    if (!(f instanceof microflows.SequenceFlow)) continue;
    if (!f.origin || !f.destination) continue;
    valid.push(f);
    if (isSplit(f.origin)) {
      if (!bySplit.has(f.origin)) bySplit.set(f.origin, []);
      bySplit.get(f.origin)!.push(f);
    }
  }

  // Determine the happy flow for each split.
  const happyPerSplit = new Map<MfObject, microflows.SequenceFlow>();
  for (const [split, splitFlows] of bySplit) {
    const happy = pickHappyFlow(split, splitFlows, overrides);
    if (happy) happyPerSplit.set(split, happy);
  }

  // Build WiredFlows: a flow is a branch when its origin is a split and it is
  // not the chosen happy flow for that split. Non-split flows are never
  // branches at this stage (the layout walker may still promote a
  // VF→EndEvent flow to branch later for vertical continuation).
  const result: WiredFlow[] = [];
  for (const f of valid) {
    let isBranch = false;
    if (isSplit(f.origin!)) {
      const happy = happyPerSplit.get(f.origin!);
      isBranch = happy !== f;
    }
    result.push({
      flow: f,
      origin: f.origin!,
      destination: f.destination!,
      isBranch,
    });
  }
  return result;
}

interface AdjEntry {
  dest: MfObject;
  wired: WiredFlow;
  get isBranch(): boolean;
}

function buildAdjacency(wired: WiredFlow[]): Map<MfObject, AdjEntry[]> {
  const m = new Map<MfObject, AdjEntry[]>();
  for (const w of wired) {
    if (!m.has(w.origin)) m.set(w.origin, []);
    m.get(w.origin)!.push({
      dest: w.destination,
      wired: w,
      get isBranch() {
        return w.isBranch;
      },
    });
  }
  return m;
}

// ── Recursive layout (matches microflowBuilder.layoutSubtree) ────────────────

function placeMainPath(
  start: MfObject,
  startX: number,
  rowY: number,
  adjacency: Map<MfObject, AdjEntry[]>,
  placed: Set<MfObject>,
  incomingIsVertical: boolean
): { splits: Array<{ split: MfObject; x: number }> } {
  const splits: Array<{ split: MfObject; x: number }> = [];
  let x = startX;
  let y = rowY;
  let cur: MfObject | null = start;
  // True while the current node was reached via a vertical (BOTTOM→TOP) flow.
  // Resets to false after the first horizontal step.
  let isVerticalEntry = incomingIsVertical;

  while (cur && !placed.has(cur)) {
    cur.relativeMiddlePoint = { x, y };
    setShapeSize(cur);
    placed.add(cur);

    if (isSplit(cur)) {
      splits.push({ split: cur, x });
    }

    const outs: AdjEntry[] = adjacency.get(cur) ?? [];
    const mainOut: AdjEntry | undefined = outs.find((o) => !o.isBranch);
    if (!mainOut) break;

    // Special case (point 2): if this node was reached vertically and is a
    // ValidationFeedback whose next node is an EndEvent, continue downward
    // rather than turning right. Promote the flow to a branch so it is drawn
    // BOTTOM→TOP. EndEvent has no outgoing flow, so the walk ends after this.
    if (
      isVerticalEntry &&
      isValidationFeedbackTarget(cur) &&
      mainOut.dest instanceof microflows.EndEvent
    ) {
      mainOut.wired.isBranch = true;
      y += Y_STEP;
      cur = mainOut.dest;
      continue;
    }

    x += X_STEP;
    cur = mainOut.dest;
    isVerticalEntry = false;
  }

  return { splits };
}

function layoutSubtree(
  start: MfObject,
  startX: number,
  rowY: number,
  adjacency: Map<MfObject, AdjEntry[]>,
  placed: Set<MfObject>,
  incomingIsVertical: boolean
): void {
  const result = placeMainPath(
    start,
    startX,
    rowY,
    adjacency,
    placed,
    incomingIsVertical
  );
  for (const { split, x: splitX } of result.splits) {
    const branchOuts = (adjacency.get(split) ?? []).filter((o) => o.isBranch);
    // Each branch goes one row lower. If there are multiple branches, stack
    // them progressively further down to avoid overlap.
    let branchY = rowY + Y_STEP;
    for (const branchOut of branchOuts) {
      layoutSubtree(branchOut.dest, splitX, branchY, adjacency, placed, true);
      branchY += Y_STEP;
    }
  }
}

// ── Connection indices ───────────────────────────────────────────────────────

function applyConnectionIndices(wired: WiredFlow[]): void {
  for (const w of wired) {
    if (w.isBranch) {
      w.flow.originConnectionIndex = SIDE_BOTTOM;
      w.flow.destinationConnectionIndex = SIDE_TOP;
    } else {
      w.flow.originConnectionIndex = SIDE_RIGHT;
      w.flow.destinationConnectionIndex = SIDE_LEFT;
    }
  }
}

// ── Outer microflow layout ───────────────────────────────────────────────────

async function layoutMicroflow(
  mf: microflows.Microflow,
  overrides: BranchOverride[]
): Promise<number> {
  await mf.objectCollection.load();

  const objects = mf.objectCollection.objects;
  if (objects.length === 0) return 0;

  // All flows live on mf.flows — including flows inside any LoopedActivity.
  // Partition them: outer flows have both endpoints in the top-level
  // objectCollection; inner flows have both endpoints inside a LoopedActivity's
  // own objectCollection.
  const outerObjectSet = new Set<MfObject>(objects);
  const allFlows = [...mf.flows];

  const outerFlows: microflows.Flow[] = [];
  for (const f of allFlows) {
    if (!(f instanceof microflows.SequenceFlow)) continue;
    if (!f.origin || !f.destination) continue;
    if (outerObjectSet.has(f.origin) && outerObjectSet.has(f.destination)) {
      outerFlows.push(f);
    }
  }

  const wired = buildWiredFlows(outerFlows, overrides);
  const adjacency = buildAdjacency(wired);
  const placed = new Set<MfObject>();

  // StartEvent at (0, 0). If no StartEvent (unusual for top-level), fall back
  // to the first non-parameter object as the implicit entry.
  const startEvt = objects.filter(
    (o): o is microflows.StartEvent => o instanceof microflows.StartEvent
  )[0];

  if (startEvt) {
    startEvt.relativeMiddlePoint = { x: 0, y: 0 };
    setShapeSize(startEvt);
    placed.add(startEvt);

    const firstOut = (adjacency.get(startEvt) ?? []).find((o) => !o.isBranch);
    if (firstOut) {
      layoutSubtree(firstOut.dest, X_STEP, 0, adjacency, placed, false);
    }
  } else {
    const implicitEntry = objects.find(
      (o) => !(o instanceof microflows.MicroflowParameterObject)
    );
    if (implicitEntry) {
      layoutSubtree(implicitEntry, 0, 0, adjacency, placed, false);
    }
  }

  // Stack parameters vertically above the start
  let paramY = -170;
  for (const obj of objects) {
    if (placed.has(obj)) continue;
    if (obj instanceof microflows.MicroflowParameterObject) {
      obj.relativeMiddlePoint = { x: -2, y: paramY };
      setShapeSize(obj);
      placed.add(obj);
      paramY += 84;
    }
  }

  // Fallback row for unreachable objects (orphan EndEvents, etc.)
  let fallbackX = 0;
  for (const obj of objects) {
    if (placed.has(obj)) continue;
    obj.relativeMiddlePoint = { x: fallbackX, y: 2 * Y_STEP };
    setShapeSize(obj);
    placed.add(obj);
    fallbackX += X_STEP;
  }

  applyConnectionIndices(wired);

  // Recurse into nested LoopedActivities
  for (const obj of objects) {
    if (obj instanceof microflows.LoopedActivity) {
      layoutInnerLoop(obj, allFlows, overrides);
    }
  }

  return objects.length;
}

// ── Inner LoopedActivity layout (matches microflowBuilder.autoLayoutInnerLoop) ─

function layoutInnerLoop(
  loop: microflows.LoopedActivity,
  allFlows: microflows.Flow[],
  overrides: BranchOverride[]
): void {
  const innerOc = loop.objectCollection;
  if (!innerOc) return;
  const objects = innerOc.objects;
  if (objects.length === 0) return;

  const innerObjectSet = new Set<MfObject>(objects);
  const innerFlows: microflows.Flow[] = [];
  for (const f of allFlows) {
    if (!(f instanceof microflows.SequenceFlow)) continue;
    if (!f.origin || !f.destination) continue;
    if (innerObjectSet.has(f.origin) && innerObjectSet.has(f.destination)) {
      innerFlows.push(f);
    }
  }

  const wired = buildWiredFlows(innerFlows, overrides);
  const adjacency = buildAdjacency(wired);
  const placed = new Set<MfObject>();

  const innerMainY = 100;
  const innerStartX = 85;

  // Implicit entry: first object in objects[] (no StartEvent inside a loop)
  layoutSubtree(objects[0], innerStartX, innerMainY, adjacency, placed, false);

  // Fallback for unplaced inner objects
  let fallbackX = innerStartX;
  for (const obj of objects) {
    if (placed.has(obj)) continue;
    obj.relativeMiddlePoint = { x: fallbackX, y: innerMainY + 2 * Y_STEP };
    setShapeSize(obj);
    placed.add(obj);
    fallbackX += X_STEP;
  }

  applyConnectionIndices(wired);
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function arrangeMicroflows(
  model: IModel,
  args: MicroflowArrangeArgs
): Promise<MicroflowArrangeResult> {
  const { microflowName, moduleName } = args;
  const overrides: BranchOverride[] = args.branchOverrides ?? [];

  // ── Scope: single microflow ──────────────────────────────────────────────
  if (microflowName) {
    let stub: microflows.IMicroflow | undefined;

    if (microflowName.includes(".")) {
      const dotIdx = microflowName.indexOf(".");
      const modPart = microflowName.substring(0, dotIdx);
      const mfPart = microflowName.substring(dotIdx + 1);
      const mod = model.root.modules.find((m) => m.name === modPart);
      if (mod) {
        stub = mod.documents.filter(
          (d): d is microflows.IMicroflow =>
            d instanceof microflows.Microflow && d.name === mfPart
        )[0];
      }
      if (!stub) {
        throw new Error(`Microflow '${microflowName}' not found.`);
      }
    } else if (moduleName) {
      const mod = model.root.modules.find((m) => m.name === moduleName);
      if (!mod) {
        const available = model.root.modules.map((m) => m.name).join(", ");
        throw new Error(
          `Module '${moduleName}' not found. Available modules: ${available}.`
        );
      }
      stub = mod.documents.filter(
        (d): d is microflows.IMicroflow =>
          d instanceof microflows.Microflow && d.name === microflowName
      )[0];
      if (!stub) {
        throw new Error(
          `Microflow '${microflowName}' not found in module '${moduleName}'.`
        );
      }
    } else {
      const matches: Array<{ modName: string; stub: microflows.IMicroflow }> =
        [];
      for (const mod of model.root.modules) {
        if (!isUserModule(mod)) continue;
        const found = mod.documents.filter(
          (d): d is microflows.IMicroflow =>
            d instanceof microflows.Microflow && d.name === microflowName
        )[0];
        if (found) matches.push({ modName: mod.name, stub: found });
      }
      if (matches.length === 0) {
        throw new Error(
          `Microflow '${microflowName}' not found in any user module.`
        );
      }
      if (matches.length > 1) {
        const list = matches.map((m) => m.modName).join(", ");
        throw new Error(
          `Ambiguous microflow name '${microflowName}' — found in: ${list}. Provide moduleName to disambiguate.`
        );
      }
      stub = matches[0].stub;
    }

    const mf = await stub.load();
    const objectCount = await layoutMicroflow(mf, overrides);
    return {
      scope: "single",
      microflowCount: 1,
      moduleCount: 1,
      empty: false,
      singleFqn: mf.qualifiedName ?? microflowName,
      singleObjectCount: objectCount,
    };
  }

  // ── Scope: module ────────────────────────────────────────────────────────
  if (moduleName) {
    const mod = model.root.modules.find((m) => m.name === moduleName);
    if (!mod) {
      const available = model.root.modules.map((m) => m.name).join(", ");
      throw new Error(
        `Module '${moduleName}' not found. Available modules: ${available}.`
      );
    }
    const stubs = mod.documents.filter(
      (d): d is microflows.IMicroflow => d instanceof microflows.Microflow
    );
    if (stubs.length === 0) {
      return {
        scope: "module",
        microflowCount: 0,
        moduleCount: 1,
        empty: true,
        moduleName,
        microflowNames: [],
      };
    }
    const names: string[] = [];
    for (const stub of stubs) {
      const mf = await stub.load();
      await layoutMicroflow(mf, overrides);
      names.push(mf.qualifiedName ?? mf.name);
    }
    return {
      scope: "module",
      microflowCount: names.length,
      moduleCount: 1,
      empty: false,
      moduleName,
      microflowNames: names,
    };
  }

  // ── Scope: project ───────────────────────────────────────────────────────
  const userMods = model.root.modules.filter(isUserModule);
  if (userMods.length === 0) {
    return {
      scope: "project",
      microflowCount: 0,
      moduleCount: 0,
      empty: true,
      noUserModules: true,
    };
  }
  let totalMf = 0;
  let totalMods = 0;
  for (const mod of userMods) {
    const stubs = mod.documents.filter(
      (d): d is microflows.IMicroflow => d instanceof microflows.Microflow
    );
    if (stubs.length === 0) continue;
    for (const stub of stubs) {
      const mf = await stub.load();
      await layoutMicroflow(mf, overrides);
      totalMf++;
    }
    totalMods++;
  }
  return {
    scope: "project",
    microflowCount: totalMf,
    moduleCount: totalMods,
    empty: totalMf === 0,
  };
}
