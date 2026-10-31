import { ChunkWriter, createChunk, recountChunk, type Chunk } from "../chunk";
import type { Terrain } from "../terrain";
import { CHUNK_PIPELINE } from "./pipeline";

/**
 * Generates one chunk by running the registered pipeline.
 *
 * This function used to live in `world.ts` and name every pass explicitly,
 * which is why the world module also owned ore placement and flower scatter.
 * It now only chooses the stage set; the order lives in the pipeline.
 */
export interface GenerateChunkOptions {
  structures?: boolean;
}

export function generateChunk(
  terrain: Terrain,
  cx: number,
  cz: number,
  options: GenerateChunkOptions = {},
): Chunk {
  const chunk = createChunk(cx, cz);
  CHUNK_PIPELINE.run({
    seed: terrain.seed,
    terrain,
    writer: new ChunkWriter(chunk),
    structures: options.structures === true,
  });
  recountChunk(chunk);
  return chunk;
}
