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

/**
 * Returns planned nodes whose world-space location/footprint intersects a
 * rectangular query. A caller can use this to restrict work to visible chunks.
 *
 * Note: these are still planning coordinates; terrain validation and block
 * stamping must happen before they are treated as placed structures.
 */
export function hierarchyNodesInBounds(
  plan: HierarchyPlan,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  margin = 0,
): SettlementNode[] {
  return plan.nodes.filter((node) =>
    node.x + margin >= minX &&
    node.x - margin <= maxX &&
    node.z + margin >= minZ &&
    node.z - margin <= maxZ
  );
}

/** Clear cached plans in tests or when a development session changes worlds. */
export function clearHierarchyPlanCache(): void {
  plans.clear();
}
