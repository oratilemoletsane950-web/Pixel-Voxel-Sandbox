/**
 * Derives the runtime block tables from the catalogue and validates them.
 *
 * Chunk storage encodes blocks as ids, so `BLOCK_TYPES` order is a save format.
 * The old code kept a second, independently ordered list of block info; if the
 * two drifted, ids silently pointed at the wrong block. Here the id order is
 * the only order, every entry must exist exactly once, and a mismatch throws
 * at import time instead of corrupting a save.
 */
import { BLOCK_DEFINITIONS, type BlockDefinition } from "./definitions";
import {
  BLOCK_TYPES,
  WORLD_BLOCK_TYPES,
  type BlockInfo,
  type BlockType,
  type WorldBlockType,
} from "./types";

export interface BlockTables {
  readonly definitions: Readonly<Record<WorldBlockType, BlockDefinition>>;
  readonly info: Readonly<Record<WorldBlockType, BlockInfo>>;
  readonly id: Readonly<Record<WorldBlockType, number>>;
  readonly nameById: ReadonlyArray<WorldBlockType | null>;
  readonly solid: Uint8Array;
  readonly opaque: Uint8Array;
  readonly alpha: Float32Array;
}

export function buildBlockTables(
  catalogue: readonly BlockDefinition[],
  order: readonly WorldBlockType[],
  collectible: readonly BlockType[],
): BlockTables {
  const byName = new Map<string, BlockDefinition>();
  for (const definition of catalogue) {
    if (byName.has(definition.name)) {
      throw new Error(`Block catalogue: duplicate entry "${definition.name}"`);
    }
    byName.set(definition.name, definition);
  }

  const missing = order.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Block catalogue: no definition for ${missing.join(", ")}. Add it to blocks/definitions.ts.`,
    );
  }
  const unknown = [...byName.keys()].filter((name) => !(order as readonly string[]).includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `Block catalogue: ${unknown.join(", ")} has no id slot. Add it to BLOCK_TYPES in blocks/types.ts.`,
    );
  }

  const collectibleSet = new Set<string>(collectible);
  const definitions = {} as Record<WorldBlockType, BlockDefinition>;
  const info = {} as Record<WorldBlockType, BlockInfo>;
  const id = {} as Record<WorldBlockType, number>;
  const nameById: Array<WorldBlockType | null> = [null];
  const solid = new Uint8Array(order.length + 1);
  const opaque = new Uint8Array(order.length + 1);
  const alpha = new Float32Array(order.length + 1);

  order.forEach((name, index) => {
    const definition = byName.get(name) as BlockDefinition;
    const numericId = index + 1;
    const blockInfo: BlockInfo = {
      name,
      label: definition.label,
      short: definition.short,
      colors: definition.colors,
      speckle: definition.speckle,
      pattern: definition.pattern,
      solid: definition.solid,
      opaque: definition.opaque,
      alpha: definition.alpha,
      hardness: definition.hardness,
      collectible: collectibleSet.has(name),
      unbreakable: definition.unbreakable,
      fleck: definition.fleck,
    };
    definitions[name] = definition;
    info[name] = Object.freeze(blockInfo);
    id[name] = numericId;
    nameById.push(name);
    solid[numericId] = definition.solid ? 1 : 0;
    opaque[numericId] = definition.opaque ? 1 : 0;
    alpha[numericId] = definition.alpha;
  });

  return Object.freeze({
    definitions: Object.freeze(definitions),
    info: Object.freeze(info),
    id: Object.freeze(id),
    nameById: Object.freeze(nameById),
    solid,
    opaque,
    alpha,
  });
}

export const BLOCKS: BlockTables = buildBlockTables(BLOCK_DEFINITIONS, WORLD_BLOCK_TYPES, BLOCK_TYPES);

/* ------------------------------------------------------------------ */
/* Stable public constants (kept so existing consumers are unaffected)  */
/* ------------------------------------------------------------------ */

export const BLOCK_INFO = BLOCKS.info;
/** Numeric ids (0 is air). Chunks store these in a Uint8Array. */
export const BLOCK_ID = BLOCKS.id;
export const BLOCK_NAME_BY_ID = BLOCKS.nameById as Array<WorldBlockType | null>;
export const IS_SOLID = BLOCKS.solid;
export const IS_OPAQUE = BLOCKS.opaque;
export const BLOCK_ALPHA = BLOCKS.alpha;

export const AIR = 0;
export const ID = BLOCK_ID;

export function isWorldBlockType(value: unknown): value is WorldBlockType {
  return typeof value === "string" && value in BLOCK_ID;
}

export function isCollectible(type: WorldBlockType): type is BlockType {
  return BLOCK_INFO[type].collectible;
}
