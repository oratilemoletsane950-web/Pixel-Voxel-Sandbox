/**
 * Public terrain API (`./game/terrain`).
 *
 * Implementation lives in `./terrain/*`:
 *   height   — elevation and river hydrology
 *   climate  — temperature and moisture
 *   surface  — ordered biome rules and the surface classifier
 *   terrain  — cached facade used by chunk generation
 */
export { Terrain } from "./terrain/terrain";
export { HeightModel } from "./terrain/height";
export { climateAt, type Climate } from "./terrain/climate";
export {
  SurfaceClassifier,
  SURFACE_CLASSIFIER,
  buildSurfaceFacts,
  type SurfaceFacts,
  type SurfaceRule,
} from "./terrain/surface";
export type {
  Biome,
  Column,
  EnvironmentalData,
  HeightRecord,
} from "./terrain/types";
