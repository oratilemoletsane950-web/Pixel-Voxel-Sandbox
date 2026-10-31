/**
 * Isometric 2D renderer used when WebGL2 is unavailable.
 *
 * It reads the same world state and runs the same physics as the 3D view, so
 * the game stays playable (and editable) instead of showing a renderer error.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import {
  blockKey,
  dayFraction,
  daylight,
  getChunkCoordinates,
  getVisibleBlocksNear,
  PLAYER_EYE_HEIGHT,
  skyPalette,
  sunHeight,
  type BlockCell,
  type WorldData,
} from "../game/world";
import {
  createPlayerMotion,
  isEyeUnderwater,
  isInWater,
  updatePlayerMotion,
  type PlayerMotion,
  type Position,
} from "../game/physics";
import type { SurvivalEnvironment } from "../game/player/survival";
import { DOUBLE_TAP_MS, TURN_SPEED } from "../game/player/controls";
import {
  findColumnTop,
  getHotbarIndexFromCode,
  type AimTarget,
} from "../game/player/aiming";
import {
  MIN_MINING_SECONDS,
  advanceMining,
  miningDuration,
  type MiningTool,
} from "../game/player/mining";
import type { DropField, ItemDrop } from "../game/player/drops";
import type { WeatherState } from "../game/world/weather";
import { weatherExposure } from "../game/world/weather-exposure";
import { findSpawn } from "../game/player/session";
import { BLOCK_COLORS } from "./block-palette";

export function VoxelFallback({
  world,
  onTarget,
  onMine,
  onPlace,
  onPosition,
  onChunkChange,
  onMineProgress,
  onLook,
  savedPosition,
  mobileMove,
  started,
  onStart,
  paused = false,
  allowFlight = true,
  worldTime,
  tool = null,
  drops,
  onCollectDrops,
  weather,
  onUse,
  survivalMode = false,
  onEnvironment,
  onFall,
  onVoid,
}: {
  world: WorldData;
  onTarget: (target: AimTarget | null) => void;
  onMine: (cell: BlockCell) => void;
  onPlace: (cell: BlockCell, adjacent: AimTarget["adjacent"]) => void;
  onPosition: (position: Position) => void;
  onChunkChange: (chunkX: number, chunkZ: number) => void;
  onMineProgress?: (progress: number) => void;
  onLook?: (yaw: number) => void;
  savedPosition: Position | null;
  mobileMove: { forward: number; side: number; jump: boolean };
  started: boolean;
  onStart: () => void;
  paused?: boolean;
  /** Survival worlds keep the player grounded; creative worlds may fly. */
  allowFlight?: boolean;
  worldTime: number;
  /** The equipped tool, or bare hands when null. */
  tool?: MiningTool | null;
  drops: DropField;
  onCollectDrops: (drops: ItemDrop[]) => void;
  weather: WeatherState;
  onUse: (cell: BlockCell) => void;
  survivalMode?: boolean;
  onEnvironment?: (environment: SurvivalEnvironment) => void;
  onFall?: (impactSpeed: number) => void;
  onVoid?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [player] = useState<PlayerMotion>(() =>
    createPlayerMotion(world, savedPosition ?? findSpawn(world)),
  );
  const keys = useRef<Record<string, boolean>>({});
  const moveRef = useRef(mobileMove);
  const targetRef = useRef<AimTarget | null>(null);
  const startedRef = useRef(started);
  const lastSpaceTap = useRef(0);
  const lastWTap = useRef(0);
  const forwardBoost = useRef(false);
  const yawRef = useRef(0);
  const lastPositionSent = useRef(0);
  const lastLookSent = useRef(0);
  const lastEnvironmentSent = useRef(0);
  const lastChunkKey = useRef("");
  const voidReported = useRef(false);
  const miningRef = useRef<{ key: string; progress: number } | null>(null);
  const lastMiningProgress = useRef(-1);
  moveRef.current = mobileMove;
  startedRef.current = started;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const allowFlightRef = useRef(allowFlight);
  allowFlightRef.current = allowFlight;

  const ordered = useMemo(
    () =>
      getVisibleBlocksNear(world, player.x, player.z, 34).sort(
        (a, b) => a.x + a.z + a.y - (b.x + b.z + b.y),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world],
  );
  const latest = useRef({
    world,
    ordered,
    onTarget,
    onMine,
    onPlace,
    onPosition,
    onChunkChange,
    onMineProgress,
    onLook,
    onStart,
    worldTime,
    tool,
    drops,
    onCollectDrops,
    weather,
    onUse,
    survivalMode,
    onEnvironment,
    onFall,
    onVoid,
  });
  latest.current = {
    world,
    ordered,
    onTarget,
    onMine,
    onPlace,
    onPosition,
    onChunkChange,
    onMineProgress,
    onLook,
    onStart,
    worldTime,
    tool,
    drops,
    onCollectDrops,
    weather,
    onUse,
    survivalMode,
    onEnvironment,
    onFall,
    onVoid,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let frame = 0;
    let lastTime = 0;

    const drawCube = (
      x: number,
      top: number,
      colors: [string, string, string],
      width: number,
      height: number,
      highlight: boolean,
    ) => {
      const [side, upper, front] = colors;
      context.beginPath();
      context.moveTo(x, top - height / 2);
      context.lineTo(x + width / 2, top);
      context.lineTo(x, top + height / 2);
      context.lineTo(x - width / 2, top);
      context.closePath();
      context.fillStyle = upper;
      context.fill();

      context.beginPath();
      context.moveTo(x - width / 2, top);
      context.lineTo(x, top + height / 2);
      context.lineTo(x, top + height / 2 + height);
      context.lineTo(x - width / 2, top + height);
      context.closePath();
      context.fillStyle = side;
      context.fill();

      context.beginPath();
      context.moveTo(x, top + height / 2);
      context.lineTo(x + width / 2, top);
      context.lineTo(x + width / 2, top + height);
      context.lineTo(x, top + height / 2 + height);
      context.closePath();
      context.fillStyle = front;
      context.fill();

      context.strokeStyle = highlight ? "#fff1a3" : "rgba(30, 55, 48, .27)";
      context.lineWidth = highlight ? 2 : 0.7;
      context.stroke();
    };

    const getTargetAt = (clientX: number, clientY: number): AimTarget | null => {
      const rect = canvas.getBoundingClientRect();
      const tileWidth = Math.max(21, Math.min(36, rect.width / 31));
      const tileHeight = tileWidth * 0.48;
      const projectedX = ((clientX - rect.left - rect.width / 2) * 2) / tileWidth;
      const projectedZ =
        ((clientY - rect.top - rect.height * 0.51) * 2) / tileHeight;
      const x = Math.floor(player.x + (projectedX + projectedZ) / 2);
      const z = Math.floor(player.z + (projectedZ - projectedX) / 2);
      const top = findColumnTop(latest.current.world, x, z);
      if (!top) return null;
      return {
        cell: { x, y: top.y, z, type: top.type },
        adjacent: { x, y: top.y + 1, z },
      };
    };

    const stopMining = () => {
      if (!miningRef.current) return;
      miningRef.current = null;
      lastMiningProgress.current = -1;
      latest.current.onMineProgress?.(0);
    };

    const startMining = (cell: BlockCell) => {
      const duration = miningDuration(cell.type, latest.current.tool);
      if (!Number.isFinite(duration) || duration <= MIN_MINING_SECONDS) {
        stopMining();
        latest.current.onMine(cell);
        return;
      }
      miningRef.current = {
        key: blockKey(cell.x, cell.y, cell.z),
        progress: 0,
      };
      lastMiningProgress.current = 0;
      latest.current.onMineProgress?.(0.01);
    };

    const updateTarget = (nextTarget: AimTarget | null) => {
      const previous = targetRef.current;
      const previousKey = previous
        ? blockKey(previous.cell.x, previous.cell.y, previous.cell.z)
        : "";
      const nextKey = nextTarget
        ? blockKey(nextTarget.cell.x, nextTarget.cell.y, nextTarget.cell.z)
        : "";
      if (miningRef.current && nextKey !== miningRef.current.key) stopMining();
      targetRef.current = nextTarget;
      if (previousKey !== nextKey) latest.current.onTarget(nextTarget);
    };

    const onPointerMove = (event: PointerEvent) => {
      updateTarget(getTargetAt(event.clientX, event.clientY));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!startedRef.current) latest.current.onStart();
      event.preventDefault();
      updateTarget(getTargetAt(event.clientX, event.clientY));
      const hit = targetRef.current;
      if (!hit) return;
      if (event.button === 0) startMining(hit.cell);
      if (event.button === 2) {
        if (hit.cell.type === "chest") latest.current.onUse(hit.cell);
        else latest.current.onPlace(hit.cell, hit.adjacent);
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button === 0) stopMining();
    };
    const onContextMenu = (event: Event) => event.preventDefault();
    const onKeyDown = (event: KeyboardEvent) => {
      keys.current[event.code] = true;
      if (event.code === "KeyW" && !event.repeat && startedRef.current) {
        const now = performance.now();
        if (now - lastWTap.current <= DOUBLE_TAP_MS && lastWTap.current > 0) forwardBoost.current = true;
        lastWTap.current = now;
      }
      if (event.code === "Space" && !event.repeat && startedRef.current && allowFlightRef.current) {
        const now = performance.now();
        if (now - lastSpaceTap.current < DOUBLE_TAP_MS) {
          lastSpaceTap.current = 0;
          player.flying = !player.flying;
          player.velocityY = 0;
          window.dispatchEvent(new CustomEvent("pixel-wilds-fly", { detail: player.flying }));
        } else {
          lastSpaceTap.current = now;
        }
      }
      if (
        ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code) ||
        getHotbarIndexFromCode(event.code) >= 0
      ) {
        event.preventDefault();
      }
      const index = getHotbarIndexFromCode(event.code);
      if (index >= 0) window.dispatchEvent(new CustomEvent("pixel-wilds-slot", { detail: index }));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.current[event.code] = false;
      if (event.code === "KeyW") { forwardBoost.current = false; lastWTap.current = 0; }
    };
    const onBlur = () => {
      keys.current = {};
      forwardBoost.current = false;
      lastWTap.current = 0;
      stopMining();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      window.dispatchEvent(
        new CustomEvent("pixel-wilds-cycle", { detail: event.deltaY > 0 ? 1 : -1 }),
      );
    };
    const onResize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
    };

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    onResize();

    const render = (time: number) => {
      frame = window.requestAnimationFrame(render);
      const dt = Math.min((time - lastTime) / 1000 || 0, 0.05);
      lastTime = time;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.imageSmoothingEnabled = false;

      if (miningRef.current && (pausedRef.current || !startedRef.current)) stopMining();

      if (startedRef.current && !pausedRef.current) {
        // Arrow keys turn the walking direction; the isometric view stays put.
        const turn = Number(Boolean(keys.current.ArrowLeft)) - Number(Boolean(keys.current.ArrowRight));
        if (turn !== 0) yawRef.current += turn * TURN_SPEED * dt;
        const inputForward =
          Number(Boolean(keys.current.KeyW || keys.current.ArrowUp)) -
          Number(Boolean(keys.current.KeyS || keys.current.ArrowDown)) +
          moveRef.current.forward;
        const inputSide =
          Number(Boolean(keys.current.KeyD)) -
          Number(Boolean(keys.current.KeyA)) +
          moveRef.current.side;
        const wasGrounded = player.grounded;
        const previousVelocityY = player.velocityY;
        const wasFlying = player.flying;
        const wasInWater = isInWater(latest.current.world, player);
        updatePlayerMotion(
          latest.current.world,
          player,
          {
            forward: inputForward,
            side: inputSide,
            jump: Boolean(keys.current.Space || moveRef.current.jump),
            sprint: Boolean(keys.current.ShiftLeft || keys.current.ShiftRight || (forwardBoost.current && keys.current.KeyW)),
            descend: Boolean(keys.current.ControlLeft || keys.current.ControlRight),
          },
          yawRef.current,
          dt,
        );
        const chunk = getChunkCoordinates(player.x, player.z);
        const chunkKeyNow = `${chunk.x},${chunk.z}`;
        if (chunkKeyNow !== lastChunkKey.current) {
          lastChunkKey.current = chunkKeyNow;
          latest.current.onChunkChange(chunk.x, chunk.z);
        }
        if (
          latest.current.survivalMode &&
          !wasGrounded &&
          player.grounded &&
          !wasFlying &&
          !wasInWater &&
          previousVelocityY < 0
        ) {
          latest.current.onFall?.(-previousVelocityY);
        }
        if (time - lastEnvironmentSent.current > 250) {
          lastEnvironmentSent.current = time;
          latest.current.onEnvironment?.({
            underwater: isEyeUnderwater(latest.current.world, player),
            inWater: isInWater(latest.current.world, player),
            moving: Math.hypot(player.velocityX, player.velocityZ) > 0.6,
            sprinting: Boolean(keys.current.ShiftLeft || keys.current.ShiftRight || (forwardBoost.current && keys.current.KeyW)),
            ...weatherExposure(
              latest.current.world,
              player,
              latest.current.weather,
              latest.current.weather.kind === "snow",
            ),
          });
        }
        if (player.y < -40) {
          const wasFlying = player.flying;
          if (latest.current.survivalMode) {
            if (!voidReported.current) {
              voidReported.current = true;
              latest.current.onVoid?.();
            }
          } else if (wasFlying) {
            window.dispatchEvent(new CustomEvent("pixel-wilds-fly", { detail: false }));
          }
          Object.assign(
            player,
            createPlayerMotion(latest.current.world, findSpawn(latest.current.world)),
          );
          player.flying = false;
        }
        if (miningRef.current) {
          const hit = targetRef.current;
          if (!hit || blockKey(hit.cell.x, hit.cell.y, hit.cell.z) !== miningRef.current.key) {
            stopMining();
          } else {
            const step = advanceMining(
              miningRef.current.progress,
              dt,
              hit.cell.type,
              latest.current.tool,
            );
            miningRef.current.progress = step.progress;
            if (step.complete) {
              const cell = hit.cell;
              miningRef.current = null;
              lastMiningProgress.current = -1;
              latest.current.onMineProgress?.(0);
              latest.current.onMine(cell);
            } else if (step.progress - lastMiningProgress.current >= 0.02) {
              lastMiningProgress.current = step.progress;
              latest.current.onMineProgress?.(step.progress);
            }
          }
        }
        const collected = latest.current.drops.tick(latest.current.world, player, dt);
        if (collected.length > 0) latest.current.onCollectDrops(collected);
        if (time - lastPositionSent.current > 350) {
          lastPositionSent.current = time;
          latest.current.onPosition({ x: player.x, y: player.y, z: player.z });
        }
        if (time - lastLookSent.current > 250) {
          lastLookSent.current = time;
          latest.current.onLook?.(yawRef.current);
        }
      }

      const width = rect.width;
      const height = rect.height;
      const worldTime = latest.current.worldTime;
      const palette = skyPalette(worldTime);
      const light = daylight(worldTime);
      const angle = Math.PI * 2 * (dayFraction(worldTime) - 0.25);
      const elevation = sunHeight(worldTime);
      const background = context.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, palette.sky);
      background.addColorStop(0.58, palette.fog);
      background.addColorStop(1, palette.ambient);
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      if (elevation > -0.18) {
        const sunX = width * (0.5 + Math.cos(angle) * 0.32);
        const sunY = height * (0.3 - elevation * 0.16);
        context.fillStyle = palette.sun;
        context.fillRect(sunX - 15, sunY - 15, 30, 30);
        context.fillRect(sunX - 8, sunY - 22, 16, 44);
        context.fillRect(sunX - 22, sunY - 8, 44, 16);
      } else {
        const moonX = width * (0.5 - Math.cos(angle) * 0.32);
        const moonY = height * (0.3 + elevation * 0.16);
        context.fillStyle = "rgba(220, 233, 230, .84)";
        context.fillRect(moonX - 11, moonY - 11, 22, 22);
      }

      const tileWidth = Math.max(21, Math.min(36, width / 31));
      const tileHeight = tileWidth * 0.48;
      const blockHeight = tileHeight * 1.02;
      const baseY = Math.floor(player.y - 1 - PLAYER_EYE_HEIGHT);
      const centerY = height * 0.51;
      for (const cell of latest.current.ordered) {
        const dx = cell.x + 0.5 - player.x;
        const dz = cell.z + 0.5 - player.z;
        if (Math.abs(dx) > 31 || Math.abs(dz) > 31) continue;
        const centerX = width / 2 + ((dx - dz) * tileWidth) / 2;
        const top = centerY + ((dx + dz) * tileHeight) / 2 -
          (cell.y - baseY) * blockHeight;
        if (
          centerX < -tileWidth || centerX > width + tileWidth ||
          top < -blockHeight * 2 || top > height + blockHeight
        ) continue;
        const highlighted =
          targetRef.current?.cell.x === cell.x &&
          targetRef.current?.cell.y === cell.y &&
          targetRef.current?.cell.z === cell.z;
        drawCube(
          centerX,
          top,
          BLOCK_COLORS[cell.type],
          tileWidth,
          blockHeight,
          highlighted,
        );
      }

      for (const drop of latest.current.drops.items) {
        const dx = drop.x - player.x;
        const dz = drop.z - player.z;
        if (Math.abs(dx) > 31 || Math.abs(dz) > 31) continue;
        const centerX = width / 2 + ((dx - dz) * tileWidth) / 2;
        const bob = drop.settled ? Math.sin(drop.age * 4 + drop.id) * blockHeight * 0.08 : 0;
        const top = centerY + ((dx + dz) * tileHeight) / 2 -
          (drop.y - 0.5 - baseY) * blockHeight + bob;
        drawCube(
          centerX,
          top,
          BLOCK_COLORS[drop.item],
          tileWidth * 0.24,
          blockHeight * 0.24,
          false,
        );
      }

      const weatherState = latest.current.weather;
      if (weatherState.kind !== "clear") {
        const storm = weatherState.kind === "storm";
        const snow = weatherState.kind === "snow";
        const count = storm ? 120 : 78;
        context.save();
        context.globalAlpha = snow ? 0.72 : 0.46;
        if (snow) {
          context.fillStyle = "#f3f6eb";
          for (let index = 0; index < count; index += 1) {
            const x = (index * 73 + time * 0.018) % width;
            const y = (index * 47 + time * 0.055) % height;
            context.fillRect(x, y, 2, 2);
          }
        } else {
          context.strokeStyle = storm ? "#a9d1e2" : "#c1dfE8";
          context.lineWidth = storm ? 1.4 : 1;
          for (let index = 0; index < count; index += 1) {
            const x = (index * 83 + time * 0.12) % width;
            const y = (index * 59 + time * 0.38) % height;
            context.beginPath();
            context.moveTo(x, y);
            context.lineTo(x - 3, y + 12);
            context.stroke();
          }
        }
        context.restore();
      }

      const darkness = (1 - light) * 0.36 + (weatherState.wet ? 0.1 : 0);
      if (darkness > 0.01) {
        context.fillStyle = `rgba(9, 18, 24, ${darkness})`;
        context.fillRect(0, 0, width, height);
      }
    };
    frame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frame);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="voxel-fallback"
      aria-label="Voxel wilderness, isometric view"
      data-testid="canvas-voxel-fallback"
    />
  );
}
