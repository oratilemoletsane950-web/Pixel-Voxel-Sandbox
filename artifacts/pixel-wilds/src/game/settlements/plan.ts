/** Settlement planning: sites, terrain footprint, layouts and cached queries. */
import { ID } from "../blocks";
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
} from "../blueprints";
import { SEA_LEVEL } from "../chunk";
import { hash2, lerp, smoothstep } from "../noise";
import type { HeightRecord, Terrain } from "../terrain";

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

export type Facing = 0 | 1 | 2 | 3; // 0 = +z, 1 = +x, 2 = -z, 3 = -x

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

export interface Farm {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface Garden {
  x: number;  z: number;  w: number;
  d: number;
}

export interface District {
  x: number;
  z: number;
  half: number;
}

export interface PathSegment {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface WallSpec {
  height: number;
  block: number;
  palisade: boolean;
  gateHalfWidth: number;
  gates: Facing[];
}

export interface TowerSpec {
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

export type Feature = "well" | "fountain" | "tree" | "hall" | "fire" | "mage" | "keep" | "palace";

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

export interface KindSpec {
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

export function scoreSite(
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

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Style {
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

export function makeSettlement(terrain: Terrain, seed: number, regionX: number, regionZ: number): Settlement | null {
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

export function getSettlement(terrain: Terrain, regionX: number, regionZ: number): Settlement | null {
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
export function settlementsTouching(terrain: Terrain, x0: number, z0: number, x1: number, z1: number): Settlement[] {
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
