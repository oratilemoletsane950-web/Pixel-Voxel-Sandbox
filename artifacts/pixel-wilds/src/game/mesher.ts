import { BLOCK_ALPHA, FACE_BOTTOM, FACE_SIDE, FACE_TOP, ID, IS_OPAQUE, TILE_UVS, tileIndex } from "./blocks";
import { CHUNK_SIZE, WORLD_HEIGHT, type Chunk } from "./chunk";

/**
 * Turns one chunk into two triangle meshes. Only faces that can be seen are
 * emitted: a face is skipped when the block next to it is opaque, or when it
 * is the same see-through block (water against water). Opaque geometry and
 * see-through geometry (water, glass, ice) are returned separately so the
 * renderer can draw the second with blending.
 */

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** RGBA, only filled for the see-through mesh. */
  colors: Float32Array | null;
  indices: Uint32Array;
}

export interface ChunkMeshData {
  opaque: MeshArrays | null;
  transparent: MeshArrays | null;
}

export interface ChunkNeighbours {
  px?: Chunk;
  nx?: Chunk;
  pz?: Chunk;
  nz?: Chunk;
}

interface Builder {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[] | null;
  indices: number[];
}

const newBuilder = (withColor: boolean): Builder => ({
  positions: [], normals: [], uvs: [], colors: withColor ? [] : null, indices: [],
});

// Corner order is counter-clockwise seen from outside, so winding faces outward.
const FACES = [
  { dx: 1, dy: 0, dz: 0, kind: FACE_SIDE, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { dx: -1, dy: 0, dz: 0, kind: FACE_SIDE, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { dx: 0, dy: 1, dz: 0, kind: FACE_TOP, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dx: 0, dy: -1, dz: 0, kind: FACE_BOTTOM, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dx: 0, dy: 0, dz: 1, kind: FACE_SIDE, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dx: 0, dy: 0, dz: -1, kind: FACE_SIDE, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
] as const;
const CORNER_UV = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;

function finish(builder: Builder): MeshArrays | null {
  if (builder.indices.length === 0) return null;
  return {
    positions: new Float32Array(builder.positions),
    normals: new Float32Array(builder.normals),
    uvs: new Float32Array(builder.uvs),
    colors: builder.colors ? new Float32Array(builder.colors) : null,
    indices: new Uint32Array(builder.indices),
  };
}

export function buildChunkMesh(chunk: Chunk, neighbours: ChunkNeighbours): ChunkMeshData {
  const { blocks } = chunk;
  const opaque = newBuilder(false);
  const clear = newBuilder(true);
  const maxY = Math.min(WORLD_HEIGHT - 1, chunk.maxY);

  // -1 means "outside the loaded world": hide that face rather than draw a wall at the edge.
  const neighbourId = (lx: number, y: number, lz: number): number => {
    if (y < 0) return -1;
    if (y >= WORLD_HEIGHT) return 0;
    let source: Uint8Array | undefined;
    if (lx < 0) { source = neighbours.nx?.blocks; lx += CHUNK_SIZE; }
    else if (lx >= CHUNK_SIZE) { source = neighbours.px?.blocks; lx -= CHUNK_SIZE; }
    else if (lz < 0) { source = neighbours.nz?.blocks; lz += CHUNK_SIZE; }
    else if (lz >= CHUNK_SIZE) { source = neighbours.pz?.blocks; lz -= CHUNK_SIZE; }
    else source = blocks;
    return source ? source[(lx * CHUNK_SIZE + lz) * WORLD_HEIGHT + y] : -1;
  };

  // Buried blocks can never show a face. For every column (and a one-block border
  // taken from the neighbouring chunks) find the first non-opaque cell going up;
  // anything more than a block below the lowest of a column and its four
  // neighbours is enclosed, so meshing can start higher up. This is what keeps
  // meshing cheap: only the surface layer is ever examined.
  const PAD = CHUNK_SIZE + 2;
  const open = new Int16Array(PAD * PAD).fill(WORLD_HEIGHT);
  const firstOpen = (source: Uint8Array, base: number): number => {
    let y = 0;
    while (y < WORLD_HEIGHT && IS_OPAQUE[source[base + y]] === 1) y += 1;
    return y;
  };
  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      open[(lx + 1) * PAD + lz + 1] = firstOpen(blocks, (lx * CHUNK_SIZE + lz) * WORLD_HEIGHT);
    }
  }
  for (let i = 0; i < CHUNK_SIZE; i += 1) {
    if (neighbours.nx) open[i + 1 + 0] = firstOpen(neighbours.nx.blocks, ((CHUNK_SIZE - 1) * CHUNK_SIZE + i) * WORLD_HEIGHT);
    if (neighbours.px) open[(CHUNK_SIZE + 1) * PAD + i + 1] = firstOpen(neighbours.px.blocks, (0 * CHUNK_SIZE + i) * WORLD_HEIGHT);
    if (neighbours.nz) open[(i + 1) * PAD] = firstOpen(neighbours.nz.blocks, (i * CHUNK_SIZE + CHUNK_SIZE - 1) * WORLD_HEIGHT);
    if (neighbours.pz) open[(i + 1) * PAD + CHUNK_SIZE + 1] = firstOpen(neighbours.pz.blocks, (i * CHUNK_SIZE) * WORLD_HEIGHT);
  }

  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      const base = (lx * CHUNK_SIZE + lz) * WORLD_HEIGHT;
      const at = (lx + 1) * PAD + lz + 1;
      const startY = Math.max(
        0,
        Math.min(open[at] - 1, open[at - PAD], open[at + PAD], open[at - 1], open[at + 1]),
      );
      for (let y = startY; y <= maxY; y += 1) {
        const id = blocks[base + y];
        if (id === 0) continue;
        const solid = IS_OPAQUE[id] === 1;
        const target = solid ? opaque : clear;
        // Open-water surfaces sit a little below the block top, like a real waterline.
        const loweredTop = id === ID.water && neighbourId(lx, y + 1, lz) !== ID.water;

        for (let f = 0; f < 6; f += 1) {
          const face = FACES[f];
          const other = neighbourId(lx + face.dx, y + face.dy, lz + face.dz);
          if (other === -1 || IS_OPAQUE[other] === 1) continue;
          if (other === id && !solid) continue;

          const tile = tileIndex(id, face.kind) * 4;
          const u0 = TILE_UVS[tile];
          const v0 = TILE_UVS[tile + 1];
          const u1 = TILE_UVS[tile + 2];
          const v1 = TILE_UVS[tile + 3];
          const start = target.positions.length / 3;
          for (let c = 0; c < 4; c += 1) {
            const corner = face.corners[c];
            const cy = corner[1] === 1 && loweredTop ? 0.88 : corner[1];
            target.positions.push(lx + corner[0], y + cy, lz + corner[2]);
            target.normals.push(face.dx, face.dy, face.dz);
            target.uvs.push(CORNER_UV[c][0] ? u1 : u0, CORNER_UV[c][1] ? v1 : v0);
            if (target.colors) target.colors.push(1, 1, 1, BLOCK_ALPHA[id]);
          }
          target.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
        }
      }
    }
  }
  return { opaque: finish(opaque), transparent: finish(clear) };
}
