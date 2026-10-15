import { ID } from "./blocks";
import {
  accentBlock,
  applyVictorianFacade,
  blueprintById,
  pickFrom,
  rosterPool,
  tierPalette,
  tierRoofBlock,
  type Blueprint,
  type HumanTier,
} from "./blueprints";
import { CHUNK_SIZE, ChunkWriter, SEA_LEVEL } from "./chunk";
import { hash2, lerp, smoothstep } from "./noise";
import type { HeightRecord, Terrain } from "./terrain";
import { leafBlob } from "./trees";
import { hierarchyNodesInBounds, hierarchyPlanFor } from "./hierarchy-streaming";

/**
 * Settlements (1 block = 0.5 m).
 *
 * How one is made, in order:
 *  1. The world is divided into 320 x 320 procedural regions; each region may hold one
 *     settlement. A few candidate sites per region are scored for flatness,
 *     dryness and what the faction likes (elves want forest, dwarves want
 *     mountains, ...). Sites on or near water are rejected.
 *  2. The winning site is terraformed: the ground inside a square footprint
 *     is levelled to one height and eased back to the natural land over a
 *     12-block apron (see `settlementGround`, which feeds the terrain model).
 *  3. The layout is planned logically on paper first - see below - then every
 *     chunk stamps only the part of each structure that lies inside it, so a
 *     building across a chunk border is built seamlessly by both chunks.
 *  4. Chunks stamp in this order: streets and paths, moat and bridges, farms,
 *     gardens, the centrepiece, buildings, walls, towers, gatehouses last
 *     (their archway must cut through the wall).
 *
 * The four human designs follow the settlement sheet exactly - one roster of
 * named house types per tier (see `blueprints.ts`), a progression of
 * village -> town -> castle -> kingdom:
 *
 *   village - 42-block radius. Central square with a well, the village
 *             hall (the chief's house, 2 storeys), a watchtower and market
 *             stalls on the square, cottages, farms. Thatched roofs, timber.
 *             No wall - just open lanes.
 *   town    - 62-block radius. Five neighborhood squares linked by streets; town hall (3 storeys, clock turret) and
 *             guild hall facing the square, three market stalls, an inn and a
 *             blacksmith with a lit forge guaranteed; multi-storey row houses
 *             along the streets. Timber palisade, 9 high, with a stone gate
 *             tower on each of the four gates. Cobble streets.
 *   castle  - 76-block radius, on flat-ish defended ground. A water MOAT
 *             around a 15-high crenellated curtain wall with four gatehouses
 *             (open archways you walk through) and twelve towers; the royal
 *             keep (5 storeys, gold banded, four corner turrets) rises on the
 *             centre; barracks, armoury, stables, granary, a chapel with a
 *             spire, a mage tower, guest and commander houses fill the bailey,
 *             and the royal gardens (hedges, paths, a fountain) sit in one
 *             quarter.
 *   kingdom - 104-block radius, on a broad flat fertile plain only (see
 *             `scoreSite`). Moat + 16-high curtain wall with eight gate
 *             towers, four corner towers and four gatehouses; inside, an
 *             inner ward wall (10 high, gated on every street) rings the
 *             royal palace (5 storeys, dome, corner turrets, gold); four
 *             paved DISTRICTS hold the grand market (four gold-trimmed
 *             stalls + trade guild), the temple, the barracks, and the
 *             warehouses; government house, university, hospital, noble
 *             estates and the harbour master take ring slots; a royal park
 *             and a farm fill the outer wards.
 *   grove/hold/camp/tower/lodge - the non-human factions, placed by taste.
 *
 * Multi-storey buildings that are at least 9 x 9 get a staircase they can
 * walk up (one-block steps + floor slabs at every 6-block storey line);
 * windows light every storey; belt courses mark the floors (marble, gold or
 * brick); market stalls are canopies on posts instead of walls; and gates,
 * moats and bridges are stamped so you can stroll in from any direction.
 *
 * Furnishing: every house gets a table and chairs against the wall opposite
 * its door, halls and keeps get a long banquet table, the blacksmith gets a
 * coal forge, and doorways are hung with wooden doors (opaque, but
 * walk-through). Door, chair, table, marble, brick and gold are all
 * placeable blocks too (press C, except gold: gather it from royal places).
 *
 * Proportions: the player is 4 blocks tall, so doors are 5 high, storeys are
 * 6 blocks, rooms keep 5 blocks of headroom and streets are 5 wide (2.5 m).
 *
 * There are NO mobs: settlements are uninhabited architecture by design.
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
  | "castle"
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

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Wall height above the floor: storeys * 6. */
  wall: number;
  stories: number;
  facing: Facing;
  roof: "gable" | "hip" | "flat" | "mansard" | "dome";
  wallBlock: number;
  frameBlock: number;
  roofBlock: number;
  floorBlock: number;
  foundation: number;
  chimney: number;
  glazed: boolean;
  /** Which design from the roster built this (for the HUD and tests). */
  blueprint: string;
  /** Belt-course block (gold, marble or brick), or 0 for none. */
  accent: number;
  /** Market stall: paving, posts and a canopy instead of walls. */
  open: boolean;
  /** Roof-top lookout: one central turret or four corner turrets. */
  turret: 0 | 1 | 4;
  /** Chapel-style spire above the ridge. */
  spire: boolean;
  /** Blacksmith: coal fire in the corner, stack through the roof. */
  forge: boolean;
  /** Gatehouse: open archway through the ground floor along this axis. */
  passage?: "x" | "z";
  /** 0 = none, 1 = table + chairs, 2 = banquet table. */
  furniture: 0 | 1 | 2;
  /** Victorian facade variant: 0 = standard, 1 = bay window, 2 = full Victorian */
  facadeVariant?: 0 | 1 | 2;
  /** Number of Victorian sash windows per façade side. */
  windowCount?: number;
  /** Decorative cornice block (gold, marble, or brick), or 0 for none. */
  corniceBlock?: number;
  /** Whether the building has a decorative gable trim. */
  gableTrim?: boolean;
  /** Whether the building has dormer windows. */
  hasDormers?: boolean;
  /** Bay window width in blocks (0 = none). */
  bayWindowWidth?: number;
}

interface Farm {
  x: number;
  z: number;
  w: number;
  d: number;
}

interface Garden {
  x: number;  z: number;  w: number;
  d: number;
}

interface District {
  x: number;
  z: number;
  half: number;
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
  /** True for gate towers: doors on all four faces so the street runs through. */
  doors?: boolean;
}

type Feature = "well" | "fountain" | "tree" | "hall" | "fire" | "mage" | "keep" | "palace";

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
  gardens: Garden[];
  paths: PathSegment[];
  /** Paved district squares (kingdom markets, temples, ...). */
  districts: District[];
  wall: WallSpec | null;
  /** Kingdoms only: the ward wall around the palace, and its half-extent. */
  innerWall: WallSpec | null;
  innerHalf: number;
  /** Castle & kingdom: a water channel around the outer wall. */
  moat: boolean;
  towers: TowerSpec[];
  /** Gatehouses, stamped after the wall so their archway cuts through it. */
  gates: Building[];
  /** A few landmark names for the HUD card. */
  landmarks: string[];
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

// Seeded procedural regions: placement is derived from the world seed and terrain,
// not authored settlement coordinates. Larger regions leave room for major towns.
const REGION_SIZE = 320;
const APRON = 12;
const MAX_HALF = 112;
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
    // The sheet's progression: village -> town -> castle -> kingdom, from
    // smallest/most common to largest/rarest. A kingdom additionally has to
    // pass `scoreSite`'s broad-plain rules.
    if (kingdom) return { kind: "kingdom", half: 104, occupancy: 0.94, quadrantCottages: 0.9, population: 24 };
    if (tier > 0.78) return { kind: "castle", half: 76, occupancy: 0.92, quadrantCottages: 0.78, population: 18 };
    if (tier > 0.45) return { kind: "town", half: 62, occupancy: 0.92, quadrantCottages: 0.82, population: 12 };
    return { kind: "village", half: 42, occupancy: 0.96, quadrantCottages: 0.88, population: 8 };
  }
  if (faction === "elves") return { kind: "grove", half: 38, occupancy: 0.75, quadrantCottages: 0.45, population: 5 };
  if (faction === "dwarves") return { kind: "hold", half: 40, occupancy: 0.8, quadrantCottages: 0.35, population: 5 };
  if (faction === "orcs") return { kind: "camp", half: 32, occupancy: 0.8, quadrantCottages: 0.4, population: 5 };
  if (faction === "mages") return { kind: "tower", half: 30, occupancy: 0.8, quadrantCottages: 0.35, population: 4 };
  return { kind: "lodge", half: 32, occupancy: 0.75, quadrantCottages: 0.35, population: 4 };
}

function isHumanTier(kind: SettlementKind): kind is HumanTier {
  return kind === "village" || kind === "town" || kind === "castle" || kind === "kingdom";
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
  // Castles want defensible, buildable ground: flat enough for a moat and a
  // curtain wall, temperate, not frozen and not a dune field.
  if (spec.kind === "castle") {
    if (range > 20 || elev < 4 || elev > 46) return { score: -100, baseY };
    if (desert || frozen || moisture < 0.28 || moisture > 0.85) return { score: -100, baseY };
    return {
      baseY,
      score: 3.5 + (range <= 12 ? 1.5 : 0) + (moisture > 0.4 && moisture < 0.75 ? 1 : 0) - flatPenalty * 2,
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
/* Layout: the human four (blueprint rosters)                          */
/* ------------------------------------------------------------------ */

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

interface Style {
  walls: number[];
  frame: number;
  roof: number;
  floor: number;
  foundation: number;
  chimney: number;
  roofShape: "gable" | "hip";
}

/** Faction styles (freefolk tiers use the blueprint palettes instead). */
function styleFor(faction: SettlementFaction, kind: SettlementKind): Style {
  switch (faction) {
    case "freefolk":
      return {
        walls: [ID.planks, ID.planks, ID.limestone],
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
 * The four human designs. Everything is hand-placed specials first (plaza,
 * districts, farms, ring slots), then generic street rows and block cottages
 * fill whatever is left - each slot checked against the rectangles already
 * taken, so houses never overlap and landmark buildings are always present.
 */
function layoutHuman(settlement: Settlement, spec: KindSpec, regionX: number, regionZ: number, seed: number): void {
  const tier = settlement.kind as HumanTier;
  const cx = settlement.centerX;
  const cz = settlement.centerZ;
  const half = settlement.radius;
  // How far buildings may reach toward the edge (curtain wall or open fields).
  const limit = half - (tier === "castle" || tier === "kingdom" ? 6 : 5);
  const r = (index: number) => hash2(regionX * 131 + index, regionZ * 137 + index * 7, seed + 9100);

  const placed: Rect[] = [];
  const rectOf = (x: number, z: number, w: number, d: number): Rect => ({
    x0: x - (w - 1) / 2,
    z0: z - (d - 1) / 2,
    x1: x + (w - 1) / 2,
    z1: z + (d - 1) / 2,
  });
  const fits = (x: number, z: number, w: number, d: number, m = 2): boolean => {
    const rect = rectOf(x, z, w, d);
    return !placed.some(
      (p) => rect.x0 - m <= p.x1 && rect.x1 + m >= p.x0 && rect.z0 - m <= p.z1 && rect.z1 + m >= p.z0,
    );
  };

  const landmarks: string[] = [];
  const remember = (bp: Blueprint): void => {
    if (!landmarks.includes(bp.label)) landmarks.push(bp.label);
  };

  const make = (bp: Blueprint, x: number, z: number, facing: Facing, extra?: Partial<Building>): Building => {
    const palette = tierPalette(tier, bp.style);
    return applyVictorianFacade({
      x,
      z,
      w: bp.w,
      d: bp.d,
      wall: bp.stories * 6,
      stories: bp.stories,
      facing,
      roof: bp.roof,
      wallBlock: pick(palette.walls, r(bp.id.length * 7 + Math.abs(x * 13 + z))),
      frameBlock: palette.frame,
      roofBlock: tierRoofBlock(tier),
      floorBlock: palette.floor,
      foundation: palette.foundation,
      chimney: bp.chimney || bp.forge ? ID.cobblestone : 0,
      glazed: true,
      blueprint: bp.id,
      accent: accentBlock(bp.accent),
      open: !!bp.open,
      turret: bp.turret ?? 0,      spire: !!bp.spire,
      forge: !!bp.forge,      passage: bp.passage,
      furniture: bp.furniture,
      ...extra,
    }, bp.facadeVariant, bp.windowCount, bp.corniceBlock, bp.gableTrim, bp.hasDormers, bp.bayWindowWidth);
  };
  const commit = (bp: Blueprint, x: number, z: number, facing: Facing, m = 2, extra?: Partial<Building>): void => {
    if (!fits(x, z, bp.w, bp.d, m)) return;
    const building = make(bp, x, z, facing, extra);
    placed.push(rectOf(building.x, building.z, building.w, building.d));
    settlement.buildings.push(building);
    remember(bp);
  };
  /** Face toward the settlement centre from (x, z). */
  const facingIn = (x: number, z: number): Facing => {
    const fdx = cx - x;
    const fdz = cz - z;
    return Math.abs(fdx) >= Math.abs(fdz) ? (fdx > 0 ? 1 : 3) : (fdz > 0 ? 0 : 2);
  };

  /* ---- centre piece ---- */
  settlement.feature =
    tier === "village" ? "well" : tier === "town" ? "fountain" : tier === "castle" ? "keep" : "palace";
  settlement.streetBlock = tier === "castle" || tier === "kingdom" ? ID.cobblestone : ID.path;
  settlement.plazaBlock = tier === "castle" || tier === "kingdom" ? ID.stone_bricks : ID.cobblestone;
  if (tier === "castle") commit(blueprintById(tier, "royal_keep"), cx, cz, 0, 0);
  if (tier === "kingdom") commit(blueprintById(tier, "royal_palace"), cx, cz, 0, 0);

  /* ---- plaza: the ruler's hall, the market, the tower ---- */
  if (tier === "village") {
    commit(blueprintById(tier, "village_hall"), cx, cz - 11, 0, 0);
    commit(blueprintById(tier, "watchtower"), cx + 10, cz - 10, 0, 0);
    commit(blueprintById(tier, "market_stall"), cx + 10, cz + 10, 3, 0);
    commit(blueprintById(tier, "market_stall"), cx - 10, cz - 10, 1, 0);
  } else if (tier === "town") {
    commit(blueprintById(tier, "town_hall"), cx, cz - 13, 0, 0);
    commit(blueprintById(tier, "guild_hall"), cx, cz + 13, 2, 0);
    commit(blueprintById(tier, "city_market"), cx + 11, cz + 5, 3, 0);
    commit(blueprintById(tier, "city_market"), cx + 11, cz - 5, 3, 0);
    commit(blueprintById(tier, "city_market"), cx - 11, cz + 5, 1, 0);
  }

  /* ---- districts: gardens in a castle, four quarters in a kingdom ---- */
  if (tier === "castle") {
    const gx = cx + Math.round(half * 0.52);
    const gz = cz + Math.round(half * 0.52);
    const garden = blueprintById(tier, "royal_gardens");
    if (fits(gx, gz, garden.w, garden.d)) {
      settlement.gardens.push({ x: gx, z: gz, w: garden.w, d: garden.d });
      placed.push(rectOf(gx, gz, garden.w, garden.d));
      remember(garden);
    }
  }
  if (tier === "kingdom") {
    const d = Math.round(half * 0.55);
    const district = (ox: number, oz: number): { x: number; z: number } => {
      const x = cx + ox * d;
      const z = cz + oz * d;
      settlement.districts.push({ x, z, half: 10 });
      placed.push(rectOf(x, z, 21, 21));
      return { x, z };
    };
    // Grand market: four gold-trimmed stalls around the trade guild.
    const market = district(-1, -1);
    commit(blueprintById(tier, "trade_guild"), market.x, market.z, facingIn(market.x, market.z), 0);
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const sx = market.x + ox * 8;
      const sz = market.z + oz * 8;
      commit(blueprintById(tier, "grand_market"), sx, sz, facingIn(sx, sz), 0);
    }
    // Temple quarter, barracks quarter, warehouse quarter.
    const templeQuarter = district(1, -1);
    commit(blueprintById(tier, "temple"), templeQuarter.x, templeQuarter.z, facingIn(templeQuarter.x, templeQuarter.z), 0);
    const garrison = district(-1, 1);
    commit(blueprintById(tier, "barracks"), garrison.x, garrison.z, facingIn(garrison.x, garrison.z), 0);
    const stores = district(1, 1);
    commit(blueprintById(tier, "warehouse"), stores.x - 7, stores.z, facingIn(stores.x - 7, stores.z), 0);
    commit(blueprintById(tier, "warehouse"), stores.x + 7, stores.z, facingIn(stores.x + 7, stores.z), 0);
  }

  /* ---- neighborhood hierarchy and local street network ---- */
  // Towns are organized as five village-like neighborhoods around the civic
  // centre. Castles have four wards around the keep. Kingdoms have ten urban
  // wards (the visual city-level subdivisions) around the palace and districts.
  const wardCount = tier === "town" ? 5 : tier === "castle" ? 4 : tier === "kingdom" ? 10 : 0;
  const wardReach = tier === "town" ? 0.58 : tier === "castle" ? 0.48 : 0.66;
  const wardHalf = tier === "town" ? 4 : tier === "castle" ? 5 : 6;
  for (let ward = 0; ward < wardCount; ward += 1) {
    const angle = -Math.PI / 2 + (ward * Math.PI * 2) / wardCount;
    const wx = cx + Math.round(Math.cos(angle) * half * wardReach);
    const wz = cz + Math.round(Math.sin(angle) * half * wardReach);
    // A compact local square gives each neighborhood a recognizable centre.
    settlement.districts.push({ x: wx, z: wz, half: wardHalf });
    // Connect the local square back to the civic cross, forming a walkable
    // street hierarchy instead of isolated rows of houses.
    if (Math.abs(wx - cx) >= Math.abs(wz - cz)) {
      settlement.paths.push({ x0: Math.min(cx, wx), x1: Math.max(cx, wx), z0: wz - 1, z1: wz + 1 });
    } else {
      settlement.paths.push({ x0: wx - 1, x1: wx + 1, z0: Math.min(cz, wz), z1: Math.max(cz, wz) });
    }
  }

  /* ---- farms and parks (guaranteed green space) ---- */
  const greenSpace: Record<HumanTier, Array<[number, number, number, number] | "garden">> = {
    village: [[-24, 26, 13, 15], [26, -25, 15, 13]],
    town: [[-27, 27, 13, 15]],
    castle: [[-28, 27, 13, 15]],
    kingdom: [[-40, -10, 13, 15], "garden"],
  };
  for (const entry of greenSpace[tier]) {
    if (entry === "garden") {
      const bp = blueprintById(tier, "royal_park");
      const x = cx + 40;
      const z = cz + 10;
      if (fits(x, z, bp.w, bp.d)) {
        settlement.gardens.push({ x, z, w: bp.w, d: bp.d });
        placed.push(rectOf(x, z, bp.w, bp.d));
        remember(bp);
      }
      continue;
    }
    const [ox, oz, w, d] = entry;
    const x = cx + ox;
    const z = cz + oz;
    if (fits(x, z, w, d, 1)) settlement.farms.push({ x, z, w, d });
  }

  /* ---- ring slots: the guaranteed landmark houses ---- */
  const guaranteed: Record<HumanTier, string[]> = {
    village: [],
    town: ["blacksmith", "inn"],
    castle: ["barracks", "armoury", "stable", "granary", "chapel", "mage_tower", "guest_house", "commanders_house", "noble_house"],
    kingdom: ["government", "university", "hospital", "harbour_master", "noble_estate"],
  };
  // Ring slots sit off the streets (22.5° off the axes) at three reaches.
  const slots: Array<{ x: number; z: number }> = [];
  for (let k = 0; k < 8; k += 1) {
    const angle = Math.PI / 8 + (k * Math.PI) / 4;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    for (const reach of [0.46, 0.64, 0.84]) {
      slots.push({ x: cx + Math.round(reach * half * dx), z: cz + Math.round(reach * half * dz) });
    }
  }
  for (const id of guaranteed[tier]) {
    const bp = blueprintById(tier, id);
    for (const slot of slots) {
      if (Math.abs(slot.x) + (bp.w - 1) / 2 > limit || Math.abs(slot.z) + (bp.d - 1) / 2 > limit) continue;
      // Kingdom landmarks must stand clear of the inner ward wall.
      if (
        tier === "kingdom" &&
        Math.abs(slot.x) - (bp.w - 1) / 2 <= settlement.innerHalf + 1 &&
        Math.abs(slot.z) - (bp.d - 1) / 2 <= settlement.innerHalf + 1
      ) continue;
      if (!fits(slot.x, slot.z, bp.w, bp.d)) continue;
      commit(bp, slot.x, slot.z, facingIn(slot.x, slot.z));
      break;
    }
  }

  /* ---- street rows: houses lining the cross streets ---- */
  const streetLateral = tier === "kingdom" ? 16 : tier === "castle" ? 7 : tier === "town" ? 6 : 5;
  const zRowStart = tier === "kingdom" ? 17 : tier === "castle" ? 13 : tier === "town" ? 11 : 9;
  const rowPool = rosterPool(tier, "row");
  let buildingIndex = 0;
  if (rowPool.length > 0) {
    for (const side of [-1, 1]) {
      for (const dir of [-1, 1]) {
        // Rows beside the x-street: march along x (fits() keeps them off
        // whatever stands on the plaza corner).
        let along = 13;
        while (true) {
          buildingIndex += 1;
          const bp = pickFrom(rowPool, r(buildingIndex * 3));
          if (along + bp.w > limit + 1) break;
          const centre = along + (bp.w - 1) / 2;
          along += bp.w + 3;
          if (r(buildingIndex * 3 + 2) > spec.occupancy) continue;
          const x = cx + dir * centre;
          const z = cz + side * (streetLateral + (bp.d - 1) / 2);
          if (!fits(x, z, bp.w, bp.d)) continue;
          commit(bp, x, z, side > 0 ? 2 : 0);
        }
        // Rows beside the z-street: march along z.
        along = zRowStart;
        while (true) {
          buildingIndex += 1;
          const bp = pickFrom(rowPool, r(buildingIndex * 3));
          if (along + bp.d > limit + 1) break;
          const centre = along + (bp.d - 1) / 2;
          along += bp.d + 3;
          if (r(buildingIndex * 3 + 2) > spec.occupancy) continue;
          const x = cx + side * (streetLateral + (bp.w - 1) / 2);
          const z = cz + dir * centre;
          if (!fits(x, z, bp.w, bp.d)) continue;
          commit(bp, x, z, side > 0 ? 3 : 1);
        }
      }
    }
  }
  /* ---- block cottages between the streets, each with a path ---- */
  const quadPool = rosterPool(tier, "quad");
  // Residential blocks expand with each tier. The homes follow local lanes and
  // use varied footprints/setbacks to form clusters rather than a square grid.
  const quadStart = tier === "village" ? 11 : tier === "town" ? 15 : tier === "castle" ? 19 : 27;
  const step = tier === "village" ? 8 : tier === "town" ? 9 : tier === "castle" ? 10 : 11;
  const gridCount = tier === "village" ? 4 : tier === "town" ? 6 : tier === "castle" ? 7 : 8;
  let cottage = 0;
  let farms = 0;
  const farmGoal = tier === "village" ? 2 : tier === "town" ? 3 : tier === "castle" ? 2 : 4;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < gridCount; i += 1) {
        for (let j = 0; j < gridCount; j += 1) {
          cottage += 1;
          const qx = quadStart + i * step + Math.floor(r(cottage + 711) * 3) - 1;
          const qz = quadStart + j * step + Math.floor(r(cottage + 712) * 3) - 1;
          const cellRoll = r(cottage + 600);
          // Farming villages keep the first free block of each quarter as a field.
          if (tier === "village" && i === 0 && j === 0 && farms < farmGoal && cellRoll < 0.7) {
            const x = cx + sx * (qx + 2);
            const z = cz + sz * (qz + 2);
            if (fits(x, z, 11, 13, 1)) {
              settlement.farms.push({ x, z, w: 11, d: 13 });
              farms += 1;
            }
            continue;
          }
          if (cellRoll > spec.quadrantCottages) continue;
          if (quadPool.length === 0) continue;
          const bp = pickFrom(quadPool, r(cottage + 700));
          if (qx + (bp.w + 1) / 2 + 1 > limit || qz + (bp.d + 1) / 2 + 1 > limit) continue;
          const x = cx + sx * qx;
          const z = cz + sz * qz;
          if (!fits(x, z, bp.w, bp.d)) continue;
          const facing: Facing = qz <= qx ? (sz > 0 ? 2 : 0) : (sx > 0 ? 3 : 1);
          commit(bp, x, z, facing);
          // A path from the door to the nearest street.
          const reach = ((qz <= qx ? bp.d : bp.w) - 1) / 2 + 1;
          if (qz <= qx) {
            const doorZ = z - sz * reach;
            const edgeZ = cz + sz * 3;
            settlement.paths.push({ x0: x - 1, x1: x + 1, z0: Math.min(doorZ, edgeZ), z1: Math.max(doorZ, edgeZ) });
          } else {
            const doorX = x - sx * reach;
            const edgeX = cx + sx * 3;
            settlement.paths.push({ z0: z - 1, z1: z + 1, x0: Math.min(doorX, edgeX), x1: Math.max(doorX, edgeX) });
          }
        }
      }
    }
  }
  // Villages always farm at least twice - they are farming hamlets.
  if (tier === "village" && farms < 1) {
    const x = cx - 26;
    const z = cz + 26;
    if (fits(x, z, 13, 15, 1)) settlement.farms.push({ x, z, w: 13, d: 15 });
  }

  /* ---- defences: wall, moat, towers, gatehouses ---- */
  if (tier === "kingdom") {
    settlement.wall = { height: 16, block: ID.stone_bricks, palisade: false, gateHalfWidth: 5, gates: [0, 1, 2, 3] };
    settlement.innerWall = { height: 10, block: ID.stone_bricks, palisade: false, gateHalfWidth: 3, gates: [0, 1, 2, 3] };
    settlement.innerHalf = 15;
    settlement.moat = true;
  } else if (tier === "castle") {
    settlement.wall = { height: 15, block: ID.stone_bricks, palisade: false, gateHalfWidth: 4, gates: [0, 1, 2, 3] };
    settlement.moat = true;
  } else if (tier === "town") {
    settlement.wall = { height: 9, block: ID.spruce_wood, palisade: true, gateHalfWidth: 3, gates: [0, 1, 2, 3] };
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
          bandBlock: tier === "kingdom" ? ID.marble : ID.cobblestone,
          roofBlock: ID.roof,
          roofRise: 5,
        });
      }
    }
  }
  if (settlement.wall && !settlement.wall.palisade) {
    const edge = half - 1;
    const flank = settlement.wall.gateHalfWidth + 6;
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
        doors: true,
      });
    }
  }
  if (tier === "town") {
    // A stone tower over each palisade gate.
    for (const [ox, oz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      settlement.towers.push({
        x: cx + ox * half,
        z: cz + oz * half,
        w: 7,
        height: 11,
        wallBlock: ID.stone_bricks,
        bandBlock: ID.cobblestone,
        roofBlock: ID.roof,
        roofRise: 4,
        doors: true,
      });
    }
  }
  if (tier === "kingdom") {
    // Four small towers on the corners of the inner ward.
    const ward = settlement.innerHalf - 1;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        settlement.towers.push({
          x: cx + sx * ward,
          z: cz + sz * ward,
          w: 7,
          height: 14,
          wallBlock: ID.stone_bricks,
          bandBlock: ID.marble,
          roofBlock: ID.roof,
          roofRise: 4,
        });
      }
    }
  }
  if (tier === "castle" || tier === "kingdom") {
    // Gatehouses straddle the wall; stamped last so their arch cuts through.
    const gate = blueprintById(tier, "gatehouse");
    for (const [ox, oz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const alongX = ox !== 0;
      const facing: Facing = ox > 0 ? 3 : ox < 0 ? 1 : oz > 0 ? 2 : 0;
      settlement.gates.push(
        make(gate, cx + ox * half, cz + oz * half, facing, {
          w: alongX ? 9 : 13,
          d: alongX ? 13 : 9,
          passage: alongX ? "x" : "z",
        }),
      );
    }
    remember(gate);
  }

  settlement.landmarks = landmarks;
}

/* ------------------------------------------------------------------ */
/* Layout: the non-human factions (unchanged styles)                   */
/* ------------------------------------------------------------------ */

function layoutFaction(settlement: Settlement, spec: KindSpec, regionX: number, regionZ: number, seed: number): void {
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
  ): Building => ({    x,
    z,
    w,
    d,    wall: big ? 8 : 6,
    stories: 1,
    facing,
    roof: big && faction === "dwarves" ? "flat" : style.roofShape,
    wallBlock: pick(style.walls, r(index + 400)),
    frameBlock: style.frame,
    roofBlock: style.roof,
    floorBlock: style.floor,
    foundation: style.foundation,
    chimney: style.chimney,
    glazed: faction !== "orcs",
    blueprint: big ? "hall" : "cottage",
    accent: 0,
    open: false,
    turret: 0,
    spire: false,
    forge: false,
    furniture: w >= 15 || d >= 15 ? 2 : 1,
  });

  settlement.feature =
    faction === "elves" ? "tree" :
    faction === "dwarves" ? "hall" :
    faction === "orcs" || kind === "lodge" ? "fire" :
    faction === "mages" ? "mage" : "well";
  settlement.streetBlock = ID.path;
  settlement.plazaBlock = faction === "dwarves" ? ID.stone_bricks : ID.cobblestone;

  // The dwarven great hall sits on the plaza where other peoples have a well.
  if (settlement.feature === "hall") {
    settlement.buildings.push(makeBuilding(cx, cz - 1, 21, 13, 0, 900, true));
  }

  const limit = half - 5;
  const streetLateral = 5;
  const zRowStart = 9;
  const rowDepth = (index: number) => oddSize(r(index), faction === "orcs" ? [7, 9] : [9, 11]);
  const rowWidth = (index: number) => oddSize(r(index), faction === "orcs" ? [7, 9] : [9, 11, 13]);
  let buildingIndex = 0;

  for (const side of [-1, 1]) {
    for (const dir of [-1, 1]) {
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
          if (faction === "freefolk" && i === 0 && j === 0 && farms < 3 && cellRoll < 0.75) {
            settlement.farms.push({ x: cx + sx * 24, z: cz + sz * 26, w: 11, d: 15 });
            farms += 1;
            continue;
          }
          if (cellRoll > spec.quadrantCottages) continue;
          const size = faction === "orcs" ? 7 : oddSize(r(cottage + 700), [7, 9, 11]);
          const depth = oddSize(r(cottage + 701), [7, 9, 11]);
          const x = cx + sx * qx;
          const z = cz + sz * qz;
          const reachX = (size - 1) / 2 + 1;
          const reachZ = (depth - 1) / 2 + 1;
          // Place varied residential footprints in the outer neighborhood blocks.
          settlement.buildings.push(makeBuilding(x, z, size, depth, qz <= qx ? (sz > 0 ? 2 : 0) : (sx > 0 ? 3 : 1), 1000 + cottage));
          if (qz <= qx) {
            const doorZ = z - sz * reachZ;
            const edgeZ = cz + sz * 3;
            settlement.paths.push({ x0: x - 1, x1: x + 1, z0: Math.min(doorZ, edgeZ), z1: Math.max(doorZ, edgeZ) });
          } else {
            const doorX = x - sx * reachX;
            const edgeX = cx + sx * 3;
            settlement.paths.push({ z0: z - 1, z1: z + 1, x0: Math.min(doorX, edgeX), x1: Math.max(doorX, edgeX) });
          }
        }
      }
    }
  }

  if (kind === "hold") {
    settlement.wall = { height: 12, block: ID.stone_bricks, palisade: false, gateHalfWidth: 4, gates: [0, 2] };
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

function layout(settlement: Settlement, spec: KindSpec, regionX: number, regionZ: number, seed: number): void {
  if (isHumanTier(settlement.kind)) layoutHuman(settlement, spec, regionX, regionZ, seed);
  else layoutFaction(settlement, spec, regionX, regionZ, seed);
}

/* ------------------------------------------------------------------ */
/* Site choice + caching                                               */
/* ------------------------------------------------------------------ */

function makeSettlement(terrain: Terrain, seed: number, regionX: number, regionZ: number): Settlement | null {
  // Region (0, 0) is the guaranteed starting realm. The search below looks
  // farther for a valid plain so a new player starts inside a real stamped
  // kingdom instead of relying on a rare random roll near the world origin.
  const startingKingdom = regionX === 0 && regionZ === 0;
  if (!startingKingdom && hash2(regionX, regionZ, seed + 8201) < 0.3) return null;

  const faction = startingKingdom ? "freefolk" : chooseFaction(hash2(regionX, regionZ, seed + 8219));
  const tier = hash2(regionX, regionZ, seed + 8291);
  // Kingdoms are rare in the wider world, but the origin region is reserved
  // for the starting kingdom. Every candidate still has to pass scoreSite's
  // water, slope, elevation and climate checks.
  const kingdom = startingKingdom ||
    (faction === "freefolk" && hash2(regionX, regionZ, seed + 8293) > 0.94 && tier > 0.35);
  const spec = kindFor(faction, tier, kingdom);
  const centerX = regionX * REGION_SIZE + REGION_SIZE / 2 +
    Math.floor((hash2(regionX, regionZ, seed + 8231) - 0.5) * REGION_SIZE * 0.42);
  const centerZ = regionZ * REGION_SIZE + REGION_SIZE / 2 +
    Math.floor((hash2(regionX, regionZ, seed + 8243) - 0.5) * REGION_SIZE * 0.42);

  let best: { x: number; z: number; score: number; baseY: number } | null = null;
  // The starting kingdom searches a larger deterministic area for a valid
  // plain. Other regions retain the lighter local site search for streaming.
  const offsets = startingKingdom
    ? Array.from({ length: 21 }, (_, i) => (i - 10) * 24)
    : [-72, -48, -24, 0, 24, 48, 72];
  for (const offsetX of offsets) {
    for (const offsetZ of offsets) {
      const x = centerX + offsetX;
      const z = centerZ + offsetZ;
      const result = scoreSite(faction, spec, terrain, x, z);
      if (!best || result.score > best.score) best = { x, z, ...result };
    }
  }
  if (!best || best.score < 2.2) return null;

  const id = `${seed}:${regionX}:${regionZ}`;
  const name = `${pick(nameStarts, hash2(regionX, regionZ, seed + 8297))}${pick(    nameEnds,
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
    gardens: [],
    paths: [],
    districts: [],
    wall: null,
    innerWall: null,
    innerHalf: 0,
    moat: false,
    towers: [],
    gates: [],
    landmarks: [],
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
  const reach = MAX_HALF + APRON + 72 + 24; // footprint + apron + candidate offset + jitter
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

export interface StairCell {
  x: number;
  y: number;
  z: number;
}

/**
 * The walk-up staircase inside a multi-storey building: six one-block steps
 * hugging the left wall (relative to the door), climbing from the back corner
 * toward the front. Empty for one-storey buildings and for towers too small
 * to hold a flight - those are lookouts, reached by flight.
 */
export function stairCells(b: Building, ground: number): StairCell[] {
  if (b.stories < 2 || b.open) return [];
  const hx = (b.w - 1) / 2;
  const hz = (b.d - 1) / 2;
  const run = (b.facing === 0 || b.facing === 2 ? b.d : b.w) - 2;
  if (run < 6) return [];
  const cells: StairCell[] = [];
  for (let j = 0; j < 6; j += 1) {
    const y = ground + 1 + j;
    if (b.facing === 0) cells.push({ x: b.x - hx + 1, y, z: b.z - hz + 1 + j });
    else if (b.facing === 2) cells.push({ x: b.x - hx + 1, y, z: b.z + hz - 1 - j });
    else if (b.facing === 1) cells.push({ x: b.x - hx + 1 + j, y, z: b.z - hz + 1 });
    else cells.push({ x: b.x + hx - 1 - j, y, z: b.z - hz + 1 });
  }
  return cells;
}

/** Market stall: paved floor, corner posts, a back wall, a counter and a canopy. */
function stampStall(writer: ChunkWriter, b: Building, ground: number): void {
  const hx = (b.w - 1) / 2;
  const hz = (b.d - 1) / 2;
  const top = ground + 6;
  for (let dx = -hx; dx <= hx; dx += 1) {
    for (let dz = -hz; dz <= hz; dz += 1) {
      const x = b.x + dx;
      const z = b.z + dz;
      if (!writer.inside(x, z)) continue;
      const onX = Math.abs(dx) === hx;
      const onZ = Math.abs(dz) === hz;
      writer.set(x, ground, z, onX || onZ ? b.foundation : b.floorBlock);
      for (let y = ground + 1; y < top; y += 1) writer.set(x, y, z, 0);
      const corner = onX && onZ;
      if (corner) {
        for (let y = ground + 1; y <= top; y += 1) writer.set(x, y, z, b.frameBlock);
        continue;
      }
      const onBack =
        (b.facing === 0 && dz === -hz) || (b.facing === 2 && dz === hz) ||
        (b.facing === 1 && dx === -hx) || (b.facing === 3 && dx === hx);
      if (onBack) for (let y = ground + 1; y <= ground + 5; y += 1) writer.set(x, y, z, b.wallBlock);
    }
  }
  // Counter along the open side, with a gap to walk in.
  const counter = (dx: number, dz: number): void => {
    if (Math.abs(dx) > hx - 1 || Math.abs(dz) > hz - 1) return;
    if ((b.facing === 0 || b.facing === 2) && Math.abs(dx) < 2) return;    if ((b.facing === 1 || b.facing === 3) && Math.abs(dz) < 2) return;
    writer.set(b.x + dx, ground + 1, b.z + dz, ID.table);
  };
  if (b.facing === 0) for (let dx = -hx + 1; dx <= hx - 1; dx += 1) counter(dx, hz - 1);
  else if (b.facing === 2) for (let dx = -hx + 1; dx <= hx - 1; dx += 1) counter(dx, -hz + 1);
  else if (b.facing === 1) for (let dz = -hz + 1; dz <= hz - 1; dz += 1) counter(hx - 1, dz);  else for (let dz = -hz + 1; dz <= hz - 1; dz += 1) counter(-hx + 1, dz);

  // Canopy with a one-block overhang; the trim ring takes the tier accent.
  for (let dx = -hx - 1; dx <= hx + 1; dx += 1) {
    for (let dz = -hz - 1; dz <= hz + 1; dz += 1) {
      const x = b.x + dx;
      const z = b.z + dz;
      if (!writer.inside(x, z)) continue;
      const outer = Math.abs(dx) === hx + 1 || Math.abs(dz) === hz + 1;
      writer.set(x, top, z, outer && b.accent ? b.accent : b.roofBlock);
    }
  }
}

function stampBuilding(writer: ChunkWriter, b: Building, ground: number): void {
  const hx = (b.w - 1) / 2;
  const hz = (b.d - 1) / 2;
  if (!writer.overlaps(b.x - hx - 3, b.z - hz - 3, b.x + hx + 3, b.z + hz + 3)) return;
  if (b.open) {
    stampStall(writer, b, ground);
    return;
  }

  const top = ground + b.wall;
  const ridgeAlongX = b.w >= b.d;
  const stairs = stairCells(b, ground);
  const stairColumns = new Set(stairs.map((cell) => `${cell.x},${cell.z}`));
  const stairKeys = new Set(stairs.map((cell) => `${cell.x},${cell.y},${cell.z}`));
  const grand = b.w >= 13 || b.d >= 13 || b.stories >= 3;
  // A portion of houses have chamfered corners, creating varied footprints.
  const chamfered = b.w >= 9 && b.d >= 9 &&
    hash2(b.x, b.z, b.blueprint.length + b.stories * 17) > 0.38;
  const clippedCorner = (dx: number, dz: number): boolean =>
    chamfered && Math.abs(dx) >= hx - 1 && Math.abs(dz) >= hz - 1 &&
    Math.abs(dx) + Math.abs(dz) > hx + hz - 1;

  for (let dx = -hx; dx <= hx; dx += 1) {
    for (let dz = -hz; dz <= hz; dz += 1) {
      if (clippedCorner(dx, dz)) continue;
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
      const doorHalf = Math.max(1, Math.min(wallLength - 2, grand ? 2 : 1));
      const doorCell = onDoorWall && Math.abs(along) <= doorHalf && !corner;
      writer.set(x, ground, z, b.foundation);
      for (let wy = 1; wy <= b.wall; wy += 1) {
        const y = ground + wy;
        // Gatehouse archway: open through the ground floor along the passage.
        if (b.passage && wy <= 5 && (b.passage === "z" ? Math.abs(dx) <= 2 : Math.abs(dz) <= 2)) {
          writer.set(x, y, z, 0);
          continue;
        }
        if (doorCell && wy <= 5) {
          // A hung wooden door: opaque so it reads as a door, but walk-through.
          writer.set(x, y, z, ID.door);
          continue;
        }
        const local = ((wy - 1) % 6) + 1;
        let block = b.accent && local === 1 ? b.accent : corner ? b.frameBlock : b.wallBlock;
        const a = Math.abs(along);
        const windowRow = local === 3 || local === 4;
        const windowColumn = a >= 2 && a <= wallLength - 2 && (a % 4 === 2 || a % 4 === 3);
        if (b.glazed && !corner && windowRow && windowColumn && !(onDoorWall && a <= 2)) block = ID.glass;
        writer.set(x, y, z, block);
      }
    }
  }

  // Randomized entrance porches add a readable front entrance and varied massing.
  const hasPorch = b.w >= 7 && b.d >= 7 && b.stories <= 3 &&
    hash2(b.x + b.w, b.z - b.d, b.blueprint.length + 41) > 0.48;
  if (hasPorch) {
    for (let side = -1; side <= 1; side += 1) {
      let px = b.x;
      let pz = b.z;
      if (b.facing === 0) { px += side; pz += hz + 1; }
      else if (b.facing === 2) { px += side; pz -= hz + 1; }
      else if (b.facing === 1) { px += hx + 1; pz += side; }
      else { px -= hx + 1; pz += side; }
      if (!writer.inside(px, pz)) continue;
      writer.set(px, ground, pz, b.foundation);
      if (side !== 0) for (let py = ground + 1; py <= ground + 3; py += 1) writer.set(px, py, pz, b.frameBlock);
    }
    for (let side = -2; side <= 2; side += 1) {
      let px = b.x;
      let pz = b.z;
      if (b.facing === 0) { px += side; pz += hz + 2; }
      else if (b.facing === 2) { px += side; pz -= hz + 2; }
      else if (b.facing === 1) { px += hx + 2; pz += side; }
      else { px -= hx + 2; pz += side; }
      if (writer.inside(px, pz)) writer.set(px, ground + 4, pz, b.accent || b.roofBlock);
    }
  }

  // Victorian bay windows project one block from the front facade. The
  // glass is kept at eye level on each storey, with a sill and lintel.
  if (b.bayWindowWidth && b.bayWindowWidth > 0) {
    const width = Math.min(
      Math.floor((b.bayWindowWidth - 1) / 2),
      Math.max(0, Math.floor((b.facing === 0 || b.facing === 2 ? hx : hz) - 1)),
    );
    for (let offset = -width; offset <= width; offset += 1) {
      for (let storey = 0; storey < b.stories; storey += 1) {
        const y0 = ground + storey * 6 + 2;
        for (let dy = 0; dy <= 2; dy += 1) {
          let x = b.x;
          let z = b.z;
          if (b.facing === 0) { x += offset; z += hz + 1; }
          else if (b.facing === 2) { x += offset; z -= hz + 1; }
          else if (b.facing === 1) { x += hx + 1; z += offset; }
          else { x -= hx + 1; z += offset; }
          if (!writer.inside(x, z)) continue;
          const edge = Math.abs(offset) === width;
          writer.set(x, y0 + dy, z, dy === 0 || dy === 2 ? (b.accent || b.frameBlock) : edge ? b.frameBlock : ID.glass);
        }
      }
    }
  }

  // Dormer windows sit on the two roof slopes of Victorian mansard/gable roofs.
  if (b.hasDormers && (b.roof === "gable" || b.roof === "mansard" || b.roof === "hip")) {
    const positions = ridgeAlongX
      ? [-Math.floor(hx / 2), Math.floor(hx / 2)]
      : [-Math.floor(hz / 2), Math.floor(hz / 2)];
    for (const offset of positions) {
      const x = ridgeAlongX ? b.x + offset : b.x;
      const z = ridgeAlongX ? b.z : b.z + offset;
      const y = top + 2;
      if (!writer.inside(x, z)) continue;
      writer.set(x, y, z, b.frameBlock);
      writer.set(x, y + 1, z, ID.glass);
      writer.set(x, y + 2, z, b.frameBlock);
    }
  }

  // Decorative gable trim follows the ridge ends; the accent block is used
  // where available, otherwise the facade frame material keeps it coherent.
  if (b.gableTrim && b.roof === "gable") {
    const trim = b.accent || b.frameBlock;
    if (ridgeAlongX) {
      for (let dz = -hz; dz <= hz; dz += 1) {
        const y = top + (hz - Math.abs(dz)) + 1;
        for (const x of [b.x - hx, b.x + hx]) {
          if (writer.inside(x, b.z + dz)) writer.set(x, y, b.z + dz, trim);
        }
      }
    } else {
      for (let dx = -hx; dx <= hx; dx += 1) {
        const y = top + (hx - Math.abs(dx)) + 1;
        for (const z of [b.z - hz, b.z + hz]) {
          if (writer.inside(b.x + dx, z)) writer.set(b.x + dx, y, z, trim);
        }
      }
    }
  }

  // Furniture against the wall opposite the door (never where the stairs go).
  const interiorLimitX = hx - 1;
  const interiorLimitZ = hz - 1;
  const place = (dx: number, dz: number, id: number): void => {
    if (Math.abs(dx) > interiorLimitX || Math.abs(dz) > interiorLimitZ) return;
    const x = b.x + dx;
    const z = b.z + dz;
    if (stairKeys.has(`${x},${ground + 1},${z}`)) return;
    writer.set(x, ground + 1, z, id);
  };
  const alongDoor = b.facing === 0 || b.facing === 2;
  const backRow =
    b.facing === 0 ? -hz + 1 : b.facing === 2 ? hz - 1 : b.facing === 3 ? hx - 1 : -hx + 1;
  const chairRow = backRow < 0 ? backRow + 1 : backRow - 1;
  if (b.forge) {
    // The blacksmith's forge: a coal fire banked against the back wall.
    place(0, backRow, ID.coal_ore);
    place(-1, backRow, ID.cobblestone);
    place(1, backRow, ID.cobblestone);
  } else if (b.furniture === 2) {
    const span = Math.min(Math.floor((b.w >= b.d ? hx : hz) - 1), 7);
    for (let d = -span; d <= span; d += 1) {
      if (alongDoor) place(d, backRow, ID.table);
      else place(backRow, d, ID.table);
    }
    for (let d = -span + 1; d <= span; d += 3) {
      if (alongDoor) place(d, chairRow, ID.chair);
      else place(chairRow, d, ID.chair);
    }
  } else if (b.furniture === 1) {
    if (alongDoor) {
      place(0, backRow, ID.table);
      place(-2, backRow, ID.chair);
      place(2, backRow, ID.chair);
    } else {
      place(backRow, 0, ID.table);
      place(backRow, -2, ID.chair);
      place(backRow, 2, ID.chair);
    }
  }

  // Floor slabs for the upper storeys, with the stairwell left open.
  for (let k = 1; k < b.stories; k += 1) {
    const y = ground + 6 * k;
    if (y > top) break;
    for (let dx = -hx + 1; dx <= hx - 1; dx += 1) {
      for (let dz = -hz + 1; dz <= hz - 1; dz += 1) {        const x = b.x + dx;
        const z = b.z + dz;
        if (!writer.inside(x, z)) continue;
        if (stairColumns.has(`${x},${z}`)) continue;
        writer.set(x, y, z, b.floorBlock);
      }
    }
  }
  for (const cell of stairs) writer.set(cell.x, cell.y, cell.z, b.floorBlock);

  // Roof: gable, hip, flat with battlements, mansard skirt, or a stepped dome.
  const rx = hx + 1;
  const rz = hz + 1;
  for (let dx = -rx; dx <= rx; dx += 1) {
    for (let dz = -rz; dz <= rz; dz += 1) {
      if (clippedCorner(dx, dz)) continue;
      const x = b.x + dx;
      const z = b.z + dz;
      if (!writer.inside(x, z)) continue;
      if (b.roof === "flat") {
        if (Math.abs(dx) === rx || Math.abs(dz) === rz) continue;
        writer.set(x, top + 1, z, b.roofBlock);
        if ((Math.abs(dx) === hx || Math.abs(dz) === hz) && (dx + dz) % 2 === 0) writer.set(x, top + 2, z, b.roofBlock);
        continue;
      }
      if (b.roof === "dome" || b.roof === "mansard") {
        const inset = Math.min(rx - Math.abs(dx), rz - Math.abs(dz));
        const span = Math.max(1, Math.min(rx, rz));
        const rise = b.roof === "dome"
          ? Math.round(0.65 * span * Math.sin((Math.min(1, inset / span) * Math.PI) / 2))
          : Math.min(inset === 0 ? 1 : 2 + (inset - 1) * 2, Math.max(rx, rz));
        for (let y = top + 1; y <= top + 1 + rise; y += 1) writer.set(x, y, z, b.roofBlock);
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

  // Chimney against the gable end, rising past the ridge; forges always vent.
  if (b.chimney !== 0 && (b.roof === "gable" || b.roof === "mansard" || b.forge)) {
    const px = ridgeAlongX ? b.x + hx + 1 : b.x;
    const pz = ridgeAlongX ? b.z : b.z + hz + 1;
    const ridge = b.roof === "gable" ? top + (ridgeAlongX ? rz : rx) : top + 5;
    for (let y = ground + 1; y <= ridge + 2; y += 1) writer.set(px, y, pz, b.chimney);  }

  // Roof-top turrets: the watchtower's lookout, the keep's and palace's corner
  // turrets, the mage tower's spire room. Each gets a small pyramid and finial.
  if (b.turret) {
    const spots: Array<[number, number]> = b.turret === 1
      ? [[0, 0]]
      : [[-(hx - 1), -(hz - 1)], [hx - 1, -(hz - 1)], [-(hx - 1), hz - 1], [hx - 1, hz - 1]];
    const tw = b.turret === 1 ? (Math.min(b.w, b.d) >= 11 ? 5 : 3) : 3;
    const th = (tw - 1) / 2;
    const rise = 7;
    for (const [ox, oz] of spots) {
      for (let dx = -th; dx <= th; dx += 1) {
        for (let dz = -th; dz <= th; dz += 1) {
          const x = b.x + ox + dx;
          const z = b.z + oz + dz;
          if (!writer.inside(x, z)) continue;
          const edge = Math.max(Math.abs(dx), Math.abs(dz));
          if (edge < th) {
            for (let y = top + 1; y <= top + rise; y += 1) writer.set(x, y, z, 0);
            continue;
          }
          for (let wy = 1; wy <= rise; wy += 1) {
            const corner = Math.abs(dx) === th && Math.abs(dz) === th;
            const slit = !corner && wy === 4;
            writer.set(x, top + wy, z, slit ? ID.glass : corner ? b.frameBlock : b.wallBlock);
          }
        }
      }
      for (let dx = -th - 1; dx <= th + 1; dx += 1) {
        for (let dz = -th - 1; dz <= th + 1; dz += 1) {
          const x = b.x + ox + dx;
          const z = b.z + oz + dz;
          if (!writer.inside(x, z)) continue;
          const edge = Math.max(Math.abs(dx), Math.abs(dz));
          if (edge > th + 1) continue;
          const lift = edge <= th ? Math.max(1, Math.round(((th + 1 - edge) * 5) / (th + 1))) : 0;
          for (let y = top + rise + 1; y <= top + rise + lift; y += 1) writer.set(x, y, z, b.roofBlock);
          if (edge === th + 1) writer.set(x, top + rise, z, b.roofBlock);
        }
      }
      writer.set(b.x + ox, top + rise + 6, b.z + oz, b.accent || b.roofBlock);
    }
  }

  // Chapel spire: a stepped pyramid over the crossing, with a finial.
  if (b.spire) {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const x = b.x + dx;
        const z = b.z + dz;
        if (!writer.inside(x, z)) continue;
        const rise = Math.max(Math.abs(dx), Math.abs(dz)) === 0 ? 8 : 5;
        for (let y = top + 1; y <= top + rise; y += 1) writer.set(x, y, z, b.roofBlock);
      }
    }
    writer.set(b.x, top + 9, b.z, b.accent || b.roofBlock);
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

/** Town square fountain: a stone basin you can wade in, with a pillar. */
function stampFountain(writer: ChunkWriter, cx: number, cz: number, ground: number, grand: boolean): void {
  const radius = grand ? 4 : 3;
  const rim = grand ? ID.marble : ID.cobblestone;
  if (!writer.overlaps(cx - radius, cz - radius, cx + radius, cz + radius)) return;
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      const x = cx + dx;
      const z = cz + dz;
      if (!writer.inside(x, z)) continue;
      if (Math.max(Math.abs(dx), Math.abs(dz)) === radius) {
        writer.set(x, ground, z, rim);
        writer.set(x, ground + 1, z, rim);
      } else {
        writer.set(x, ground - 1, z, rim);
        writer.set(x, ground, z, ID.water);
        writer.set(x, ground + 1, z, 0);
      }
    }
  }
  const height = grand ? 4 : 3;
  for (let y = ground + 1; y <= ground + height; y += 1) writer.set(cx, y, cz, rim);
  writer.set(cx, ground + height + 1, cz, grand ? ID.gold : ID.roof);
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
  const height = 42;  for (let y = ground + 1; y <= ground + height; y += 1) {
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

/**
 * Royal gardens and parks: a clipped hedge with an opening on every side, a
 * path ring, flowers in the lawn, and a fountain in the middle.
 */
function stampGarden(writer: ChunkWriter, g: Garden, ground: number, seed: number): void {
  const hx = (g.w - 1) / 2;
  const hz = (g.d - 1) / 2;
  if (!writer.overlaps(g.x - hx - 1, g.z - hz - 1, g.x + hx + 1, g.z + hz + 1)) return;
  for (let dx = -hx; dx <= hx; dx += 1) {
    for (let dz = -hz; dz <= hz; dz += 1) {
      const x = g.x + dx;
      const z = g.z + dz;
      if (!writer.inside(x, z)) continue;
      writer.set(x, ground + 1, z, 0);
      const dist = Math.max(Math.abs(dx), Math.abs(dz));
      const doorway = Math.abs(dx) <= 1 || Math.abs(dz) <= 1;
      if (dist === hx && !doorway) {
        writer.set(x, ground + 1, z, ID.leaves);        if (Math.abs(dx) === hx && Math.abs(dz) === hz) writer.set(x, ground + 2, z, ID.leaves);
      } else if (dist === hx - 2) {
        writer.set(x, ground, z, ID.path);
      } else if (dist < hx - 2 && hash2(x, z, seed + 4441) < 0.14) {
        writer.set(x, ground + 1, z, ID.flower);
      }
    }
  }
  if (g.w >= 15) {
    stampFountain(writer, g.x, g.z, ground, g.w >= 17);
  } else {
    for (let y = ground + 1; y <= ground + 5; y += 1) writer.set(g.x, y, g.z, ID.wood);
    leafBlob(writer, g.x, ground + 8, g.z, 4, 3, ID.leaves, seed, 0.14);
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
        const doorCell = Math.abs(dx) <= 1 || Math.abs(dz) <= 1;
        const open = t.doors ? doorCell : dz === h && Math.abs(dx) <= 1;
        for (let wy = 1; wy <= t.height; wy += 1) {
          if (open && wy <= 5) {
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

/**
 * The moat around a castle or kingdom: a four-block channel two blocks below
 * the street, crossed by a paved bridge with low rails at each of the four
 * gates. Carved before walls and towers so they can stand on its bank.
 */
function stampMoat(writer: ChunkWriter, s: Settlement, ground: number): void {
  if (!s.wall) return;
  const cx = s.centerX;
  const cz = s.centerZ;
  const half = s.radius;
  const walkHalf = 3;
  for (let dx = -(half + 4); dx <= half + 4; dx += 1) {
    for (let dz = -(half + 4); dz <= half + 4; dz += 1) {
      const cheb = Math.max(Math.abs(dx), Math.abs(dz));
      if (cheb < half + 1 || cheb > half + 4) continue;
      const x = cx + dx;
      const z = cz + dz;
      if (!writer.inside(x, z)) continue;
      const bridge =
        (Math.abs(dx) <= walkHalf && Math.abs(dz) >= half - 2) ||
        (Math.abs(dz) <= walkHalf && Math.abs(dx) >= half - 2);
      if (bridge) continue;
      for (let y = ground - 1; y <= ground + 2; y += 1) writer.set(x, y, z, 0);
      writer.set(x, ground - 2, z, ID.water);
      writer.set(x, ground - 3, z, ID.water);
      writer.set(x, ground - 4, z, ID.gravel);
    }
  }
  // Bridges: deck from just inside the wall to past the channel, with rails.
  for (const [ox, oz] of DIRS) {
    for (let cross = -walkHalf; cross <= walkHalf; cross += 1) {
      for (let along = half - 2; along <= half + 4; along += 1) {
        const x = cx + (ox !== 0 ? ox * along : cross);
        const z = cz + (oz !== 0 ? oz * along : cross);        if (!writer.inside(x, z)) continue;
        writer.set(x, ground, z, ID.stone_bricks);
        writer.set(x, ground + 1, z, Math.abs(cross) === walkHalf ? s.wall!.block : 0);
      }
    }
  }
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
  const originSettlement = getSettlement(terrain, 0, 0);
  const hierarchyOriginX = originSettlement?.kind === "kingdom" ? originSettlement.centerX : 0;
  const hierarchyOriginZ = originSettlement?.kind === "kingdom" ? originSettlement.centerZ : 0;
  const hierarchyPlan = hierarchyPlanFor(seed, { originX: hierarchyOriginX, originZ: hierarchyOriginZ });
  const legacyCandidates = settlementsTouching(terrain, startX, startZ, endX, endZ);
  for (const s of legacyCandidates) {
    // Keep the starting kingdom intact. Other legacy settlements are omitted
    // when their footprint would occupy a hierarchy-owned village, town, city
    // civic centre or castle; this avoids stamping two independent plans over
    // the same site while retaining legacy settlements in untouched regions.
    if (s.kind !== "kingdom") {
      const margin = s.radius + 64;
      const nearbyHierarchy = hierarchyNodesInBounds(
        hierarchyPlan,
        s.centerX - margin, s.centerZ - margin,
        s.centerX + margin, s.centerZ + margin,
        0,
      );
      const conflicts = nearbyHierarchy.some((node) => {
        const distance = Math.hypot(node.x - s.centerX, node.z - s.centerZ);
        const ownedRadius = node.level === "town" ? 52
          : node.level === "village" ? 44
          : node.level === "city" ? 28
          : node.level === "castle" ? 60
          : node.level === "house" ? 6 : 0;
        return ownedRadius > 0 && distance < s.radius + ownedRadius;
      });
      if (conflicts) continue;
    }
    const ground = s.baseY;
    const half = s.radius;
    if (!writer.overlaps(s.centerX - half - 6, s.centerZ - half - 6, s.centerX + half + 6, s.centerZ + half + 6)) continue;

    // 1. Streets, plaza, district paving and paths, clearing any plants above.
    for (let x = Math.max(s.centerX - half, startX); x <= Math.min(s.centerX + half, endX); x += 1) {
      for (let z = Math.max(s.centerZ - half, startZ); z <= Math.min(s.centerZ + half, endZ); z += 1) {
        const block = groundCover(s, x - s.centerX, z - s.centerZ);
        if (block === 0) continue;
        writer.set(x, ground, z, block);
        writer.set(x, ground + 1, z, 0);
      }
    }
    for (const district of s.districts) {
      const dh = district.half;
      if (!writer.overlaps(district.x - dh, district.z - dh, district.x + dh, district.z + dh)) continue;
      for (let x = Math.max(district.x - dh, startX); x <= Math.min(district.x + dh, endX); x += 1) {
        for (let z = Math.max(district.z - dh, startZ); z <= Math.min(district.z + dh, endZ); z += 1) {
          writer.set(x, ground, z, s.plazaBlock);
          writer.set(x, ground + 1, z, 0);
        }
      }
    }
    for (const path of s.paths) {
      const x0 = Math.min(path.x0, path.x1);
      const x1 = Math.max(path.x0, path.x1);
      const z0 = Math.min(path.z0, path.z1);
      const z1 = Math.max(path.z0, path.z1);      if (!writer.overlaps(x0, z0, x1, z1)) continue;
      for (let x = Math.max(x0, startX); x <= Math.min(x1, endX); x += 1) {
        for (let z = Math.max(z0, startZ); z <= Math.min(z1, endZ); z += 1) {
          writer.set(x, ground, z, ID.path);
          writer.set(x, ground + 1, z, 0);
        }
      }
    }

    // 2. Moat and bridges (before anything is built on the bank).
    if (s.moat) stampMoat(writer, s, ground);

    // 3. Farms and gardens.
    for (const farm of s.farms) stampFarm(writer, farm, ground);
    for (const garden of s.gardens) stampGarden(writer, garden, ground, seed);

    // 4. The centrepiece (well, fountain, great tree, bonfire, ...). Keeps,
    //    palaces and halls are ordinary buildings and come with step 5.
    if (s.feature === "well") stampWell(writer, s.centerX, s.centerZ, ground);
    else if (s.feature === "fountain") stampFountain(writer, s.centerX, s.centerZ, ground, false);
    else if (s.feature === "fire") stampFire(writer, s.centerX, s.centerZ, ground);
    else if (s.feature === "tree") stampGreatTree(writer, s.centerX, s.centerZ, ground, seed);

    // 5. Buildings.
    for (const building of s.buildings) stampBuilding(writer, building, ground);

    // 6. Walls: curtain first, then the kingdom's inner ward.
    stampWall(writer, s, ground);
    if (s.innerWall && s.innerHalf > 0) {
      stampRing(writer, s.centerX, s.centerZ, s.innerHalf, s.innerWall, s.baseY + 13, ground);
    }

    // 7. Towers (they stand on the wall line and the moat bank).
    for (const tower of s.towers) stampTower(writer, tower, ground);

    // 8. Gatehouses last: their archway cuts through the wall.
    for (const gate of s.gates) stampBuilding(writer, gate, ground);
  }

  // Hierarchy house nodes are the source of these residential buildings. Keep
  // this after legacy settlement stamping so the hierarchy owns its own homes
  // without changing the existing settlement landmarks in this increment.
  stampHierarchyHouseNodes(writer, terrain, seed);
}

type CastleLayout = {
  outerRadius: number; outerHeight: number; innerRadius: number; innerHeight: number;
  innerRise: number; keepRadius: number; keepHeight: number; keepRise: number;
  gateHalfWidth: number; towerHalf: number; towerExtra: number; gateTowers: boolean;
  keepSize: number; keepWall: number; moat: boolean;
};

function castleLayout(archetype: string): CastleLayout {
  switch (archetype) {
    case "hilltop":
      return { outerRadius: 43, outerHeight: 12, innerRadius: 27, innerHeight: 10, innerRise: 3,
        keepRadius: 0, keepHeight: 0, keepRise: 0, gateHalfWidth: 2, towerHalf: 4,
        towerExtra: 10, gateTowers: false, keepSize: 15, keepWall: 36, moat: false };
    case "riverside":
      return { outerRadius: 50, outerHeight: 9, innerRadius: 32, innerHeight: 9, innerRise: 2,
        keepRadius: 0, keepHeight: 0, keepRise: 0, gateHalfWidth: 3, towerHalf: 4,
        towerExtra: 6, gateTowers: true, keepSize: 19, keepWall: 24, moat: true };
    case "palace-fortress":
      return { outerRadius: 44, outerHeight: 8, innerRadius: 0, innerHeight: 0, innerRise: 0,
        keepRadius: 0, keepHeight: 0, keepRise: 0, gateHalfWidth: 3, towerHalf: 3,
        towerExtra: 5, gateTowers: true, keepSize: 23, keepWall: 30, moat: true };
    case "concentric":
    default:
      return { outerRadius: 56, outerHeight: 10, innerRadius: 38, innerHeight: 9, innerRise: 2,
        keepRadius: 20, keepHeight: 8, keepRise: 4, gateHalfWidth: 3, towerHalf: 4,
        towerExtra: 7, gateTowers: false, keepSize: 17, keepWall: 24, moat: false };
  }
}

function chooseCastleSite(
  terrain: Terrain, anchorX: number, anchorZ: number, archetype: string, searchRadius: number,
): { x: number; z: number; ground: number } | null {
  const layout = castleLayout(archetype);
  let best: { x: number; z: number; ground: number; score: number } | null = null;
  for (let radius = 0; radius <= searchRadius; radius += 16) {
    const steps = radius === 0 ? 1 : Math.max(8, Math.round((Math.PI * 2 * radius) / 24));
    for (let i = 0; i < steps; i += 1) {
      const angle = radius === 0 ? 0 : (Math.PI * 2 * i) / steps;
      const x = Math.round(anchorX + Math.cos(angle) * radius);
      const z = Math.round(anchorZ + Math.sin(angle) * radius);
      const offsets: Array<[number, number]> = [[0, 0], [layout.outerRadius, 0], [-layout.outerRadius, 0],
        [0, layout.outerRadius], [0, -layout.outerRadius], [layout.outerRadius, layout.outerRadius],
        [-layout.outerRadius, -layout.outerRadius], [layout.outerRadius, -layout.outerRadius],
        [-layout.outerRadius, layout.outerRadius]];
      const samples = offsets.map(([dx, dz]) => terrain.natural(x + dx, z + dz));
      if (samples.some((s) => s.water > 0 || s.riverDist < s.riverHalfWidth + 3 ||
          s.ground <= SEA_LEVEL + 3 || s.ground + layout.keepWall + layout.outerHeight + 12 >= 192)) continue;
      const heights = samples.map((s) => s.ground);
      const spread = Math.max(...heights) - Math.min(...heights);
      if (spread > 30) continue;
      const ground = [...heights].sort((a, b) => a - b)[Math.floor(heights.length / 2)];
      const elevation = ground - SEA_LEVEL;
      const riverDistance = samples[0]!.riverDist;
      const terrainPenalty = spread * 1.7;
      let strategicBonus = 0;
      if (archetype === "hilltop") strategicBonus += Math.min(elevation, 55) * 0.5 - Math.abs(spread - 12) * 0.7;
      else if (archetype === "riverside") {
        strategicBonus += Number.isFinite(riverDistance) ? Math.max(0, 35 - Math.abs(riverDistance - 24)) * 0.7 : -8;
      } else if (archetype === "palace-fortress") strategicBonus += Math.max(0, 14 - spread) * 0.8 - Math.abs(elevation - 18) * 0.12;
      else strategicBonus += Math.min(elevation, 42) * 0.2 + Math.max(0, 18 - spread) * 0.6;
      const score = strategicBonus - terrainPenalty - Math.hypot(x - anchorX, z - anchorZ) * 0.045;
      if (!best || score > best.score) best = { x, z, ground, score };
    }
  }
  if (best) return { x: best.x, z: best.z, ground: best.ground };
  const sample = terrain.natural(anchorX, anchorZ);
  if (sample.water > 0 || sample.ground <= SEA_LEVEL + 2 || sample.ground + 42 >= 192) return null;
  return { x: anchorX, z: anchorZ, ground: sample.ground };
}

function stampCastleTower(
  writer: ChunkWriter, cx: number, cz: number, ground: number, half: number, height: number,
): void {
  if (!writer.overlaps(cx - half - 1, cz - half - 1, cx + half + 1, cz + half + 1)) return;
  for (let dx = -half; dx <= half; dx += 1) for (let dz = -half; dz <= half; dz += 1) {
    const x = cx + dx; const z = cz + dz;
    if (!writer.inside(x, z) || Math.max(Math.abs(dx), Math.abs(dz)) !== half) continue;
    const corner = Math.abs(dx) === half && Math.abs(dz) === half;
    for (let y = ground; y < ground + height; y += 1) {
      const slit = !corner && y === ground + 4 && (dx === 0 || dz === 0);
      if (!slit) writer.set(x, y, z, corner || y % 8 === 0 ? ID.cobblestone : ID.stone_bricks);
    }
    for (let offset = -half; offset <= half; offset += 2) {
      if (Math.abs(dx) === half && dz === offset) writer.set(x, ground + height, z, ID.stone_bricks);
      if (Math.abs(dz) === half && dx === offset) writer.set(x, ground + height, z, ID.stone_bricks);
    }
  }
}

/**
 * Turn nearby hierarchy house records into real block-stamped buildings.
 * Terrain is sampled at the centre and corners; wet or excessively uneven
 * sites are skipped rather than placing houses through rivers or cliffs.
 */
function stampHierarchyHouseNodes(writer: ChunkWriter, terrain: Terrain, seed: number): void {
  const start = getSettlement(terrain, 0, 0);
  const originX = start?.kind === "kingdom" ? start.centerX : 0;
  const originZ = start?.kind === "kingdom" ? start.centerZ : 0;
  const plan = hierarchyPlanFor(seed, { originX, originZ });
  const chunkMinX = writer.startX;
  const chunkMinZ = writer.startZ;
  const chunkMaxX = chunkMinX + CHUNK_SIZE - 1;
  const chunkMaxZ = chunkMinZ + CHUNK_SIZE - 1;
  // Pull endpoints far enough away to draw the roads crossing this chunk.
  const nodes = hierarchyNodesInBounds(plan, chunkMinX, chunkMinZ, chunkMaxX, chunkMaxZ, 520);
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  // Reserve resolved house footprints in stable node order for each village.
  const reservedHouseSites = new Map<string, Array<{ x: number; z: number; halfW: number; halfD: number }>>();

  const stampRoad = (fromX: number, fromZ: number, toX: number, toZ: number, width: number): void => {
    const minX = Math.max(Math.min(fromX, toX) - width, chunkMinX);
    const maxX = Math.min(Math.max(fromX, toX) + width, chunkMaxX);
    const minZ = Math.max(Math.min(fromZ, toZ) - width, chunkMinZ);
    const maxZ = Math.min(Math.max(fromZ, toZ) + width, chunkMaxZ);
    if (minX > maxX || minZ > maxZ) return;
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const lengthSq = dx * dx + dz * dz || 1;
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const t = Math.max(0, Math.min(1, ((x - fromX) * dx + (z - fromZ) * dz) / lengthSq));
        const nearestX = fromX + t * dx;
        const nearestZ = fromZ + t * dz;
        if (Math.hypot(x - nearestX, z - nearestZ) > width / 2) continue;
        const sample = terrain.natural(x, z);
        if (sample.water > 0 || sample.riverDist < sample.riverHalfWidth + 1) continue;
        if (sample.ground <= SEA_LEVEL + 1 || sample.ground + 2 >= 192) continue;
        writer.set(x, sample.ground, z, ID.gravel);
        writer.set(x, sample.ground + 1, z, 0);
        writer.set(x, sample.ground + 2, z, 0);
      }
    }
  };

  const stampRingWithGates = (
    x: number, z: number, radius: number, ground: number, height: number,
    block: number, gateHalfWidth: number,
  ): void => {
    const minX = Math.max(x - radius, chunkMinX);
    const maxX = Math.min(x + radius, chunkMaxX);
    const minZ = Math.max(z - radius, chunkMinZ);
    const maxZ = Math.min(z + radius, chunkMaxZ);
    if (minX > maxX || minZ > maxZ) return;
    for (let px = minX; px <= maxX; px += 1) {
      for (let pz = minZ; pz <= maxZ; pz += 1) {
        const edge = Math.max(Math.abs(px - x), Math.abs(pz - z));
        if (Math.abs(edge - radius) > 0) continue;
        const dx = px - x;
        const dz = pz - z;
        const cardinalGate = (Math.abs(dx) <= gateHalfWidth && Math.abs(dz) === radius) ||
          (Math.abs(dz) <= gateHalfWidth && Math.abs(dx) === radius);
        if (cardinalGate) continue;
        for (let y = ground; y < ground + height; y += 1) {
          const crenel = height >= 7 && y === ground + height - 1 && ((px + pz) & 1) === 0;
          writer.set(px, y, pz, crenel ? ID.stone_bricks : block);
        }
      }
    }
    // Gate piers make each opening legible without closing the passage.
    for (const [gx, gz] of [[x, z - radius], [x, z + radius], [x - radius, z], [x + radius, z]] as const) {
      for (const side of [-1, 1]) {
        const px = gx + (gx === x ? side * (gateHalfWidth + 1) : 0);
        const pz = gz + (gz === z ? side * (gateHalfWidth + 1) : 0);
        if (px < chunkMinX || px > chunkMaxX || pz < chunkMinZ || pz > chunkMaxZ) continue;
        for (let y = ground; y < ground + height + 1; y += 1) writer.set(px, y, pz, ID.stone_bricks);
      }
    }
  };

  const stampTownFortifications = (x: number, z: number, ground: number): void => {
    const radius = 48;
    const wallHeight = 8;
    stampRingWithGates(x, z, radius, ground, wallHeight, ID.stone_bricks, 2);

    // Four corner towers rise above the curtain wall. Their hollow centres and
    // narrow arrow slits keep them readable as towers rather than solid pillars.
    const stampTower = (cx: number, cz: number, half: number, height: number): void => {
      const minX = Math.max(cx - half, chunkMinX);
      const maxX = Math.min(cx + half, chunkMaxX);
      const minZ = Math.max(cz - half, chunkMinZ);
      const maxZ = Math.min(cz + half, chunkMaxZ);
      if (minX > maxX || minZ > maxZ) return;
      for (let px = minX; px <= maxX; px += 1) {
        for (let pz = minZ; pz <= maxZ; pz += 1) {
          const dx = Math.abs(px - cx);
          const dz = Math.abs(pz - cz);
          const edge = Math.max(dx, dz) === half;
          if (!edge) continue;
          for (let y = ground; y < ground + height; y += 1) {
            const slit = y === ground + 4 && ((dx === half && dz === 0) || (dz === half && dx === 0));
            if (!slit) writer.set(px, y, pz, ID.stone_bricks);
          }
          if (px === cx && pz === cz) {
            writer.set(px, ground + height, pz, ID.dark_planks);
          }
        }
      }
      // Alternating merlons on the tower roofline.
      const top = ground + height;
      for (let offset = -half; offset <= half; offset += 2) {
        for (const [px, pz] of [[cx + offset, cz - half], [cx + offset, cz + half],
          [cx - half, cz + offset], [cx + half, cz + offset]] as const) {
          if (px >= chunkMinX && px <= chunkMaxX && pz >= chunkMinZ && pz <= chunkMaxZ) {
            writer.set(px, top, pz, ID.stone_bricks);
            writer.set(px, top + 1, pz, ID.stone_bricks);
          }
        }
      }
    };

    for (const dx of [-radius, radius]) {
      for (const dz of [-radius, radius]) stampTower(x + dx, z + dz, 4, 12);
    }

    // Paired gate towers flank each open cardinal entrance. A lintel spans
    // above head height so the gate reads as a gatehouse while remaining walkable.
    for (const [gx, gz, horizontal] of [
      [x, z - radius, true], [x, z + radius, true],
      [x - radius, z, false], [x + radius, z, false],
    ] as const) {
      for (const side of [-1, 1]) {
        const tx = gx + (horizontal ? side * 6 : 0);
        const tz = gz + (horizontal ? 0 : side * 6);
        stampTower(tx, tz, 3, 11);
      }
      if (horizontal) {
        for (let px = Math.max(x - 2, chunkMinX); px <= Math.min(x + 2, chunkMaxX); px += 1) {
          if (gz < chunkMinZ || gz > chunkMaxZ) continue;
          for (let y = ground + 7; y <= ground + 8; y += 1) writer.set(px, y, gz, ID.stone_bricks);
        }
      } else {
        for (let pz = Math.max(z - 2, chunkMinZ); pz <= Math.min(z + 2, chunkMaxZ); pz += 1) {
          if (gx < chunkMinX || gx > chunkMaxX) continue;
          for (let y = ground + 7; y <= ground + 8; y += 1) writer.set(gx, y, pz, ID.stone_bricks);
        }
      }
    }
  };

  for (const node of nodes) {
    const x = Math.round(node.x);
    const z = Math.round(node.z);

    if (node.level === "city") {
      // A city gets a civic landmark and radial links to its five town centres.
      const nearby = Math.abs(x - chunkMinX) <= 520 + CHUNK_SIZE && Math.abs(z - chunkMinZ) <= 520 + CHUNK_SIZE;
      if (nearby) {
        const sample = terrain.natural(x, z);
        if (sample.water <= 0 && sample.riverDist >= sample.riverHalfWidth + 3 &&
            sample.ground > SEA_LEVEL + 2 && sample.ground + 28 < 192) {
          const plazaRadius = 15;
          for (let px = Math.max(x - plazaRadius, chunkMinX); px <= Math.min(x + plazaRadius, chunkMaxX); px += 1) {
            for (let pz = Math.max(z - plazaRadius, chunkMinZ); pz <= Math.min(z + plazaRadius, chunkMaxZ); pz += 1) {
              if (Math.abs(px - x) <= 9 && Math.abs(pz - z) <= 8) continue;
              writer.set(px, sample.ground, pz, ID.stone_bricks);
              writer.set(px, sample.ground + 1, pz, 0);
            }
          }
          const hall: Building = {
            x, z, w: 19, d: 17, wall: 18, stories: 3, facing: 0, roof: "hip",
            wallBlock: ID.stone_bricks, frameBlock: ID.dark_planks, roofBlock: ID.roof,
            floorBlock: ID.stone_bricks, foundation: ID.stone_bricks, chimney: ID.cobblestone,
            glazed: true, blueprint: "hierarchy-city-hall", accent: ID.dark_planks,
            open: false, turret: 1, spire: false, forge: false, furniture: 2,
          };
          stampBuilding(writer, hall, sample.ground);
        }
      }
      for (const townId of node.children) {
        const town = byId.get(townId);
        if (town?.level === "town") stampRoad(x, z, Math.round(town.x), Math.round(town.z), 5);
      }
      continue;
    }

    if (node.level === "town") {
      // Main streets connect the town square to its village neighbourhoods.
      for (const villageId of node.children) {
        const village = byId.get(villageId);
        if (village?.level === "village") stampRoad(x, z, Math.round(village.x), Math.round(village.z), 3);
      }

      const samples = [terrain.natural(x, z), terrain.natural(x - 7, z - 6),
        terrain.natural(x + 7, z - 6), terrain.natural(x - 7, z + 6), terrain.natural(x + 7, z + 6)];
      if (samples.some((sample) => sample.water > 0 || sample.riverDist < sample.riverHalfWidth + 3)) continue;
      const heights = samples.map((sample) => sample.ground);
      if (Math.max(...heights) - Math.min(...heights) > 3) continue;
      const sortedHeights = [...heights].sort((a, b) => a - b);
      const ground = sortedHeights[Math.floor(sortedHeights.length / 2)];
      if (ground <= SEA_LEVEL + 2 || ground + 24 >= 192) continue;

      // Stone curtain wall with crenellated corner towers and four open gatehouses.
      stampTownFortifications(x, z, ground);
      const plazaRadius = 11;
      for (let px = Math.max(x - plazaRadius, chunkMinX); px <= Math.min(x + plazaRadius, chunkMaxX); px += 1) {
        for (let pz = Math.max(z - plazaRadius, chunkMinZ); pz <= Math.min(z + plazaRadius, chunkMaxZ); pz += 1) {
          if (Math.abs(px - x) <= 8 && Math.abs(pz - z) <= 7) continue;
          writer.set(px, ground, pz, ID.stone_bricks);
          writer.set(px, ground + 1, pz, 0);
        }
      }
      const hall: Building = {
        x, z, w: 15, d: 13, wall: 12, stories: 2, facing: 0, roof: "hip",
        wallBlock: ID.cobblestone, frameBlock: ID.dark_planks, roofBlock: ID.roof,
        floorBlock: ID.stone_bricks, foundation: ID.stone_bricks, chimney: ID.cobblestone,
        glazed: true, blueprint: "hierarchy-town-hall", accent: ID.dark_planks,
        open: false, turret: 0, spire: false, forge: false, furniture: 2,
      };
      stampBuilding(writer, hall, ground);
      continue;
    }

    if (node.level === "castle") {
      const searchRadius = Number(node.metadata.strategicRadius) || 88;
      if (Math.abs(x - chunkMinX) > searchRadius + 64 + CHUNK_SIZE ||
          Math.abs(z - chunkMinZ) > searchRadius + 64 + CHUNK_SIZE) continue;
      const archetype = String(node.metadata.archetype ?? "concentric");
      const site = chooseCastleSite(terrain, x, z, archetype, searchRadius);
      if (!site) continue;
      const castleX = site.x;
      const castleZ = site.z;
      const ground = site.ground;
      const style = castleLayout(archetype);

      if (style.moat) {
        const moatRadius = style.outerRadius + 3;
        const minX = Math.max(castleX - moatRadius, chunkMinX);
        const maxX = Math.min(castleX + moatRadius, chunkMaxX);
        const minZ = Math.max(castleZ - moatRadius, chunkMinZ);
        const maxZ = Math.min(castleZ + moatRadius, chunkMaxZ);
        for (let px = minX; px <= maxX; px += 1) for (let pz = minZ; pz <= maxZ; pz += 1) {
          if (Math.max(Math.abs(px - castleX), Math.abs(pz - castleZ)) !== moatRadius) continue;
          const dx = px - castleX; const dz = pz - castleZ;
          if ((Math.abs(dx) <= 3 && Math.abs(dz) >= style.outerRadius - 1) ||
              (Math.abs(dz) <= 3 && Math.abs(dx) >= style.outerRadius - 1)) continue;
          writer.set(px, ground - 1, pz, ID.water);
          writer.set(px, ground - 2, pz, ID.water);
          writer.set(px, ground - 3, pz, ID.gravel);
        }
      }

      stampRingWithGates(castleX, castleZ, style.outerRadius, ground, style.outerHeight, ID.stone_bricks, style.gateHalfWidth);
      if (style.innerRadius > 0) {
        stampRingWithGates(castleX, castleZ, style.innerRadius, ground + style.innerRise, style.innerHeight, ID.stone_bricks, 2);
      }
      if (style.keepRadius > 0) {
        stampRingWithGates(castleX, castleZ, style.keepRadius, ground + style.keepRise, style.keepHeight, ID.stone_bricks, 2);
      }
      for (const dx of [-style.outerRadius, style.outerRadius]) {
        for (const dz of [-style.outerRadius, style.outerRadius]) {
          stampCastleTower(writer, castleX + dx, castleZ + dz, ground, style.towerHalf, style.outerHeight + style.towerExtra);
        }
      }
      if (style.gateTowers) {
        for (const [dx, dz] of [[0, -style.outerRadius], [0, style.outerRadius], [-style.outerRadius, 0], [style.outerRadius, 0]] as const) {
          stampCastleTower(writer, castleX + dx, castleZ + dz, ground, 3, style.outerHeight + 5);
        }
      }
      const keep: Building = {
        x: castleX, z: castleZ, w: style.keepSize, d: style.keepSize,
        wall: style.keepWall, stories: Math.max(2, Math.floor(style.keepWall / 6)),
        facing: 0, roof: archetype === "palace-fortress" ? "dome" : "hip",
        wallBlock: archetype === "riverside" ? ID.cobblestone : ID.stone_bricks,
        frameBlock: archetype === "palace-fortress" ? ID.marble : ID.dark_planks,
        roofBlock: archetype === "palace-fortress" ? ID.marble : ID.roof,
        floorBlock: ID.stone_bricks, foundation: ID.stone_bricks, chimney: ID.cobblestone,
        glazed: true, blueprint: `hierarchy-castle-${archetype}-keep`,
        accent: archetype === "palace-fortress" ? ID.gold : ID.dark_planks,
        open: false, turret: archetype === "palace-fortress" ? 4 : 1,
        spire: false, forge: false, furniture: 2,
      };
      stampBuilding(writer, keep, ground + style.keepRise);
      continue;
    }

    if (node.level !== "house") continue;
    const archetype = Math.max(0, Math.min(4, Math.floor(Number(node.metadata.archetypeIndex) || 0)));
    const blueprintIds = ["simple_home", "farmers_cottage", "fishermans_hut", "woodcutters_cabin", "bakers_house"] as const;
    const bp = blueprintById("village", blueprintIds[archetype]);
    const size = bp.w;
    const depth = bp.d;
    const stories = bp.stories;
    // Resolve unsuitable planned sites by searching deterministic nearby candidates.
    // Each node picks the same site in every chunk, preserving seamless boundaries.
    const halfW = Math.ceil(size / 2);
    const halfD = Math.ceil(depth / 2);
    const candidateOffsets: Array<[number, number]> = [[0, 0]];
    for (let radius = 4; radius <= 160; radius += 4) {
      for (let step = 0; step < 16; step += 1) {
        const angle = (Math.PI * 2 * step) / 16;
        candidateOffsets.push([Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)]);
      }
    }
    const siblingHouses = nodes.filter((other) => other.level === "house" && other.parentId === node.parentId && other.id !== node.id);
    const reserved = reservedHouseSites.get(node.parentId ?? "") ?? [];
    let chosen: { x: number; z: number; ground: number } | null = null;
    let bestFallback: { x: number; z: number; ground: number; score: number } | null = null;

    for (const [offsetX, offsetZ] of candidateOffsets) {
      const siteX = x + offsetX;
      const siteZ = z + offsetZ;
      const overlapsHouse = siblingHouses.some((other) =>
        Math.abs(siteX - Math.round(other.x)) < halfW + 5 &&
        Math.abs(siteZ - Math.round(other.z)) < halfD + 5) ||
        reserved.some((other) => Math.abs(siteX - other.x) < halfW + other.halfW + 3 &&
          Math.abs(siteZ - other.z) < halfD + other.halfD + 3);
      const samples = [
        terrain.natural(siteX, siteZ),
        terrain.natural(siteX - halfW, siteZ - halfD),
        terrain.natural(siteX + halfW, siteZ - halfD),
        terrain.natural(siteX - halfW, siteZ + halfD),
        terrain.natural(siteX + halfW, siteZ + halfD),
      ];
      if (samples.some((sample) => sample.water > 0 || sample.riverDist < sample.riverHalfWidth + 2)) continue;
      const heights = samples.map((sample) => sample.ground);
      const spread = Math.max(...heights) - Math.min(...heights);
      const sorted = [...heights].sort((a, b) => a - b);
      const ground = sorted[Math.floor(sorted.length / 2)];
      if (ground <= SEA_LEVEL + 2 || ground + stories * 6 + 8 >= 192) continue;

      const score = spread * 10 + Math.hypot(offsetX, offsetZ);
      if (!bestFallback || score < bestFallback.score) bestFallback = { x: siteX, z: siteZ, ground, score };
      if (!overlapsHouse && spread <= 4) {
        chosen = { x: siteX, z: siteZ, ground };
        break;
      }
    }
    // If strict flat sites are unavailable, prefer the least-steep dry candidate
    // rather than silently dropping a home.
    if (!chosen && bestFallback) {
      chosen = { x: bestFallback.x, z: bestFallback.z, ground: bestFallback.ground };
    }
    // A village's planned residential count is a hard rendering requirement. If
    // the surrounding search finds no dry site (for example, a tiny island or
    // river delta), retain the house on a deterministic raised build pad rather
    // than silently dropping it. The pad clears the footprint while stamping,
    // so water/vegetation cannot leave the interior flooded.
    if (!chosen) {
      const sample = terrain.natural(x, z);
      const safeGround = Math.max(SEA_LEVEL + 3, Math.min(sample.ground, 192 - stories * 6 - 10));
      chosen = { x, z, ground: safeGround };
    }
    const siteX = chosen.x;
    const siteZ = chosen.z;
    const ground = chosen.ground;
    reserved.push({ x: siteX, z: siteZ, halfW, halfD });
    reservedHouseSites.set(node.parentId ?? "", reserved);
    // The final site may shift into a neighbouring chunk, so check overlap only now.
    if (siteX + halfW < chunkMinX || siteX - halfW > chunkMaxX ||
        siteZ + halfD < chunkMinZ || siteZ - halfD > chunkMaxZ) continue;

    // Use the same blueprint roster as hand-designed villages, so hierarchy
    // homes inherit their real footprints, wall palettes, roof forms and facades.
    const palette = tierPalette("village", bp.style);
    const building = applyVictorianFacade({
      x: siteX, z: siteZ, w: bp.w, d: bp.d, wall: bp.stories * 6, stories: bp.stories,
      facing: archetype % 4 as Facing, roof: bp.roof,
      wallBlock: pickFrom(palette.walls, hash2(siteX, siteZ, seed + archetype * 37)),
      frameBlock: palette.frame, roofBlock: tierRoofBlock("village"),
      floorBlock: palette.floor, foundation: palette.foundation,
      chimney: bp.chimney || bp.forge ? ID.cobblestone : 0, glazed: true,
      blueprint: `hierarchy-${bp.id}`, accent: accentBlock(bp.accent),
      open: !!bp.open, turret: bp.turret ?? 0, spire: !!bp.spire,
      forge: !!bp.forge, passage: bp.passage, furniture: bp.furniture,
    }, bp.facadeVariant, bp.windowCount, bp.corniceBlock, bp.gableTrim, bp.hasDormers, bp.bayWindowWidth);
    stampBuilding(writer, building, ground);
  }
}