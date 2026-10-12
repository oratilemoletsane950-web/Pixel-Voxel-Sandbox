import type { WorldBlockType } from "./world";

export const SETTLEMENT_FACTIONS = [
  "freefolk",
  "elves",
  "dwarves",
  "mages",
  "orcs",
  "wardens",
] as const;

export type SettlementFaction = (typeof SETTLEMENT_FACTIONS)[number];
export type SettlementKind =
  | "village"
  | "town"
  | "city"
  | "grove"
  | "hold"
  | "camp"
  | "tower"
  | "lodge";

export interface Humanoid {
  id: string;
  name: string;
  faction: SettlementFaction;
  role: string;
  x: number;
  y: number;
  z: number;
  phase: number;
}

export interface Settlement {
  id: string;
  name: string;
  faction: SettlementFaction;
  kind: SettlementKind;
  x: number;
  y: number;
  z: number;
  radius: number;
  inhabitants: Humanoid[];
}

export interface SettlementTerrain {
  height: number;
  surface: WorldBlockType;
  forest: number;
  moisture: number;
  mountain: number;
  river: boolean;
}

export type TerrainSampler = (x: number, z: number, seed: number) => SettlementTerrain;

export const FACTION_LABELS: Record<SettlementFaction, string> = {
  freefolk: "Villagers",
  elves: "Greenward Elves",
  dwarves: "Stone Dwarves",
  mages: "Circle Mages",
  orcs: "Redtooth Orcs",
  wardens: "Beast Wardens",
};

export const FACTION_COLORS: Record<SettlementFaction, string> = {
  freefolk: "#ba8652",
  elves: "#43886e",
  dwarves: "#aa7137",
  mages: "#7059a0",
  orcs: "#75934d",
  wardens: "#5b6269",
};

export const FACTION_SKIN_COLORS: Record<SettlementFaction, string> = {
  freefolk: "#d3a177",
  elves: "#cfb58b",
  dwarves: "#c99568",
  mages: "#d7b18d",
  orcs: "#a2ad70",
  wardens: "#c79b73",
};

const REGION_SIZE = 96;
const MAX_REGION_CACHE = 96;
const regionCache = new Map<string, Settlement | null>();

const firstNames = [
  "Ari", "Bram", "Cora", "Dain", "Edda", "Fen", "Galen", "Halla",
  "Ivo", "Jori", "Kiva", "Lio", "Mara", "Neri", "Orin", "Pella",
  "Quin", "Runa", "Sella", "Tarin", "Una", "Venn", "Willa", "Yara",
];
const familyNames = [
  "Ashdown", "Birch", "Cinder", "Dale", "Ember", "Frost", "Greenbank",
  "Hill", "Ironvale", "Juniper", "Kettle", "Longstep", "Moss", "North",
  "Oakenshade", "Pine", "Quickwater", "Ridge", "Stonebrook", "Thorn",
];
const nameStarts = [
  "Amber", "Bracken", "Clover", "Dawn", "Fern", "Gold", "Heather",
  "Juniper", "Moss", "Oaken", "River", "Silver", "Thistle", "Willow",
];
const nameEnds = [
  "brook", "fall", "field", "grove", "haven", "hollow", "mere",
  "reach", "rest", "ridge", "stead", "watch", "well", "wick",
];

function hash2(x: number, z: number, seed: number): number {
  let value = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function pick<T>(values: readonly T[], roll: number): T {
  return values[Math.floor(roll * values.length) % values.length];
}

function chooseFaction(roll: number): SettlementFaction {
  if (roll < 0.4) return "freefolk";
  if (roll < 0.55) return "elves";
  if (roll < 0.7) return "dwarves";
  if (roll < 0.82) return "orcs";
  if (roll < 0.92) return "mages";
  return "wardens";
}

function scoreSite(faction: SettlementFaction, site: SettlementTerrain): number {
  if (site.surface === "water") return -100;
  const openGround = site.surface === "grass" ? 2 : -1;
  switch (faction) {
    case "freefolk":
      return openGround + (site.height >= 4 && site.height <= 15 ? 3 : -3) +
        (site.river ? -3 : 0) + (site.moisture > 0.25 && site.moisture < 0.78 ? 1 : 0);
    case "elves":
      return openGround + site.forest * 6 + (site.river ? 1 : 0) -
        (site.height > 24 ? 3 : 0);
    case "dwarves":
      return site.mountain * 6 + Math.max(0, site.height - 12) * 0.22 +
        (site.surface === "cobblestone" ? 2 : 0) - (site.river ? 2 : 0);
    case "orcs":
      return (site.surface === "snow" ? -3 : 1) +
        (site.height >= 7 && site.height <= 26 ? 2 : -1) +
        (site.moisture < 0.58 ? 1.5 : 0) + site.mountain * 1.2;
    case "mages":
      return (site.height >= 9 && site.height <= 27 ? 3 : -1) +
        site.mountain * 2 + openGround - (site.river ? 1 : 0);
    case "wardens":
      return site.forest * 3 + site.mountain * 2 +
        (site.height >= 6 && site.height <= 24 ? 1 : -1);
  }
}

function settlementShape(faction: SettlementFaction, tier: number): {
  kind: SettlementKind;
  radius: number;
} {
  if (faction === "freefolk") {
    if (tier > 0.9) return { kind: "city", radius: 23 };
    if (tier > 0.55) return { kind: "town", radius: 17 };
    return { kind: "village", radius: 12 };
  }
  if (faction === "elves") return { kind: "grove", radius: 14 };
  if (faction === "dwarves") return { kind: "hold", radius: 13 };
  if (faction === "orcs") return { kind: "camp", radius: 11 };
  if (faction === "mages") return { kind: "tower", radius: 9 };
  return { kind: "lodge", radius: 10 };
}

function rolesFor(faction: SettlementFaction): string[] {
  switch (faction) {
    case "freefolk": return ["farmer", "trader", "miller", "craftsperson", "town guard"];
    case "elves": return ["ranger", "herbalist", "storykeeper", "bow scout"];
    case "dwarves": return ["smith", "stonewright", "delver", "hold guard"];
    case "orcs": return ["scout", "clan keeper", "tracker", "warrior"];
    case "mages": return ["wizard", "apprentice", "lorekeeper", "healer"];
    case "wardens": return ["beast tracker", "herbalist", "trail guide", "monster hunter"];
  }
}

function makeSettlement(
  seed: number,
  regionX: number,
  regionZ: number,
  sample: TerrainSampler,
): Settlement | null {
  const presence = hash2(regionX, regionZ, seed + 8201);
  if (presence < 0.38) return null;

  const faction = chooseFaction(hash2(regionX, regionZ, seed + 8219));
  const centerX = regionX * REGION_SIZE + REGION_SIZE / 2 +
    Math.floor((hash2(regionX, regionZ, seed + 8231) - 0.5) * 20);
  const centerZ = regionZ * REGION_SIZE + REGION_SIZE / 2 +
    Math.floor((hash2(regionX, regionZ, seed + 8243) - 0.5) * 20);
  const candidates: Array<[number, number]> = [
    [0, 0], [8, 0], [-8, 0], [0, 8], [0, -8],
    [16, 8], [-16, 8], [16, -8], [-16, -8],
    [24, 0], [-24, 0], [0, 24], [0, -24],
    [24, 16], [-24, -16], [24, -16], [-24, 16],
  ];
  let best: { x: number; z: number; site: SettlementTerrain; score: number } | null = null;
  for (const [offsetX, offsetZ] of candidates) {
    const x = centerX + offsetX;
    const z = centerZ + offsetZ;
    const site = sample(x, z, seed);
    const score = scoreSite(faction, site);
    if (!best || score > best.score) best = { x, z, site, score };
  }
  if (!best || best.score < 2.3) return null;

  const tier = hash2(regionX, regionZ, seed + 8291);
  const { kind, radius } = settlementShape(faction, tier);
  const population = kind === "city" ? 8 : kind === "town" ? 6 : kind === "village" ? 4 : 3;
  const id = `${seed}:${regionX}:${regionZ}`;
  const name = `${pick(nameStarts, hash2(regionX, regionZ, seed + 8297))}${pick(
    nameEnds,
    hash2(regionZ, regionX, seed + 8311),
  )}`;
  const roles = rolesFor(faction);
  const inhabitants: Humanoid[] = [];

  for (let index = 0; index < population; index += 1) {
    const angle = index * 2.399963 + hash2(index, regionX + regionZ, seed + 8353);
    const distance = 3 + hash2(index + regionX, regionZ, seed + 8363) * Math.min(9, radius * 0.62);
    const x = best.x + Math.round(Math.cos(angle) * distance);
    const z = best.z + Math.round(Math.sin(angle) * distance);
    const ground = sample(x, z, seed);
    inhabitants.push({
      id: `${id}:${index}`,
      name: `${pick(firstNames, hash2(index, regionX, seed + 8377))} ${pick(
        familyNames,
        hash2(regionZ, index, seed + 8389),
      )}`,
      faction,
      role: roles[index % roles.length],
      x: x + 0.5,
      y: ground.height + 1,
      z: z + 0.5,
      phase: hash2(index, regionX + regionZ, seed + 8399) * Math.PI * 2,
    });
  }

  return {
    id,
    name,
    faction,
    kind,
    x: best.x + 0.5,
    y: best.site.height + 1,
    z: best.z + 0.5,
    radius,
    inhabitants,
  };
}

function getSettlement(
  seed: number,
  regionX: number,
  regionZ: number,
  sample: TerrainSampler,
): Settlement | null {
  const key = `${seed}:${regionX}:${regionZ}`;
  const cached = regionCache.get(key);
  if (cached !== undefined) {
    regionCache.delete(key);
    regionCache.set(key, cached);
    return cached;
  }
  const settlement = makeSettlement(seed, regionX, regionZ, sample);
  if (regionCache.size >= MAX_REGION_CACHE) {
    const oldest = regionCache.keys().next().value;
    if (oldest !== undefined) regionCache.delete(oldest);
  }
  regionCache.set(key, settlement);
  return settlement;
}

export function getNearbySettlements(
  seed: number,
  x: number,
  z: number,
  radius: number,
  sample: TerrainSampler,
): Settlement[] {
  const searchRadius = radius + 34;
  const minRegionX = Math.floor((x - searchRadius) / REGION_SIZE);
  const maxRegionX = Math.floor((x + searchRadius) / REGION_SIZE);
  const minRegionZ = Math.floor((z - searchRadius) / REGION_SIZE);
  const maxRegionZ = Math.floor((z + searchRadius) / REGION_SIZE);
  const settlements: Settlement[] = [];
  for (let regionX = minRegionX; regionX <= maxRegionX; regionX += 1) {
    for (let regionZ = minRegionZ; regionZ <= maxRegionZ; regionZ += 1) {
      const settlement = getSettlement(seed, regionX, regionZ, sample);
      if (!settlement) continue;
      const distance = Math.hypot(settlement.x - x, settlement.z - z);
      if (distance <= radius + settlement.radius) settlements.push(settlement);
    }
  }
  return settlements.sort(
    (left, right) =>
      Math.hypot(left.x - x, left.z - z) - Math.hypot(right.x - x, right.z - z),
  );
}

const BUILDING_OFFSETS: Array<[number, number]> = [
  [-8, -4], [0, -10], [8, -4], [-10, 4], [0, 0],
  [10, 4], [-7, 11], [7, 11], [0, 17],
];

function buildingMaterials(faction: SettlementFaction): {
  wall: WorldBlockType;
  roof: WorldBlockType;
  floor: WorldBlockType;
} {
  switch (faction) {
    case "freefolk": return { wall: "planks", roof: "roof", floor: "cobblestone" };
    case "elves": return { wall: "wood", roof: "leaves", floor: "wood" };
    case "dwarves": return { wall: "cobblestone", roof: "stone", floor: "stone" };
    case "orcs": return { wall: "wood", roof: "cobblestone", floor: "dirt" };
    case "mages": return { wall: "brick", roof: "roof", floor: "stone" };
    case "wardens": return { wall: "planks", roof: "cobblestone", floor: "cobblestone" };
  }
}

function addHouse(
  blocks: Record<string, WorldBlockType>,
  centerX: number,
  centerZ: number,
  halfSize: number,
  baseY: number,
  materials: ReturnType<typeof buildingMaterials>,
  chunkX: number,
  chunkZ: number,
  sample: TerrainSampler,
  seed: number,
): void {
  const roofHeight = Math.min(2, halfSize - 1);
  for (let dx = -halfSize; dx <= halfSize; dx += 1) {
    for (let dz = -halfSize; dz <= halfSize; dz += 1) {
      const x = centerX + dx;
      const z = centerZ + dz;
      if (Math.floor(x / 16) !== chunkX || Math.floor(z / 16) !== chunkZ) continue;
      const terrainY = sample(x, z, seed).height;
      const foundationMaterial = materials.floor === "wood" ? "wood" : "cobblestone";
      for (let y = terrainY + 1; y <= baseY; y += 1) {
        setCell(blocks, x, y, z, foundationMaterial, chunkX, chunkZ);
      }
      setCell(blocks, x, baseY, z, materials.floor, chunkX, chunkZ);

      const edge = Math.abs(dx) === halfSize || Math.abs(dz) === halfSize;
      if (!edge) continue;
      for (let wallY = 1; wallY <= 3; wallY += 1) {
        const door = dz === halfSize && dx === 0 && wallY <= 2;
        const window = wallY === 2 &&
          ((Math.abs(dx) === halfSize && Math.abs(dz) <= 1) ||
            (Math.abs(dz) === halfSize && Math.abs(dx) <= 1)) &&
          hash2(x, z, seed + 8423) > 0.36;
        if (door) continue;
        setCell(
          blocks,
          x,
          baseY + wallY,
          z,
          window ? "glass" : materials.wall,
          chunkX,
          chunkZ,
        );
      }
    }
  }

  for (let dx = -halfSize; dx <= halfSize; dx += 1) {
    const rise = roofHeight - Math.floor(Math.abs(dx) * roofHeight / (halfSize + 1));
    for (let dz = -halfSize - 1; dz <= halfSize + 1; dz += 1) {
      setCell(
        blocks,
        centerX + dx,
        baseY + 4 + rise,
        centerZ + dz,
        materials.roof,
        chunkX,
        chunkZ,
      );
    }
  }
}

function setCell(
  blocks: Record<string, WorldBlockType>,
  x: number,
  y: number,
  z: number,
  type: WorldBlockType,
  chunkX: number,
  chunkZ: number,
): void {
  if (y < 0 || y > 64 || Math.floor(x / 16) !== chunkX || Math.floor(z / 16) !== chunkZ) return;
  blocks[`${x},${y},${z}`] = type;
}

export function addSettlementBlocksToChunk(
  blocks: Record<string, WorldBlockType>,
  chunkX: number,
  chunkZ: number,
  seed: number,
  sample: TerrainSampler,
): void {
  const startX = chunkX * 16;
  const startZ = chunkZ * 16;
  const minRegionX = Math.floor((startX - 32) / REGION_SIZE);
  const maxRegionX = Math.floor((startX + 48) / REGION_SIZE);
  const minRegionZ = Math.floor((startZ - 32) / REGION_SIZE);
  const maxRegionZ = Math.floor((startZ + 48) / REGION_SIZE);

  for (let regionX = minRegionX; regionX <= maxRegionX; regionX += 1) {
    for (let regionZ = minRegionZ; regionZ <= maxRegionZ; regionZ += 1) {
      const settlement = getSettlement(seed, regionX, regionZ, sample);
      if (!settlement) continue;
      if (
        settlement.x + 22 < startX ||
        settlement.x - 22 > startX + 15 ||
        settlement.z + 22 < startZ ||
        settlement.z - 22 > startZ + 15
      ) continue;
      const materials = buildingMaterials(settlement.faction);
      const buildingCount = settlement.kind === "city" ? 9 :
        settlement.kind === "town" ? 6 :
          settlement.kind === "village" ? 4 : 3;
      for (let index = 0; index < buildingCount; index += 1) {
        const [offsetX, offsetZ] = BUILDING_OFFSETS[index];
        const x = Math.floor(settlement.x) + offsetX;
        const z = Math.floor(settlement.z) + offsetZ;
        const size = settlement.kind === "city" && index === 4 ? 3 :
          settlement.kind === "hold" && index === 0 ? 3 : 2;
        const baseY = sample(x, z, seed).height + 1;
        addHouse(
          blocks,
          x,
          z,
          size,
          baseY,
          materials,
          chunkX,
          chunkZ,
          sample,
          seed,
        );
      }
    }
  }
}
