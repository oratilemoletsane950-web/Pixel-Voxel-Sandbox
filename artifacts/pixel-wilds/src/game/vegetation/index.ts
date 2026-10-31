/**
 * Vegetation module boundary.
 *
 * `species` — what grows where (registry, priorities, sculpting choice)
 * `stamps`  — how each plant form is sculpted
 * `shapes`  — primitives shared by stamps
 * `place`   — the jittered grid that calls a species' stamp
 * `flowers` — wildflower scatter rule
 */
export {
  SPECIES,
  selectSpecies,
  speciesRolls,
  type SpeciesDefinition,
  type SpeciesHabitat,
  type SpeciesQuery,
} from "./species";
export { placeVegetation } from "./place";
export { hasFlower } from "./flowers";
export { groundCoverType } from "./ground-cover";
export { leafBlob, foliageDisc } from "./shapes";
