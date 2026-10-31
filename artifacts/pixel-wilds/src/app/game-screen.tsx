/**
 * One running world: state, streaming, saving, input wiring and composition of
 * the renderer with the HUD and pause menu.
 *
 * The launcher (`App`) owns navigation and world profiles; this screen owns a
 * single world session and hands control back through `onExit`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

import {
  BLOCK_TYPES,
  ensureChunks,
  getBiomeAt,
  getBlock,
  getChunkCoordinates,
  getLoadedBlockCount,
  getLoadedChunkCount,
  isChunkLoadedAt,
  START_TIME,
  advanceWorldTime,
  readWorldClock,
  saveWorldClock,
  saveWorldData,
  setBlock,
  type BlockCell,
  type BlockType,
  type WorldData,
  type WorldProfile,
} from "../game/world";
import { BLOCK_INFO } from "../game/blocks";
import { MAX_BUILD_HEIGHT } from "../game/chunk";
import { PLAYER_RADIUS, type Position } from "../game/physics";
import { applyCraft, canCraft, type CraftRecipe } from "../game/crafting";
import { HOTBAR_SLOTS } from "../game/player/controls";
import {
  createInventory,
  readPlayerSave,
  savePlayer,
  type Inventory,
} from "../game/player/inventory";
import type { AimTarget } from "../game/player/aiming";
import { findSpawn, initialWorld } from "../game/player/session";
import {
  MAX_HEALTH,
  MAX_HUNGER,
  addBerries,
  applyDamage,
  createSurvivalState,
  eatBerries as consumeBerries,
  fallDamage,
  isBerrySource,
  readSurvivalSave,
  respawnSurvival,
  saveSurvival,
  tickSurvival,
  type SurvivalEnvironment,
  type SurvivalState,
} from "../game/player/survival";
import type { AppSettings } from "../game/settings";
import { BLOCK_META } from "./block-palette";
import { GameWorld } from "./game-world";
import { VoxelFallback } from "./voxel-fallback";
import {
  BrandLockup,
  CraftPanel,
  Crosshair,
  DeathScreen,
  FieldReadouts,
  Hotbar,
  MobileControls,
  SurvivalHud,
  ToastNote,
  WelcomeOverlay,
  WorldCard,
  WorldClock,
  WorldRulesPanel,
  WorldStatus,
} from "./hud";
import { PauseMenu } from "./world-menu";

export function GameScreen({
  profile,
  settings,
  onSettingsChange,
  onExit,
}: {
  profile: WorldProfile;
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onExit: () => void;
}) {
  const savedPlayer = useMemo(() => readPlayerSave(profile.id), [profile.id]);
  const survivalMode = profile.mode === "survival";
  const savedSurvival = useMemo(
    () => (survivalMode ? readSurvivalSave(profile.id) : null),
    [profile.id, survivalMode],
  );
  const [survival, setSurvival] = useState<SurvivalState>(
    () => savedSurvival ?? createSurvivalState(),
  );
  const survivalRef = useRef(survival);
  survivalRef.current = survival;
  const environmentRef = useRef<SurvivalEnvironment>({
    underwater: false,
    inWater: false,
    moving: false,
    sprinting: false,
  });
  const [sessionKey, setSessionKey] = useState(0);
  const [worldTime, setWorldTime] = useState<number>(
    () => readWorldClock(profile.id) ?? START_TIME,
  );
  const worldTimeRef = useRef(worldTime);
  worldTimeRef.current = worldTime;
  const [world, setWorld] = useState<WorldData>(() =>
    initialWorld(profile, savedPlayer?.position ?? null),
  );
  const worldRef = useRef(world);
  worldRef.current = world;
  const [inventory, setInventory] = useState<Inventory>(
    () => savedPlayer?.inventory ?? createInventory(profile.mode),
  );
  const [playerPosition, setPlayerPosition] = useState<Position | null>(
    savedPlayer?.position ?? null,
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [target, setTarget] = useState<AimTarget | null>(null);
  const [miningProgress, setMiningProgress] = useState(0);
  const [started, setStarted] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [craftOpen, setCraftOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [flying, setFlying] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "unsaved">("saved");
  const [notice, setNotice] = useState("");
  const [mobileMove, setMobileMove] = useState({ forward: 0, side: 0, jump: false });
  const [supportsWebGL, setSupportsWebGL] = useState<boolean | null>(null);
  const noticeTimeout = useRef<number | undefined>(undefined);
  const streamCenter = useRef(
    getChunkCoordinates(savedPlayer?.position?.x ?? 0, savedPlayer?.position?.z ?? 0),
  );
  const selected = BLOCK_TYPES[selectedIndex] ?? "grass";
  const unlimited = profile.mode === "creative";
  const paused = craftOpen || pauseOpen || !survival.alive;

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

  useEffect(() => () => window.clearTimeout(noticeTimeout.current), []);

  // Leaving pointer lock hands the mouse back so panels can be clicked.
  useEffect(() => {
    if (!craftOpen && !pauseOpen) return;
    if (document.pointerLockElement) document.exitPointerLock?.();
  }, [craftOpen, pauseOpen]);

  // The renderer reports flight toggles so the HUD can show walking or flying.
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

  // Survival hazards are advanced on a slow clock; the renderer only reports
  // observations, so a paused or dead player cannot lose hunger or breath.
  useEffect(() => {
    if (!survivalMode || !started || paused) return;
    const timer = window.setInterval(() => {
      setSurvival((current) =>
        tickSurvival(current, environmentRef.current, profile.difficulty, 0.5),
      );
    }, 500);
    return () => window.clearInterval(timer);
  }, [paused, profile.difficulty, started, survivalMode]);

  // Death is not a pause state the player can dismiss by pressing Escape.
  useEffect(() => {
    if (survival.alive) return;
    if (document.pointerLockElement) document.exitPointerLock?.();
    setCraftOpen(false);
    setPauseOpen(false);
  }, [survival.alive]);

  // Save vitals periodically rather than on every half-second hunger tick.
  useEffect(() => {
    if (!survivalMode) return;
    const timer = window.setInterval(() => {
      saveSurvival(profile.id, survivalRef.current);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [profile.id, survivalMode]);

  // One real second is one in-game second. The clock stops with the pause menu.
  useEffect(() => {
    if (!started || paused) return;
    const timer = window.setInterval(() => {
      setWorldTime((current) => advanceWorldTime(current, 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [paused, started]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      saveWorldClock(profile.id, worldTimeRef.current);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [profile.id]);

  // The player's chunk is only recorded here; a timer then generates a few
  // missing chunks per tick (nearest first), so walking never causes one stall.
  const streamChunks = useCallback((chunkX: number, chunkZ: number) => {
    streamCenter.current = { x: chunkX, z: chunkZ };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = ensureChunks(
        worldRef.current,
        streamCenter.current.x,
        streamCenter.current.z,
        settings.renderRadius,
        3,
      );
      if (next === worldRef.current) return;
      worldRef.current = next;
      setWorld(next);
    }, 40);
    return () => window.clearInterval(timer);
  }, [settings.renderRadius]);

  const setWorldEdited = useCallback(
    (edit: (current: WorldData) => WorldData) => {
      const next = edit(worldRef.current);
      if (next === worldRef.current) return;
      worldRef.current = next;
      setWorld(next);
      setSaveState("unsaved");
      try {
        saveWorldData(profile.id, next);
      } catch {
        showNotice("This landscape could not be saved");
      }
      window.setTimeout(() => setSaveState("saved"), 450);
    },
    [profile.id, showNotice],
  );

  const mineBlock = useCallback(
    (cell: BlockCell) => {
      const current = worldRef.current;
      const found = getBlock(current, cell.x, cell.y, cell.z);
      if (!found) return;
      if (BLOCK_INFO[found].unbreakable) {
        showNotice("Bedrock will not budge");
        return;
      }
      setWorldEdited((latestWorld) => setBlock(latestWorld, cell.x, cell.y, cell.z, null));
      const foraged = survivalMode && isBerrySource(found);
      if (BLOCK_TYPES.includes(found as BlockType)) {
        const item = found as BlockType;
        setInventory((currentInventory) => ({
          ...currentInventory,
          [item]: currentInventory[item] + 1,
        }));
        if (foraged) setSurvival((current) => addBerries(current, 1));
        showNotice(
          foraged
            ? `${BLOCK_META[item].label} gathered · wild berries +1`
            : `${BLOCK_META[item].label} gathered`,
        );
      } else if (found === "flower") {
        showNotice("Wild bloom cleared");
      } else {
        showNotice(`${BLOCK_META[found].label} cleared`);
      }
    },
    [showNotice, setWorldEdited, survivalMode],
  );

  const placeBlock = useCallback(
    (cell: BlockCell, adjacent: AimTarget["adjacent"]) => {
      const currentWorld = worldRef.current;
      if (adjacent.y < 0 || adjacent.y > MAX_BUILD_HEIGHT) {
        showNotice("Build height reached");
        return;
      }
      if (!isChunkLoadedAt(currentWorld, adjacent.x, adjacent.z)) {
        showNotice("That area is still loading");
        return;
      }
      if (!unlimited && inventory[selected] < 1) {
        showNotice(`Out of ${BLOCK_META[selected].label.toLowerCase()}`);
        return;
      }
      const occupant = getBlock(worldRef.current, adjacent.x, adjacent.y, adjacent.z);
      if (occupant && occupant !== "water") return;
      const feetY = (playerPosition?.y ?? 4) - 3.7;
      const headY = feetY + 4;
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
      if (!unlimited) {
        setInventory((current) => ({
          ...current,
          [selected]: Math.max(0, current[selected] - 1),
        }));
      }
      showNotice(`${BLOCK_META[selected].label} placed`);
    },
    [inventory, playerPosition, selected, setWorldEdited, showNotice, unlimited],
  );

  const craft = useCallback(
    (recipe: CraftRecipe) => {
      if (!unlimited && !canCraft(recipe, inventory)) {
        showNotice("Not enough materials yet");
        return;
      }
      setInventory((current) =>
        unlimited
          ? { ...current, [recipe.output]: current[recipe.output] + recipe.count }
          : applyCraft(recipe, current),
      );
      showNotice(`Crafted ${recipe.label}`);
    },
    [inventory, showNotice, unlimited],
  );

  const eatForaged = useCallback(() => {
    if (!survivalMode) return;
    const current = survivalRef.current;
    if (current.berries < 1) {
      showNotice("No wild berries — clear leaves to forage");
      return;
    }
    if (current.hunger >= MAX_HUNGER) {
      showNotice("Not hungry yet");
      return;
    }
    const next = consumeBerries(current);
    survivalRef.current = next;
    setSurvival(next);
    showNotice("Wild berries restore a little hunger");
  }, [showNotice, survivalMode]);

  const handleFall = useCallback(
    (impactSpeed: number) => {
      if (!survivalMode) return;
      const amount = fallDamage(impactSpeed, profile.difficulty);
      if (amount <= 0) return;
      setSurvival((current) => applyDamage(current, amount, "fall"));
      showNotice(amount >= 6 ? "A heavy fall — find shelter" : "A rough landing");
    },
    [profile.difficulty, showNotice, survivalMode],
  );

  const handleVoid = useCallback(() => {
    if (!survivalMode) return;
    setSurvival((current) => applyDamage(current, MAX_HEALTH, "void"));
  }, [survivalMode]);

  const handleEnvironment = useCallback((environment: SurvivalEnvironment) => {
    environmentRef.current = environment;
  }, []);

  const savePlayerState = useCallback(
    (position?: Position) => {
      savePlayer(profile.id, inventory, position ?? playerPosition);
    },
    [inventory, playerPosition, profile.id],
  );

  useEffect(() => {
    const onSelect = (event: Event) => {
      const type = (event as CustomEvent<BlockType>).detail;
      const index = BLOCK_TYPES.indexOf(type);
      if (index >= 0) setSelectedIndex(index);
    };
    const onCycle = (event: Event) => {
      const direction = (event as CustomEvent<number>).detail;
      setSelectedIndex(
        (current) => (current + direction + BLOCK_TYPES.length) % BLOCK_TYPES.length,
      );
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
      if (event.code === "KeyF" && !event.repeat && survivalMode && !pauseOpen) {
        eatForaged();
        return;
      }
      if (event.code === "KeyC" && !event.repeat && !event.ctrlKey && !event.metaKey && !pauseOpen) {
        setCraftOpen((open) => !open);
        return;
      }
      if (event.code === "Escape") {
        if (craftOpen) setCraftOpen(false);
        else if (pauseOpen) {
          setPauseOpen(false);
          if (supportsWebGL === true && !window.matchMedia("(pointer: coarse)").matches) {
            const canvas = document.querySelector(".game-canvas canvas") as HTMLCanvasElement | null;
            canvas?.requestPointerLock?.();
          }
        } else if (started) setPauseOpen(true);
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
    const saveOnExit = () => {
      savePlayerState();
      saveWorldClock(profile.id, worldTimeRef.current);
      if (survivalMode) saveSurvival(profile.id, survivalRef.current);
    };
    window.addEventListener("beforeunload", saveOnExit);
    return () => {
      window.removeEventListener("pixel-wilds-select", onSelect);
      window.removeEventListener("pixel-wilds-cycle", onCycle);
      window.removeEventListener("pixel-wilds-slot", onSlot);
      window.removeEventListener("keydown", onPageKey);
      document.removeEventListener("pointerlockchange", onPointerChange);
      window.removeEventListener("beforeunload", saveOnExit);
    };
  }, [craftOpen, eatForaged, pauseOpen, profile.id, savePlayerState, started, supportsWebGL, survivalMode]);

  useEffect(() => {
    savePlayerState();
  }, [savePlayerState]);

  const beginExplore = () => {
    setPauseOpen(false);
    setStarted(true);
    if (supportsWebGL !== true || window.matchMedia("(pointer: coarse)").matches) return;
    const canvas = document.querySelector(".game-canvas canvas") as HTMLCanvasElement | null;
    canvas?.requestPointerLock?.();
  };

  const respawn = () => {
    const next = respawnSurvival(survivalRef.current);
    const spawn = findSpawn(worldRef.current);
    survivalRef.current = next;
    setSurvival(next);
    setPlayerPosition(spawn);
    setSessionKey((key) => key + 1);
    setMiningProgress(0);
    setPauseOpen(false);
    setCraftOpen(false);
    saveSurvival(profile.id, next);
    window.setTimeout(beginExplore, 0);
  };

  const loadedBlockCount = useMemo(() => getLoadedBlockCount(world), [world]);
  const loadedChunkCount = useMemo(() => getLoadedChunkCount(world), [world]);
  const biome = getBiomeAt(world.seed, playerPosition?.x ?? 0.5, playerPosition?.z ?? 0.5);
  const coordinates = playerPosition
    ? `${Math.floor(playerPosition.x)} · ${Math.floor(playerPosition.y)} · ${Math.floor(playerPosition.z)}`
    : "ROAM FREE";

  const saveNow = () => {
    try {
      saveWorldData(profile.id, worldRef.current);
      savePlayerState();
      saveWorldClock(profile.id, worldTimeRef.current);
      if (survivalMode) saveSurvival(profile.id, survivalRef.current);
      setSaveState("saved");
      showNotice("Landscape tucked away");
      return true;
    } catch {
      showNotice("Could not save this landscape");
      return false;
    }
  };

  const saveAndQuit = () => {
    if (document.pointerLockElement) document.exitPointerLock?.();
    saveNow();
    onExit();
  };

  const changeSettings = (next: AppSettings) => {
    onSettingsChange(next);
  };

  return (
    <main className={`game-shell ${survivalMode ? "is-survival" : ""}`} data-testid="game-world">
      {supportsWebGL !== true ? (
        <VoxelFallback
          key={`fallback-${sessionKey}`}
          world={world}
          onTarget={setTarget}
          onMine={mineBlock}
          onPlace={placeBlock}
          onPosition={setPlayerPosition}
          onChunkChange={streamChunks}
          onMineProgress={setMiningProgress}
          savedPosition={playerPosition}
          mobileMove={mobileMove}
          started={started}
          onStart={startFallback}
          paused={paused}
          allowFlight={unlimited}
          worldTime={worldTime}
          survivalMode={survivalMode}
          onEnvironment={handleEnvironment}
          onFall={handleFall}
          onVoid={handleVoid}
        />
      ) : (
        <Canvas
          className="game-canvas"
          dpr={[1, 1.35]}
          camera={{ position: [0.5, 60, 0.5], fov: settings.fov, near: 0.1, far: 400 }}
          gl={{ antialias: false, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.12;
          }}
        >
          <GameWorld
            key={`${world.seed}:${sessionKey}`}
            world={world}
            onTarget={setTarget}
            onMine={mineBlock}
            onPlace={placeBlock}
            onPosition={setPlayerPosition}
            onChunkChange={streamChunks}
            onMineProgress={setMiningProgress}
            savedPosition={playerPosition}
            mobileMove={mobileMove}
            renderRadius={settings.renderRadius}
            paused={paused}
            allowFlight={unlimited}
            fov={settings.fov}
            worldTime={worldTime}
            survivalMode={survivalMode}
            onEnvironment={handleEnvironment}
            onFall={handleFall}
            onVoid={handleVoid}
          />
        </Canvas>
      )}

      <div className="hud">
        <BrandLockup />
        <WorldClock seconds={worldTime} />
        <WorldStatus
          saveState={saveState}
          flying={flying}
          renderRadius={settings.renderRadius}
          onRenderRadiusChange={(value) => changeSettings({ ...settings, renderRadius: value })}
          onSave={saveNow}
          onPause={() => setPauseOpen(true)}
        />
        <WorldCard
          seed={world.seed}
          biome={biome}
          rulesOpen={rulesOpen}
          onToggleRules={() => setRulesOpen((current) => !current)}
        />
        <WorldRulesPanel open={rulesOpen} onClose={() => setRulesOpen(false)} />
        {survivalMode && <SurvivalHud state={survival} onEat={eatForaged} />}
        <Crosshair target={target} miningProgress={miningProgress} />
        <FieldReadouts
          biome={biome}
          coordinates={coordinates}
          loadedChunkCount={loadedChunkCount}
          loadedBlockCount={loadedBlockCount}
          renderRadius={settings.renderRadius}
        />
        <Hotbar
          inventory={inventory}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          unlimited={unlimited}
        />
        <CraftPanel
          open={craftOpen}
          inventory={inventory}
          onClose={() => setCraftOpen(false)}
          onCraft={craft}
          unlimited={unlimited}
        />
        <ToastNote notice={notice} />
        <WelcomeOverlay hidden={started || paused} onBegin={beginExplore} />
        <MobileControls
          onMove={setMobileMove}
          target={target}
          onMine={mineBlock}
          onPlace={placeBlock}
          onToggleCraft={() => setCraftOpen((open) => !open)}
        />
      </div>

      <PauseMenu
        open={pauseOpen}
        profile={profile}
        settings={settings}
        onChangeSettings={changeSettings}
        onResume={beginExplore}
        onSaveQuit={saveAndQuit}
      />
      {survivalMode && !survival.alive && (
        <DeathScreen state={survival} onRespawn={respawn} onQuit={saveAndQuit} />
      )}
    </main>
  );
}
