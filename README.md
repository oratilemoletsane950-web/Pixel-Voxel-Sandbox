<img width="940" height="470" alt="image" src="https://github.com/user-attachments/assets/6456c67c-34af-4f2e-ba66-ad2ac620a5c4" />
<img width="940" height="472" alt="image" src="https://github.com/user-attachments/assets/0e2469f6-962a-49c4-8c9a-cb61e9257a2a" />
<img width="940" height="476" alt="image" src="https://github.com/user-attachments/assets/a8c0a0c3-100e-45c1-bc9d-1b25757f7744" />



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


