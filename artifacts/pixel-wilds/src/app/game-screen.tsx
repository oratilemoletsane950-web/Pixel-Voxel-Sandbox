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
import {
  containerKey,
  containerTotal,
  deposit as depositIntoContainer,
  readContainers,
  saveContainers,
  withdraw as withdrawFromContainer,
  type ContainerMap,
} from "../game/containers";
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
  CREATIVE_MINING_TOOL,
  canHarvest,
  harvestRefusal,
} from "../game/player/mining";
import {
  createDropField,
  readDropSave,
  saveDropState,
  type ItemDrop,
} from "../game/player/drops";
import {
  craftTool as craftFieldTool,
  cycleTool,
  equipTool,
  equippedTool,
  readToolState,
  repairTool as repairFieldTool,
  saveToolState,
  toolDefinition,
  wearTool,
  type ToolId,
  type ToolState,
} from "../game/player/tools";
import { isColdBiome, weatherAt } from "../game/world/weather";
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
  Compass,
  ContainerPanel,
  CraftPanel,
  Crosshair,
  DeathScreen,
  FieldReadouts,
  Hotbar,
  MobileControls,
  SurvivalHud,
  ToastNote,
  WelcomeOverlay,
  WeatherBadge,
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
  const savedToolState = useMemo(() => readToolState(profile.id), [profile.id]);
  const [toolState, setToolState] = useState<ToolState>(savedToolState);
  const toolStateRef = useRef(toolState);
  toolStateRef.current = toolState;
  const dropField = useMemo(() => createDropField(readDropSave(profile.id)), [profile.id]);
  const savedContainers = useMemo(() => readContainers(profile.id), [profile.id]);
  const [containers, setContainers] = useState<ContainerMap>(savedContainers);
  const containersRef = useRef(containers);
  containersRef.current = containers;
  const [openChest, setOpenChest] = useState<{ x: number; y: number; z: number } | null>(null);
  const [playerPosition, setPlayerPosition] = useState<Position | null>(
    savedPlayer?.position ?? null,
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [target, setTarget] = useState<AimTarget | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const [lookYaw, setLookYaw] = useState(0);
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
  const currentTool = equippedTool(toolState);
  const currentToolDurability = currentTool ? toolState.belt[currentTool.id] : 0;
  const miningTool = unlimited
    ? currentTool
      ? { ...currentTool, creative: true }
      : CREATIVE_MINING_TOOL
    : currentTool;
  const paused = craftOpen || pauseOpen || Boolean(openChest) || !survival.alive;

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
    if (!craftOpen && !pauseOpen && !openChest) return;
    if (document.pointerLockElement) document.exitPointerLock?.();
  }, [craftOpen, openChest, pauseOpen]);

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

  // Tool wear changes once per broken block, so persist immediately.
  useEffect(() => {
    saveToolState(profile.id, toolState);
  }, [profile.id, toolState]);

  // Drops are simulated outside React; save them on a slow clock and on exit.
  useEffect(() => {
    const timer = window.setInterval(() => saveDropState(profile.id, dropField), 5000);
    return () => window.clearInterval(timer);
  }, [dropField, profile.id]);

  useEffect(() => {
    saveContainers(profile.id, containers);
  }, [containers, profile.id]);

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

  const useBlock = useCallback((cell: BlockCell) => {
    if (getBlock(worldRef.current, cell.x, cell.y, cell.z) !== "chest") return;
    setCraftOpen(false);
    setOpenChest({ x: cell.x, y: cell.y, z: cell.z });
  }, []);

  const transferChestItem = useCallback(
    (item: BlockType, amount: number, mode: "deposit" | "withdraw") => {
      if (!openChest) return;
      const key = containerKey(openChest);
      const current = containersRef.current[key] ?? {};
      const result = mode === "deposit"
        ? depositIntoContainer(current, inventory, item, amount)
        : withdrawFromContainer(current, inventory, item, amount);
      if (result.moved === 0) {
        showNotice(result.blocked ? "Chest is full" : "Nothing to move");
        return;
      }
      const next = { ...containersRef.current };
      if (containerTotal(result.contents) === 0) delete next[key];
      else next[key] = result.contents;
      containersRef.current = next;
      setContainers(next);
      setInventory(result.inventory);
      saveContainers(profile.id, next);
      showNotice(`${mode === "deposit" ? "Stored" : "Took"} ${result.moved} ${BLOCK_META[item].label.toLowerCase()}`);
    },
    [inventory, openChest, profile.id, showNotice],
  );

  const collectDrops = useCallback(
    (drops: ItemDrop[]) => {
      if (drops.length === 0) return;
      setInventory((currentInventory) => {
        const next = { ...currentInventory };
        for (const drop of drops) next[drop.item] += 1;
        return next;
      });
      saveDropState(profile.id, dropField);
      showNotice(
        drops.length === 1
          ? `${BLOCK_META[drops[0].item].label} gathered`
          : `${drops.length} items gathered`,
      );
    },
    [dropField, profile.id, showNotice],
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
      const chestKey = found === "chest" ? containerKey(cell) : null;
      const chestContents = chestKey ? containersRef.current[chestKey] : null;
      const chestStored = chestContents ? containerTotal(chestContents) : 0;
      const activeTool = equippedTool(toolStateRef.current);
      if (!unlimited && !canHarvest(found, activeTool)) {
        showNotice(harvestRefusal(found, activeTool) || "That block needs a stronger tool");
        return;
      }

      setWorldEdited((latestWorld) => setBlock(latestWorld, cell.x, cell.y, cell.z, null));
      const foraged = survivalMode && isBerrySource(found);
      let message: string;
      if (BLOCK_TYPES.includes(found as BlockType)) {
        const item = found as BlockType;
        if (foraged) setSurvival((current) => addBerries(current, 1));
        if (unlimited) {
          message = `${BLOCK_META[item].label} cleared`;
        } else {
          const drop = dropField.spawn(item, cell);
          if (drop) {
            saveDropState(profile.id, dropField);
            message = foraged
              ? `${BLOCK_META[item].label} dropped · wild berries +1`
              : `${BLOCK_META[item].label} dropped · walk over to collect`;
          } else {
            // Never lose a block just because the visible drop field is full.
            setInventory((currentInventory) => ({
              ...currentInventory,
              [item]: currentInventory[item] + 1,
            }));
            message = foraged
              ? `${BLOCK_META[item].label} gathered · wild berries +1`
              : `${BLOCK_META[item].label} gathered`;
          }
        }
      } else if (found === "flower") {
        message = "Wild bloom cleared";
      } else {
        message = `${BLOCK_META[found].label} cleared`;
      }

      // A tool wears once per broken block, never per frame or per tick.
      if (!unlimited && activeTool) {
        const worn = wearTool(toolStateRef.current, activeTool.id);
        toolStateRef.current = worn.state;
        setToolState(worn.state);
        if (worn.broke) message = `${message} · ${activeTool.label} broke`;
      }
      if (chestKey) {
        const next = { ...containersRef.current };
        delete next[chestKey];
        containersRef.current = next;
        setContainers(next);
      }
      if (chestStored > 0) {
        setInventory((currentInventory) => {
          const next = { ...currentInventory };
          for (const [item, count] of Object.entries(chestContents ?? {})) {
            if (count) next[item as BlockType] += count;
          }
          return next;
        });
        message = `${message} · ${chestStored} stored items recovered`;
      }
      showNotice(message);
    },
    [dropField, profile.id, showNotice, setWorldEdited, survivalMode, unlimited],
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

  const craftFieldToolAtBench = useCallback(
    (id: ToolId) => {
      const definition = toolDefinition(id);
      if (!definition) return;
      const result = craftFieldTool(id, inventory, toolStateRef.current, unlimited);
      if (!result) {
        showNotice("Not enough materials for that tool");
        return;
      }
      setInventory(result.inventory);
      toolStateRef.current = result.state;
      setToolState(result.state);
      showNotice(`${definition.label} ready · ${definition.maxDurability} uses`);
    },
    [inventory, showNotice, unlimited],
  );

  const repairFieldToolAtBench = useCallback(
    (id: ToolId) => {
      const definition = toolDefinition(id);
      if (!definition) return;
      const result = repairFieldTool(id, inventory, toolStateRef.current, unlimited);
      if (!result) {
        showNotice("Repairing needs the listed materials");
        return;
      }
      setInventory(result.inventory);
      toolStateRef.current = result.state;
      setToolState(result.state);
      showNotice(`${definition.label} repaired · ${definition.maxDurability} uses`);
    },
    [inventory, showNotice, unlimited],
  );

  const equipFieldTool = useCallback(
    (id: ToolId) => {
      const next = equipTool(toolStateRef.current, id);
      toolStateRef.current = next;
      setToolState(next);
      showNotice(`${toolDefinition(id)?.label ?? "Tool"} equipped`);
    },
    [showNotice],
  );

  const cycleEquippedTool = useCallback(() => {
    const next = cycleTool(toolStateRef.current);
    toolStateRef.current = next;
    setToolState(next);
    const tool = equippedTool(next);
    showNotice(tool ? `${tool.label} ready` : "Bare hands · craft tools at the workbench");
  }, [showNotice]);

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
      if (event.code === "KeyT" && !event.repeat && !event.ctrlKey && !event.metaKey && !pauseOpen) {
        cycleEquippedTool();
        return;
      }
      if (event.code === "KeyE" && !event.repeat && !openChest && targetRef.current?.cell.type === "chest") {
        useBlock(targetRef.current.cell);
        return;
      }
      if (event.code === "Escape") {
        if (openChest) setOpenChest(null);
        else if (craftOpen) setCraftOpen(false);
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
      saveToolState(profile.id, toolStateRef.current);
      saveDropState(profile.id, dropField);
      saveContainers(profile.id, containersRef.current);
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
  }, [craftOpen, cycleEquippedTool, dropField, eatForaged, openChest, pauseOpen, profile.id, savePlayerState, started, supportsWebGL, survivalMode, useBlock]);

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
  const weather = useMemo(
    () => weatherAt(world.seed, worldTime, isColdBiome(biome)),
    [biome, world.seed, worldTime],
  );
  const coordinates = playerPosition
    ? `${Math.floor(playerPosition.x)} · ${Math.floor(playerPosition.y)} · ${Math.floor(playerPosition.z)}`
    : "ROAM FREE";

  const saveNow = () => {
    try {
      saveWorldData(profile.id, worldRef.current);
      savePlayerState();
      saveWorldClock(profile.id, worldTimeRef.current);
      if (survivalMode) saveSurvival(profile.id, survivalRef.current);
      saveToolState(profile.id, toolStateRef.current);
      saveDropState(profile.id, dropField);
      saveContainers(profile.id, containersRef.current);
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
          onLook={setLookYaw}
          savedPosition={playerPosition}
          mobileMove={mobileMove}
          started={started}
          onStart={startFallback}
          paused={paused}
          allowFlight={unlimited}
          worldTime={worldTime}
          tool={miningTool}
          drops={dropField}
          onCollectDrops={collectDrops}
          weather={weather}
          onUse={useBlock}
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
          onLook={setLookYaw}
          savedPosition={playerPosition}
            mobileMove={mobileMove}
            renderRadius={settings.renderRadius}
            paused={paused}
            allowFlight={unlimited}
            fov={settings.fov}
            worldTime={worldTime}
            tool={miningTool}
            drops={dropField}
            onCollectDrops={collectDrops}
            weather={weather}
            onUse={useBlock}
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
        <WeatherBadge weather={weather} />
        <Compass yaw={lookYaw} />
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
          tool={currentTool}
          toolDurability={currentToolDurability}
          onCycleTool={cycleEquippedTool}
        />
        <ContainerPanel
          open={Boolean(openChest)}
          position={openChest ? `${openChest.x} · ${openChest.y} · ${openChest.z}` : ""}
          contents={openChest ? containers[containerKey(openChest)] ?? {} : {}}
          inventory={inventory}
          onClose={() => setOpenChest(null)}
          onDeposit={(item, amount) => transferChestItem(item, amount, "deposit")}
          onWithdraw={(item, amount) => transferChestItem(item, amount, "withdraw")}
        />
        <CraftPanel
          open={craftOpen}
          inventory={inventory}
          toolbelt={toolState.belt}
          equippedToolId={toolState.equipped}
          onClose={() => setCraftOpen(false)}
          onCraft={craft}
          onCraftTool={craftFieldToolAtBench}
          onEquipTool={equipFieldTool}
          onRepairTool={repairFieldToolAtBench}
          unlimited={unlimited}
        />
        <ToastNote notice={notice} />
        <WelcomeOverlay hidden={started || paused} onBegin={beginExplore} />
        <MobileControls
          onMove={setMobileMove}
          target={target}
          onMine={mineBlock}
          onPlace={placeBlock}
          onUse={useBlock}
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
