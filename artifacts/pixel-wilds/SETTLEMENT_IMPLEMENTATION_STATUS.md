# Procedural Settlement System — Implementation Status

Branch: `feature/detailed-town-fortifications`

## What has been implemented in this tranche

### Streaming and validation foundation added
- Added `src/game/hierarchy-streaming.ts` with a bounded four-plan LRU cache keyed by seed and origin.
- Added a lazily built 256-block spatial bucket index so bounds queries inspect nearby candidates instead of scanning every node in the full hierarchy for each query.
- Hardened bounds queries to reject non-finite values, inverted ranges and negative margins; results are sorted deterministically so chunk consumers do not depend on bucket traversal order.
- Strengthened `validateHierarchyPlan()` to detect duplicate IDs, invalid parent/child links, incorrect parent tiers, missing town features, missing castle wards, non-finite coordinates and parent cycles.
- Live vertical slice added: the chunk settlement stamper queries nearby hierarchy nodes and converts `house` nodes into actual block-stamped residential buildings using the existing building stamper. The placement pass rejects wet, river-adjacent, steep and out-of-range sites. House coordinates now use compact deterministic grids within each village rather than overlapping random points.
- Town civic-centre slice added: hierarchy `town` nodes stamp a two-storey stone town hall, paved plaza and four open defensive gates. The follow-up fortification pass upgrades the hierarchy town boundary to a stone curtain wall with crenellated corner towers, paired gate towers and elevated lintels while preserving walk-through entrances. Town placement checks water, river clearance, slope and vertical bounds.
- City-level structures added: hierarchy `city` nodes stamp a three-storey civic hall and plaza; roads connect city centres to their child towns, and town centres to their child villages. Roads are chunk-clipped and sampled against water/river terrain.
- Castle ward slice added: the hierarchy capital castle is offset from the kingdom centre and stamps three concentric gated stone enclosures plus a four-storey keep.
- Legacy overlap mitigation added: non-kingdom legacy settlements are skipped when their footprint intersects hierarchy-owned town, village, city, castle or house sites; the starting legacy kingdom is preserved.
- Still incomplete: this is conflict filtering rather than a universal footprint reservation solver. Some hierarchy structures can still be skipped on invalid terrain, town walls are a simple square palisade rather than a detailed wall-and-tower system, and kingdom/city/village layout spacing is not yet fully terrain-aware. Spatial query coordinates are not a complete terrain-aware strategic layout.

### Starting kingdom and spawn preference
- Reserved procedural region `(0, 0)` for a human kingdom rather than relying on a rare random kingdom roll.
- Expanded that region's deterministic site search to find a terrain-valid kingdom plain over a wider area while preserving the existing water, slope, elevation and climate checks.
- Updated new-world setup and spawn selection to prefer the kingdom before falling back to another human settlement.

**Verification status:** the merged foundation passed the GitHub Actions TypeScript check and production build before merge. Automated hierarchy and streaming tests have now been added to this follow-up branch and wired into CI; their result is pending. No live preview or in-game spawn test has been performed, so actual appearance and player placement remain unverified.

### Deterministic hierarchy planning
Added `src/game/settlement-hierarchy.ts`.

- Defines lightweight nodes for kingdoms, cities, towns, villages, houses and castles.
- Generates a seeded hierarchy plan with stable IDs and reproducible names/coordinates.
- Enforces 5–8 cities per kingdom.
- Enforces exactly 5 towns per city.
- Enforces 5–8 villages per town.
- Enforces 20–30 residential house records per village.
- Records parent/child relationships explicitly instead of inferring them from proximity.
- Adds town metadata for a square, town hall and outer wall.
- Adds castle ward metadata for outer ward, inner ward and keep.
- Includes `validateHierarchyPlan()` to check required counts and parent references.

### Important limitation
The hierarchy planner is connected to chunk stamping for residential `house` nodes, town and city civic structures, roads, town walls/gates and castle wards. The whole hierarchy is not yet live: village nodes do not have their own full blueprinted village layouts, planned counts are not guaranteed rendered counts, and the legacy settlement generator remains active. The full in-game hierarchy must not be described as finished yet.

## Work remaining, in priority order

### P0 — Integrate and prove the smallest vertical slice
1. **In progress:** detailed hierarchy town gatehouses and towers have been added; next validate/refine footprint spacing and finish reconciling legacy and hierarchy layouts. Geometry still requires visual preview verification.
2. Add a terrain-aware placement pass that validates land, water, slope, spacing and footprint conflicts.
3. Connect village nodes to actual building blueprints and guarantee 20–30 residential homes per village, counting houses separately from barns, stalls and civic buildings.
4. Wire hierarchy nodes into real settlement blueprints and chunk stamping; prove one kingdom -> city -> town -> village vertical slice before enabling full counts.
5. Verify the starting-kingdom path with a new world and representative seeds.
6. Run automated hierarchy tests, TypeScript checking and the production build in CI; fix all errors before merging.

### P1 — Correct hierarchy and civic architecture in the renderer
1. Replace the current one-settlement-per-region interpretation for human settlements with parent-child region planning.
2. Generate 5–8 village neighbourhoods within each town's planned influence area; ensure they are connected, not just nearby points.
3. Generate exactly five town districts per city and connect them through streets and shared civic/commercial space.
4. Generate 5–8 cities per kingdom with major roads and countryside between cities.
5. Ensure every town has its own square, town hall, outer defensive boundary and connected gates/roads.
6. Rework kingdom/capital layout so a kingdom is a geographic region containing cities, rather than a single large settlement footprint.
7. Separate castles from the old `castle` human-tier settlement assumption. A castle is a fortified complex placed strategically inside a kingdom/city region, not a substitute for a town/city tier.

### P2 — House and street realism
1. Create explicit footprint archetypes: cottage, longhouse, timber-frame house, stone house, townhouse, merchant house, row house, manor and service building.
2. Add footprint shape data for L-shaped plans, rear wings, chamfered corners and attached row buildings.
3. Make roof geometry respond to footprints, including gables, hips, mansards, intersecting ridges and roof valleys where supported.
4. Validate wall thickness, foundation, floor heights, door clearance, window placement, stairs, chimneys and room circulation.
5. Vary materials by biome, wealth, occupation and architectural period; use Victorian facades only where the world/region style calls for them.
6. Add plot-level gardens, sheds, wells, fences and work areas without allowing them to block streets or overlap neighbours.
7. Add automated geometry/placement checks for overlaps, blocked doors, unsupported roofs and inaccessible interiors.

### P3 — Castle construction
1. Add multiple castle archetypes: hill castle, concentric castle, riverside fortress and royal palace-fortress.
2. Place sites using terrain elevation, slope, nearby water, road/river crossings and strategic importance.
3. Generate outer perimeter, gatehouses, towers, outer ward, inner ward and keep in a valid connected sequence.
4. Allocate ward-specific facilities: stables, stores, workshops, barracks, well/cistern, great hall, chapel and protected residential rooms.
5. Check path connectivity through gates and between wards; avoid walls blocking the only route.
6. Scale fortification dimensions to castle type and available terrain.

### P4 — Physical scale and terrain
1. Current code documents **1 block = 0.5 m** and a 4-block player height, which already corresponds to a 2 m player. Preserve that relationship unless the actual player collider proves otherwise.
2. Audit camera height, collider height, door dimensions, storey height, movement speed and collision before modifying units.
3. The current chunk storage has `WORLD_HEIGHT = 192` blocks (96 m at 0.5 m/block). This is too low to represent real mountains hundreds or thousands of metres tall in the same vertical world. Plan a deliberate vertical-world/terrain redesign; do not merely increase tree dimensions or change the scale comment.
4. Design terrain vertical range, chunk storage, meshing, collision, sky/fog, water, caves and save data together before changing `WORLD_HEIGHT`.
5. Give trees species-specific height, trunk diameter, canopy and age ranges, scaled in metres.
6. Generate mountains with foothills, ridgelines, valleys, passes and elevation profiles, not small stepped pyramids.
7. Add LOD/instancing and chunk streaming to keep large forests and settlements performant.

### P5 — On-demand generation and safe kingdom spawn
1. Define a region/chunk lifecycle: unknown -> planned -> terrain-validated -> generated -> cached; preserve seed and IDs.
2. Generate metadata ahead of visible geometry, then stamp only buildings intersecting requested chunks.
3. Make adjacent chunks agree on the same buildings, roads, walls and terrain.
4. Cache and evict region data safely without changing it on revisit.
5. **Partially implemented:** region (0, 0) is reserved for a terrain-validated starting kingdom, and new-world setup prefers that kingdom. Still verify that the spawn point is inside the intended playable area for new worlds.
6. Ensure the full hierarchy exists before the player becomes controllable; this is not implemented yet.
7. Test repeated travel away from and back to regions for consistency, duplicates and memory leaks.

### P6 — Validation, performance and handoff
1. Add automated tests for hierarchy counts, deterministic output, parent links and castle ward requirements.
2. Add placement tests for terrain/water/slope constraints, overlap prevention and road connectivity.
3. Add preview smoke tests and verify a new game spawns in a kingdom.
4. Profile chunk generation time and memory at village, town, city and kingdom scales.
5. Document the seed, hierarchy data model, rendering pipeline, known limits and exact commands to run tests.

## Automated checks added in the current follow-up

- Added deterministic hierarchy count/link tests across representative seeds.
- Added tests that same seed/options yield identical plans and changing the origin translates coordinates without changing IDs.
- Added streaming-cache reuse, spatial bounds ordering, margin/negative-coordinate and invalid-query tests.
- Added a package test command and a CI step to run these tests before typecheck/build. CI results must be checked before treating them as passing.

## Current execution boundary

The hierarchy data/validation layer has been improved, but the requested live game feature is still incomplete. The hierarchy coordinates are broad planning hints and are not yet mapped onto terrain-validated settlement sites. The current renderer still stamps independently generated settlements; simply feeding these raw coordinates into it would create overlapping or invalid structures. No successful TypeScript check, production build, automated test run or live preview has been recorded for this branch. Do not represent the feature as complete until the integration and verification items above have been implemented and tested.

## Handoff notes for another AI/developer

- Start from this branch and read this document before editing.
- The hierarchy module is partially wired into live settlement rendering for houses, town/city civic structures, roads and castle wards. Starting-kingdom selection is connected separately, but the requested parent-child settlement hierarchy is still incomplete.
- Read `src/game/settlements.ts`, `src/game/terrain.ts`, `src/game/chunk.ts`, the chunk/world renderer, player spawn logic and `package.json` before changing architecture.
- Do not claim that the hierarchy or spawn requirement is complete until it is wired into the runtime and verified in a running preview.
- Do not modify block scale casually. The existing 0.5 m/block convention makes a 4-block player 2 m tall, but the current 192-block vertical world limits realistic mountain heights.
- Run `npm run typecheck` and `npm run build` after integration. This tranche has not been typechecked or run in the game preview.
