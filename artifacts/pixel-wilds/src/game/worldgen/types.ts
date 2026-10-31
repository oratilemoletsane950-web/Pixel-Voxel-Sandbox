import type { ChunkWriter } from "../chunk";
import type { Stage } from "../core/pipeline";
import type { Terrain } from "../terrain";

/** Everything a generation stage may read or write. */
export interface GenerationContext {
  readonly seed: number;
  readonly terrain: Terrain;
  readonly writer: ChunkWriter;
  /** Settlement and other profile-gated passes read this rather than a global. */
  readonly structures?: boolean;
}

/** One ordered pass over a chunk. */
export type ChunkStage = Stage<GenerationContext>;
