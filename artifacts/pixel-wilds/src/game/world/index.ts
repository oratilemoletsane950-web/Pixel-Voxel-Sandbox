/**
 * Public world API.
 *
 * Submodules:
 *   types             — data shapes, coordinates, player constants
 *   terrain-registry  — cached Terrain instances per seed
 *   access            — block reads, edits and visibility queries
 *   streaming         — chunk generation/streaming and edit replay
 *   spawn             — safe spawn selection
 *   persistence       — save/load with an injectable storage backend
 *   clock             — world time, daylight palettes and clock persistence
 *   save-slots        — one ordered table of all per-world save files
 *   archive           — validated portable export/import of a whole world
 *   settlements       — settlement query boundary (currently disabled)
 */
export * from "./types";
export * from "./profile";
export * from "./terrain-registry";
export * from "./access";
export * from "./streaming";
export * from "./spawn";
export * from "./persistence";
export * from "./clock";
export * from "./save-slots";
export * from "./archive";

/* Re-exported so `./game/world` remains the one-stop import it always was. */
export { BLOCK_TYPES, WORLD_BLOCK_TYPES, type BlockType, type WorldBlockType } from "../blocks/types";
export { CHUNK_SIZE, MAX_BUILD_HEIGHT } from "../chunk";
