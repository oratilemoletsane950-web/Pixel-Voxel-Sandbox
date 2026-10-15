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
  const nodeById = new Map<string, SettlementNode>();
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
    nodeById.set(id, node);
    childrenByParent[id] = node.children;
    if (parentId) {
      const parent = nodeById.get(parentId);
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
        // A compact deterministic grid gives the block stamper usable house
        // footprints instead of overlapping random points in the village.
        const columns = Math.ceil(Math.sqrt(houseCount));
        const rows = Math.ceil(houseCount / columns);
        for (let hi = 0; hi < houseCount; hi += 1) {
          const col = hi % columns;
          const row = Math.floor(hi / columns);
          const jitterX = (hash(seed, 10000 + ci * 10000 + ti * 1000 + vi * 100 + hi) - 0.5) * 2;
          const jitterZ = (hash(seed, 20000 + ci * 10000 + ti * 1000 + vi * 100 + hi) - 0.5) * 2;
          const houseX = village.x + (col - (columns - 1) / 2) * 13 + jitterX;
          const houseZ = village.z + (row - (rows - 1) / 2) * 13 + jitterZ;
          add(`${villageId}-house-${hi + 1}`, generatedName(seed, 30000 + ci * 10000 + ti * 1000 + vi * 100 + hi, "house"),
            "house", villageId, houseX, houseZ,
            { archetypeIndex: intBetween(seed, 40000 + ci * 10000 + ti * 1000 + vi * 100 + hi, 0, 4) });
        }
      }
    }
  }

  if (options.includeCapitalCastle !== false) {
    const castleId = `${kingdomId}-capital-castle`;
    // Offset the capital castle from the kingdom centre to avoid occupying the legacy palace/plaza.
    add(castleId, generatedName(seed, 999, "castle"), "castle", kingdomId, originX + 220, originZ + 180, { capital: true });
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
  const byId = new Map<string, SettlementNode>();
  for (const node of plan.nodes) {
    if (byId.has(node.id)) errors.push(`Duplicate node id: ${node.id}.`);
    else byId.set(node.id, node);
  }

  const kingdom = byId.get(plan.kingdomId);
  if (!kingdom || kingdom.level !== "kingdom") errors.push("Missing root kingdom.");
  if (kingdom?.parentId !== null) errors.push("Root kingdom must not have a parent.");

  for (const node of plan.nodes) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.z)) {
      errors.push(`${node.id}: coordinates must be finite numbers.`);
    }
  }

  // Walk each parent chain to catch cycles that local link checks cannot find.
  for (const node of plan.nodes) {
    const visited = new Set<string>();
    let current: SettlementNode | undefined = node;
    while (current) {
      if (visited.has(current.id)) {
        errors.push(`${node.id}: parent cycle detected at ${current.id}.`);
        break;
      }
      visited.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }

  const expectedParent: Partial<Record<SettlementLevel, SettlementLevel>> = {
    city: "kingdom",
    town: "city",
    village: "town",
    house: "village",
    castle: "kingdom",
  };
  const countChildren = (node: SettlementNode, level: SettlementLevel) =>
    node.children.map((id) => byId.get(id)).filter((child) => child?.level === level).length;

  for (const node of plan.nodes) {
    if (node.parentId) {
      const parent = byId.get(node.parentId);
      if (!parent) errors.push(`${node.id}: missing parent ${node.parentId}.`);
      else {
        if (expectedParent[node.level] && parent.level !== expectedParent[node.level]) {
          errors.push(`${node.id}: ${node.level} must be parented by ${expectedParent[node.level]}, not ${parent.level}.`);
        }
        if (!parent.children.includes(node.id)) errors.push(`${node.id}: parent does not list this child.`);
      }
    } else if (node.id !== plan.kingdomId) {
      errors.push(`${node.id}: only the root kingdom may omit a parent.`);
    }

    const seenChildren = new Set<string>();
    for (const childId of node.children) {
      if (seenChildren.has(childId)) errors.push(`${node.id}: duplicate child reference ${childId}.`);
      seenChildren.add(childId);
      const child = byId.get(childId);
      if (!child) errors.push(`${node.id}: missing child ${childId}.`);
      else if (child.parentId !== node.id) errors.push(`${node.id}: child ${childId} points to a different parent.`);
    }

    if (node.level === "kingdom") {
      const cities = countChildren(node, "city");
      if (cities < 5 || cities > 8) errors.push(`${node.id}: expected 5-8 cities, got ${cities}.`);
    } else if (node.level === "city") {
      const towns = countChildren(node, "town");
      if (towns !== 5) errors.push(`${node.id}: expected exactly 5 towns, got ${towns}.`);
    } else if (node.level === "town") {
      const villages = countChildren(node, "village");
      if (villages < 5 || villages > 8) errors.push(`${node.id}: expected 5-8 villages, got ${villages}.`);
      for (const key of ["townSquare", "townHall", "outerWall"]) {
        if (node.metadata[key] !== true) errors.push(`${node.id}: missing town feature ${key}.`);
      }
    } else if (node.level === "village") {
      const houses = countChildren(node, "house");
      if (houses < 20 || houses > 30) errors.push(`${node.id}: expected 20-30 houses, got ${houses}.`);
    } else if (node.level === "castle") {
      const wards = plan.castleWards[node.id] ?? [];
      for (const ward of ["outer", "inner", "keep"] as const) {
        if (!wards.includes(ward)) errors.push(`${node.id}: castle must declare the ${ward} ward.`);
      }
    }
  }
  return errors;
}
