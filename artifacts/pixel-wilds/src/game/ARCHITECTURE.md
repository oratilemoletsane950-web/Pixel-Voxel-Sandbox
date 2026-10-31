# Pixel Wilds — module architecture

The game code is organised around **stable facades over small submodules**. A
file you already import (`game/world.ts`, `game/blocks.ts`, `game/terrain.ts`,
`game/trees.ts`, `game/worldgen.ts`) keeps its public API; its implementation
lives in a directory next to it and can be split further without touching
callers.

```
src/game/
  core/           registry, prototype (factory), ordered pipeline — no game knowledge
  blocks/         vocabulary (types) · catalogue (definitions) · derived tables
  terrain/        height model · climate model · surface rules · cached facade
  vegetation/     species registry · stamps · shapes · placement · ground cover
  worldgen/       one file per stage + the pipeline that orders them
  world/          types · terrain cache · access · streaming · spawn · persistence
  chunk.ts        chunk storage (unchanged)
  mesher.ts       chunk -> meshes (unchanged)
  textures.ts     atlas generation (unchanged)
  physics.ts      player movement (unchanged)
  crafting.ts     recipes (unchanged)
  settlements.ts  settlement plan/stamp (generation disabled, see below)

src/app/          the UI: game-world (WebGL view) · chunk-mesh · voxel-fallback
                  (2D) · hud panels · block palette
src/game/player/  inventory & save · aiming/raycast · session (world + spawn) ·
                  input tuning constants
```

## Rules that keep this robust

1. **Facades, not deep imports.** App, tests and settlements import
   `./game/world`, `./game/blocks` and so on. Submodule paths are internal, so
   moving a file cannot break a feature.
2. **Direction of dependencies.** `core` knows nothing about the game.
   `blocks` knows only `core`. `terrain` depends on `blocks`/`chunk`/`noise`.
   `vegetation` depends on `terrain` types. `worldgen` composes all of them.
   `world` consumes `worldgen` and never contains generation rules.
   No cycles: `terrain` never imports `world`.
3. **Registration over edits.** New content is an entry, not a branch:
   ids are rejected loudly on duplicates, and an ordering mistake fails at
   import time instead of corrupting saves.
4. **Derived, never duplicated.** Block ids/atlas size are derived from one
   ordered vocabulary; the catalogue is validated against it.
5. **Behaviour is fingerprinted.** `characterize.ts` and
   `generation-fingerprint.test.ts` pin generated worlds, so a refactor that
   changes terrain, trees, ores or flowers fails loudly.

## Recipes

### Add a block

1. Append the name to `BLOCK_TYPES` (append only — this order is the save
   format) or `SCENERY_BLOCK_TYPES`.
2. Add one `defineBlock(FAMILY, { ... })` line in
   `blocks/definitions.ts`.
3. If it needs new art, add a `TexturePattern` and handle it in `textures.ts`.

The id, `BLOCK_INFO`, solidity, opacity, alpha and atlas slot all follow
automatically; startup validation catches a missed step.

### Add a tree / plant species

Add one `defineSpecies({ id, label, habitats: [{ biomes, priority, accepts }],
stamp })` in `vegetation/species.ts`. Reuse a stamp from `vegetation/stamps.ts`
or write a new one. No placement or dispatch code changes: selection is by
priority, not by the position of a `case` label.

### Add a generation pass (caves, structures, carvings, settlements)

Write a stage beside `worldgen/*.ts`:

```ts
export const caveStage: ChunkStage = Object.freeze({
  id: "caves",
  order: 25,
  run: ({ writer, terrain, seed }) => carveCaves(writer, terrain, seed),
});
```

and register it in `worldgen/pipeline.ts`. Set `enabled: false` to keep a stage
documented but off. Settlements already fit this shape — re-enabling them is a
registration, not a rewrite.

### Add a biome

Add a `SurfaceRule` (id, order, `apply(column, facts)`) to the ordered list in
`terrain/surface.ts`. Lower `order` wins. Add the biome name to `Biome` in
`terrain/types.ts`, and habitat entries in `vegetation/species.ts` if anything
should grow there. `SURFACE_CLASSIFIER.classify()` returns the winning rule id,
which makes precedence testable.

### Add a HUD panel or control

Create a presentational component in `src/app/hud.tsx` that takes state and
callbacks as props, then render it from `App.tsx` and wire the state there.
Panels hold no game logic, so adding a panel cannot affect physics, streaming
or the render loop. Reuse `BLOCK_META` / `BLOCK_COLORS` from
`app/block-palette.ts` for consistent swatches, and keep existing
`data-testid` names stable for validation.

### Add a save backend (IndexedDB, file, server)

Implement `KeyValueStorage` (`world/persistence.ts`) and pass it to
`saveWorld`/`loadWorld`. The default is `browserStorage()`; tests already use an
in-memory backend through this seam.

## Invariants to preserve

- One block = 0.5 m; the player is 4 blocks tall (see `blocks/types.ts`).
- Chunk layout is column-major `(lx * 16 + lz) * 256 + y`.
- World generation is a pure function of `(seed, x, z)`; chunk order must never
  matter. Every stage must stay chunk-independent.
- `window` is only touched in `world/persistence.ts` (`browserStorage`) and the
  React layer. Game modules stay headless and testable with `node:test`.

## Known remaining work

- `src/game/settlements.ts` (~2.4k lines): plan + stamp + furniture. Generation
  is disabled; when it is re-enabled, split blueprints/stamping/furnishing and
  register the stage in `worldgen/pipeline.ts`.
- `artifacts/mockup-sandbox` duplicates the shadcn UI components in this app;
  it is a design sandbox, not shipped game code.
- The production bundle is a single ~1.3 MB chunk (Three.js dominates) and the
  build warns about the 500 kB threshold. Code-splitting the renderer is a
  packaging improvement, not a correctness issue.

## UI layout

`App.tsx` is now wiring only (~430 lines): game state, streaming, saving, input
subscriptions and composition. Rendering, panels and player helpers are in
separate modules (`src/app/*`, `src/game/player/*`), and the 3D and 2D
renderers implement the same callback contract, so either can be replaced
without touching the shell.
