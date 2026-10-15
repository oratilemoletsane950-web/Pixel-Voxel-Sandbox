import {
  createHierarchyPlan,
  type HierarchyOptions,
  type HierarchyPlan,
  type SettlementNode,
} from "./settlement-hierarchy";

/**
 * Bounded deterministic cache for hierarchy plans. Plans are expensive enough
 * that they should be created once per seed/origin, not once per streamed chunk.
 */
const MAX_PLANS = 4;
const plans = new Map<string, HierarchyPlan>();
const BUCKET_SIZE = 256;
const spatialIndexes = new WeakMap<HierarchyPlan, Map<string, SettlementNode[]>>();

function planKey(seed: number, options: HierarchyOptions): string {
  return [
    seed >>> 0,
    Math.round(options.originX ?? 0),
    Math.round(options.originZ ?? 0),
    options.includeCapitalCastle === false ? 0 : 1,
  ].join(":");
}

export function hierarchyPlanFor(seed: number, options: HierarchyOptions = {}): HierarchyPlan {
  const key = planKey(seed, options);
  const existing = plans.get(key);
  if (existing) {
    plans.delete(key);
    plans.set(key, existing);
    return existing;
  }

  const plan = createHierarchyPlan(seed, options);
  if (plans.size >= MAX_PLANS) {
    const oldestKey = plans.keys().next().value;
    if (oldestKey !== undefined) plans.delete(oldestKey);
  }
  plans.set(key, plan);
  return plan;
}

function bucketKey(x: number, z: number): string {
  return `${Math.floor(x / BUCKET_SIZE)}:${Math.floor(z / BUCKET_SIZE)}`;
}

function indexPlan(plan: HierarchyPlan): Map<string, SettlementNode[]> {
  const cached = spatialIndexes.get(plan);
  if (cached) return cached;
  const index = new Map<string, SettlementNode[]>();
  for (const node of plan.nodes) {
    const key = bucketKey(node.x, node.z);
    const bucket = index.get(key);
    if (bucket) bucket.push(node);
    else index.set(key, [node]);
  }
  spatialIndexes.set(plan, index);
  return index;
}

/**
 * Returns nodes in a rectangular world-space query. The index avoids scanning
 * every hierarchy node for each streamed chunk. Margin is used to include
 * structures whose footprint extends beyond their planned centre.
 *
 * Coordinates remain planning hints until a terrain-aware placement pass
 * validates the site and the real structure stamper places the blocks.
 */
export function hierarchyNodesInBounds(
  plan: HierarchyPlan,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  margin = 0,
): SettlementNode[] {
  if (![minX, minZ, maxX, maxZ, margin].every(Number.isFinite)) {
    throw new RangeError("Hierarchy bounds and margin must be finite numbers.");
  }
  if (minX > maxX || minZ > maxZ) {
    throw new RangeError("Hierarchy bounds must be ordered from minimum to maximum.");
  }
  if (margin < 0) {
    throw new RangeError("Hierarchy query margin cannot be negative.");
  }

  const index = indexPlan(plan);
  const firstX = Math.floor((minX - margin) / BUCKET_SIZE);
  const lastX = Math.floor((maxX + margin) / BUCKET_SIZE);
  const firstZ = Math.floor((minZ - margin) / BUCKET_SIZE);
  const lastZ = Math.floor((maxZ + margin) / BUCKET_SIZE);
  const candidates: SettlementNode[] = [];
  const seen = new Set<string>();

  for (let bx = firstX; bx <= lastX; bx += 1) {
    for (let bz = firstZ; bz <= lastZ; bz += 1) {
      for (const node of index.get(`${bx}:${bz}`) ?? []) {
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        if (
          node.x + margin >= minX &&
          node.x - margin <= maxX &&
          node.z + margin >= minZ &&
          node.z - margin <= maxZ
        ) candidates.push(node);
      }
    }
  }
  // A stable order makes chunk consumers independent of bucket traversal details.
  candidates.sort((a, b) => a.x - b.x || a.z - b.z || a.id.localeCompare(b.id));
  return candidates;
}

/** Clear cached plans in tests or when a development session changes worlds. */
export function clearHierarchyPlanCache(): void {
  plans.clear();
}
