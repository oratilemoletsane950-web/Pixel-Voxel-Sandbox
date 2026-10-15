# Pixel Wilds

A first-person voxel wilderness you can walk, mine, build and settle: streaming
16×16 chunks, procedural terrain with climates and rivers, ten tree species,
medieval settlements from villages to walled kingdoms, and a workbench where
you craft furniture out of the blocks you gather. Every block is 0.5 m, so you
are a 2 m (4-block) human in a world that measures doors in whole blocks.

## Run & operate

```bash
pnpm install                                  # workspace deps (pnpm, not npm)
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/pixel-wilds run dev    # play at http://localhost:3000
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/pixel-wilds run build  # production build → dist/public
pnpm run typecheck                            # whole workspace
```

Headless gameplay tests (no browser needed; run from `artifacts/pixel-wilds`):

```bash
../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/bin/esbuild sanity.ts \
  --bundle --platform=node --format=esm --outfile=/tmp/pw-sanity.mjs && node /tmp/pw-sanity.mjs
```

`PORT` and `BASE_PATH` are required by `vite.config.ts` for both dev and build.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | walk (relative to where you look) |
| `←` / `→` | turn left / right — works **while** walking with WASD (no mouse needed) |
| Mouse | look around (click to capture the pointer) |
| `Space` | jump / swim up — **double-tap to fly**; while flying: `Space` rises, `Ctrl` sinks, `Shift` is a faster cruise |
| (automatic) | **autojump**: walking into a 2-block obstacle hops it for you; taller walls still need a manual `Space` |
| `Shift` | sprint |
| `LMB` / `RMB` | gather block / place selected block |
| `1–9 / 0`, `Q` `E`, mouse wheel | choose block / flip hotbar page |
| `C` | open the workbench (crafting) |
| Touch | on-screen move, jump, Mine, Place and Craft buttons |

## What has been done

### Movement
- **Flight by double-tapping Space** (`src/game/physics.ts`, `src/App.tsx`).
  Gravity is off while flying; Space rises, Ctrl sinks, Shift cruises faster.
  A HUD pill shows the flight state, respawn exits flight, and the 2D
  no-WebGL fallback supports the same toggle.
- **Autojump** — when you walk into a block whose top is between step height
  (1 block) and jump reach (~2.3 blocks), the character hops it without touching
  Space. Walls taller than a jump are left alone, so you never bunny-hop up a
  castle wall. Verified headlessly: climbs a 2-block step hands-off, ignores a
  6-block wall.
- **Arrow-key turning** — `←`/`→` rotate the view at ~150°/s while `W A S D`
  keeps walking (and `↑`/`↓` still walk forward/back). Mouse look is unchanged.

### Trees and forests (`src/game/trees.ts`)
- **Ten species**, each with its own trunk size (blocks; 1 block = 0.5 m):
  shrub 1 · cactus 4–8 · swamp oak 8–11 · oak 11–17 · willow 9–13 ·
  birch 13–19 · palm 12–20 (leaning, with a frond crown) · spruce 15–24 ·
  **pine 18–29** (bare lower trunk, whorled foliage) ·
  **redwood 44–63** (22–31 m, the only 3×3 buttressed trunk, crown above the canopy).
- **Forest stands** — slow stand noise makes whole patches lean the same way:
  birch groves, redwood stands, pine belts, spruce woods in the cold, willows
  in swamps, palms along beaches, cactus in deserts, lone oaks on plains.

### Settlements (`src/game/settlements.ts`)
- Kinds: **village → town → city** for villagers, plus elven groves, dwarven
  holds, orc camps, mage towers and warden lodges — each with its own style,
  wall type and site preference.
- **Kingdoms** (new): ruled by explicit geographic rules — villagers only,
  roughly one region in thirty, and the site must be a *broad flat plain*
  (height range ≤ 14 blocks over the whole footprint, 3–30 m above sea level,
  never desert or frozen, moisture 0.4–0.8), otherwise the site is rejected.
  A kingdom is the biggest footprint (56-block radius) and is built like a real
  medieval castle: a 16-block **crenellated curtain wall** with four gates,
  **eight gate towers** and four corner towers, a stone **keep** (21×17, four
  towers of its own) on the plaza, and an **inner ward wall** between keep and
  town, gated on every street — keep, bailey and wards.
- **No mobs by design**: settlements are uninhabited architecture — no NPCs,
  no wandering villagers, no hostiles. Just the buildings and their furniture
  for you to explore.
- **You always find them**: a brand-new world **spawns you inside the nearest
  village/town/city/kingdom** (its chunks are generated before the first
  frame), and the settlement card top-right always shows the nearest
  settlement with its distance and compass direction — it accents when you
  arrive. Existing saves keep their position and use the same card to navigate.
- **Furnished interiors**: every house gets a **wooden door** hung in its
  doorway (opaque, but walk-through), plus a **table** and two **chairs**
  against the wall opposite the door; halls and keeps get a long banquet
  table. Kingdom gate towers are banded with **marble**.
- Placement/sizing rules are documented in the module header of
  `settlements.ts` and are pure functions of the region hash + terrain, so
  they are identical in every chunk and session.

### Crafting & materials (`src/game/crafting.ts`, `src/game/blocks.ts`)
- **Workbench on `C`** (also a Craft button on mobile): 11 recipes that spend
  blocks you gathered — planks and dark planks from logs, **door / chair /
  table** from planks, stone bricks from stone, marble from limestone, bricks
  from clay, and kiln recipes (roof tiles, glass) that also burn coal.
- Crafted blocks go into your inventory, are placeable like any block, and can
  be mined back out. Starter counts are small so crafting matters.
- New blocks with procedural textures: **door, chair, table, marble**.
- Inventory, position and world edits still persist to `localStorage`
  (block *names* are saved, so old saves keep working).

### Tooling
- `artifacts/pixel-wilds/sanity.ts` — 48 headless checks covering flight,
  autojump, yaw turning, every crafting recipe, kingdom placement rules and
  structure counts, village/kingdom furniture stamping, and the presence of
  all four new tree species. All passing.

## Settlement design

Every settlement is planned on paper first (see the header of
`src/game/settlements.ts`), then stamped by every chunk that touches it:

| Kind | Footprint (half-extent) | Site rules | Layout |
| --- | --- | --- | --- |
| Village | 36 | any dry lowland, moisture 0.38–0.78 | cross streets, plaza with a well, cottages, thatched roofs, farms |
| Town | 44 | better score, same lowland rules | as the village, plus a timber palisade with one gate per side |
| City | 54 | the best lowland sites | stone wall, corner towers, cobble streets, taller mixed walls |
| Kingdom | 56 | **flat plain only** (range ≤ 14, 3–30 m elevation, no desert/tundra, moisture 0.4–0.8), villagers only, ~1 region in 30 | curtain wall (16 high, 8 gate towers + 4 corner towers) → outer ward houses → inner ward wall (10 high, gated on all four streets) → keep on the plaza with 4 towers |
| Grove / Hold / Camp / Tower / Lodge | 30–40 | faction taste (elves want forest, dwarves want mountains, …) | faction-specific walls, roofs and centrepiece |

Common to all: levelled ground with a 12-block apron, streets 5 blocks wide
meeting at a paved plaza, buildings facing the street, doorways 5 blocks high
hung with walk-through doors, and every house furnished with a table and two
chairs. Halls and keeps get long banquet tables. **No mobs** — the settlements
are empty of life on purpose.

## What still needs to be done

- **Doors do not swing.** They are always walk-through panels; there is no
  open/close state or interaction (a "use" action would need to be added).
- **Furniture is full cubes.** At 0.5 m scale a chair/table is a single voxel
  block; thin-slab or multi-box models (a door leaf with a frame, a table with
  leg space underneath) would look better but need mesher + collision shape
  support.
- **Kingdom ward paths** from outer cottages stop at the inner ward wall
  (cosmetic dead-end); they should route through the ward gates instead.
- **Laws of the realm**: kingdoms have placement/size rules, but no
  behavioural rules (factions are currently styling only — there are no NPCs
  to enforce anything, by design).
- **Mobile flight**: touch has no Space key, so flight cannot be toggled on
  touch devices yet (needs a Fly button next to Craft).
- **More craftables**: stairs, fences, banners, beds, ladders, chests — the
  recipe list is designed to grow in `crafting.ts`.
- **Species-specific wood**: redwoods and palms drop ordinary oak/spruce logs;
  dedicated log/leaves blocks for each species would make forests more
  rewarding to harvest.
- **Forest tuning**: stand sizes and densities are one noise scale for the
  whole world; per-biome density curves and smoother biome edges would help.
- **No CI**: `sanity.ts` must be run manually (commands above); wire it into a
  test script if the project gets CI.
- **Key remapping / settings**: turning speed, mouse sensitivity and the
  double-tap window are hard-coded constants in `App.tsx`.
- **Save versioning**: old-format saves are silently discarded by
  `loadWorld`; a migration prompt or version tag would be kinder.

## Where things live

- `artifacts/pixel-wilds/src/game/blocks.ts` — every block type, atlas layout.
- `.../game/physics.ts` — walking, jumping, autojump, swimming, flight.
- `.../game/trees.ts` — species, stands, trunk/canopy stamping.
- `.../game/settlements.ts` — site rules, layout, keep/wards/walls, furnishing.
- `.../game/crafting.ts` — workbench recipes.
- `.../game/terrain.ts` / `world.ts` / `chunk.ts` / `mesher.ts` / `textures.ts`
  — terrain model, chunk streaming & saves, meshing, procedural texture atlas.
- `artifacts/pixel-wilds/src/App.tsx` — input handling, HUD, workbench UI.
- `artifacts/pixel-wilds/sanity.ts` — headless gameplay tests.

## Gotchas

- Use **pnpm** (the preinstall hook rejects npm/yarn).
- Vite needs `PORT` and `BASE_PATH` for dev *and* build.
- The texture atlas is built from `WORLD_BLOCK_TYPES`; adding a block appends
  to the list — saved worlds store block names, so they stay compatible.
