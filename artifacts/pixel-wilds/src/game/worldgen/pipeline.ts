/**
 * The chunk generation pipeline.
 *
 * Registration order (by `order`) is the world's generation order:
 * geology -> ores -> ground cover -> vegetation.
 *
 * To add a pass (caves, structures, carvings, settlements), write a stage next
 * to this file and register it below. No other module needs to change, and a
 * stage can be disabled without deleting it — `enabled: false`.
 *
 * Example: settlement generation is currently disabled by requirement. Its
 * stamper already conforms to this shape:
 *   register({ id: "settlements", order: 50, run: ({ writer, terrain, seed }) => stampSettlements(writer, terrain, seed) })
 */
import { Pipeline } from "../core/pipeline";
import { geologyStage } from "./geology";
import { groundCoverStage } from "./groundCover";
import { oreStage } from "./ores";
import { vegetationStage } from "./vegetation";
import type { GenerationContext } from "./types";

export const CHUNK_PIPELINE = new Pipeline<GenerationContext>("chunk generation");

CHUNK_PIPELINE.register(geologyStage)
  .register(oreStage)
  .register(groundCoverStage)
  .register(vegetationStage);

/** The stage ids in execution order. Useful for docs, diagnostics and tests. */
export function chunkStageOrder(): string[] {
  return CHUNK_PIPELINE.list().map((stage) => stage.id);
}
