/**
 * Public vegetation API (`./game/trees`).
 *
 * The implementation now lives in `./vegetation/*` (species registry, stamps,
 * placement). This facade keeps the historical import path stable for the
 * world generator and settlements.
 */
export { leafBlob } from "./vegetation/shapes";
export { placeVegetation } from "./vegetation/place";
export { hasFlower } from "./vegetation/flowers";
export { groundCoverType } from "./vegetation/ground-cover";
export { SPECIES, selectSpecies, speciesRolls } from "./vegetation/species";
export type { SpeciesDefinition, SpeciesHabitat, SpeciesQuery } from "./vegetation/species";
