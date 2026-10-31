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
] as const;

/** Scenery that is part of the world but is cleared rather than collected. */
export const SCENERY_BLOCK_TYPES = ["flower", "wheat", "fern", "tall_grass", "reed", "mushroom", "vine", "water", "bedrock"] as const;

export const WORLD_BLOCK_TYPES = [...BLOCK_TYPES, ...SCENERY_BLOCK_TYPES] as const;

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
  | "gilded";

export type Rgb = [string, string, string];

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
  collectible: boolean;
  unbreakable: boolean;
  /** Extra colour for ore flecks. */
  fleck?: string;
}
