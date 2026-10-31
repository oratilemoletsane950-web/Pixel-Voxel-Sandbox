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
                  (geology · ores · caves · ground cover · vegetation)
  world/          types · terrain cache · access · streaming · spawn · clock · persistence
                  profile (validated world metadata) · registry (in persistence)
  chunk.ts        chunk storage (unchanged)
  mesher.ts       chunk -> meshes (unchanged)
  textures.ts     atlas generation (unchanged)
  physics.ts      player movement (unchanged)
  crafting.ts     recipes (unchanged)
  player/survival.ts  health, hunger, breath, foraging, fall damage and saves
  player/mining.ts    hardness, tool speed, harvest tiers and progress
  player/tools.ts     tool catalogue, recipes, wear, selection and saves
  player/drops.ts     dropped-block physics, pickup and per-world saves
  settlements.ts  settlement plan/stamp (generation disabled, see below)

src/app/          the UI: game-screen (one world session) · world-menu
                  (launcher, world select/create, pause, settings) ·
                  game-world (WebGL view) · chunk-mesh · voxel-fallback (2D) ·
                  hud panels · block palette
src/game/storage.ts   KeyValueStorage seam and save-key constants
src/game/settings.ts  validated, persisted app settings
src/game/player/  inventory & save · aiming/raycast · session (world + spawn) ·
                  survival · mining · tools · input tuning constants
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

Implement `KeyValueStorage` (`game/storage.ts`) and pass it to the registry,
`saveWorldData`/`loadWorldData` and the player save helpers. The default is
`browserStorage()`; tests use an in-memory backend through this seam.

### Add a world setting

Add the field to `WorldRules` (`world/profile.ts`), default it in
`DEFAULT_WORLD_RULES`, validate it in `isValidWorldProfile`, then render it in
`app/world-menu.tsx`. Existing saves are upgraded by the default; no migration
branch is needed. Gameplay stages read the profile rules instead of branching
on a world name or mode string.

### Save layout (v4)

- `pixel-wilds-worlds-v1` — `{ version, activeId, worlds: WorldProfile[] }`.
- `pixel-wilds-world-data-v1:<worldId>` — `{ version, seed, edits }`.
- `pixel-wilds-player-v3:<worldId>` — `{ inventory, position }`.
- `pixel-wilds-survival-v1:<worldId>` — `{ health, hunger, berries }`.
- `pixel-wilds-clock-v1:<worldId>` — `{ seconds }` within the twelve-minute cycle.
- `pixel-wilds-tools-v1:<worldId>` — `{ belt, equipped }` tool durability and hand slot.
- `pixel-wilds-drops-v1:<worldId>` — dropped block items with settled positions.
- `pixel-wilds-settings-v1` — view distance and field of view.

The first launch without a registry migrates the old `pixel-wilds-world-v3:*`
seed slots into profiles under `legacy-<seed>` ids and copies the old global
player save into the world that was active. Legacy keys are left untouched, so
migration never destroys a save it has not copied.

## Invariants to preserve

- One block = 0.5 m; the player is 4 blocks tall (see `blocks/types.ts`).
- Chunk layout is column-major `(lx * 16 + lz) * 256 + y`.
- World generation is a pure function of `(seed, x, z)`; chunk order must never
  matter. Every stage must stay chunk-independent.
- `window` is only touched in `world/persistence.ts` (`browserStorage`) and the
  React layer. Game modules stay headless and testable with `node:test`.

## Increment map

1. **Done:** launcher, world profiles/selection/creation, rename/duplicate/
delete, per-world terrain and player saves with migration, pause + Save and
   Quit, persisted view distance/FOV, creative-vs-survival inventory and flight
   gating.
2. **Done:** survival health/hunger/breath, fall/drowning/starvation/void
   damage, difficulty tuning, death/respawn, berry foraging and a separate
   vitals save.
3. **Done:** a persisted twelve-minute day/night cycle with interpolated sky
   and lighting in both renderers, deterministic caves below a safe roof, and
   per-block hand-mining hardness with hold-to-mine progress.
4. **Done:** field tools (pickaxe, axe, shovel) in three tiers with recipes,
   durability, equipping, tool speed, harvest-tier gates for coal and iron, a
   tool HUD and per-world toolbelt saves.
5. **Done:** dropped-block items in both renderers, gravity and floor settling,
   delayed pickup, a bounded per-world drop save, and direct-to-inventory
   fallback when the drop field is full.
6. **Next:** weather; LAN hosting/discovery over WebRTC or a local relay (a
   browser cannot listen on a port); structures wired to profiles; import/export.

## Known remaining work

- `src/game/settlements.ts` (~2.4k lines): plan + stamp + furniture. Generation
  is disabled; when it is re-enabled, split blueprints/stamping/furnishing and
  register the stage in `worldgen/pipeline.ts`.
- Caves deliberately leave a three-block roof and skip water columns. Surface
  entrances, underground lighting and cave-specific decoration remain future
  work.
- Tools cover pickaxe, axe and shovel work; there is no repair bench, no
  tool-specific art, and no dropped tools. Mined blocks now become pickup
  entities, but there is no full inventory screen, chest or container system.
  The touch **Mine** button still breaks a block immediately instead of using
  hold-to-mine duration.
- `artifacts/mockup-sandbox` duplicates the shadcn UI components in this app;
  it is a design sandbox, not shipped game code.
- The production bundle is a single ~1.3 MB chunk (Three.js dominates) and the
  build warns about the 500 kB threshold. Code-splitting the renderer is a
  packaging improvement, not a correctness issue.

## UI layout

`App.tsx` is now wiring only (~200 lines): launcher state, profiles, settings
and routing. One running world is owned by `src/app/game-screen.tsx`, including
streaming, saving and survival state. Rendering, panels and player helpers are
in separate modules (`src/app/*`, `src/game/player/*`), and the 3D and 2D
renderers implement the same callback contract, so either can be replaced
without touching the shell.
