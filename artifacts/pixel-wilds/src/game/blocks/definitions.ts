/**
 * The block catalogue.
 *
 * One entry per block, grouped into families created with the prototype
 * pattern. A family carries shared behaviour (solidity, opacity, alpha,
 * breakability); each block clones its family and adds its identity and
 * colours. Adding a block is now a single line plus its name in
 * `BLOCK_TYPES` — there is no second table to keep in sync, and
 * `blocks/registry.ts` fails at startup if the two disagree.
 */
import { prototype, type Prototype } from "../core/prototype";
import type { Rgb, TexturePattern, ToolKind, WorldBlockType } from "./types";

export interface BlockTraits {
  pattern: TexturePattern;
  solid: boolean;
  opaque: boolean;
  alpha: number;
  /** Seconds of hand mining; a matching tool scales this. */
  hardness: number;
  /** Tool family that mines this block efficiently. */
  tool?: ToolKind;
  /** Minimum tool tier needed to harvest the block; 0 allows bare hands. */
  harvestTier: number;
  unbreakable: boolean;
  fleck?: string;
}

export interface BlockIdentity {
  name: WorldBlockType;
  label: string;
  short: string;
  colors: Rgb;
  speckle: Rgb;
}

export type BlockDefinition = BlockIdentity & BlockTraits;

const SOLID: Prototype<BlockTraits> = prototype<BlockTraits>({
  pattern: "speckle",
  solid: true,
  opaque: true,
  alpha: 1,
  hardness: 1.1,
  harvestTier: 0,
  unbreakable: false,
});

/** Stone and dressed masonry: slow by hand, quick with a pickaxe. */
const ROCK = SOLID.extend({ tool: "pickaxe" });
/** Logs, boards and furniture: axe work. */
const TIMBER = SOLID.extend({ tool: "axe" });
/** Soil, sediment and snow: shovel work. */
const SOIL = SOLID.extend({ tool: "shovel" });

/** Walk-through decoration: flowers, crops, doors. */
const PLANT: Prototype<BlockTraits> = SOLID.extend({ solid: false, hardness: 0.18 });

/** Blocks you can see through: water, glass, ice. */
const SEE_THROUGH: Prototype<BlockTraits> = SOLID.extend({ opaque: false, hardness: 0.45 });

/** Walk-through and see-through: water. */
const FLUID: Prototype<BlockTraits> = SOLID.extend({ solid: false, opaque: false, hardness: 0.05 });

/** Breakable transparent rock such as ice. */
const CRYSTAL = SEE_THROUGH.extend({ tool: "pickaxe" });
/** A walk-through timber piece such as a door. */
const TIMBER_PLANT = PLANT.extend({ tool: "axe" });

export function defineBlock(
  family: Prototype<BlockTraits>,
  identity: BlockIdentity & Partial<BlockTraits>,
): BlockDefinition {
  return family.extend(identity) as unknown as BlockDefinition;
}

const STONE_COLORS: Rgb = ["#82877c", "#9b9d8b", "#777c73"];
const STONE_SPECKLE: Rgb = ["#c0bca1", "#626e69", "#9e9f90"];
const GRAINED: Rgb = ["#d0a16d", "#79553b", "#a4774e"];

const CATALOGUE: BlockDefinition[] = [
  // Ground & sediment
  defineBlock(SOIL, { name: "grass", label: "Grass", short: "GRS", colors: ["#788d53", "#829e5b", "#bc8459"], speckle: ["#d3a16c", "#644a3c", "#bc8459"], pattern: "grass" }),
  defineBlock(SOIL, { name: "dirt", label: "Dirt", short: "DRT", colors: ["#9b6b48", "#ad7950", "#ad7950"], speckle: ["#d3a16c", "#644a3c", "#ad7950"] }),
  defineBlock(SOIL, { name: "mud", label: "Mud", short: "MUD", colors: ["#5d4a3a", "#6b5644", "#4e3d30"], speckle: ["#7a634d", "#43332a", "#58463a"] }),
  defineBlock(SOIL, { name: "path", label: "Dirt path", short: "PTH", colors: ["#a98c5e", "#bfa270", "#98794f"], speckle: ["#cdb283", "#8c6f48", "#b39665"] }),
  defineBlock(SOIL, { name: "farmland", label: "Farmland", short: "FRM", colors: ["#6e4a30", "#5a3b27", "#5a3b27"], speckle: ["#80573a", "#3f2a1c", "#6e4a30"], pattern: "farmland" }),
  defineBlock(SOIL, { name: "sand", label: "Sand", short: "SND", colors: ["#d1b870", "#e3cb83", "#c3a965"], speckle: ["#f0d993", "#b99d61", "#e2c77e"] }),
  defineBlock(SOIL, { name: "gravel", label: "Gravel", short: "GRV", colors: ["#8a8578", "#b7ad98", "#706d63"], speckle: ["#b7ad98", "#706d63", "#8a8578"] }),
  defineBlock(SOIL, { name: "clay", label: "Clay", short: "CLY", colors: ["#a66f65", "#ce9480", "#8c5d59"], speckle: ["#ce9480", "#8c5d59", "#a66f65"] }),
  defineBlock(SOIL, { name: "snow", label: "Snow", short: "SNW", colors: ["#aabac2", "#eef0dc", "#869da6"], speckle: ["#f0d993", "#b99d61", "#e2c77e"], pattern: "snow" }),
  defineBlock(CRYSTAL, { name: "ice", label: "Ice", short: "ICE", colors: ["#8fc3d8", "#b9e0ee", "#7ab0c9"], speckle: ["#dff3fa", "#79aec6", "#a8d4e6"], alpha: 0.78 }),
  defineBlock(SOIL, { name: "moss", label: "Moss", short: "MOS", colors: ["#5d7b3a", "#6f9444", "#4d6a31"], speckle: ["#8db255", "#3f5a28", "#6f9444"] }),

  // Rock
  defineBlock(ROCK, { name: "stone", hardness: 3.4, label: "Stone", short: "STN", colors: STONE_COLORS, speckle: STONE_SPECKLE }),
  defineBlock(ROCK, { name: "granite", hardness: 3.6, label: "Granite", short: "GRN", colors: ["#a98577", "#bd9a8b", "#8f6f63"], speckle: ["#d8b9a8", "#7f5f55", "#c9a595"] }),
  defineBlock(ROCK, { name: "limestone", hardness: 3.0, label: "Limestone", short: "LMS", colors: ["#cfc6a6", "#ddd4b4", "#b8af90"], speckle: ["#efe8cc", "#a89f82", "#d8cfae"] }),
  defineBlock(ROCK, { name: "sandstone", hardness: 2.8, label: "Sandstone", short: "SDS", colors: ["#d4b97a", "#dfc687", "#bfa56a"], speckle: ["#e8d49a", "#b59a5f", "#cbb06f"], pattern: "bands" }),
  defineBlock(ROCK, { name: "cobblestone", hardness: 3.2, label: "Cobble", short: "CBL", colors: ["#686f6b", "#93968a", "#5a625f"], speckle: STONE_SPECKLE, pattern: "cobble" }),
  defineBlock(ROCK, { name: "stone_bricks", hardness: 3.2, label: "Stone brick", short: "SBK", colors: ["#868a80", "#9a9d91", "#6f7369"], speckle: ["#b1b3a6", "#5f645c", "#8d9186"], pattern: "bricks" }),
  defineBlock(ROCK, { name: "coal_ore", hardness: 4.0, harvestTier: 1, label: "Coal ore", short: "COA", colors: STONE_COLORS, speckle: STONE_SPECKLE, pattern: "ore", fleck: "#1c1c20" }),
  defineBlock(ROCK, { name: "iron_ore", hardness: 4.5, harvestTier: 2, label: "Iron ore", short: "IRN", colors: STONE_COLORS, speckle: STONE_SPECKLE, pattern: "ore", fleck: "#d9a77f" }),

  // Wood & plants
  defineBlock(TIMBER, { name: "wood", hardness: 2.2, label: "Oak log", short: "OAK", colors: ["#956044", "#bd8150", "#80513e"], speckle: ["#d3a16c", "#644a3c", "#80513e"], pattern: "log" }),
  defineBlock(TIMBER, { name: "birch_wood", hardness: 2.0, label: "Birch log", short: "BCH", colors: ["#d9d5c6", "#c9ba90", "#bdb7a4"], speckle: ["#2e2a24", "#a8a08a", "#e9e5d6"], pattern: "log" }),
  defineBlock(TIMBER, { name: "spruce_wood", hardness: 2.2, label: "Spruce log", short: "SPR", colors: ["#5b4330", "#8a6a45", "#4a3526"], speckle: ["#3a2a1e", "#7a5a3c", "#6a4e36"], pattern: "log" }),
  defineBlock(TIMBER, { name: "leaves", label: "Oak leaves", short: "LVF", colors: ["#4c7957", "#6f9b61", "#416b50"], speckle: ["#91b66a", "#416c50", "#6d985d"], pattern: "leaves" }),
  defineBlock(TIMBER, { name: "birch_leaves", label: "Birch leaves", short: "BLV", colors: ["#7fa24f", "#99bb5f", "#6d8f42"], speckle: ["#b6d36f", "#587a36", "#8fb057"], pattern: "leaves" }),
  defineBlock(TIMBER, { name: "spruce_leaves", label: "Spruce needles", short: "SLV", colors: ["#2f5a3f", "#3f7050", "#264b35"], speckle: ["#5a8f67", "#1d3d2a", "#3b6a4a"], pattern: "leaves" }),
  defineBlock(TIMBER, { name: "cactus", hardness: 0.45, label: "Cactus", short: "CAC", colors: ["#3f7d3d", "#5ea04a", "#356b34"], speckle: ["#8fcf72", "#2a5a2a", "#4d8f45"], pattern: "cactus" }),
  defineBlock(TIMBER, { name: "thatch", hardness: 0.5, label: "Thatch", short: "THT", colors: ["#c8a653", "#d9b862", "#a98a41"], speckle: ["#e9d28a", "#8f7233", "#c8a653"], pattern: "thatch" }),

  // Crafted
  defineBlock(TIMBER, { name: "planks", hardness: 2.0, label: "Planks", short: "PLK", colors: ["#8d6846", "#c09866", "#70513b"], speckle: GRAINED, pattern: "planks" }),
  defineBlock(TIMBER, { name: "dark_planks", hardness: 2.0, label: "Dark planks", short: "DPL", colors: ["#5a3e2a", "#6e4d35", "#4a3322"], speckle: ["#8a6444", "#3a281b", "#6e4d35"], pattern: "planks" }),
  defineBlock(ROCK, { name: "brick", hardness: 3.0, label: "Brick", short: "BRK", colors: ["#81584c", "#b47d67", "#67473d"], speckle: ["#d49c81", "#744b43", "#a66d5b"], pattern: "bricks" }),
  defineBlock(ROCK, { name: "roof", hardness: 3.0, label: "Roof tile", short: "ROF", colors: ["#46534d", "#6b7770", "#35433d"], speckle: ["#89948a", "#394741", "#66746b"], pattern: "shingles" }),
  defineBlock(CRYSTAL, { name: "glass", label: "Glass", short: "GLS", colors: ["#5d9997", "#b8e6d8", "#487a7d"], speckle: ["#d2f0df", "#4b8285", "#83bcb3"], pattern: "glass", alpha: 0.42 }),
  defineBlock(TIMBER_PLANT, { name: "door", hardness: 0.8, label: "Wooden door", short: "DOR", colors: ["#79553a", "#a4774e", "#634430"], speckle: GRAINED, pattern: "door" }),
  defineBlock(TIMBER, { name: "chair", hardness: 1.4, label: "Chair", short: "CHR", colors: ["#6f4e33", "#8d6846", "#593d28"], speckle: GRAINED, pattern: "chair" }),
  defineBlock(TIMBER, { name: "table", hardness: 1.6, label: "Table", short: "TBL", colors: ["#8d6846", "#b58a5c", "#6b4c34"], speckle: GRAINED, pattern: "table" }),
  defineBlock(ROCK, { name: "marble", hardness: 3.2, label: "Marble", short: "MRB", colors: ["#dcd9cf", "#f1efe7", "#c2bfb4"], speckle: ["#f7f5ee", "#a3a199", "#d8d5cb"], pattern: "marble" }),
  defineBlock(ROCK, { name: "gold", hardness: 3.5, label: "Royal gold", short: "GLD", colors: ["#c99b2e", "#e6c455", "#a87d1f"], speckle: ["#f6e08a", "#8f6a17", "#dcb13c"], pattern: "gilded" }),

  // Scenery
  defineBlock(PLANT, { name: "flower", label: "Wild bloom", short: "FLR", colors: ["#59845b", "#7aa76a", "#507b54"], speckle: ["#f4d276", "#d8796e", "#93b56a"], pattern: "flower" }),
  defineBlock(PLANT, { name: "wheat", label: "Wheat", short: "WHT", colors: ["#c9b24a", "#d8c35a", "#b39b3b"], speckle: ["#e8d47a", "#a68c2f", "#c9b24a"], pattern: "wheat" }),
  defineBlock(PLANT, { name: "fern", label: "Forest fern", short: "FRN", colors: ["#477d45", "#77a65f", "#3e6c42"], speckle: ["#9bc675", "#315d38", "#609449"], pattern: "fern", opaque: false }),
  defineBlock(PLANT, { name: "tall_grass", label: "Meadow grass", short: "TGR", colors: ["#698448", "#91aa5a", "#526f3c"], speckle: ["#c3cb74", "#46633a", "#839b50"], pattern: "tall_grass", opaque: false }),
  defineBlock(PLANT, { name: "reed", label: "Wetland reed", short: "RED", colors: ["#718144", "#a5a257", "#586d3b"], speckle: ["#d1c46b", "#48663b", "#89934e"], pattern: "reed", opaque: false }),
  defineBlock(PLANT, { name: "mushroom", label: "Wild mushroom", short: "MSH", colors: ["#794f4a", "#ad6861", "#563d45"], speckle: ["#edc9a2", "#4e3843", "#d99276"], pattern: "mushroom", opaque: false }),
  defineBlock(PLANT, { name: "vine", label: "Hanging vine", short: "VIN", colors: ["#476d3d", "#6f9650", "#385a37"], speckle: ["#a3b55b", "#365637", "#66914a"], pattern: "vine", opaque: false }),
  defineBlock(FLUID, { name: "water", label: "Water", short: "WTR", colors: ["#246b78", "#55b5bc", "#195665"], speckle: ["#9ad7d1", "#257a88", "#61b7ba"], pattern: "water", alpha: 0.74 }),
  defineBlock(SOLID, { name: "bedrock", label: "Bedrock", short: "BDR", colors: ["#3f3f43", "#4a4a4f", "#2f2f33"], speckle: ["#6b6b72", "#222226", "#55555b"], pattern: "bedrock", unbreakable: true }),
];

export const BLOCK_DEFINITIONS: readonly BlockDefinition[] = Object.freeze(CATALOGUE);
