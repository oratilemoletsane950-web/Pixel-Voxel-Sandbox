/**
 * Single source of truth for every block in the game.
 *
 * SCALE: one block is 0.5 m on each side. The player is 2 m (4 blocks) tall,
 * so a door is 5 blocks high and a room's ceiling is about 6 blocks.
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

export interface BlockInfo {
  name: WorldBlockType;
  label: string;
  short: string;
  /** [side, top, front] colours, used by the 2D fallback and palette swatches. */
  colors: [string, string, string];
  speckle: [string, string, string];
  pattern: TexturePattern;
  /** Blocks movement. Water, flowers and crops can be walked through. */
  solid: boolean;
  /** Hides the faces of neighbours. Water, glass and ice are see-through. */
  opaque: boolean;
  /** Alpha used for see-through blocks. */
  alpha: number;
  collectible: boolean;
  unbreakable: boolean;
  /** Extra colour for ore flecks. */
  fleck?: string;
}

type Spec = Partial<Pick<BlockInfo, "pattern" | "solid" | "opaque" | "alpha" | "unbreakable" | "fleck">>;

function def(
  name: WorldBlockType,
  label: string,
  short: string,
  colors: [string, string, string],
  speckle: [string, string, string],
  spec: Spec = {},
): BlockInfo {
  return {
    name,
    label,
    short,
    colors,
    speckle,
    pattern: spec.pattern ?? "speckle",
    solid: spec.solid ?? true,
    opaque: spec.opaque ?? true,
    alpha: spec.alpha ?? 1,
    collectible: (BLOCK_TYPES as readonly string[]).includes(name),
    unbreakable: spec.unbreakable ?? false,
    fleck: spec.fleck,
  };
}

const STONE_COLORS: [string, string, string] = ["#82877c", "#9b9d8b", "#777c73"];
const STONE_SPECKLE: [string, string, string] = ["#c0bca1", "#626e69", "#9e9f90"];

const BLOCK_LIST: BlockInfo[] = [
  def("grass", "Grass", "GRS", ["#788d53", "#829e5b", "#bc8459"], ["#d3a16c", "#644a3c", "#bc8459"], { pattern: "grass" }),
  def("dirt", "Dirt", "DRT", ["#9b6b48", "#ad7950", "#ad7950"], ["#d3a16c", "#644a3c", "#ad7950"]),
  def("mud", "Mud", "MUD", ["#5d4a3a", "#6b5644", "#4e3d30"], ["#7a634d", "#43332a", "#58463a"]),
  def("path", "Dirt path", "PTH", ["#a98c5e", "#bfa270", "#98794f"], ["#cdb283", "#8c6f48", "#b39665"]),
  def("farmland", "Farmland", "FRM", ["#6e4a30", "#5a3b27", "#5a3b27"], ["#80573a", "#3f2a1c", "#6e4a30"], { pattern: "farmland" }),
  def("sand", "Sand", "SND", ["#d1b870", "#e3cb83", "#c3a965"], ["#f0d993", "#b99d61", "#e2c77e"]),
  def("gravel", "Gravel", "GRV", ["#8a8578", "#b7ad98", "#706d63"], ["#b7ad98", "#706d63", "#8a8578"]),
  def("clay", "Clay", "CLY", ["#a66f65", "#ce9480", "#8c5d59"], ["#ce9480", "#8c5d59", "#a66f65"]),
  def("snow", "Snow", "SNW", ["#aabac2", "#eef0dc", "#869da6"], ["#f0d993", "#b99d61", "#e2c77e"], { pattern: "snow" }),
  def("ice", "Ice", "ICE", ["#8fc3d8", "#b9e0ee", "#7ab0c9"], ["#dff3fa", "#79aec6", "#a8d4e6"], { opaque: false, alpha: 0.78 }),
  def("moss", "Moss", "MOS", ["#5d7b3a", "#6f9444", "#4d6a31"], ["#8db255", "#3f5a28", "#6f9444"]),
  def("stone", "Stone", "STN", STONE_COLORS, STONE_SPECKLE),
  def("granite", "Granite", "GRN", ["#a98577", "#bd9a8b", "#8f6f63"], ["#d8b9a8", "#7f5f55", "#c9a595"]),
  def("limestone", "Limestone", "LMS", ["#cfc6a6", "#ddd4b4", "#b8af90"], ["#efe8cc", "#a89f82", "#d8cfae"]),
  def("sandstone", "Sandstone", "SDS", ["#d4b97a", "#dfc687", "#bfa56a"], ["#e8d49a", "#b59a5f", "#cbb06f"], { pattern: "bands" }),
  def("cobblestone", "Cobble", "CBL", ["#686f6b", "#93968a", "#5a625f"], STONE_SPECKLE, { pattern: "cobble" }),
  def("stone_bricks", "Stone brick", "SBK", ["#868a80", "#9a9d91", "#6f7369"], ["#b1b3a6", "#5f645c", "#8d9186"], { pattern: "bricks" }),
  def("coal_ore", "Coal ore", "COA", STONE_COLORS, STONE_SPECKLE, { pattern: "ore", fleck: "#1c1c20" }),
  def("iron_ore", "Iron ore", "IRN", STONE_COLORS, STONE_SPECKLE, { pattern: "ore", fleck: "#d9a77f" }),
  def("wood", "Oak log", "OAK", ["#956044", "#bd8150", "#80513e"], ["#d3a16c", "#644a3c", "#80513e"], { pattern: "log" }),
  def("birch_wood", "Birch log", "BCH", ["#d9d5c6", "#c9ba90", "#bdb7a4"], ["#2e2a24", "#a8a08a", "#e9e5d6"], { pattern: "log" }),
  def("spruce_wood", "Spruce log", "SPR", ["#5b4330", "#8a6a45", "#4a3526"], ["#3a2a1e", "#7a5a3c", "#6a4e36"], { pattern: "log" }),
  def("leaves", "Oak leaves", "LVF", ["#4c7957", "#6f9b61", "#416b50"], ["#91b66a", "#416c50", "#6d985d"], { pattern: "leaves" }),
  def("birch_leaves", "Birch leaves", "BLV", ["#7fa24f", "#99bb5f", "#6d8f42"], ["#b6d36f", "#587a36", "#8fb057"], { pattern: "leaves" }),
  def("spruce_leaves", "Spruce needles", "SLV", ["#2f5a3f", "#3f7050", "#264b35"], ["#5a8f67", "#1d3d2a", "#3b6a4a"], { pattern: "leaves" }),
  def("cactus", "Cactus", "CAC", ["#3f7d3d", "#5ea04a", "#356b34"], ["#8fcf72", "#2a5a2a", "#4d8f45"], { pattern: "cactus" }),
  def("thatch", "Thatch", "THT", ["#c8a653", "#d9b862", "#a98a41"], ["#e9d28a", "#8f7233", "#c8a653"], { pattern: "thatch" }),
  def("planks", "Planks", "PLK", ["#8d6846", "#c09866", "#70513b"], ["#d0a16d", "#79553b", "#a4774e"], { pattern: "planks" }),
  def("dark_planks", "Dark planks", "DPL", ["#5a3e2a", "#6e4d35", "#4a3322"], ["#8a6444", "#3a281b", "#6e4d35"], { pattern: "planks" }),
  def("brick", "Brick", "BRK", ["#81584c", "#b47d67", "#67473d"], ["#d49c81", "#744b43", "#a66d5b"], { pattern: "bricks" }),
  def("roof", "Roof tile", "ROF", ["#46534d", "#6b7770", "#35433d"], ["#89948a", "#394741", "#66746b"], { pattern: "shingles" }),
  def("glass", "Glass", "GLS", ["#5d9997", "#b8e6d8", "#487a7d"], ["#d2f0df", "#4b8285", "#83bcb3"], { pattern: "glass", opaque: false, alpha: 0.42 }),
  def("door", "Wooden door", "DOR", ["#79553a", "#a4774e", "#634430"], ["#d0a16d", "#79553b", "#a4774e"], { pattern: "door", solid: false }),
  def("chair", "Chair", "CHR", ["#6f4e33", "#8d6846", "#593d28"], ["#d0a16d", "#79553b", "#a4774e"], { pattern: "chair" }),
  def("table", "Table", "TBL", ["#8d6846", "#b58a5c", "#6b4c34"], ["#d0a16d", "#79553b", "#a4774e"], { pattern: "table" }),
  def("marble", "Marble", "MRB", ["#dcd9cf", "#f1efe7", "#c2bfb4"], ["#f7f5ee", "#a3a199", "#d8d5cb"], { pattern: "marble" }),
  def("gold", "Royal gold", "GLD", ["#c99b2e", "#e6c455", "#a87d1f"], ["#f6e08a", "#8f6a17", "#dcb13c"], { pattern: "gilded" }),
  def("flower", "Wild bloom", "FLR", ["#59845b", "#7aa76a", "#507b54"], ["#f4d276", "#d8796e", "#93b56a"], { pattern: "flower", solid: false }),
  def("wheat", "Wheat", "WHT", ["#c9b24a", "#d8c35a", "#b39b3b"], ["#e8d47a", "#a68c2f", "#c9b24a"], { pattern: "wheat", solid: false }),
  def("fern", "Forest fern", "FRN", ["#477d45", "#77a65f", "#3e6c42"], ["#9bc675", "#315d38", "#609449"], { pattern: "fern", solid: false, opaque: false }),
  def("tall_grass", "Meadow grass", "TGR", ["#698448", "#91aa5a", "#526f3c"], ["#c3cb74", "#46633a", "#839b50"], { pattern: "tall_grass", solid: false, opaque: false }),
  def("reed", "Wetland reed", "RED", ["#718144", "#a5a257", "#586d3b"], ["#d1c46b", "#48663b", "#89934e"], { pattern: "reed", solid: false, opaque: false }),
  def("mushroom", "Wild mushroom", "MSH", ["#794f4a", "#ad6861", "#563d45"], ["#edc9a2", "#4e3843", "#d99276"], { pattern: "mushroom", solid: false, opaque: false }),
  def("vine", "Hanging vine", "VIN", ["#476d3d", "#6f9650", "#385a37"], ["#a3b55b", "#365637", "#66914a"], { pattern: "vine", solid: false, opaque: false }),
  def("water", "Water", "WTR", ["#246b78", "#55b5bc", "#195665"], ["#9ad7d1", "#257a88", "#61b7ba"], { pattern: "water", solid: false, opaque: false, alpha: 0.74 }),
  def("bedrock", "Bedrock", "BDR", ["#3f3f43", "#4a4a4f", "#2f2f33"], ["#6b6b72", "#222226", "#55555b"], { pattern: "bedrock", unbreakable: true }),
];

export const BLOCK_INFO = Object.fromEntries(
  BLOCK_LIST.map((info) => [info.name, info]),
) as Record<WorldBlockType, BlockInfo>;

/** Numeric ids (0 is air). Chunks store these in a Uint8Array. */
export const BLOCK_ID = Object.fromEntries(
  WORLD_BLOCK_TYPES.map((name, index) => [name, index + 1]),
) as Record<WorldBlockType, number>;

export const BLOCK_NAME_BY_ID: Array<WorldBlockType | null> = [
  null,
  ...WORLD_BLOCK_TYPES,
];

const TABLE_SIZE = WORLD_BLOCK_TYPES.length + 1;
export const IS_SOLID = new Uint8Array(TABLE_SIZE);
export const IS_OPAQUE = new Uint8Array(TABLE_SIZE);
export const BLOCK_ALPHA = new Float32Array(TABLE_SIZE);
for (const name of WORLD_BLOCK_TYPES) {
  const id = BLOCK_ID[name];
  const info = BLOCK_INFO[name];
  IS_SOLID[id] = info.solid ? 1 : 0;
  IS_OPAQUE[id] = info.opaque ? 1 : 0;
  BLOCK_ALPHA[id] = info.alpha;
}

export const AIR = 0;
export const ID = BLOCK_ID;

export function isWorldBlockType(value: unknown): value is WorldBlockType {
  return typeof value === "string" && value in BLOCK_ID;
}

export function isCollectible(type: WorldBlockType): type is BlockType {
  return BLOCK_INFO[type].collectible;
}

/* ------------------------------------------------------------------ */
/* Texture atlas layout (shared by the mesher and the texture builder) */
/* ------------------------------------------------------------------ */

export const TILE_SIZE = 16;
export const ATLAS_COLUMNS = 16;
export const FACE_SIDE = 0;
export const FACE_TOP = 1;
export const FACE_BOTTOM = 2;
export const TILES_PER_BLOCK = 3;
export const ATLAS_ROWS = Math.ceil((TABLE_SIZE * TILES_PER_BLOCK) / ATLAS_COLUMNS);

export function tileIndex(blockId: number, face: number): number {
  return blockId * TILES_PER_BLOCK + face;
}

/** [u0, v0, u1, v1] for every tile, with a half-texel inset to stop bleeding. */
export const TILE_UVS = (() => {
  const uvs = new Float32Array(TABLE_SIZE * TILES_PER_BLOCK * 4);
  const insetU = 0.4 / (ATLAS_COLUMNS * TILE_SIZE);
  const insetV = 0.4 / (ATLAS_ROWS * TILE_SIZE);
  for (let tile = 0; tile < TABLE_SIZE * TILES_PER_BLOCK; tile += 1) {
    const column = tile % ATLAS_COLUMNS;
    const row = Math.floor(tile / ATLAS_COLUMNS);
    uvs[tile * 4] = column / ATLAS_COLUMNS + insetU;
    uvs[tile * 4 + 1] = 1 - (row + 1) / ATLAS_ROWS + insetV;
    uvs[tile * 4 + 2] = (column + 1) / ATLAS_COLUMNS - insetU;
    uvs[tile * 4 + 3] = 1 - row / ATLAS_ROWS - insetV;
  }
  return uvs;
})();
