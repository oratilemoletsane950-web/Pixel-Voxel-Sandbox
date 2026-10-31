/**
 * The chunk generation pipeline.
 *
 * Registration order (by `order`) is the world's generation order:
 * geology -> ores -> caves -> ground cover -> vegetation.
 *
 * To add a pass (caves, structures, carvings, settlements), write a stage next
 * to this file and register it below. No other module needs to change, and a
 * stage can be disabled without deleting it — `enabled: false`.
 *
 * Example: settlement generation is currently disabled by requirement. Its
 * stamper already conforms to this shape:
 *   register({ id: "settlements", order: 50, run: ({ writer, terrain, seed }) => stampSettlements(writer, terrain, seed) })
 *
 * Caves are registered after ores and before surface decoration, so they can
 * remove rock without disturbing the roof that vegetation and spawns rely on.
 */
import { Pipeline } from "../core/pipeline";
import { stampSettlements } from "../settlements";
import { caveStage } from "./caves";
import { geologyStage } from "./geology";
import { groundCoverStage } from "./groundCover";
import { oreStage } from "./ores";
import { vegetationStage } from "./vegetation";
import type { GenerationContext } from "./types";

export const CHUNK_PIPELINE = new Pipeline<GenerationContext>("chunk generation");

/** Structures are profile-gated; the stage remains registered for every world. */
export const settlementStage = Object.freeze({
  id: "settlements",
  order: 50,
  run: ({ writer, terrain, seed, structures }: GenerationContext) => {
    if (structures) stampSettlements(writer, terrain, seed);
  },
});

CHUNK_PIPELINE.register(geologyStage)
  .register(oreStage)
  .register(caveStage)
  .register(groundCoverStage)
  .register(vegetationStage)
  .register(settlementStage);

/** The stage ids in execution order. Useful for docs, diagnostics and tests. */
export function chunkStageOrder(): string[] {
  return CHUNK_PIPELINE.list().map((stage) => stage.id);
}
