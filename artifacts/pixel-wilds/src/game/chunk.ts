/**
 * Chunk storage.
 *
 * A chunk is a 16 x 16 column of blocks, 192 blocks tall (96 m), stored as a
 * flat Uint8Array of block ids. Layout is column-major so that a terrain
 * column is contiguous in memory: index = (lx * 16 + lz) * WORLD_HEIGHT + y.
 */

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 192;
export const MAX_BUILD_HEIGHT = WORLD_HEIGHT - 1;
/** Sea level in blocks: y = 36 is 18 m above the bottom of the world. */
export const SEA_LEVEL = 36;

export interface Chunk {
  cx: number;
  cz: number;
  blocks: Uint8Array;
  /** Bumped on every change so meshes know when to rebuild. */
  version: number;
  /** Highest y that contains a block, so meshing can skip empty sky. */
  maxY: number;
  solidCount: number;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function chunkIndex(lx: number, y: number, lz: number): number {
  return (lx * CHUNK_SIZE + lz) * WORLD_HEIGHT + y;
}

export function createChunk(cx: number, cz: number): Chunk {
  return {
    cx,
    cz,
    blocks: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT),
    version: 0,
    maxY: 0,
    solidCount: 0,
  };
}

export function recountChunk(chunk: Chunk): void {
  const { blocks } = chunk;
  let maxY = 0;
  let count = 0;
  for (let column = 0; column < CHUNK_SIZE * CHUNK_SIZE; column += 1) {
    const base = column * WORLD_HEIGHT;
    for (let y = WORLD_HEIGHT - 1; y >= 0; y -= 1) {
      if (blocks[base + y] !== 0) {
        if (y > maxY) maxY = y;
        break;
      }
    }
    for (let y = 0; y < WORLD_HEIGHT; y += 1) if (blocks[base + y] !== 0) count += 1;
  }
  chunk.maxY = maxY;
  chunk.solidCount = count;
}

/**
 * Writes blocks into a chunk using world coordinates. Anything that falls
 * outside the chunk is ignored, which is what lets trees and buildings that
 * straddle a border be generated independently by each neighbouring chunk.
 */
export class ChunkWriter {
  readonly startX: number;
  readonly startZ: number;
  readonly blocks: Uint8Array;

  constructor(readonly chunk: Chunk) {
    this.startX = chunk.cx * CHUNK_SIZE;
    this.startZ = chunk.cz * CHUNK_SIZE;
    this.blocks = chunk.blocks;
  }

  inside(x: number, z: number): boolean {
    const lx = x - this.startX;
    const lz = z - this.startZ;
    return lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE;
  }

  /** True if the column footprint [x0..x1] x [z0..z1] touches this chunk. */
  overlaps(x0: number, z0: number, x1: number, z1: number): boolean {
    return (
      x1 >= this.startX && x0 < this.startX + CHUNK_SIZE &&
      z1 >= this.startZ && z0 < this.startZ + CHUNK_SIZE
    );
  }

  get(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT || !this.inside(x, z)) return 0;
    return this.blocks[chunkIndex(x - this.startX, y, z - this.startZ)];
  }

  set(x: number, y: number, z: number, id: number): void {
    if (y < 0 || y >= WORLD_HEIGHT || !this.inside(x, z)) return;
    this.blocks[chunkIndex(x - this.startX, y, z - this.startZ)] = id;
  }

  /** Only writes into empty space, so foliage never overwrites trunks or terrain. */
  setIfAir(x: number, y: number, z: number, id: number): void {
    if (y < 0 || y >= WORLD_HEIGHT || !this.inside(x, z)) return;
    const index = chunkIndex(x - this.startX, y, z - this.startZ);
    if (this.blocks[index] === 0) this.blocks[index] = id;
  }

  fillBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void {
    const minX = Math.max(x0, this.startX);
    const maxX = Math.min(x1, this.startX + CHUNK_SIZE - 1);
    const minZ = Math.max(z0, this.startZ);
    const maxZ = Math.min(z1, this.startZ + CHUNK_SIZE - 1);
    const minY = Math.max(y0, 0);
    const maxY = Math.min(y1, WORLD_HEIGHT - 1);
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const base = chunkIndex(x - this.startX, 0, z - this.startZ);
        for (let y = minY; y <= maxY; y += 1) this.blocks[base + y] = id;
      }
    }
  }
}
