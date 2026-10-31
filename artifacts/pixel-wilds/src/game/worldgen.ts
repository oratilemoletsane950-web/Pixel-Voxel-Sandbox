/**
 * Public world-generation API (`./game/worldgen`).
 *
 * Internals live in `./worldgen/*`: geology, ores, wildflowers, vegetation and
 * the ordered pipeline that composes them.
 */
export { generateChunk } from "./worldgen/generate";
export { CHUNK_PIPELINE, chunkStageOrder } from "./worldgen/pipeline";
export { generateGeologicalLayers, geologyStage } from "./worldgen/geology";
export { placeOres, oreStage } from "./worldgen/ores";
export { groundCoverStage } from "./worldgen/groundCover";
export { vegetationStage } from "./worldgen/vegetation";
export { normalizeWorldSeed } from "./worldgen/seed";
export type { ChunkStage, GenerationContext } from "./worldgen/types";
