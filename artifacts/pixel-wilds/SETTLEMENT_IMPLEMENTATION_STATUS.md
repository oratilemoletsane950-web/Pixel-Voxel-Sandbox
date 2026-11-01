# Settlement System — Implementation Status

Updated: 2026-11-01

This document describes the code on `freebuff/4e582922980e20ec648ece04`.
It replaces the older branch handoff notes, which described an earlier
`feature/world-scale-mountains-trees` tranche.

## Current implementation

### Hierarchy and placement

- `src/game/settlement-hierarchy.ts` plans one kingdom, 5–8 cities, exactly five
  towns per city, 5–8 villages per town and 20–30 homes per village.
- `resolveHierarchyPlan()` in the settlement facade resolves city, town,
  village, castle and house sites once per terrain/seed/origin. Resolved major
  footprints are reserved globally, not just per village.
- Houses now draw from nine village blueprints: simple home, farmer's cottage,
  fisherman's hut, woodcutter's cabin, baker's house, carpenter's shop,
  healer's house, tavern and general store. Selection is deterministic.
- The resolver rejects wet, river-adjacent, steep and out-of-bounds candidates.
  A house that cannot be placed safely is omitted instead of being forced onto
  a raised pad.
- Town, city and castle roads follow resolved centres. Castle and kingdom
  layouts now include a central cross-street from the keep to each outer gate.

### Geometry

- Chunk stamping renders hierarchy houses, town halls, civic plazas, city
  halls, roads, town walls, castle wards, keeps and towers. Legacy settlement
  geometry remains disabled.
- Building shells keep 6-block storeys, 5-block door clearance and walkable
  interior stairwells.
- Interiors now add storage appropriate to the building: chests in homes,
  barrels in shops/warehouses/granaries, and furnaces in bakeries and forges.
  Furniture and storage share one occupancy set, so nothing overwrites a
  stairwell or another furnishing.
- Castle and kingdom ward paths reserve a gate-to-keep route before roads and
  buildings are stamped.

### Tests

`src/game/settlements/settlements.test.ts`, `settlement-hierarchy.test.ts` and
`settlement-placement.test.ts` cover deterministic plans, structural counts,
parent links, castle ward metadata, terrain-safe placement, global major and
house footprint separation, stair clearance and interior dressing.

## Validation status

- TypeScript: passing.
- Automated tests: passing (the exact count moves as tests are added).
- Production build: passing.
- Interactive geometry review: still required. Automated checks verify
  footprints and planned routing, not every stamped voxel or the player's
  walking experience.

## Remaining settlement work

1. Visually inspect one kingdom → city → town → village → house chain,
   including gate approach, ward crossings, door clearance and stair access.
2. Add ward facilities beyond the keep: stables, workshops, barracks, stores,
   well/cistern and chapel interiors.
3. Run an occupancy audit against stamped voxels rather than only planned
   rectangles.
4. Expand house/roof archetypes further and vary materials by biome and wealth.
5. Profile full hierarchy resolution and stamping; the placement test is the
   slowest part of the suite.

## Commands

```sh
cd artifacts/pixel-wilds
npm test
npm run typecheck
PORT=3000 BASE_PATH=/ npm run build
```
