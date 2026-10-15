import { ID } from "./blocks";
import { CHUNK_SIZE, ChunkWriter, SEA_LEVEL } from "./chunk";
import { hash2, lerp, smoothstep } from "./noise";
import type { HeightRecord, Terrain } from "./terrain";
import { leafBlob } from "./trees";

/**
 * Settlements (1 block = 0.5 m).
 *
 * How one is made, in order:
 *  1. The world is divided into 192 x 192 regions; each region may hold one
 *     settlement. A few candidate sites per region are scored for flatness,
 *     dryness and what the faction likes (elves want forest, dwarves want
 *     mountains, ...). Sites on or near water are rejected.
 *  2. The winning site is terraformed: the ground inside a square footprint
 *     is levelled to one height and eased back to the natural land over a
 *     12-block apron (see `settlementGround`, which feeds the terrain model).
 *  3. The layout is planned logically: two cross streets meet in a plaza,
 *     buildings line the streets and face them, cottages fill the quadrants
 *     with a path to the nearest street, and bigger settlements get a wall.
 *  4. Chunks stamp only the part of each structure that lies inside them, so
 *     a building across a chunk border is built seamlessly by both chunks.
 *
 * Kinds and their rules (all decided from the region's hash rolls and the
 * terrain score, so they are the same in every chunk and every session):
 *   village - freefolk, any decent lowland, 36-block footprint, no wall
 *   town    - freefolk, better ground, 44 blocks, timber palisade
 *   city    - freefolk, best ground, 54 blocks, stone wall and corner towers
 *   kingdom - freefolk only, ~1 region in 6, and `scoreSite` then insists on
 *             a broad FLAT plain (range <= 14 blocks), 3-30 m above sea
 *             level, never desert or frozen, moisture 0.4-0.8. It is the
 *             biggest footprint (56 blocks): a crenellated curtain wall with
 *             eight gate towers, a stone keep on the plaza with its own four
 *             towers, and an inner ward wall between them - keep, wards and
 *             bailey like a real medieval castle.
 *   grove/hold/camp/tower/lodge - the non-human factions, placed by taste.
 *
 * Furnishing: every house gets a table and chairs against the wall opposite
 * its door, halls and keeps get a long banquet table, and doorways are hung
 * with wooden doors (opaque, but walk-through). All four - door, chair, table
 * and marble - are also craftable and placeable by the player (press C).
 *
 * Proportions: the player is 4 blocks tall, so doors are 5 high, rooms have
 * 5 blocks of headroom and streets are 5 wide (2.5 m).
 */

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
  | "kingdom"
  | "grove"
  | "hold"
  | "camp"
  | "tower"
  | "lodge";

/**
 * Kept for compatibility, but settlements no longer spawn any: the game is
 * architecture-only by design, with no NPC mobs walking around.
 */
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

type Facing = 0 | 1 | 2 | 3; // 0 = +z, 1 = +x, 2 = -z, 3 = -x

interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  wall: number;
  facing: Facing;
  roof: "gable" | "hip" | "flat";
  wallBlock: number;
  frameBlock: number;
  roofBlock: number;
  floorBlock: number;
  foundation: number;
  chimney: number;
  glazed: boolean;
}

interface Farm {
  x: number;
  z: number;
  w: number;
  d: number;
}

interface PathSegment {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

interface WallSpec {
  height: number;
  block: number;
  palisade: boolean;
  gateHalfWidth: number;
  gates: Facing[];
}

interface TowerSpec {
  x: number;
  z: number;
  w: number;
  height: number;
  wallBlock: number;
  bandBlock: number;
  roofBlock: number;
  roofRise: number;
}

type Feature = "well" | "tree" | "hall" | "fire" | "mage" | "keep";

export interface Settlement {
  id: string;
  name: string;
  faction: SettlementFaction;
  kind: SettlementKind;
  /** Centre of the plaza; y is the standing height. */
  x: number;
  y: number;
  z: number;
  /** Half-extent of the levelled footprint, in blocks. */
  radius: number;
  inhabitants: Humanoid[];
  /* generation data (not shown in the HUD) */
  baseY: number;
  centerX: number;
  centerZ: number;
  buildings: Building[];
  farms: Farm[];
  paths: PathSegment[];
  wall: WallSpec | null;
  /** Kingdoms only: the ward wall around the keep, and its half-extent. */
  innerWall: WallSpec | null;
  innerHalf: number;
  towers: TowerSpec[];
  feature: Feature;
  streetBlock: number;
  plazaBlock: number;
}

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

const REGION_SIZE = 192;
const APRON = 12;
const MAX_HALF = 64;
const MAX_REGION_CACHE = 128;
const regionCache = new Map<string, Settlement | null>();

const nameStarts = [
  "Amber", "Bracken", "Clover", "Dawn", "Fern", "Gold", "Heather",
  "Juniper", "Moss", "Oaken", "River", "Silver", "Thistle", "Willow",
];
const nameEnds = [
  "brook", "fall", "field", "grove", "haven", "hollow", "mere",
  "reach", "rest", "ridge", "stead", "watch", "well", "wick",
];

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

interface KindSpec {
  kind: SettlementKind;
  half: number;
  occupancy: number;
  quadrantCottages: number;
  population: number;
}

function kindFor(faction: SettlementFaction, tier: number, kingdom: boolean): KindSpec {
  if (faction === "freefolk") {
    // A kingdom is a walled royal seat: the biggest footprint in the game,
    // ruled by `scoreSite`, which only allows one on a broad fertile plain.
    if (kingdom) return { kind: "kingdom", half: 56, occupancy: 0.75, quadrantCottages: 0.45, population: 16 };
    if (tier > 0.88) return { kind: "city", half: 54, occupancy: 0.95, quadrantCottages: 0.75, population: 14 };
    if (tier > 0.5) return { kind: "town", half: 44, occupancy: 0.9, quadrantCottages: 0.6, population: 9 };
    return { kind: "village", half: 36, occupancy: 0.85, quadrantCottages: 0.5, population: 6 };
  }
  if (faction === "elves") return { kind: "grove", half: 38, occupancy: 0.75, quadrantCottages: 0.45, population: 5 };
  if (faction === "dwarves") return { kind: "hold", half: 40, occupancy: 0.8, quadrantCottages: 0.35, population: 5 };
  if (faction === "orcs") return { kind: "camp", half: 32, occupancy: 0.8, quadrantCottages: 0.4, population: 5 };
  if (faction === "mages") return { kind: "tower", half: 30, occupancy: 0.8, quadrantCottages: 0.35, population: 4 };
  return { kind: "lodge", half: 32, occupancy: 0.75, quadrantCottages: 0.35, population: 4 };
}

/* ------------------------------------------------------------------ */
/* Site selection                                                      */
/* ------------------------------------------------------------------ */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function scoreSite(
  faction: SettlementFaction,
  spec: KindSpec,
  terrain: Terrain,
  x: number,
  z: number,
): { score: number; baseY: number } {
  const half = spec.half;
  // Probe the whole footprint (centre, half-way ring, and the edge/corners of the square).
  // Anything wet in there rejects the site; the outer apron may be wet.
  const probes: Array<[number, number]> = [[0, 0]];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    probes.push([dx * half * 0.5, dz * half * 0.5]);
    probes.push([dx * half, dz * half]);
  }
  const heights: number[] = [];
  for (const [dx, dz] of probes) {
    const rec = terrain.natural(Math.round(x + dx), Math.round(z + dz));
    if (rec.water > 0 || rec.riverDist < rec.riverHalfWidth + 4) return { score: -100, baseY: 0 };
    heights.push(rec.ground);
  }
  const baseY = median(heights);
  if (baseY < SEA_LEVEL + 3 || baseY > 118) return { score: -100, baseY };
  const range = Math.max(...heights) - Math.min(...heights);
  if (range > 26) return { score: -100, baseY };
  // Terraforming smooths ground out, so only large height differences cost score.
  const flatPenalty = Math.max(0, range - 8) * 0.25;

  const centre = terrain.natural(Math.round(x), Math.round(z));
  const { temperature, moisture } = terrain.climate(x, z, baseY);
  const elev = baseY - SEA_LEVEL;
  const desert = temperature > 0.62 && moisture < 0.46;
  const frozen = temperature < 0.22;

  // Kingdoms are the one settlement with hard geographic rules: they only
  // rise on a broad, flat, well-watered plain (never desert, tundra or
  // hill country), and the flatter the better - that is where a medieval
  // king could farm, tax and defend a shire.
  if (spec.kind === "kingdom") {
    if (range > 14 || elev < 3 || elev > 30) return { score: -100, baseY };
    if (desert || frozen || moisture < 0.4 || moisture > 0.8) return { score: -100, baseY };
    return {
      baseY,
      score: 4 + (range <= 8 ? 2 : 0) + (moisture > 0.45 && moisture < 0.75 ? 1.5 : 0) - flatPenalty * 2,
    };
  }

  let score: number;
  switch (faction) {
    case "freefolk":
      score = (elev >= 3 && elev <= 40 ? 3 : -1) + (moisture > 0.38 && moisture < 0.78 ? 1.5 : 0) +
        (desert ? -2.5 : 0) + (frozen ? -3 : 0) - flatPenalty;
      break;
    case "elves":
      score = moisture * 6 + (temperature > 0.35 ? 1 : -2) - (elev > 50 ? 3 : 0) - flatPenalty;
      break;
    case "dwarves":
      score = centre.mountain * 8 + Math.max(0, elev - 25) * 0.12 - flatPenalty * 0.5;
      break;
    case "orcs":
      score = (elev >= 12 && elev <= 60 ? 2.2 : 0) + (moisture < 0.55 ? 1.5 : 0) + centre.mountain * 1.5 - flatPenalty;
      break;
    case "mages":
      score = (elev >= 18 && elev <= 70 ? 3 : -1) + centre.mountain * 2 - flatPenalty;
      break;
    case "wardens":
      score = moisture * 3 + centre.mountain * 2 + (elev >= 8 && elev <= 50 ? 1.2 : -1) - flatPenalty;
      break;
  }
  return { score, baseY };
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

interface Style {
  walls: number[];
  frame: number;
  roof: number;
  floor: number;
  foundation: number;
  chimney: number;
  roofShape: "gable" | "hip";
}

function styleFor(faction: SettlementFaction, kind: SettlementKind): Style {
  if (kind === "kingdom") {
    // Royal stone: dressed walls, oak frames, tiled roofs - the castle style.
    return {
      walls: [ID.stone_bricks, ID.limestone, ID.planks],
      frame: ID.wood,
      roof: ID.roof,
      floor: ID.planks,
      foundation: ID.cobblestone,
      chimney: ID.cobblestone,
      roofShape: "gable",
    };
  }
  switch (faction) {
    case "freefolk":
      return {
        walls: kind === "city" ? [ID.planks, ID.limestone, ID.brick] : [ID.planks, ID.planks, ID.limestone],
        frame: ID.wood,
        roof: kind === "village" ? ID.thatch : ID.roof,
        floor: ID.planks,
        foundation: ID.cobblestone,
        chimney: ID.cobblestone,
        roofShape: "gable",
      };
    case "elves":
      return { walls: [ID.birch_wood], frame: ID.wood, roof: ID.birch_leaves, floor: ID.planks, foundation: ID.wood, chimney: 0, roofShape: "hip" };
    case "dwarves":
      return { walls: [ID.stone_bricks, ID.cobblestone], frame: ID.stone_bricks, roof: ID.roof, floor: ID.stone, foundation: ID.stone_bricks, chimney: ID.stone_bricks, roofShape: "gable" };
    case "orcs":
      return { walls: [ID.dark_planks], frame: ID.spruce_wood, roof: ID.thatch, floor: ID.dirt, foundation: ID.cobblestone, chimney: 0, roofShape: "hip" };
    case "mages":
      return { walls: [ID.limestone, ID.brick], frame: ID.stone_bricks, roof: ID.roof, floor: ID.planks, foundation: ID.stone_bricks, chimney: ID.brick, roofShape: "gable" };
    case "wardens":
      return { walls: [ID.dark_planks, ID.planks], frame: ID.spruce_wood, roof: ID.roof, floor: ID.planks, foundation: ID.cobblestone, chimney: ID.cobblestone, roofShape: "gable" };
  }
}

function oddSize(roll: number, options: number[]): number {
  return options[Math.min(options.length - 1, Math.floor(roll * options.length))];
}

/**
 * Street plan, relative to the plaza at (0, 0):
 *   - an x-street (|dz| <= 2) and a z-street (|dx| <= 2) cross at the plaza;
 *   - z-street houses start 9 blocks out, x-street houses start 19 blocks out
 *     so the two rows never collide at the plaza corners;
 *   - quadrant cottages sit beyond both rows, joined to the nearest street.
 */
function layout(settlement: Settlement, spec: KindSpec, regionX: number, regionZ: number, seed: number): void {
  const { faction, kind, radius: half } = settlement;
  const style = styleFor(faction, kind);
  const r = (index: number) => hash2(regionX * 131 + index, regionZ * 137 + index * 7, seed + 9100);
  const cx = settlement.centerX;
  const cz = settlement.centerZ;

  const makeBuilding = (
    x: number,
    z: number,
    w: number,
    d: number,
    facing: Facing,
    index: number,
    big = false,
  ): Building => ({
    x,
    z,
    w,
    d,
    wall: big ? 8 : 6,
    facing,
    roof: big && faction === "dwarves" ? "flat" : style.roofShape,
    wallBlock: pick(style.walls, r(index + 400)),
    frameBlock: style.frame,
    roofBlock: style.roof,
    floorBlock: style.floor,
    foundation: style.foundation,
    chimney: style.chimney,
    glazed: faction !== "orcs",
  });

  settlement.feature =
    faction === "elves" ? "tree" :
    faction === "dwarves" ? "hall" :
    faction === "orcs" || kind === "lodge" ? "fire" :
    faction === "mages" ? "mage" :
    kind === "kingdom" ? "keep" : "well";
  settlement.streetBlock = kind === "city" || kind === "kingdom" ? ID.cobblestone : ID.path;
  settlement.plazaBlock = kind === "city" || kind === "kingdom" || faction === "dwarves" ? ID.stone_bricks : ID.cobblestone;

  // The dwarven great hall sits on the plaza where other peoples have a well.
  if (settlement.feature === "hall") {
    settlement.buildings.push(makeBuilding(cx, cz - 1, 21, 13, 0, 900, true));
  }

  // The royal keep rises on the plaza of a kingdom: tall stone walls, a great
  // door facing the main gate, and flanking towers on its corners.
  if (settlement.feature === "keep") {
    const keep = makeBuilding(cx, cz, 21, 17, 0, 901, true);
    keep.wall = 12;
    keep.wallBlock = ID.stone_bricks;
    keep.frameBlock = ID.limestone;
    keep.roofBlock = ID.roof;
    keep.glazed = true;
    settlement.buildings.push(keep);
  }

  const limit = half - 5;
  // Kingdoms keep their houses clear of the inner ward wall around the keep.
  const streetLateral = kind === "kingdom" ? 16 : 5;
  const zRowStart = kind === "kingdom" ? 17 : 9;
  const rowDepth = (index: number) => oddSize(r(index), faction === "orcs" ? [7, 9] : [9, 11]);
  const rowWidth = (index: number) => oddSize(r(index), faction === "orcs" ? [7, 9] : [9, 11, 13]);
  let buildingIndex = 0;

  for (const side of [-1, 1]) {
    for (const dir of [-1, 1]) {
      // x-street row: houses at z = side * offset, marching along x.
      let along = 19;
      while (true) {
        buildingIndex += 1;
        const w = rowWidth(buildingIndex * 3);
        const d = rowDepth(buildingIndex * 3 + 1);
        if (along + w > limit + 1) break;
        const centre = along + (w - 1) / 2;
        along += w + 4;
        if (r(buildingIndex * 3 + 2) > spec.occupancy) continue;
        settlement.buildings.push(
          makeBuilding(cx + dir * centre, cz + side * (streetLateral + (d - 1) / 2), w, d, side > 0 ? 2 : 0, buildingIndex),
        );
      }
      // z-street row: houses at x = side * offset, marching along z.
      along = zRowStart;
      while (true) {
        buildingIndex += 1;
        const d = rowWidth(buildingIndex * 3);
        const w = rowDepth(buildingIndex * 3 + 1);
        if (along + d > limit + 1) break;
        const centre = along + (d - 1) / 2;
        along += d + 4;
        if (r(buildingIndex * 3 + 2) > spec.occupancy) continue;
        settlement.buildings.push(
          makeBuilding(cx + side * (streetLateral + (w - 1) / 2), cz + dir * centre, w, d, side > 0 ? 3 : 1, buildingIndex),
        );
      }
    }
  }

  // Quadrant cottages (and, for farming villages, a field), each joined to the nearest street.
  let farms = 0;
  let cottage = 0;
  const step = faction === "orcs" ? 11 : 13;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 4; i += 1) {
        for (let j = 0; j < 4; j += 1) {
          cottage += 1;
          const qx = 24 + i * step;
          const qz = 24 + j * step;
          if (qx + 5 > half - 4 || qz + 5 > half - 4) continue;
          const cellRoll = r(cottage + 600);
          if (faction === "freefolk" && kind !== "city" && i === 0 && j === 0 && farms < 3 && cellRoll < 0.75) {
            settlement.farms.push({ x: cx + sx * 24, z: cz + sz * 26, w: 11, d: 15 });
            farms += 1;
            continue;
          }
          if (cellRoll > spec.quadrantCottages) continue;
          const size = faction === "orcs" ? 7 : oddSize(r(cottage + 700), [7, 9]);
          const x = cx + sx * qx;
          const z = cz + sz * qz;
          const reach = (size - 1) / 2 + 1;
          if (qz <= qx) {
            // Nearer to the x-street: door faces it along z.
            settlement.buildings.push(makeBuilding(x, z, size, size, sz > 0 ? 2 : 0, 1000 + cottage));
            const doorZ = z - sz * reach;
            const edgeZ = cz + sz * (kind === "kingdom" ? 15 : 3);
            settlement.paths.push({ x0: x - 1, x1: x + 1, z0: Math.min(doorZ, edgeZ), z1: Math.max(doorZ, edgeZ) });
          } else {
            settlement.buildings.push(makeBuilding(x, z, size, size, sx > 0 ? 3 : 1, 1000 + cottage));
            const doorX = x - sx * reach;
            const edgeX = cx + sx * (kind === "kingdom" ? 15 : 3);
            settlement.paths.push({ z0: z - 1, z1: z + 1, x0: Math.min(doorX, edgeX), x1: Math.max(doorX, edgeX) });
          }
        }
      }
    }
  }

  // Walls and towers.
  if (kind === "kingdom") {
    // Curtain wall: 16 blocks (8 m) of crenellated stone, four gatehouses,
    // and an inner ward wall that rings the keep alone.
    settlement.wall = { height: 16, block: ID.stone_bricks, palisade: false, gateHalfWidth: 5, gates: [0, 1, 2, 3] };
    settlement.innerWall = { height: 10, block: ID.stone_bricks, palisade: false, gateHalfWidth: 3, gates: [0, 1, 2, 3] };
    settlement.innerHalf = 14;
  } else if (kind === "city") {
    settlement.wall = { height: 14, block: ID.stone_bricks, palisade: false, gateHalfWidth: 4, gates: [0, 1, 2, 3] };
  } else if (kind === "hold") {
    settlement.wall = { height: 12, block: ID.stone_bricks, palisade: false, gateHalfWidth: 4, gates: [0, 2] };
  } else if (kind === "town") {
    settlement.wall = { height: 8, block: ID.spruce_wood, palisade: true, gateHalfWidth: 3, gates: [0, 1, 2, 3] };
  } else if (kind === "camp") {
    settlement.wall = { height: 7, block: ID.spruce_wood, palisade: true, gateHalfWidth: 3, gates: [Math.floor(r(77) * 4) as Facing] };
  }
  if (settlement.wall && !settlement.wall.palisade) {
    const corner = half - 1;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        settlement.towers.push({
          x: cx + sx * corner,
          z: cz + sz * corner,
          w: 9,
          height: settlement.wall.height + 8,
          wallBlock: ID.stone_bricks,
          bandBlock: ID.cobblestone,
          roofBlock: ID.roof,
          roofRise: 5,
        });
      }
    }
  }
  if (kind === "kingdom" && settlement.wall) {
    const edge = half - 1;
    const flank = settlement.wall.gateHalfWidth + 6;
    // Twin towers on each side of every gate, then four more around the keep.
    for (const [ox, oz] of [
      [-flank, edge], [flank, edge], [-flank, -edge], [flank, -edge],
      [edge, -flank], [edge, flank], [-edge, -flank], [-edge, flank],
    ] as const) {
      settlement.towers.push({
        x: cx + ox,
        z: cz + oz,
        w: 7,
        height: settlement.wall.height + 5,
        wallBlock: ID.stone_bricks,
        bandBlock: ID.marble,
        roofBlock: ID.roof,
        roofRise: 4,
      });
    }
    for (const [ox, oz] of [[-11, -9], [11, -9], [-11, 9], [11, 9]] as const) {
      settlement.towers.push({
        x: cx + ox,
        z: cz + oz,
        w: 7,
        height: 22,
        wallBlock: ID.stone_bricks,
        bandBlock: ID.limestone,
        roofBlock: ID.roof,
        roofRise: 5,
      });
    }
  }
  if (settlement.feature === "mage") {
    settlement.towers.push({
      x: cx,
      z: cz,
      w: 11,
      height: 44,
      wallBlock: ID.limestone,
      bandBlock: ID.stone_bricks,
      roofBlock: ID.roof,
      roofRise: 9,
    });
  }
}

function makeSettlement(terrain: Terrain, seed: number, regionX: number, regionZ: number): Settlement | null {
  if (hash2(regionX, regionZ, seed + 8201) < 0.3) return null;

  const faction = chooseFaction(hash2(regionX, regionZ, seed + 8219));
  const tier = hash2(regionX, regionZ, seed + 8291);
  // Only one region in about six becomes a kingdom, and only freefolk land;
  // `scoreSite` then insists the ground is a broad, flat, fertile plain.
  const kingdom = faction === "freefolk" && hash2(regionX, regionZ, seed + 8293) > 0.82 && tier > 0.4;
  const spec = kindFor(faction, tier, kingdom);
  const centerX = regionX * REGION_SIZE + REGION_SIZE / 2 +
    Math.floor((hash2(regionX, regionZ, seed + 8231) - 0.5) * 16);
  const centerZ = regionZ * REGION_SIZE + REGION_SIZE / 2 +
    Math.floor((hash2(regionX, regionZ, seed + 8243) - 0.5) * 16);

  let best: { x: number; z: number; score: number; baseY: number } | null = null;
  for (const offsetX of [-48, -24, 0, 24, 48]) {
    for (const offsetZ of [-48, -24, 0, 24, 48]) {
      const x = centerX + offsetX;
      const z = centerZ + offsetZ;
      const result = scoreSite(faction, spec, terrain, x, z);
      if (!best || result.score > best.score) best = { x, z, ...result };
    }
  }
  if (!best || best.score < 2.2) return null;

  const id = `${seed}:${regionX}:${regionZ}`;
  const name = `${pick(nameStarts, hash2(regionX, regionZ, seed + 8297))}${pick(
    nameEnds,
    hash2(regionZ, regionX, seed + 8311),
  )}`;
  const settlement: Settlement = {
    id,
    name,
    faction,
    kind: spec.kind,
    x: best.x + 0.5,
    y: best.baseY + 1,
    z: best.z + 0.5,
    radius: spec.half,
    inhabitants: [],
    baseY: best.baseY,
    centerX: best.x,
    centerZ: best.z,
    buildings: [],
    farms: [],
    paths: [],
    wall: null,
    innerWall: null,
    innerHalf: 0,
    towers: [],
    feature: "well",
    streetBlock: ID.path,
    plazaBlock: ID.cobblestone,
  };
  layout(settlement, spec, regionX, regionZ, seed);

  // Settlements are architecture only - no residents, no mobs. What you get
  // is the streets, the buildings, the furniture inside them, and the walls.
  return settlement;
}

function getSettlement(terrain: Terrain, regionX: number, regionZ: number): Settlement | null {
  const key = `${terrain.seed}:${regionX}:${regionZ}`;
  const cached = regionCache.get(key);
  if (cached !== undefined) return cached;
  const settlement = makeSettlement(terrain, terrain.seed, regionX, regionZ);
  if (regionCache.size >= MAX_REGION_CACHE) {
    const oldest = regionCache.keys().next().value;
    if (oldest !== undefined) regionCache.delete(oldest);
  }
  regionCache.set(key, settlement);
  return settlement;
}

/** Settlements whose footprint (plus apron) could touch the box [x0..x1] x [z0..z1]. */
function settlementsTouching(terrain: Terrain, x0: number, z0: number, x1: number, z1: number): Settlement[] {
  const reach = MAX_HALF + APRON + 48 + 8; // footprint + apron + candidate offset + jitter
  const result: Settlement[] = [];
  const minRegionX = Math.floor((x0 - reach) / REGION_SIZE);
  const maxRegionX = Math.floor((x1 + reach) / REGION_SIZE);
  const minRegionZ = Math.floor((z0 - reach) / REGION_SIZE);
  const maxRegionZ = Math.floor((z1 + reach) / REGION_SIZE);
  for (let regionX = minRegionX; regionX <= maxRegionX; regionX += 1) {
    for (let regionZ = minRegionZ; regionZ <= maxRegionZ; regionZ += 1) {
      const settlement = getSettlement(terrain, regionX, regionZ);
      if (!settlement) continue;
      const margin = settlement.radius + APRON + 2;
      if (
        settlement.centerX + margin < x0 || settlement.centerX - margin > x1 ||
        settlement.centerZ + margin < z0 || settlement.centerZ - margin > z1
      ) continue;
      result.push(settlement);
    }
  }
  return result;
}

export function getNearbySettlements(terrain: Terrain, x: number, z: number, radius: number): Settlement[] {
  return settlementsTouching(terrain, x - radius, z - radius, x + radius, z + radius)
    .filter((settlement) => Math.hypot(settlement.x - x, settlement.z - z) <= radius + settlement.radius)
    .sort(
      (left, right) =>
        Math.hypot(left.x - x, left.z - z) - Math.hypot(right.x - x, right.z - z),
    );
}

/* ------------------------------------------------------------------ */
/* Terraforming hook                                                   */
/* ------------------------------------------------------------------ */

/** Levels the ground inside settlement footprints; installed on `Terrain.hook`. */
export function settlementGround(
  terrain: Terrain,
  x: number,
  z: number,
  natural: HeightRecord,
): { ground: number; water: number; flat: number } | null {
  let bestWeight = 0;
  let bestBase = 0;
  for (const settlement of settlementsTouching(terrain, x, z, x, z)) {
    const distance = Math.max(Math.abs(x - settlement.centerX), Math.abs(z - settlement.centerZ));
    const weight = 1 - smoothstep((distance - (settlement.radius + 2)) / APRON);
    if (weight > bestWeight) {
      bestWeight = weight;
      bestBase = settlement.baseY;
    }
  }
  if (bestWeight <= 0) return null;
  const ground = Math.round(lerp(natural.ground, bestBase, bestWeight));
  const water = bestWeight < 0.5 && natural.water > ground ? natural.water : 0;
  return { ground, water, flat: bestWeight };
}

/* ------------------------------------------------------------------ */
/* Stamping                                                            */
/* ------------------------------------------------------------------ */

const DIRS: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 0], [0, -1], [-1, 0]];

function stampBuilding(writer: ChunkWriter, b: Building, ground: number): void {
  const hx = (b.w - 1) / 2;
  const hz = (b.d - 1) / 2;
  if (!writer.overlaps(b.x - hx - 3, b.z - hz - 3, b.x + hx + 3, b.z + hz + 3)) return;
  const top = ground + b.wall;
  const ridgeAlongX = b.w >= b.d;

  for (let dx = -hx; dx <= hx; dx += 1) {
    for (let dz = -hz; dz <= hz; dz += 1) {
      const x = b.x + dx;
      const z = b.z + dz;
      if (!writer.inside(x, z)) continue;
      writer.set(x, ground, z, b.floorBlock);
      const onX = Math.abs(dx) === hx;
      const onZ = Math.abs(dz) === hz;
      if (!onX && !onZ) {
        for (let y = ground + 1; y <= top; y += 1) writer.set(x, y, z, 0);
        continue;
      }
      const corner = onX && onZ;
      const along = onZ ? dx : dz;
      const wallLength = onZ ? hx : hz;
      const onDoorWall =
        (b.facing === 0 && dz === hz) || (b.facing === 2 && dz === -hz) ||
        (b.facing === 1 && dx === hx) || (b.facing === 3 && dx === -hx);
      const doorCell = onDoorWall && Math.abs(along) <= 1 && !corner;
      writer.set(x, ground, z, b.foundation);
      for (let wy = 1; wy <= b.wall; wy += 1) {
        const y = ground + wy;
        if (doorCell && wy <= 5) {
          // A hung wooden door: opaque so it reads as a door, but walk-through.
          writer.set(x, y, z, ID.door);
          continue;
        }
        let block = corner ? b.frameBlock : b.wallBlock;
        const a = Math.abs(along);
        const windowRow = wy === 3 || wy === 4;
        const windowColumn = a >= 2 && a <= wallLength - 2 && (a % 4 === 2 || a % 4 === 3);
        if (b.glazed && !corner && windowRow && windowColumn && !(onDoorWall && a <= 2)) block = ID.glass;
        writer.set(x, y, z, block);
      }
    }
  }

  // Furniture against the wall opposite the door: a table with a chair on
  // each side. Halls and keeps get a long banquet table instead. Every house
  // in every settlement is furnished this way - and the player can craft and
  // place the very same chair, table and door anywhere.
  const interiorLimitX = hx - 1;
  const interiorLimitZ = hz - 1;
  const place = (dx: number, dz: number, id: number): void => {
    if (Math.abs(dx) > interiorLimitX || Math.abs(dz) > interiorLimitZ) return;
    writer.set(b.x + dx, ground + 1, b.z + dz, id);
  };
  const alongDoor = b.facing === 0 || b.facing === 2;
  const backRow =
    b.facing === 0 ? -hz + 1 : b.facing === 2 ? hz - 1 : b.facing === 3 ? hx - 1 : -hx + 1;
  const chairRow = backRow < 0 ? backRow + 1 : backRow - 1;
  if (b.w >= 15 || b.d >= 15) {
    const span = Math.min(Math.floor((b.w >= b.d ? hx : hz) - 1), 7);
    for (let d = -span; d <= span; d += 1) {
      if (alongDoor) place(d, backRow, ID.table);
      else place(backRow, d, ID.table);
    }
    for (let d = -span + 1; d <= span; d += 3) {
      if (alongDoor) place(d, chairRow, ID.chair);
      else place(chairRow, d, ID.chair);
    }
  } else if (alongDoor) {
    place(0, backRow, ID.table);
    place(-2, backRow, ID.chair);
    place(2, backRow, ID.chair);
  } else {
    place(backRow, 0, ID.table);
    place(backRow, -2, ID.chair);
    place(backRow, 2, ID.chair);
  }

  // Roof: gable (ridge along the longer side), hip, or flat with battlements.
  const rx = hx + 1;
  const rz = hz + 1;
  for (let dx = -rx; dx <= rx; dx += 1) {
    for (let dz = -rz; dz <= rz; dz += 1) {
      const x = b.x + dx;
      const z = b.z + dz;
      if (!writer.inside(x, z)) continue;
      if (b.roof === "flat") {
        if (Math.abs(dx) === rx || Math.abs(dz) === rz) continue;
        writer.set(x, top + 1, z, b.roofBlock);
        if ((Math.abs(dx) === hx || Math.abs(dz) === hz) && (dx + dz) % 2 === 0) writer.set(x, top + 2, z, b.roofBlock);
        continue;
      }
      const rise = b.roof === "hip"
        ? Math.min(rx - Math.abs(dx), rz - Math.abs(dz))
        : ridgeAlongX ? rz - Math.abs(dz) : rx - Math.abs(dx);
      const y = top + rise;
      writer.set(x, y, z, b.roofBlock);
      if (b.roof === "gable") {
        const endWall = ridgeAlongX
          ? Math.abs(dx) === hx && Math.abs(dz) <= hz
          : Math.abs(dz) === hz && Math.abs(dx) <= hx;
        if (endWall) for (let fill = top + 1; fill < y; fill += 1) writer.set(x, fill, z, b.wallBlock);
      }
    }
  }

  // Chimney against the gable end, rising past the ridge.
  if (b.chimney !== 0 && b.roof === "gable") {
    const px = ridgeAlongX ? b.x + hx + 1 : b.x;
    const pz = ridgeAlongX ? b.z : b.z + hz + 1;
    const ridge = top + (ridgeAlongX ? rz : rx);
    for (let y = ground + 1; y <= ridge + 2; y += 1) writer.set(px, y, pz, b.chimney);
  }
}

function stampWell(writer: ChunkWriter, cx: number, cz: number, ground: number): void {
  if (!writer.overlaps(cx - 3, cz - 3, cx + 3, cz + 3)) return;
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      const x = cx + dx;
      const z = cz + dz;
      if (Math.max(Math.abs(dx), Math.abs(dz)) === 2) {
        for (let y = ground - 2; y <= ground + 1; y += 1) writer.set(x, y, z, ID.cobblestone);
      } else {
        writer.set(x, ground - 3, z, ID.cobblestone);
        for (let y = ground - 2; y <= ground; y += 1) writer.set(x, y, z, ID.water);
        for (let y = ground + 1; y <= ground + 6; y += 1) writer.set(x, y, z, 0);
      }
    }
  }
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    for (let y = ground + 2; y <= ground + 6; y += 1) writer.set(cx + dx, y, cz + dz, ID.wood);
  }
  for (let dx = -3; dx <= 3; dx += 1) {
    for (let dz = -3; dz <= 3; dz += 1) {
      if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
      writer.set(cx + dx, ground + 7, cz + dz, ID.thatch);
    }
  }
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) writer.set(cx + dx, ground + 8, cz + dz, ID.thatch);
  }
}

function stampFire(writer: ChunkWriter, cx: number, cz: number, ground: number): void {
  if (!writer.overlaps(cx - 3, cz - 3, cx + 3, cz + 3)) return;
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      const dist = Math.max(Math.abs(dx), Math.abs(dz));
      if (dist === 2) writer.set(cx + dx, ground + 1, cz + dz, ID.cobblestone);
      else writer.set(cx + dx, ground, cz + dz, dist === 0 ? ID.coal_ore : ID.gravel);
    }
  }
}

function stampGreatTree(writer: ChunkWriter, cx: number, cz: number, ground: number, seed: number): void {
  if (!writer.overlaps(cx - 20, cz - 20, cx + 20, cz + 20)) return;
  const height = 42;
  for (let y = ground + 1; y <= ground + height; y += 1) {
    const radius = y < ground + 6 ? 3 : y < ground + 12 ? 2 : 1;
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
        writer.set(cx + dx, y, cz + dz, ID.birch_wood);
      }
    }
  }
  leafBlob(writer, cx, ground + height - 2, cz, 15, 9, ID.birch_leaves, seed, 0.16);
  leafBlob(writer, cx + 9, ground + height - 9, cz + 3, 8, 5, ID.leaves, seed + 1, 0.16);
  leafBlob(writer, cx - 8, ground + height - 10, cz - 4, 8, 5, ID.leaves, seed + 2, 0.16);
}

function stampFarm(writer: ChunkWriter, farm: Farm, ground: number): void {
  const hx = (farm.w - 1) / 2;
  const hz = (farm.d - 1) / 2;
  if (!writer.overlaps(farm.x - hx, farm.z - hz, farm.x + hx, farm.z + hz)) return;
  for (let dx = -hx; dx <= hx; dx += 1) {
    for (let dz = -hz; dz <= hz; dz += 1) {
      const x = farm.x + dx;
      const z = farm.z + dz;
      if (!writer.inside(x, z)) continue;
      if (dx === 0) {
        // Irrigation channel down the middle, level with the soil.
        writer.set(x, ground, z, ID.water);
        continue;
      }
      writer.set(x, ground, z, ID.farmland);
      writer.set(x, ground + 1, z, Math.abs(dz) === hz || Math.abs(dx) === hx ? 0 : ID.wheat);
    }
  }
}

/** One square ring of wall (curtain wall or ward wall) with gates and merlons. */
function stampRing(
  writer: ChunkWriter,
  centerX: number,
  centerZ: number,
  half: number,
  wall: WallSpec,
  salt: number,
  ground: number,
): void {
  const inner = half - 2;
  const minX = Math.max(centerX - half, writer.startX);
  const maxX = Math.min(centerX + half, writer.startX + CHUNK_SIZE - 1);
  const minZ = Math.max(centerZ - half, writer.startZ);
  const maxZ = Math.min(centerZ + half, writer.startZ + CHUNK_SIZE - 1);
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const dx = x - centerX;
      const dz = z - centerZ;
      if (Math.max(Math.abs(dx), Math.abs(dz)) < inner) continue;
      let gate = false;
      for (const facing of wall.gates) {
        const [gx, gz] = DIRS[facing];
        if (gx !== 0 && Math.sign(dx) === gx && Math.abs(dz) <= wall.gateHalfWidth) gate = true;
        if (gz !== 0 && Math.sign(dz) === gz && Math.abs(dx) <= wall.gateHalfWidth) gate = true;
      }
      const jitter = wall.palisade ? Math.floor(hash2(x, z, salt + 7) * 3) : 0;
      const height = wall.palisade ? wall.height - 1 + jitter : wall.height;
      for (let y = ground + 1; y <= ground + height; y += 1) {
        if (gate && y <= ground + (wall.palisade ? 6 : 9)) continue;
        // Crenellations: stone walls alternate raised and lowered blocks along the top.
        if (!wall.palisade && y === ground + height && (x + z) % 2 === 0) continue;
        writer.set(x, y, z, wall.block);
      }
    }
  }
}

function stampWall(writer: ChunkWriter, s: Settlement, ground: number): void {
  if (s.wall) stampRing(writer, s.centerX, s.centerZ, s.radius, s.wall, s.baseY, ground);
}

function stampTower(writer: ChunkWriter, t: TowerSpec, ground: number): void {
  const h = (t.w - 1) / 2;
  if (!writer.overlaps(t.x - h - 1, t.z - h - 1, t.x + h + 1, t.z + h + 1)) return;
  for (let dx = -h - 1; dx <= h + 1; dx += 1) {
    for (let dz = -h - 1; dz <= h + 1; dz += 1) {
      const x = t.x + dx;
      const z = t.z + dz;
      if (!writer.inside(x, z)) continue;
      const edge = Math.max(Math.abs(dx), Math.abs(dz));
      if (edge <= h) {
        writer.set(x, ground, z, ID.planks);
        if (edge < h) for (let y = ground + 1; y <= ground + t.height; y += 1) writer.set(x, y, z, 0);
      }
      if (edge === h) {
        const corner = Math.abs(dx) === h && Math.abs(dz) === h;
        const doorCell = dz === h && Math.abs(dx) <= 1;
        for (let wy = 1; wy <= t.height; wy += 1) {
          if (doorCell && wy <= 5) {
            writer.set(x, ground + wy, z, ID.door);
            continue;
          }
          const band = wy % 9 === 0;
          const slit = !corner && wy > 8 && (wy % 9 === 4 || wy % 9 === 5) && Math.abs(dx % 4) !== 0 && Math.abs(dz % 4) !== 0;
          writer.set(x, ground + wy, z, slit ? ID.glass : band || corner ? t.bandBlock : t.wallBlock);
        }
      }
      // Solid pyramid roof with a small overhang.
      const lift = Math.round(((h + 1 - edge) * t.roofRise) / (h + 1));
      const roofTop = ground + t.height + (edge <= h ? Math.max(1, lift) : 0);
      for (let y = ground + t.height + 1; y <= roofTop; y += 1) writer.set(x, y, z, t.roofBlock);
      if (edge === h + 1) writer.set(x, ground + t.height, z, t.roofBlock);
    }
  }
  writer.set(t.x, ground + t.height + t.roofRise + 1, t.z, ID.glass);
}

function groundCover(s: Settlement, dx: number, dz: number): number {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  const limit = s.radius - 3;
  if (ax > limit || az > limit) return 0;
  if (ax <= 5 && az <= 5) return s.plazaBlock;
  if (ax <= 2 || az <= 2) return s.streetBlock;
  return 0;
}

export function stampSettlements(writer: ChunkWriter, terrain: Terrain, seed: number): void {
  const { startX, startZ } = writer;
  const endX = startX + CHUNK_SIZE - 1;
  const endZ = startZ + CHUNK_SIZE - 1;
  for (const s of settlementsTouching(terrain, startX, startZ, endX, endZ)) {
    const ground = s.baseY;
    const half = s.radius;
    if (!writer.overlaps(s.centerX - half - 2, s.centerZ - half - 2, s.centerX + half + 2, s.centerZ + half + 2)) continue;

    // 1. Streets and plaza paving, clearing any plants above them.
    for (let x = Math.max(s.centerX - half, startX); x <= Math.min(s.centerX + half, endX); x += 1) {
      for (let z = Math.max(s.centerZ - half, startZ); z <= Math.min(s.centerZ + half, endZ); z += 1) {
        const block = groundCover(s, x - s.centerX, z - s.centerZ);
        if (block === 0) continue;
        writer.set(x, ground, z, block);
        writer.set(x, ground + 1, z, 0);
      }
    }
    for (const path of s.paths) {
      const x0 = Math.min(path.x0, path.x1);
      const x1 = Math.max(path.x0, path.x1);
      const z0 = Math.min(path.z0, path.z1);
      const z1 = Math.max(path.z0, path.z1);
      if (!writer.overlaps(x0, z0, x1, z1)) continue;
      for (let x = Math.max(x0, startX); x <= Math.min(x1, endX); x += 1) {
        for (let z = Math.max(z0, startZ); z <= Math.min(z1, endZ); z += 1) {
          writer.set(x, ground, z, ID.path);
          writer.set(x, ground + 1, z, 0);
        }
      }
    }

    // 2. Farms, centrepiece, buildings, walls and towers.
    for (const farm of s.farms) stampFarm(writer, farm, ground);
    if (s.feature === "well") stampWell(writer, s.centerX, s.centerZ, ground);
    else if (s.feature === "fire") stampFire(writer, s.centerX, s.centerZ, ground);
    else if (s.feature === "tree") stampGreatTree(writer, s.centerX, s.centerZ, ground, seed);
    for (const building of s.buildings) stampBuilding(writer, building, ground);
    stampWall(writer, s, ground);
    // The inner ward of a kingdom: its own wall around the keep, gated on
    // every street so the town flows through it like a real bailey.
    if (s.innerWall && s.innerHalf > 0) {
      stampRing(writer, s.centerX, s.centerZ, s.innerHalf, s.innerWall, s.baseY + 13, ground);
    }
    for (const tower of s.towers) stampTower(writer, tower, ground);
  }
}
