/**
 * Texture atlas layout, shared by the mesher and the texture builder.
 * Derived from the block vocabulary so a new block gets its own tiles
 * automatically instead of needing a manual atlas size bump.
 */
import { WORLD_BLOCK_TYPES } from "./types";

const TABLE_SIZE = WORLD_BLOCK_TYPES.length + 1;

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
