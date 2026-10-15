/**
 * Hierarchical settlement planning foundation.
 *
 * This module deliberately produces lightweight, deterministic settlement
 * metadata only. It does NOT stamp blocks or choose terrain sites yet; that
 * integration belongs in the world/terrain streaming layer. Keeping hierarchy
 * planning separate lets the game enforce the requested counts before any
 * expensive geometry is rendered.
 */

export type SettlementLevel = "kingdom" | "city" | "town" | "village" | "castle" | "house";
export type CastleWardKind = "outer" | "inner" | "keep";

export interface SettlementNode {
  id: string;
  name: string;
  level: SettlementLevel;
  parentId: string | null;
  /** Planned centre in world block coordinates; terrain height is resolved later. */
  x: number;
  z: number;
  children: string[];
  metadata: Record<string, number | string | boolean>;
}

export interface HierarchyPlan {
  seed: number;
  kingdomId: string;
  nodes: SettlementNode[];
  /** Parent id -> child ids, retained for fast chunk/region queries. */
  childrenByParent: Record<string, string[]>;
  /** Castle id -> required internal ward labels. */
  castleWards: Record<string, CastleWardKind[]>;
}

export interface HierarchyOptions {
  /** Kingdom centre in world block coordinates. */
  originX?: number;
  originZ?: number;
  /** Set false in tests/tools when castles are not wanted in the first pass. */
  includeCapitalCastle?: boolean;
}

function hash(seed: number, value: number): number {
  let n = (seed ^ Math.imul(value + 0x9e3779b9, 0x85ebca6b)) | 0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

function intBetween(seed: number, key: number, min: number, max: number): number {
  return min + Math.floor(hash(seed, key) * (max - min + 1));
}

const syllablesA = ["Ash", "Bracken", "Crown", "Dun", "Elder", "Fox", "Grey", "High", "Iron", "Kings", "Long", "Mere", "North", "Oak", "Raven", "Stone", "Thorn", "West", "White", "Willow"];
const syllablesB = ["bridge", "bury", "crest", "ford", "gate", "haven", "mere", "stead", "vale", "watch", "wick", "wood"];

function generatedName(seed: number, key: number, level: SettlementLevel): string {
  const a = syllablesA[Math.floor(hash(seed, key * 3 + 1) * syllablesA.length)];
  const b = syllablesB[Math.floor(hash(seed, key * 3 + 2) * syllablesB.length)];
  const suffix = level === "kingdom" ? "Kingdom" : level === "city" ? "City" : level === "town" ? "Town" : level === "village" ? "Village" : level === "castle" ? "Castle" : "House";
  return `${a}${b} ${suffix}`;
}

/**
 * Creates one complete hierarchy around a kingdom centre.
 *
 * Counts are structural guarantees:
 * - 5-8 cities per kingdom
 * - exactly 5 towns per city
 * - 5-8 villages per town
 * - 20-30 houses per village
 *
 * Coordinates are deterministic planning hints, not terrain-validated
 * placements. The terrain-aware placement pass must resolve conflicts,
 * paths, slopes and water before these are rendered.
 */
export function createHierarchyPlan(seed: number, options: HierarchyOptions = {}): HierarchyPlan {
  const originX = options.originX ?? 0;
  const originZ = options.originZ ?? 0;
  const nodes: SettlementNode[] = [];
  const childrenByParent: Record<string, string[]> = {};
  const castleWards: Record<string, CastleWardKind[]> = {};

  const add = (
    id: string,
    name: string,
    level: SettlementLevel,
    parentId: string | null,
    x: number,
    z: number,
    metadata: SettlementNode["metadata"] = {},
  ): SettlementNode => {
    const node: SettlementNode = { id, name, level, parentId, x: Math.round(x), z: Math.round(z), children: [], metadata };
    nodes.push(node);
    childrenByParent[id] = node.children;
    if (parentId) {
      const parent = nodes.find((candidate) => candidate.id === parentId);
      if (parent) parent.children.push(id);
    }
    return node;
  };

  const kingdomId = `kingdom-${seed >>> 0}`;
  const kingdom = add(kingdomId, generatedName(seed, 1, "kingdom"), "kingdom", null, originX, originZ, { seed });
  const cityCount = intBetween(seed, 10, 5, 8);
  const cityRing = 1500;

  for (let ci = 0; ci < cityCount; ci += 1) {
    const angle = (Math.PI * 2 * ci) / cityCount + (hash(seed, 20 + ci) - 0.5) * 0.24;
    const radius = cityRing * (0.72 + hash(seed, 40 + ci) * 0.42);
    const cityId = `${kingdomId}-city-${ci + 1}`;
    const city = add(cityId, generatedName(seed, 100 + ci, "city"), "city", kingdomId,
      originX + Math.cos(angle) * radius, originZ + Math.sin(angle) * radius,
      { townCount: 5, index: ci + 1 });
    void city;

    for (let ti = 0; ti < 5; ti += 1) {
      const townAngle = (Math.PI * 2 * ti) / 5 + hash(seed, 200 + ci * 10 + ti) * 0.3;
      const townRadius = 240 + hash(seed, 300 + ci * 10 + ti) * 180;
      const townId = `${cityId}-town-${ti + 1}`;
      const town = add(townId, generatedName(seed, 400 + ci * 10 + ti, "town"), "town", cityId,
        city.x + Math.cos(townAngle) * townRadius, city.z + Math.sin(townAngle) * townRadius,
        { villageCountMin: 5, villageCountMax: 8, townSquare: true, townHall: true, outerWall: true, index: ti + 1 });

      const villageCount = intBetween(seed, 500 + ci * 100 + ti, 5, 8);
      for (let vi = 0; vi < villageCount; vi += 1) {
        const villageAngle = (Math.PI * 2 * vi) / villageCount + hash(seed, 600 + ci * 100 + ti * 10 + vi) * 0.28;
        const villageRadius = 90 + hash(seed, 700 + ci * 100 + ti * 10 + vi) * 100;
        const villageId = `${townId}-village-${vi + 1}`;
        const village = add(villageId, generatedName(seed, 800 + ci * 100 + ti * 10 + vi, "village"), "village", townId,
          town.x + Math.cos(villageAngle) * villageRadius, town.z + Math.sin(villageAngle) * villageRadius,
          { houseCountMin: 20, houseCountMax: 30, index: vi + 1 });

        const houseCount = intBetween(seed, 900 + ci * 1000 + ti * 100 + vi, 20, 30);
        for (let hi = 0; hi < houseCount; hi += 1) {
          const houseAngle = hash(seed, 10000 + ci * 10000 + ti * 1000 + vi * 100 + hi) * Math.PI * 2;
          const houseRadius = 10 + Math.sqrt(hash(seed, 20000 + ci * 10000 + ti * 1000 + vi * 100 + hi)) * 42;
          add(`${villageId}-house-${hi + 1}`, generatedName(seed, 30000 + ci * 10000 + ti * 1000 + vi * 100 + hi, "house"),
            "house", villageId, village.x + Math.cos(houseAngle) * houseRadius, village.z + Math.sin(houseAngle) * houseRadius,
            { archetypeIndex: intBetween(seed, 40000 + ci * 10000 + ti * 1000 + vi * 100 + hi, 0, 4) });
        }
      }
    }
  }

  if (options.includeCapitalCastle !== false) {
    const castleId = `${kingdomId}-capital-castle`;
    add(castleId, generatedName(seed, 999, "castle"), "castle", kingdomId, originX, originZ, { capital: true });
    castleWards[castleId] = ["outer", "inner", "keep"];
  }

  // Add a castle with explicit ward metadata as a first-class hierarchy object.
  // Further castles are to be placed by the terrain-aware strategic-site pass.
  kingdom.metadata.cityCount = cityCount;

  return { seed, kingdomId, nodes, childrenByParent, castleWards };
}

/** Lightweight structural validation for development and automated tests. */
export function validateHierarchyPlan(plan: HierarchyPlan): string[] {
  const errors: string[] = [];
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  const kingdom = byId.get(plan.kingdomId);
  if (!kingdom || kingdom.level !== "kingdom") errors.push("Missing root kingdom.");

  const countChildren = (node: SettlementNode, level: SettlementLevel) =>
    node.children.map((id) => byId.get(id)).filter((child) => child?.level === level).length;

  for (const node of plan.nodes) {
    if (node.level === "kingdom") {
      const cities = countChildren(node, "city");
      if (cities < 5 || cities > 8) errors.push(`${node.id}: expected 5-8 cities, got ${cities}.`);
    } else if (node.level === "city") {
      const towns = countChildren(node, "town");
      if (towns !== 5) errors.push(`${node.id}: expected exactly 5 towns, got ${towns}.`);
    } else if (node.level === "town") {
      const villages = countChildren(node, "village");
      if (villages < 5 || villages > 8) errors.push(`${node.id}: expected 5-8 villages, got ${villages}.`);
    } else if (node.level === "village") {
      const houses = countChildren(node, "house");
      if (houses < 20 || houses > 30) errors.push(`${node.id}: expected 20-30 houses, got ${houses}.`);
    } else if (node.level === "castle") {
      if (!plan.castleWards[node.id]?.includes("outer") || !plan.castleWards[node.id]?.includes("inner") || !plan.castleWards[node.id]?.includes("keep")) {
        errors.push(`${node.id}: castle must declare outer ward, inner ward and keep.`);
      }
    }
    if (node.parentId && !byId.has(node.parentId)) errors.push(`${node.id}: missing parent ${node.parentId}.`);
  }
  return errors;
}
