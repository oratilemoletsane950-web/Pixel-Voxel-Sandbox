/**
 * Block identity and vocabulary.
 *
 * This file intentionally contains no colours or behaviour: it is the ordered
 * vocabulary that saved chunks encode as numeric ids. `BLOCK_TYPES` order is a
 * save format, so it must only ever be appended to.
 */

export const BLOCK_SIZE_METERS = 0.5;

/** Blocks the player can gather and place, grouped the way they appear in the palette. */
export const BLOCK_TYPES = [
  // ground & sediment
  "grass",
  "dirt",
  "mud",
  "path",
  "farmland",
  "sand",
  "gravel",
  "clay",
  "snow",
  "ice",
  "moss",
  // rock
  "stone",
  "granite",
  "limestone",
  "sandstone",
  "cobblestone",
  "stone_bricks",
  "coal_ore",
  "iron_ore",
  // wood & plants
  "wood",
  "birch_wood",
  "spruce_wood",
  "leaves",
  "birch_leaves",
  "spruce_leaves",
  "cactus",
  "thatch",
  // crafted
  "planks",
  "dark_planks",
  "brick",
  "roof",
  "glass",
  "door",
  "chair",
  "table",
  "marble",
  "gold",
  "chest",
  // Appended after the original vocabulary. WORLD_BLOCK_TYPES pins these
  // after the legacy scenery ids so old chunk saves keep their meaning.
  "furnace",
  "barrel",
  "hopper",
  // Appended after the legacy and container ranges. These are gameplay items
  // as well as blocks: light and cave decoration, then the wheat lifecycle.
  "glow_crystal",
  "cave_moss",
  "wheat_seeds",
  "wheat_grain",
  "bread",
] as const;

/** Scenery that is part of the world but is cleared rather than collected. */
export const SCENERY_BLOCK_TYPES = ["flower", "wheat", "fern", "tall_grass", "reed", "mushroom", "vine", "water", "bedrock"] as const;

/** New container blocks, kept out of the legacy collectible id range. */
export const CONTAINER_BLOCK_TYPES = ["furnace", "barrel", "hopper"] as const;
export type ContainerBlockType = (typeof CONTAINER_BLOCK_TYPES)[number];

/** Collectible additions that must keep their own appended id range. */
export const APPENDED_COLLECTIBLE_BLOCK_TYPES = [
  "glow_crystal",
  "cave_moss",
  "wheat_seeds",
  "wheat_grain",
  "bread",
] as const;

/** Growth stages are scenery: harvested through farming rules, not placed. */
export const CROP_STAGE_BLOCK_TYPES = ["wheat_sprout", "wheat_ripe"] as const;
export type CropStageBlockType = (typeof CROP_STAGE_BLOCK_TYPES)[number];

/** Items that live in the pack but can never be placed as construction blocks. */
export const NON_PLACEABLE_BLOCK_TYPES = ["wheat_grain", "bread"] as const;
export type NonPlaceableBlockType = (typeof NON_PLACEABLE_BLOCK_TYPES)[number];

// Keep existing numeric ids stable: chest and the newer container blocks are
// appended after the long-standing collectible and scenery slots. Adding a
// block to BLOCK_TYPES must therefore add it here explicitly, not by filtering.
export const WORLD_BLOCK_TYPES = [
  ...BLOCK_TYPES.filter(
    (type) =>
      type !== "chest" &&
      type !== "furnace" &&
      type !== "barrel" &&
      type !== "hopper" &&
      !(APPENDED_COLLECTIBLE_BLOCK_TYPES as readonly string[]).includes(type),
  ),
  ...SCENERY_BLOCK_TYPES,
  "chest",
  ...CONTAINER_BLOCK_TYPES,
  ...APPENDED_COLLECTIBLE_BLOCK_TYPES,
  ...CROP_STAGE_BLOCK_TYPES,
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];
export type WorldBlockType = (typeof WORLD_BLOCK_TYPES)[number];

export type TexturePattern =
  | "speckle"
  | "grass"
  | "log"
  | "planks"
  | "bricks"
  | "cobble"
  | "ore"
  | "leaves"
  | "cactus"
  | "thatch"
  | "farmland"
  | "shingles"
  | "water"
  | "glass"
  | "flower"
  | "wheat"
  | "fern"
  | "tall_grass"
  | "reed"
  | "mushroom"
  | "vine"
  | "bedrock"
  | "bands"
  | "snow"
  | "door"
  | "chair"
  | "table"
  | "marble"
  | "gilded"
  | "chest"
  | "metal"
  | "glow"
  | "moss"
  | "bread";

export type Rgb = [string, string, string];

export type ToolKind = "pickaxe" | "axe" | "shovel";

export interface BlockInfo {
  name: WorldBlockType;
  label: string;
  short: string;
  /** [side, top, front] colours, used by the 2D fallback and palette swatches. */
  colors: Rgb;
  speckle: Rgb;
  pattern: TexturePattern;
  /** Blocks movement. Water, flowers and crops can be walked through. */
  solid: boolean;
  /** Hides the faces of neighbours. Water, glass and ice are see-through. */
  opaque: boolean;
  /** Alpha used for see-through blocks. */
  alpha: number;
  /** Seconds of hand mining before the block breaks. */
  hardness: number;
  /** The tool family that mines this block efficiently. */
  tool?: ToolKind;
  /** Minimum tool tier required to harvest; 0 means hands are enough. */
  harvestTier: number;
  collectible: boolean;
  /** False for food/ingredient items that only live in the pack. */
  placeable: boolean;
  /** Emits a soft local light in the renderer. */
  emissive: boolean;
  unbreakable: boolean;
  /** Extra colour for ore flecks. */
  fleck?: string;
}
