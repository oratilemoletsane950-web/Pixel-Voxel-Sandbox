/**
 * App shell: owns game state, streaming, saving and input wiring, and composes
 * the renderer with the HUD.
 *
 * Rendering lives in `app/game-world.tsx` (WebGL) and `app/voxel-fallback.tsx`
 * (2D); panels live in `app/hud.tsx`; player inventory/save and aiming live in
 * `game/player/*`. A new feature should usually extend one of those modules
 * rather than this file.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

import {
  BLOCK_TYPES,
  DEFAULT_RENDER_RADIUS,
  MAX_RENDER_RADIUS,
  MIN_RENDER_RADIUS,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  ensureChunks,
  getBiomeAt,
  getBlock,
  getChunkCoordinates,
  getLoadedBlockCount,
  getLoadedChunkCount,
  isChunkLoadedAt,
  saveWorld,
  setBlock,
  type BlockCell,
  type BlockType,
  type WorldData,
} from "./game/world";
import { BLOCK_INFO } from "./game/blocks";
import { MAX_BUILD_HEIGHT } from "./game/chunk";
import { PLAYER_RADIUS, type Position } from "./game/physics";
import { applyCraft, canCraft, type CraftRecipe } from "./game/crafting";
import { HOTBAR_SLOTS, RENDER_RADIUS_KEY } from "./game/player/controls";
import {
  DEFAULT_INVENTORY,
  readPlayerSave,
  savePlayer,
  type Inventory,
} from "./game/player/inventory";
import type { AimTarget } from "./game/player/aiming";
import { initialWorld } from "./game/player/session";
import { BLOCK_META } from "./app/block-palette";
import { GameWorld } from "./app/game-world";
import { VoxelFallback } from "./app/voxel-fallback";
import {
  BrandLockup,
  CraftPanel,
  Crosshair,
  FieldReadouts,
  Hotbar,
  MobileControls,
  ToastNote,
  WelcomeOverlay,
  WorldCard,
  WorldRulesPanel,
  WorldStatus,
} from "./app/hud";

function App() {
  const savedPlayer = useMemo(() => readPlayerSave(), []);
  const [world, setWorld] = useState<WorldData>(() =>
    initialWorld(savedPlayer?.position ?? null),
  );
  const worldRef = useRef(world);
  worldRef.current = world;
  const [inventory, setInventory] = useState<Inventory>(savedPlayer?.inventory ?? DEFAULT_INVENTORY);
  const [playerPosition, setPlayerPosition] = useState<Position | null>(savedPlayer?.position ?? null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [target, setTarget] = useState<AimTarget | null>(null);
  const [started, setStarted] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [craftOpen, setCraftOpen] = useState(false);
  const [flying, setFlying] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "unsaved">("saved");
  const [notice, setNotice] = useState("");
  const [mobileMove, setMobileMove] = useState({ forward: 0, side: 0, jump: false });
  const [supportsWebGL, setSupportsWebGL] = useState<boolean | null>(null);
  const noticeTimeout = useRef<number | undefined>(undefined);
  const [renderRadius, setRenderRadius] = useState<number>(() => {
    const saved = Number(localStorage.getItem(RENDER_RADIUS_KEY));
    return Number.isInteger(saved) && saved >= MIN_RENDER_RADIUS && saved <= MAX_RENDER_RADIUS
      ? saved
      : DEFAULT_RENDER_RADIUS;
  });
  const streamCenter = useRef(
    getChunkCoordinates(
      savedPlayer?.position?.x ?? 0,
      savedPlayer?.position?.z ?? 0,
    ),
  );
  const selected = BLOCK_TYPES[selectedIndex] ?? "grass";

  useEffect(() => {
    const probe = document.createElement("canvas");
    const context = probe.getContext("webgl2");
    setSupportsWebGL(Boolean(context));
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.clearTimeout(noticeTimeout.current);
    noticeTimeout.current = window.setTimeout(() => setNotice(""), 1300);
  }, []);

  // Leaving pointer lock hands the mouse back so recipes can be clicked.
  useEffect(() => {
    if (!craftOpen) return;
    if (document.pointerLockElement) document.exitPointerLock?.();
  }, [craftOpen]);

  // The game reports every flight toggle (double-tapped Space) so the HUD can
  // show whether you are walking or flying.
  useEffect(() => {
    const onFly = (event: Event) => {
      const on = Boolean((event as CustomEvent<boolean>).detail);
      setFlying(on);
      showNotice(on ? "Flight on - Space rises, Ctrl sinks" : "Back on the ground");
    };
    window.addEventListener("pixel-wilds-fly", onFly);
    return () => window.removeEventListener("pixel-wilds-fly", onFly);
  }, [showNotice]);

  const startFallback = useCallback(() => {
    setStarted(true);
  }, []);

  // The player's chunk is only recorded here; a timer then generates a few missing
  // chunks per tick (nearest first), so walking never causes one big stall.
  const streamChunks = useCallback((chunkX: number, chunkZ: number) => {
    streamCenter.current = { x: chunkX, z: chunkZ };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = ensureChunks(
        worldRef.current,
        streamCenter.current.x,
        streamCenter.current.z,
        renderRadius,
        3,
      );
      if (next === worldRef.current) return;
      worldRef.current = next;
      setWorld(next);
    }, 40);
    return () => window.clearInterval(timer);
  }, [renderRadius]);

  useEffect(() => {
    try {
      localStorage.setItem(RENDER_RADIUS_KEY, String(renderRadius));
    } catch {
      // Not being able to remember the view distance is harmless.
    }
  }, [renderRadius]);

  const setWorldEdited = useCallback((edit: (current: WorldData) => WorldData) => {
    const next = edit(worldRef.current);
    if (next === worldRef.current) return;
    worldRef.current = next;
    setWorld(next);
    setSaveState("unsaved");
    try {
      saveWorld(next);
    } catch {
      showNotice("This landscape could not be saved");
    }
    window.setTimeout(() => setSaveState("saved"), 450);
  }, [showNotice]);

  const mineBlock = useCallback((cell: BlockCell) => {
    const current = worldRef.current;
    const found = getBlock(current, cell.x, cell.y, cell.z);
    if (!found) return;
    if (BLOCK_INFO[found].unbreakable) {
      showNotice("Bedrock will not budge");
      return;
    }
    setWorldEdited((latestWorld) => setBlock(latestWorld, cell.x, cell.y, cell.z, null));
    if (BLOCK_TYPES.includes(found as BlockType)) {
      const item = found as BlockType;
      setInventory((currentInventory) => ({
        ...currentInventory,
        [item]: currentInventory[item] + 1,
      }));
      showNotice(`${BLOCK_META[item].label} gathered`);
    } else if (found === "flower") {
      showNotice("Wild bloom cleared");
    } else {
      showNotice(`${BLOCK_META[found].label} cleared`);
    }
  }, [showNotice, setWorldEdited]);

  const placeBlock = useCallback((cell: BlockCell, adjacent: AimTarget["adjacent"]) => {
    const currentWorld = worldRef.current;
    if (adjacent.y < 0 || adjacent.y > MAX_BUILD_HEIGHT) {
      showNotice("Build height reached");
      return;
    }
    if (!isChunkLoadedAt(currentWorld, adjacent.x, adjacent.z)) {
      showNotice("That area is still loading");
      return;
    }
    if (inventory[selected] < 1) {
      showNotice(`Out of ${BLOCK_META[selected].label.toLowerCase()}`);
      return;
    }
    const occupant = getBlock(worldRef.current, adjacent.x, adjacent.y, adjacent.z);
    if (occupant && occupant !== "water") return;
    const feetY = (playerPosition?.y ?? 4) - PLAYER_EYE_HEIGHT;
    const headY = feetY + PLAYER_HEIGHT;
    const overlapsPlayer =
      adjacent.x < (playerPosition?.x ?? 0.5) + PLAYER_RADIUS &&
      adjacent.x + 1 > (playerPosition?.x ?? 0.5) - PLAYER_RADIUS &&
      adjacent.z < (playerPosition?.z ?? 0.5) + PLAYER_RADIUS &&
      adjacent.z + 1 > (playerPosition?.z ?? 0.5) - PLAYER_RADIUS &&
      adjacent.y < headY &&
      adjacent.y + 1 > feetY;
    if (overlapsPlayer) {
      showNotice("A little more room, please");
      return;
    }
    void cell;
    setWorldEdited((latestWorld) =>
      setBlock(latestWorld, adjacent.x, adjacent.y, adjacent.z, selected),
    );
    setInventory((current) => ({ ...current, [selected]: Math.max(0, current[selected] - 1) }));
    showNotice(`${BLOCK_META[selected].label} placed`);
  }, [inventory, playerPosition, selected, setWorldEdited, showNotice]);

  const craft = useCallback(
    (recipe: CraftRecipe) => {
      if (!canCraft(recipe, inventory)) {
        showNotice("Not enough materials yet");
        return;
      }
      setInventory((current) => applyCraft(recipe, current));
      showNotice(`Crafted ${recipe.label}`);
    },
    [inventory, showNotice],
  );

  const savePlayerState = useCallback((position?: Position) => {
    savePlayer(inventory, position ?? playerPosition);
  }, [inventory, playerPosition]);

  useEffect(() => {
    const onSelect = (event: Event) => {
      const type = (event as CustomEvent<BlockType>).detail;
      const index = BLOCK_TYPES.indexOf(type);
      if (index >= 0) setSelectedIndex(index);
    };
    const onCycle = (event: Event) => {
      const direction = (event as CustomEvent<number>).detail;
      setSelectedIndex((current) => (current + direction + BLOCK_TYPES.length) % BLOCK_TYPES.length);
    };
    // Number keys pick a slot on the current hotbar page; Q / E (or [ ]) flip pages.
    const onSlot = (event: Event) => {
      const slot = (event as CustomEvent<number>).detail;
      setSelectedIndex((current) => {
        const index = Math.floor(current / HOTBAR_SLOTS) * HOTBAR_SLOTS + slot;
        return index < BLOCK_TYPES.length ? index : current;
      });
    };
    const onPageKey = (event: KeyboardEvent) => {
      if (event.code === "KeyC" && !event.repeat && !event.ctrlKey && !event.metaKey) {
        setCraftOpen((open) => !open);
        return;
      }
      if (event.code === "Escape") {
        setCraftOpen(false);
        return;
      }
      const step = event.code === "KeyE" || event.code === "BracketRight" ? 1
        : event.code === "KeyQ" || event.code === "BracketLeft" ? -1 : 0;
      if (!step) return;
      setSelectedIndex((current) => {
        const pages = Math.ceil(BLOCK_TYPES.length / HOTBAR_SLOTS);
        const page = (Math.floor(current / HOTBAR_SLOTS) + step + pages) % pages;
        return Math.min(BLOCK_TYPES.length - 1, page * HOTBAR_SLOTS + (current % HOTBAR_SLOTS));
      });
    };
    const onPointerChange = () => {
      const locked = document.pointerLockElement !== null;
      setStarted(locked);
    };
    window.addEventListener("pixel-wilds-select", onSelect);
    window.addEventListener("pixel-wilds-cycle", onCycle);
    window.addEventListener("pixel-wilds-slot", onSlot);
    window.addEventListener("keydown", onPageKey);
    document.addEventListener("pointerlockchange", onPointerChange);
    const saveOnExit = () => savePlayerState();
    window.addEventListener("beforeunload", saveOnExit);
    return () => {
      window.removeEventListener("pixel-wilds-select", onSelect);
      window.removeEventListener("pixel-wilds-cycle", onCycle);
      window.removeEventListener("pixel-wilds-slot", onSlot);
      window.removeEventListener("keydown", onPageKey);
      document.removeEventListener("pointerlockchange", onPointerChange);
      window.removeEventListener("beforeunload", saveOnExit);
    };
  }, [savePlayerState]);

  useEffect(() => {
    savePlayerState();
  }, [savePlayerState]);

  const beginExplore = () => {
    setStarted(true);
    if (supportsWebGL !== true || window.matchMedia("(pointer: coarse)").matches) return;
    const canvas = document.querySelector(".game-canvas canvas") as HTMLCanvasElement | null;
    canvas?.requestPointerLock?.();
  };

  const loadedBlockCount = useMemo(() => getLoadedBlockCount(world), [world]);
  const loadedChunkCount = useMemo(() => getLoadedChunkCount(world), [world]);
  const biome = getBiomeAt(world.seed, playerPosition?.x ?? 0.5, playerPosition?.z ?? 0.5);
  const coordinates = playerPosition
    ? `${Math.floor(playerPosition.x)} · ${Math.floor(playerPosition.y)} · ${Math.floor(playerPosition.z)}`
    : "ROAM FREE";

  const saveNow = () => {
    try {
      saveWorld(world);
      savePlayerState();
      setSaveState("saved");
      showNotice("Landscape tucked away");
    } catch {
      showNotice("Could not save this landscape");
    }
  };

  return (
    <main className="game-shell" data-testid="game-world">
      {supportsWebGL !== true ? (
        <VoxelFallback
          world={world}
          onTarget={setTarget}
          onMine={mineBlock}
          onPlace={placeBlock}
          onPosition={setPlayerPosition}
          onChunkChange={streamChunks}
          savedPosition={playerPosition}
          mobileMove={mobileMove}
          started={started}
          onStart={startFallback}
        />
      ) : (
        <Canvas
          className="game-canvas"
          dpr={[1, 1.35]}
          camera={{ position: [0.5, 60, 0.5], fov: 74, near: 0.1, far: 400 }}
          gl={{ antialias: false, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.12;
          }}
        >
          <GameWorld
            key={world.seed}
            world={world}
            onTarget={setTarget}
            onMine={mineBlock}
            onPlace={placeBlock}
            onPosition={setPlayerPosition}
            onChunkChange={streamChunks}
            savedPosition={playerPosition}
            mobileMove={mobileMove}
            renderRadius={renderRadius}
            paused={craftOpen}
          />
        </Canvas>
      )}

      <div className="hud">
        <BrandLockup />
        <WorldStatus
          saveState={saveState}
          flying={flying}
          renderRadius={renderRadius}
          onRenderRadiusChange={setRenderRadius}
          onSave={saveNow}
        />
        <WorldCard
          seed={world.seed}
          biome={biome}
          rulesOpen={rulesOpen}
          onToggleRules={() => setRulesOpen((current) => !current)}
        />
        <WorldRulesPanel open={rulesOpen} onClose={() => setRulesOpen(false)} />
        <Crosshair target={target} />
        <FieldReadouts
          biome={biome}
          coordinates={coordinates}
          loadedChunkCount={loadedChunkCount}
          loadedBlockCount={loadedBlockCount}
          renderRadius={renderRadius}
        />
        <Hotbar
          inventory={inventory}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
        />
        <CraftPanel
          open={craftOpen}
          inventory={inventory}
          onClose={() => setCraftOpen(false)}
          onCraft={craft}
        />
        <ToastNote notice={notice} />
        <WelcomeOverlay hidden={started || craftOpen} onBegin={beginExplore} />
        <MobileControls
          onMove={setMobileMove}
          target={target}
          onMine={mineBlock}
          onPlace={placeBlock}
          onToggleCraft={() => setCraftOpen((open) => !open)}
        />
      </div>
    </main>
  );
}

export default App;
