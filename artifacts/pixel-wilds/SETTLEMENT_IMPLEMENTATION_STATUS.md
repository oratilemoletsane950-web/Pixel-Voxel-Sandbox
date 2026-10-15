# Procedural Settlement System — Implementation Status

Branch: `feature/settlement-hierarchy-foundation`

## What has been implemented in this tranche

### Streaming foundation added
- Added `src/game/hierarchy-streaming.ts` with a bounded four-plan LRU cache keyed by seed and origin, plus a world-space bounds query to limit future hierarchy work to the chunks that need it.
- This prevents the expensive full hierarchy plan from being rebuilt for every streamed chunk once the runtime generator is connected.
- **Not yet live:** no existing chunk or settlement renderer imports this module yet. The bounds query currently filters the plan node list and is a correctness-first foundation, not a spatial index; optimize it after the rendering bridge is working.

### Starting kingdom and spawn preference
- Reserved procedural region `(0, 0)` for a human kingdom rather than relying on a rare random kingdom roll.
- Expanded that region's deterministic site search to find a terrain-valid kingdom plain over a wider area while preserving the existing water, slope, elevation and climate checks.
- Updated new-world setup and spawn selection to prefer the kingdom before falling back to another human settlement.

**Verification caveat:** these changes have been committed to the feature branch but have not yet been typechecked or preview-tested. The spawn routine still uses the existing safe-ground scan; a running preview is needed to confirm the actual player appears inside the walls/urban area for representative seeds.

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
The hierarchy planner is still a **planning/data foundation only**. It is not yet connected to the settlement layout/stamping pipeline or used to render its city -> town -> village -> house relationships. The separate starting-kingdom preference is wired into existing procedural settlement selection, but it does not make the hierarchy planner itself live. Planned hierarchy coordinates remain hints, not terrain-validated final positions. The full in-game hierarchy must not be described as finished yet.

## Work remaining, in priority order

### P0 — Integrate and prove the smallest vertical slice
1. Inspect current settlement cache and chunk-stamping entry points in `src/game/settlements.ts`.
2. Add a hierarchy cache keyed by world seed and kingdom/region ID; avoid rebuilding thousands of nodes for every chunk request.
3. Add a terrain-aware placement pass that validates land, water, slope, spacing and footprint conflicts.
4. Connect village nodes to actual building blueprints and guarantee 20–30 residential homes per village, counting houses separately from barns, stalls and civic buildings.
5. Wire hierarchy nodes into real settlement blueprints and chunk stamping; prove one kingdom -> city -> town -> village vertical slice before enabling full counts.
6. Verify the starting-kingdom path with a new world and representative seeds.
7. Run `npm run typecheck` and `npm run build`; fix all errors before merging.

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

## Handoff notes for another AI/developer

- Start from this branch and read this document before editing.
- The hierarchy module is not yet wired into live settlement rendering. Starting-kingdom selection has been connected separately, but the requested parent-child settlement hierarchy is still incomplete.
- Read `src/game/settlements.ts`, `src/game/terrain.ts`, `src/game/chunk.ts`, the chunk/world renderer, player spawn logic and `package.json` before changing architecture.
- Do not claim that the hierarchy or spawn requirement is complete until it is wired into the runtime and verified in a running preview.
- Do not modify block scale casually. The existing 0.5 m/block convention makes a 4-block player 2 m tall, but the current 192-block vertical world limits realistic mountain heights.
- Run `npm run typecheck` and `npm run build` after integration. This tranche has not been typechecked or run in the game preview.
