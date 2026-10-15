import { ID } from "./blocks";

/**
 * The four human settlement designs, as blueprints.
 *
 * Every house type on the settlement sheet (village / town / castle /
 * kingdom, twelve per tier) is one entry here: its footprint, how many
 * storeys it has, which roof form it wears, and where in the plan it may be
 * placed. `settlements.ts` reads these to lay a settlement out, so the
 * design tables and the generator can never drift apart.
 *
 * Storeys are 6 blocks tall (3 m): floor slab, five blocks of clear height,
 * then the next floor - the same module the player walks in (doors are
 * 5 blocks, the player is 4). Buildings with two or more storeys that are at
 * least 9 x 9 get an interior staircase they can walk up; smaller multi-storey
 * pieces (watchtower, mage tower) are lookouts, reached by flight.
 *
 * Zone says where the plan puts a piece:
 *   plaza - hand-placed around the central square (halls, markets, towers)
 *   row   - lining the cross streets, facing them
 *   quad  - filling the blocks between streets, or a district landmark
 *   tower - a tall piece given a slot with a view
 *   garden- green space: stamped as hedges, paths, flowers and a fountain
 */

export type RoofForm = "gable" | "hip" | "flat" | "mansard" | "dome";
export type WallStyle = "wood" | "stone" | "brick" | "mixed" | "marble" | "dark";
export type BlueprintZone = "plaza" | "row" | "quad" | "tower" | "garden";
export type HumanTier = "village" | "town" | "castle" | "kingdom";

export interface Blueprint {
  /** Stable id used by the HUD, docs and tests. */
  id: string;
  /** The name printed on the settlement sheet. */
  label: string;
  w: number;
  d: number;
  stories: number;
  zone: BlueprintZone;
  roof: RoofForm;
  style: WallStyle;
  /** 0 = bare, 1 = table + chairs, 2 = long banquet table. */
  furniture: 0 | 1 | 2;
  chimney?: boolean;
  /** Market-style stall: paving, corner posts and a canopy instead of walls. */
  open?: boolean;
  /** Roof-top lookout: one central turret, or four corner turrets. */
  turret?: 0 | 1 | 4;
  /** Chapel-style spire above the ridge. */
  spire?: boolean;
  /** Blacksmith forge: a coal fire in the corner and a stack through the roof. */
  forge?: boolean;
  /** Gatehouse: an open archway through the ground floor along `passage`. */
  passage?: "x" | "z";
  /** Belt courses and trim: gold for royalty, marble for ceremony. */
  accent?: "gold" | "marble" | "brick";
  /** Green space rather than a building (stamped by `stampGarden`). */
  garden?: boolean;
  /** Victorian facade variant: bay window, dormer, or standard. */
  facadeVariant?: 0 | 1 | 2;
  /** Number of Victorian sash windows per façade side. */
  windowCount?: number;
  /** Decorative cornice block (gold, marble, or brick). */
  corniceBlock?: number;
  /** Whether the building has a decorative gable trim. */
  gableTrim?: boolean;
  /** Whether the building has dormer windows. */
  hasDormers?: boolean;
  /** Bay window width in blocks (0 = none). */
  bayWindowWidth?: number;
}

export const HUMAN_TIERS = ["village", "town", "castle", "kingdom"] as const;

/* ------------------------------------------------------------------ */
/* VILLAGE - smallest settlement: farming, craft and trade, 20+ homes  */
/* ------------------------------------------------------------------ */

const VILLAGE: Blueprint[] = [
  { id: "village_hall", label: "Village Hall", w: 11, d: 9, stories: 2, zone: "plaza", roof: "gable", style: "mixed", furniture: 2, chimney: true, accent: "brick", facadeVariant: 0, windowCount: 4, corniceBlock: ID.brick, gableTrim: true, hasDormers: false, bayWindowWidth: 0 },
  { id: "market_stall", label: "Market Stall", w: 7, d: 5, stories: 1, zone: "plaza", roof: "flat", style: "wood", furniture: 0, open: true, facadeVariant: 0, windowCount: 0, bayWindowWidth: 0 },
  { id: "watchtower", label: "Watchtower", w: 5, d: 5, stories: 3, zone: "tower", roof: "flat", style: "stone", furniture: 0, turret: 1, facadeVariant: 0, windowCount: 2, corniceBlock: 0, gableTrim: false, hasDormers: false, bayWindowWidth: 0 },
  { id: "tavern", label: "Tavern", w: 13, d: 9, stories: 2, zone: "row", roof: "gable", style: "mixed", furniture: 2, chimney: true, facadeVariant: 1, windowCount: 6, corniceBlock: ID.brick, gableTrim: true, hasDormers: true, bayWindowWidth: 3 },
  { id: "simple_home", label: "Simple Home", w: 9, d: 9, stories: 2, zone: "row", roof: "gable", style: "wood", furniture: 1, chimney: true, facadeVariant: 0, windowCount: 3, corniceBlock: ID.brick, gableTrim: true, hasDormers: false, bayWindowWidth: 0 },
  { id: "general_store", label: "General Store", w: 9, d: 9, stories: 1, zone: "row", roof: "hip", style: "mixed", furniture: 1, facadeVariant: 2, windowCount: 4, corniceBlock: ID.marble, gableTrim: false, hasDormers: false, bayWindowWidth: 4 },
  { id: "farmers_cottage", label: "Farmer's Cottage", w: 9, d: 9, stories: 1, zone: "quad", roof: "gable", style: "wood", furniture: 1, chimney: true, facadeVariant: 0, windowCount: 2, corniceBlock: 0, gableTrim: false, hasDormers: false, bayWindowWidth: 0 },
  { id: "fishermans_hut", label: "Fisherman's Hut", w: 7, d: 7, stories: 1, zone: "quad", roof: "hip", style: "wood", furniture: 1, facadeVariant: 0, windowCount: 1, corniceBlock: 0, gableTrim: false, hasDormers: false, bayWindowWidth: 0 },
  { id: "woodcutters_cabin", label: "Woodcutter's Cabin", w: 9, d: 7, stories: 1, zone: "quad", roof: "gable", style: "wood", furniture: 1, chimney: true, facadeVariant: 0, windowCount: 2, corniceBlock: ID.brick, gableTrim: true, hasDormers: false, bayWindowWidth: 0 },
  { id: "bakers_house", label: "Baker's House", w: 9, d: 9, stories: 1, zone: "quad", roof: "gable", style: "mixed", furniture: 1, chimney: true, facadeVariant: 1, windowCount: 3, corniceBlock: ID.brick, gableTrim: true, hasDormers: false, bayWindowWidth: 2 },
  { id: "carpenters_shop", label: "Carpenter's Shop", w: 9, d: 9, stories: 1, zone: "quad", roof: "gable", style: "wood", furniture: 1, facadeVariant: 0, windowCount: 3, corniceBlock: ID.brick, gableTrim: true, hasDormers: false, bayWindowWidth: 0 },
  { id: "healers_house", label: "Healer's House", w: 7, d: 9, stories: 1, zone: "quad", roof: "hip", style: "wood", furniture: 1, facadeVariant: 1, windowCount: 2, corniceBlock: ID.brick, gableTrim: true, hasDormers: true, bayWindowWidth: 1 },
];

/* ------------------------------------------------------------------ */
/* TOWN - medium settlement: trade, craft, regional leadership, 50+    */
/* ------------------------------------------------------------------ */

const TOWN: Blueprint[] = [
  { id: "town_hall", label: "Town Hall", w: 13, d: 11, stories: 3, zone: "plaza", roof: "mansard", style: "stone", furniture: 2, chimney: true, turret: 1, accent: "brick", facadeVariant: 2, windowCount: 8, corniceBlock: ID.marble, gableTrim: true, hasDormers: true, bayWindowWidth: 3 },
  { id: "guild_hall", label: "Guild Hall", w: 15, d: 9, stories: 3, zone: "plaza", roof: "mansard", style: "mixed", furniture: 2, accent: "brick", facadeVariant: 2, windowCount: 6, corniceBlock: ID.marble, gableTrim: true, hasDormers: true, bayWindowWidth: 2 },
  { id: "city_market", label: "City Market", w: 7, d: 5, stories: 1, zone: "plaza", roof: "flat", style: "wood", furniture: 0, open: true, facadeVariant: 0, windowCount: 0, corniceBlock: 0, gableTrim: false, hasDormers: false, bayWindowWidth: 0 },
  { id: "blacksmith", label: "Blacksmith", w: 9, d: 9, stories: 2, zone: "quad", roof: "gable", style: "stone", furniture: 0, forge: true, facadeVariant: 1, windowCount: 4, corniceBlock: ID.marble, gableTrim: true, hasDormers: false, bayWindowWidth: 2 },
  { id: "inn", label: "Inn", w: 13, d: 11, stories: 3, zone: "row", roof: "gable", style: "mixed", furniture: 2, chimney: true, facadeVariant: 2, windowCount: 8, corniceBlock: ID.marble, gableTrim: true, hasDormers: true, bayWindowWidth: 3 },
  { id: "townhouse", label: "Townhouse", w: 9, d: 9, stories: 3, zone: "row", roof: "mansard", style: "mixed", furniture: 1, chimney: true, facadeVariant: 2, windowCount: 6, corniceBlock: ID.marble, gableTrim: true, hasDormers: true, bayWindowWidth: 3 },
  { id: "merchant_house", label: "Merchant House", w: 11, d: 9, stories: 3, zone: "row", roof: "hip", style: "mixed", furniture: 1, chimney: true, accent: "brick", facadeVariant: 2, windowCount: 7, corniceBlock: ID.marble, gableTrim: true, hasDormers: true, bayWindowWidth: 3 },
  { id: "apartments", label: "Apartments", w: 11, d: 11, stories: 4, zone: "row", roof: "flat", style: "brick", furniture: 1, facadeVariant: 2, windowCount: 8, corniceBlock: ID.gold, gableTrim: false, hasDormers: false, bayWindowWidth: 2 },
  { id: "library", label: "Library", w: 11, d: 9, stories: 3, zone: "quad", roof: "hip", style: "stone", furniture: 1, facadeVariant: 2, windowCount: 6, corniceBlock: ID.marble, gableTrim: true, hasDormers: true, bayWindowWidth: 2 },
  { id: "brewery", label: "Brewery", w: 11, d: 9, stories: 2, zone: "quad", roof: "gable", style: "mixed", furniture: 0, chimney: true, facadeVariant: 1, windowCount: 4, corniceBlock: ID.marble, gableTrim: true, hasDormers: false, bayWindowWidth: 2 },
  { id: "tannery", label: "Tannery", w: 9, d: 9, stories: 2, zone: "quad", roof: "flat", style: "wood", furniture: 0, facadeVariant: 0, windowCount: 0, corniceBlock: 0, gableTrim: false, hasDormers: false, bayWindowWidth: 0 },
  { id: "stonecutter", label: "Stonecutter", w: 9, d: 9, stories: 2, zone: "quad", roof: "hip", style: "stone", furniture: 0, facadeVariant: 1, windowCount: 3, corniceBlock: ID.marble, gableTrim: true, hasDormers: false, bayWindowWidth: 1 },
];

/* ------------------------------------------------------------------ */
/* CASTLE - large fortress: royal keep, barracks, moat, garrison, 100+ */
/* ------------------------------------------------------------------ */

const CASTLE: Blueprint[] = [
  { id: "royal_keep", label: "Royal Keep", w: 21, d: 17, stories: 5, zone: "plaza", roof: "hip", style: "stone", furniture: 2, turret: 4, accent: "gold", facadeVariant: 2, windowCount: 12, corniceBlock: ID.gold, gableTrim: true, hasDormers: false, bayWindowWidth: 0 },
  { id: "gatehouse", label: "Gatehouse", w: 13, d: 9, stories: 3, zone: "plaza", roof: "flat", style: "stone", furniture: 0, accent: "marble", facadeVariant: 1, windowCount: 2, corniceBlock: ID.marble, gableTrim: true, hasDormers: false, bayWindowWidth: 1 },
  { id: "royal_gardens", label: "Royal Gardens", w: 17, d: 17, stories: 1, zone: "garden", roof: "flat", style: "wood", furniture: 0, garden: true, facadeVariant: 0, windowCount: 0, corniceBlock: 0, gableTrim: false, hasDormers: false, bayWindowWidth: 0 },
  { id: "barracks", label: "Barracks", w: 15, d: 9, stories: 3, zone: "row", roof: "gable", style: "stone", furniture: 2, facadeVariant: 1, windowCount: 6, corniceBlock: ID.marble, gableTrim: true, hasDormers: false, bayWindowWidth: 2 },
  { id: "commanders_house", label: "Commander's House", w: 13, d: 11, stories: 3, zone: "quad", roof: "hip", style: "stone", furniture: 1, chimney: true, accent: "marble", facadeVariant: 2, windowCount: 5, corniceBlock: ID.marble, gableTrim: true, hasDormers: true, bayWindowWidth: 2 },
  { id: "noble_house", label: "Noble House", w: 11, d: 11, stories: 3, zone: "quad", roof: "hip", style: "mixed", furniture: 1, chimney: true, accent: "marble", facadeVariant: 2, windowCount: 5, corniceBlock: ID.marble, gableTrim: true, hasDormers: true, bayWindowWidth: 2 },
  { id: "armoury", label: "Armoury", w: 9, d: 9, stories: 3, zone: "quad", roof: "flat", style: "stone", furniture: 0, facadeVariant: 1, windowCount: 4, corniceBlock: ID.marble, gableTrim: true, hasDormers: false, bayWindowWidth: 2 },
  { id: "stable", label: "Stable", w: 13, d: 9, stories: 1, zone: "quad", roof: "gable", style: "wood", furniture: 0, open: true, facadeVariant: 0, windowCount: 2, corniceBlock: ID.brick, gableTrim: false, hasDormers: false, bayWindowWidth: 0 },
  { id: "granary", label: "Granary", w: 11, d: 9, stories: 2, zone: "quad", roof: "gable", style: "wood", furniture: 0, facadeVariant: 0, windowCount: 2, corniceBlock: ID.brick, gableTrim: false, hasDormers: false, bayWindowWidth: 0 },
  { id: "chapel", label: "Chapel", w: 9, d: 13, stories: 3, zone: "quad", roof: "gable", style: "stone", furniture: 1, spire: true, accent: "marble", facadeVariant: 2, windowCount: 8, corniceBlock: ID.gold, gableTrim: true, hasDormers: true, bayWindowWidth: 3 },
  { id: "guest_house", label: "Guest House", w: 11, d: 9, stories: 2, zone: "row", roof: "hip", style: "mixed", furniture: 1, chimney: true, facadeVariant: 1, windowCount: 4, corniceBlock: ID.marble, gableTrim: true, hasDormers: false, bayWindowWidth: 2 },
  { id: "mage_tower", label: "Mage Tower", w: 7, d: 7, stories: 4, zone: "tower", roof: "flat", style: "brick", furniture: 1, turret: 1, accent: "marble", facadeVariant: 1, windowCount: 3, corniceBlock: ID.gold, gableTrim: true, hasDormers: true, bayWindowWidth: 1 },
];

/* ------------------------------------------------------------------ */
/* KINGDOM - largest: royal palace, districts, temples, 200+ homes     */
/* ------------------------------------------------------------------ */

const KINGDOM: Blueprint[] = [
  { id: "royal_palace", label: "Royal Palace", w: 25, d: 19, stories: 5, zone: "plaza", roof: "dome", style: "marble", furniture: 2, turret: 4, accent: "gold", facadeVariant: 2, windowCount: 20, corniceBlock: ID.gold, gableTrim: true, hasDormers: false, bayWindowWidth: 0 },
  { id: "gatehouse", label: "Gatehouse", w: 13, d: 9, stories: 3, zone: "plaza", roof: "flat", style: "stone", furniture: 0, accent: "gold", facadeVariant: 1, windowCount: 2, corniceBlock: ID.marble, gableTrim: true, hasDormers: false, bayWindowWidth: 1 },
  { id: "grand_market", label: "Grand Market Stall", w: 7, d: 5, stories: 1, zone: "plaza", roof: "flat", style: "wood", furniture: 0, open: true, accent: "gold", facadeVariant: 0, windowCount: 0, corniceBlock: 0, gableTrim: false, hasDormers: false, bayWindowWidth: 0 },
  { id: "government", label: "Government House", w: 15, d: 11, stories: 4, zone: "quad", roof: "mansard", style: "stone", furniture: 2, accent: "gold", facadeVariant: 2, windowCount: 10, corniceBlock: ID.gold, gableTrim: true, hasDormers: true, bayWindowWidth: 3 },
  { id: "temple", label: "Temple", w: 13, d: 13, stories: 4, zone: "quad", roof: "dome", style: "marble", furniture: 1, accent: "gold", facadeVariant: 2, windowCount: 12, corniceBlock: ID.gold, gableTrim: true, hasDormers: true, bayWindowWidth: 2 },
  { id: "university", label: "University", w: 15, d: 11, stories: 4, zone: "row", roof: "gable", style: "stone", furniture: 1, chimney: true, facadeVariant: 2, windowCount: 10, corniceBlock: ID.gold, gableTrim: true, hasDormers: true, bayWindowWidth: 2 },
  { id: "harbour_master", label: "Harbour Master", w: 11, d: 9, stories: 3, zone: "quad", roof: "hip", style: "dark", furniture: 1, facadeVariant: 1, windowCount: 3, corniceBlock: ID.marble, gableTrim: true, hasDormers: false, bayWindowWidth: 2 },
  { id: "warehouse", label: "Warehouse", w: 11, d: 9, stories: 3, zone: "quad", roof: "flat", style: "dark", furniture: 0, facadeVariant: 0, windowCount: 0, corniceBlock: 0, gableTrim: false, hasDormers: false, bayWindowWidth: 0 },
  { id: "trade_guild", label: "Trade Guild", w: 13, d: 9, stories: 3, zone: "quad", roof: "hip", style: "mixed", furniture: 2, accent: "brick", facadeVariant: 1, windowCount: 6, corniceBlock: ID.marble, gableTrim: true, hasDormers: false, bayWindowWidth: 2 },
  { id: "noble_estate", label: "Noble Estate", w: 13, d: 11, stories: 3, zone: "quad", roof: "hip", style: "marble", furniture: 1, chimney: true, accent: "gold", facadeVariant: 2, windowCount: 6, corniceBlock: ID.gold, gableTrim: true, hasDormers: true, bayWindowWidth: 2 },
  { id: "barracks", label: "Barracks", w: 15, d: 9, stories: 3, zone: "row", roof: "gable", style: "stone", furniture: 2, facadeVariant: 1, windowCount: 8, corniceBlock: ID.gold, gableTrim: true, hasDormers: true, bayWindowWidth: 3 },
  { id: "hospital", label: "Hospital", w: 11, d: 9, stories: 3, zone: "quad", roof: "gable", style: "marble", furniture: 1, accent: "marble", facadeVariant: 2, windowCount: 6, corniceBlock: ID.gold, gableTrim: true, hasDormers: true, bayWindowWidth: 2 },
  { id: "residential_quarter", label: "Residential Quarter", w: 11, d: 9, stories: 2, zone: "row", roof: "mansard", style: "mixed", furniture: 1, chimney: true, facadeVariant: 1, windowCount: 4, corniceBlock: ID.marble, gableTrim: true, hasDormers: true, bayWindowWidth: 2 },
  { id: "royal_park", label: "Royal Park", w: 17, d: 17, stories: 1, zone: "garden", roof: "flat", style: "wood", furniture: 0, garden: true, facadeVariant: 0, windowCount: 0, corniceBlock: 0, gableTrim: false, hasDormers: false, bayWindowWidth: 0 },
];

export const ROSTERS: Record<HumanTier, Blueprint[]> = {
  village: VILLAGE,
  town: TOWN,
  castle: CASTLE,
  kingdom: KINGDOM,
};

export function rosterPool(tier: HumanTier, zone: BlueprintZone): Blueprint[] {
  return ROSTERS[tier].filter((blueprint) => blueprint.zone === zone);
}

export function blueprintById(tier: HumanTier, id: string): Blueprint {
  const found = ROSTERS[tier].find((blueprint) => blueprint.id === id);
  if (!found) throw new Error(`No ${tier} blueprint named ${id}`);
  return found;
}

export function pickFrom<T>(values: readonly T[], roll: number): T {
  return values[Math.min(values.length - 1, Math.floor(roll * values.length))];
}

/* ------------------------------------------------------------------ */
/* Materials & colours (the sheet's palette, per tier)                 */
/* ------------------------------------------------------------------ */

interface Palette {
  walls: number[];
  frame: number;  floor: number;
  foundation: number;
}

const PALETTES: Record<HumanTier, Record<WallStyle, Palette>> = {
  village: {
    wood: { walls: [ID.planks, ID.planks], frame: ID.wood, floor: ID.planks, foundation: ID.cobblestone },
    mixed: { walls: [ID.planks, ID.limestone], frame: ID.wood, floor: ID.planks, foundation: ID.cobblestone },
    stone: { walls: [ID.limestone, ID.cobblestone], frame: ID.wood, floor: ID.planks, foundation: ID.cobblestone },
    brick: { walls: [ID.brick, ID.planks], frame: ID.wood, floor: ID.planks, foundation: ID.cobblestone },
    marble: { walls: [ID.marble, ID.limestone], frame: ID.wood, floor: ID.planks, foundation: ID.cobblestone },
    dark: { walls: [ID.dark_planks, ID.planks], frame: ID.spruce_wood, floor: ID.planks, foundation: ID.cobblestone },
  },
  town: {
    wood: { walls: [ID.planks, ID.planks], frame: ID.wood, floor: ID.planks, foundation: ID.cobblestone },
    mixed: { walls: [ID.planks, ID.brick, ID.limestone], frame: ID.wood, floor: ID.planks, foundation: ID.cobblestone },
    stone: { walls: [ID.limestone, ID.stone_bricks], frame: ID.wood, floor: ID.planks, foundation: ID.cobblestone },
    brick: { walls: [ID.brick, ID.limestone], frame: ID.wood, floor: ID.planks, foundation: ID.cobblestone },
    marble: { walls: [ID.marble, ID.limestone], frame: ID.wood, floor: ID.planks, foundation: ID.cobblestone },
    dark: { walls: [ID.dark_planks, ID.planks], frame: ID.spruce_wood, floor: ID.planks, foundation: ID.cobblestone },
  },
  castle: {
    stone: { walls: [ID.stone_bricks, ID.limestone], frame: ID.stone_bricks, floor: ID.planks, foundation: ID.cobblestone },
    mixed: { walls: [ID.stone_bricks, ID.planks, ID.brick], frame: ID.stone_bricks, floor: ID.planks, foundation: ID.cobblestone },
    wood: { walls: [ID.planks, ID.dark_planks], frame: ID.spruce_wood, floor: ID.planks, foundation: ID.cobblestone },
    brick: { walls: [ID.brick, ID.stone_bricks], frame: ID.stone_bricks, floor: ID.planks, foundation: ID.cobblestone },
    marble: { walls: [ID.marble, ID.limestone], frame: ID.stone_bricks, floor: ID.planks, foundation: ID.cobblestone },
    dark: { walls: [ID.dark_planks, ID.planks], frame: ID.spruce_wood, floor: ID.planks, foundation: ID.cobblestone },
  },
  kingdom: {
    stone: { walls: [ID.stone_bricks, ID.limestone], frame: ID.limestone, floor: ID.planks, foundation: ID.stone_bricks },
    marble: { walls: [ID.marble, ID.limestone], frame: ID.limestone, floor: ID.marble, foundation: ID.stone_bricks },
    mixed: { walls: [ID.limestone, ID.planks, ID.brick], frame: ID.wood, floor: ID.planks, foundation: ID.stone_bricks },
    wood: { walls: [ID.planks, ID.dark_planks], frame: ID.wood, floor: ID.planks, foundation: ID.cobblestone },
    brick: { walls: [ID.brick, ID.marble], frame: ID.limestone, floor: ID.planks, foundation: ID.stone_bricks },
    dark: { walls: [ID.dark_planks, ID.planks], frame: ID.spruce_wood, floor: ID.dark_planks, foundation: ID.cobblestone },
  },
};

export function tierPalette(tier: HumanTier, style: WallStyle): Palette {
  return PALETTES[tier][style];
}

/** Roof tiles everywhere except the thatched village. */
export function tierRoofBlock(tier: HumanTier): number {
  return tier === "village" ? ID.thatch : ID.roof;
}

export function accentBlock(accent: Blueprint["accent"]): number {
  if (accent === "gold") return ID.gold;
  if (accent === "marble") return ID.marble;
  if (accent === "brick") return ID.brick;
  return 0;
}

/** Apply Victorian facade details to a building's style. */
export function applyVictorianFacade(
  b: import("./settlements").Building,
  facadeVariant: Blueprint["facadeVariant"],
  windowCount?: number,
  corniceBlock?: number,
  gableTrim?: boolean,
  hasDormers?: boolean,
  bayWindowWidth?: number,
): import("./settlements").Building {
  const result = { ...b };
  if (facadeVariant === 1) {
    // Add bay window on the front façade
    result.bayWindowWidth = bayWindowWidth || 3;
  } else if (facadeVariant === 2) {
    // Full Victorian: bay windows + dormers + cornice
    result.bayWindowWidth = bayWindowWidth || 3;
    result.hasDormers = hasDormers !== undefined ? hasDormers : true;
    if (corniceBlock !== undefined) {
      // Map the block ID to an accent value for the Building interface
      if (corniceBlock === ID.gold) result.accent = ID.gold;
      else if (corniceBlock === ID.marble) result.accent = ID.marble;
      else if (corniceBlock === ID.brick) result.accent = ID.brick;
      else result.accent = corniceBlock;
    }
    result.gableTrim = gableTrim !== undefined ? gableTrim : true;
  }
  // Window count is informational - the generator uses it for placement
  if (windowCount !== undefined) result.windowCount = windowCount;
  return result;
}