/**
 * Vegetation and surface-geology pass.
 *
 * Wraps the vegetation module so the generator only sees a stage. Swapping in
 * a different scattering system means registering a different stage here.
 */
import { placeVegetation } from "../vegetation/place";
import type { ChunkStage, GenerationContext } from "./types";

export const vegetationStage: ChunkStage = Object.freeze({
  id: "vegetation",
  order: 40,
  run: ({ writer, terrain, seed }: GenerationContext) => placeVegetation(writer, terrain, seed),
});
