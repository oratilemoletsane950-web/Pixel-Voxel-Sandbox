/**
 * The WebGL game view: camera, input, chunk meshes, fog and the aim highlight.
 *
 * Extracted from `App.tsx` so the shell owns UI state and this module owns the
 * render loop. It talks to the rest of the game through callbacks only, which
 * keeps it replaceable (the 2D fallback implements the same contract).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { CHUNK_SIZE, chunkKey } from "../game/chunk";
import {
  blockKey,
  dayFraction,
  getChunkCoordinates,
  skyPalette,
  sunHeight,
  type BlockCell,
  type WorldData,
} from "../game/world";
import { createAtlasTexture } from "../game/textures";
import {
  createPlayerMotion,
  isEyeUnderwater,
  isInWater,
  updatePlayerMotion,
  type PlayerMotion,
  type Position,
} from "../game/physics";
import type { SurvivalEnvironment } from "../game/player/survival";
import {
  DOUBLE_TAP_MS,
  REACH_BLOCKS,
  TURN_SPEED,
} from "../game/player/controls";
import {
  getHotbarIndexFromCode,
  traceVoxelWorld,
  type AimTarget,
} from "../game/player/aiming";
import {
  MIN_MINING_SECONDS,
  advanceMining,
  miningDuration,
  type MiningTool,
} from "../game/player/mining";
import {
  MAX_DROPS,
  type DropField,
  type ItemDrop,
} from "../game/player/drops";
import type { WeatherState } from "../game/world/weather";
import { findSpawn } from "../game/player/session";
import { BLOCK_COLORS } from "./block-palette";
import { ChunkMesh, chunkSignature, type ChunkMaterials } from "./chunk-mesh";

function DroppedLoot({
  field,
  player,
  worldRef,
  paused,
  onCollect,
}: {
  field: DropField;
  player: PlayerMotion;
  worldRef: { current: WorldData };
  paused: boolean;
  onCollect: (drops: ItemDrop[]) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const onCollectRef = useRef(onCollect);
  onCollectRef.current = onCollect;
  const geometry = useMemo(() => new THREE.BoxGeometry(0.34, 0.34, 0.34), []);
  const material = useMemo(() => new THREE.MeshLambertMaterial(), []);
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = 0;
    // Pre-allocate the full instance colour buffer so growing the visible
    // field never writes outside a smaller buffer created on an earlier frame.
    if (!mesh.instanceColor) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(MAX_DROPS * 3).fill(1),
        3,
      );
    }
  }, []);
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((_, delta) => {
    if (!paused) {
      const collected = field.tick(worldRef.current, player, delta);
      if (collected.length > 0) onCollectRef.current(collected);
    }
    const mesh = meshRef.current;
    if (!mesh) return;
    const count = field.items.length;
    mesh.count = count;
    for (let index = 0; index < count; index += 1) {
      const drop = field.items[index];
      const bob = drop.settled ? Math.sin(drop.age * 4 + drop.id) * 0.07 : 0;
      dummy.position.set(drop.x, drop.y + 0.18 + bob, drop.z);
      dummy.rotation.set(0, drop.age * 1.8 + drop.id * 0.7, 0);
      dummy.scale.setScalar(0.86 + Math.sin(drop.age * 5 + drop.id) * 0.06);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      color.set(BLOCK_COLORS[drop.item][0]);
      mesh.setColorAt(index, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_DROPS]}
      frustumCulled={false}
    />
  );
}

const WEATHER_PARTICLES = 700;

function WeatherParticles({ weather }: { weather: WeatherState }) {
  const { camera } = useThree();
  const pointsRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const data = new Float32Array(WEATHER_PARTICLES * 3);
    for (let index = 0; index < WEATHER_PARTICLES; index += 1) {
      data[index * 3] = ((index * 37) % 100) / 100 * 50 - 25;
      data[index * 3 + 1] = ((index * 53) % 100) / 100 * 38;
      data[index * 3 + 2] = ((index * 71) % 100) / 100 * 50 - 25;
    }
    return data;
  }, []);
  const geometry = useMemo(() => new THREE.BufferGeometry(), []);
  const material = useMemo(() => new THREE.PointsMaterial({
    color: "#b8dbea",
    size: 0.12,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    sizeAttenuation: true,
  }), []);
  useEffect(() => {
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 0);
    return () => geometry.dispose();
  }, [geometry, positions]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame((_, delta) => {
    const kind = weather.kind;
    if (pointsRef.current) pointsRef.current.visible = kind !== "clear";
    if (kind === "clear") return;
    const count = kind === "storm" ? WEATHER_PARTICLES : kind === "snow" ? 420 : 520;
    geometry.setDrawRange(0, count);
    const fall = kind === "snow" ? 2.8 : 17;
    const wind = kind === "storm" ? 4.5 : 1.1;
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      positions[offset] += wind * delta * (0.35 + ((index * 17) % 10) / 10);
      positions[offset + 1] -= fall * delta;
      if (positions[offset + 1] < camera.position.y - 10) {
        positions[offset] = camera.position.x + (((index * 73) % 100) / 100 - 0.5) * 46;
        positions[offset + 1] = camera.position.y + 20 + ((index * 29) % 100) / 100 * 8;
        positions[offset + 2] = camera.position.z + (((index * 47) % 100) / 100 - 0.5) * 46;
      }
    }
    geometry.attributes.position.needsUpdate = true;
    material.color.set(kind === "snow" ? "#f3f6eb" : kind === "storm" ? "#8bb6cf" : "#a7d1df");
    material.size = kind === "snow" ? 0.2 : 0.1;
    material.opacity = kind === "snow" ? 0.86 : 0.5;
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <primitive object={geometry} attach="geometry" />
      <primitive object={material} attach="material" />
    </points>
  );
}

function HeldTool({ tool, paused }: { tool: MiningTool | null; paused: boolean }) {
  const group = useRef<THREE.Group>(null);
  const clock = useRef(0);
  const { camera } = useThree();

  useFrame((_, delta) => {
    if (!group.current) return;
    clock.current += paused ? 0 : delta;
    group.current.position.copy(camera.position);
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    group.current.position.addScaledVector(direction, 0.72);
    group.current.quaternion.copy(camera.quaternion);
    group.current.translateX(0.34);
    group.current.translateY(-0.3);
    group.current.rotateZ(-0.08 + Math.sin(clock.current * 2.2) * 0.018);
    group.current.rotateX(-0.12 + Math.sin(clock.current * 1.7) * 0.012);
  });

  if (!tool) return null;
  const metal = tool.tier >= 3 ? "#d7b263" : tool.tier === 2 ? "#b9c3bb" : "#b78b5e";
  return (
    <group ref={group} renderOrder={12} frustumCulled={false}>
      <mesh position={[0, -0.18, 0]}>
        <boxGeometry args={[0.065, 0.7, 0.065]} />
        <meshLambertMaterial color="#7e5234" depthTest={false} />
      </mesh>
      {tool.kind === "pickaxe" && (
        <mesh position={[0, 0.21, 0]} rotation={[0, 0, 0.08]}>
          <boxGeometry args={[0.48, 0.085, 0.09]} />
          <meshLambertMaterial color={metal} depthTest={false} />
        </mesh>
      )}
      {tool.kind === "axe" && (
        <mesh position={[0.08, 0.2, 0]} rotation={[0, 0, 0.18]}>
          <boxGeometry args={[0.28, 0.25, 0.085]} />
          <meshLambertMaterial color={metal} depthTest={false} />
        </mesh>
      )}
      {tool.kind === "shovel" && (
        <mesh position={[0, 0.24, 0]}>
          <boxGeometry args={[0.22, 0.27, 0.075]} />
          <meshLambertMaterial color={metal} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}

export function GameWorld({
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
  renderRadius,
  paused,
  allowFlight,
  fov,
  worldTime,
  tool = null,
  drops,
  onCollectDrops,
  weather,
  touchSensitivity = 1,
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
  renderRadius: number;
  /** True while the workbench or pause menu is open: no moving or turning. */
  paused: boolean;
  /** Survival worlds keep the player grounded; creative worlds may fly. */
  allowFlight: boolean;
  fov: number;
  worldTime: number;
  /** The equipped tool, or bare hands when null. */
  tool?: MiningTool | null;
  /** Live dropped blocks, simulated in the render frame. */
  drops: DropField;
  onCollectDrops: (drops: ItemDrop[]) => void;
  weather: WeatherState;
  touchSensitivity?: number;
  onUse: (cell: BlockCell) => void;
  /** Survival reports hazards to the session; creative ignores them. */
  survivalMode?: boolean;
  onEnvironment?: (environment: SurvivalEnvironment) => void;
  onFall?: (impactSpeed: number) => void;
  onVoid?: () => void;
}) {
  const worldRef = useRef(world);
  worldRef.current = world;
  const materials = useMemo<ChunkMaterials>(() => {
    const map = createAtlasTexture();
    return {
      opaque: new THREE.MeshLambertMaterial({ map }),
      clear: new THREE.MeshLambertMaterial({
        map,
        transparent: true,
        vertexColors: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    };
  }, []);
  const chunkList = useMemo(
    () => Object.values(world.chunks).map((chunk) => ({ chunk, signature: chunkSignature(world, chunk) })),
    [world],
  );
  const { camera, gl } = useThree();
  const fogRef = useRef<THREE.Fog>(null);
  const backgroundRef = useRef<THREE.Color>(null);
  const sunRef = useRef<THREE.Mesh>(null);
  const moonRef = useRef<THREE.Mesh>(null);
  const sunMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const dirRef = useRef<THREE.DirectionalLight>(null);
  const worldTimeRef = useRef(worldTime);
  worldTimeRef.current = worldTime;
  const weatherRef = useRef(weather);
  weatherRef.current = weather;
  const viewDistance = renderRadius * CHUNK_SIZE;
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    perspective.far = viewDistance + 3 * CHUNK_SIZE;
    perspective.updateProjectionMatrix();
  }, [camera, viewDistance]);
  const yaw = useRef(0);
  const pitch = useRef(-0.17);
  const [player] = useState<PlayerMotion>(() =>
    createPlayerMotion(world, savedPosition ?? findSpawn(world)),
  );
  const keyState = useRef<Record<string, boolean>>({});
  const target = useRef<AimTarget | null>(null);
  const aimCellKey = useRef("");
  const miningRef = useRef<{ key: string; progress: number } | null>(null);
  const lastMiningProgress = useRef(-1);
  const lastChunkKey = useRef("");
  const lastSpaceTap = useRef(0);
  const lastWTap = useRef(0);
  const forwardBoost = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const allowFlightRef = useRef(allowFlight);
  allowFlightRef.current = allowFlight;
  const touchLook = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const callbacks = useRef({
    onTarget,
    onMine,
    onPlace,
    onPosition,
    onChunkChange,
    onMineProgress,
    onLook,
    world,
    mobileMove,
    tool,
    weather,
    onUse,
    survivalMode,
    onEnvironment,
    onFall,
    onVoid,
  });
  callbacks.current = {
    onTarget,
    onMine,
    onPlace,
    onPosition,
    onChunkChange,
    onMineProgress,
    onLook,
    world,
    mobileMove,
    tool,
    weather,
    onUse,
    survivalMode,
    onEnvironment,
    onFall,
    onVoid,
  };

  const stopMining = () => {
    if (!miningRef.current) return;
    miningRef.current = null;
    lastMiningProgress.current = -1;
    callbacks.current.onMineProgress?.(0);
  };

  const startMining = (cell: BlockCell) => {
    const duration = miningDuration(cell.type, callbacks.current.tool);
    if (!Number.isFinite(duration) || duration <= MIN_MINING_SECONDS) {
      stopMining();
      callbacks.current.onMine(cell);
      return;
    }
    miningRef.current = {
      key: blockKey(cell.x, cell.y, cell.z),
      progress: 0,
    };
    lastMiningProgress.current = 0;
    callbacks.current.onMineProgress?.(0.01);
  };

  useEffect(() => {
    camera.rotation.order = "YXZ";
    camera.position.set(player.x, player.y, player.z);
  }, [camera]);

  // Settings can change mid-session; keep the projection in sync.
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    if (perspective.fov !== fov) {
      perspective.fov = fov;
      perspective.updateProjectionMatrix();
    }
  }, [camera, fov]);

  useEffect(() => {
    const canvas = gl.domElement;
    const onKeyDown = (event: KeyboardEvent) => {
      const code = event.code;
      if (
        ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code) ||
        getHotbarIndexFromCode(code) >= 0
      ) event.preventDefault();
      keyState.current[code] = true;
      if (code === "KeyW" && !event.repeat && !pausedRef.current) {
        const now = performance.now();
        if (now - lastWTap.current <= DOUBLE_TAP_MS && lastWTap.current > 0) forwardBoost.current = true;
        lastWTap.current = now;
      }
      // Double-tapping Space toggles flight: tap, tap, and you are airborne.
      if (code === "Space" && !event.repeat && !pausedRef.current && allowFlightRef.current) {
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
      const slot = getHotbarIndexFromCode(code);
      if (slot >= 0) window.dispatchEvent(new CustomEvent("pixel-wilds-slot", { detail: slot }));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keyState.current[event.code] = false;
      if (event.code === "KeyW") { forwardBoost.current = false; lastWTap.current = 0; }
    };
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      yaw.current -= event.movementX * 0.00215;
      pitch.current = THREE.MathUtils.clamp(pitch.current - event.movementY * 0.00215, -1.48, 1.48);
    };
    const onTouchStart = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      touchLook.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is optional on older mobile browsers.
      }
    };
    const onTouchMove = (event: PointerEvent) => {
      const activeTouch = touchLook.current;
      if (!activeTouch || event.pointerId !== activeTouch.pointerId) return;
      yaw.current -= (event.clientX - activeTouch.x) * 0.006 * touchSensitivity;
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - (event.clientY - activeTouch.y) * 0.006 * touchSensitivity,
        -1.48,
        1.48,
      );
      activeTouch.x = event.clientX;
      activeTouch.y = event.clientY;
    };
    const onTouchEnd = (event: PointerEvent) => {
      if (touchLook.current?.pointerId === event.pointerId) touchLook.current = null;
    };
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 2) event.preventDefault();
      if (document.pointerLockElement !== canvas) {
        if (
          event.button === 0 &&
          !pausedRef.current &&
          !window.matchMedia("(pointer: coarse)").matches
        ) {
          canvas.requestPointerLock?.();
        }
        return;
      }
      const hit = target.current;
      if (!hit) return;
      if (event.button === 0) startMining(hit.cell);        if (event.button === 2) {
          if (hit.cell.type === "chest") callbacks.current.onUse(hit.cell);
          else callbacks.current.onPlace(hit.cell, hit.adjacent);
        }
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 0) stopMining();
    };
    const onPointerLockChange = () => {
      if (!document.pointerLockElement) stopMining();
    };
    const onContextMenu = (event: Event) => event.preventDefault();
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const direction = event.deltaY > 0 ? 1 : -1;
      window.dispatchEvent(new CustomEvent("pixel-wilds-cycle", { detail: direction }));
    };
    const onBlur = () => {
      keyState.current = {};
      forwardBoost.current = false;
      lastWTap.current = 0;
      stopMining();
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    canvas.addEventListener("pointerdown", onTouchStart);
    canvas.addEventListener("pointermove", onTouchMove);
    canvas.addEventListener("pointerup", onTouchEnd);
    canvas.addEventListener("pointercancel", onTouchEnd);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      canvas.removeEventListener("pointerdown", onTouchStart);
      canvas.removeEventListener("pointermove", onTouchMove);
      canvas.removeEventListener("pointerup", onTouchEnd);
      canvas.removeEventListener("pointercancel", onTouchEnd);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [gl, touchSensitivity]);

  const direction = useMemo(() => new THREE.Vector3(), []);
  const mobileRef = useRef(mobileMove);
  mobileRef.current = mobileMove;
  const positionClock = useRef(0);
  const lookClock = useRef(0);
  const aimClock = useRef(0);
  const environmentClock = useRef(0);
  const voidReported = useRef(false);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const keys = keyState.current;
    const paused = pausedRef.current;
    // Left/Right arrows turn the view while W A S D keeps walking, so you can
    // steer without a mouse (useful when the pointer is not captured).
    const turn = Number(Boolean(keys.ArrowLeft)) - Number(Boolean(keys.ArrowRight));
    if (!paused && turn !== 0) yaw.current += turn * TURN_SPEED * dt;
    const forward = paused
      ? 0
      : Number(Boolean(keys.KeyW || keys.ArrowUp)) -
        Number(Boolean(keys.KeyS || keys.ArrowDown)) +
        mobileRef.current.forward;
    const side = paused
      ? 0
      : Number(Boolean(keys.KeyD)) -
        Number(Boolean(keys.KeyA)) +
        mobileRef.current.side;
    const wasGrounded = player.grounded;
    const previousVelocityY = player.velocityY;
    const wasFlying = player.flying;
    const wasInWater = isInWater(callbacks.current.world, player);
    updatePlayerMotion(
      callbacks.current.world,
      player,
      {
        forward,
        side,
        jump: paused ? false : Boolean(keys.Space || mobileRef.current.jump),
        sprint: paused ? false : Boolean(keys.ShiftLeft || keys.ShiftRight || (forwardBoost.current && keys.KeyW)),
        descend: paused ? false : Boolean(keys.ControlLeft || keys.ControlRight),
      },
      yaw.current,
      dt,
    );

    // A landing is a single transition from airborne to grounded. Water and
    // flight absorb the impact, and a normal jump never reaches the threshold.
    if (
      callbacks.current.survivalMode &&
      !wasGrounded &&
      player.grounded &&
      !wasFlying &&
      !wasInWater &&
      previousVelocityY < 0
    ) {
      callbacks.current.onFall?.(-previousVelocityY);
    }

    environmentClock.current += dt;
    if (environmentClock.current >= 0.25) {
      environmentClock.current = 0;
      callbacks.current.onEnvironment?.({
        underwater: isEyeUnderwater(callbacks.current.world, player),
        inWater: isInWater(callbacks.current.world, player),
        moving: !paused && Math.hypot(player.velocityX, player.velocityZ) > 0.6,
        sprinting:
          !paused && Boolean(keys.ShiftLeft || keys.ShiftRight || (forwardBoost.current && keys.KeyW)),
      });
    }

    if (player.y < -40) {
      if (callbacks.current.survivalMode) {
        if (!voidReported.current) {
          voidReported.current = true;
          callbacks.current.onVoid?.();
        }
      } else if (wasFlying) {
        window.dispatchEvent(new CustomEvent("pixel-wilds-fly", { detail: false }));
      }
      Object.assign(
        player,
        createPlayerMotion(callbacks.current.world, findSpawn(callbacks.current.world)),
      );
      player.flying = false;
    }
    camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");
    camera.position.set(player.x, player.y, player.z);

    // Fog hides the edge of the loaded world; underwater it closes in and turns
    // blue, while the surface follows the world clock's sky palette.
    const underwater = isEyeUnderwater(callbacks.current.world, player);
    const time = worldTimeRef.current;
    const palette = skyPalette(time);
    const wet = weatherRef.current.wet;
    const fog = fogRef.current;
    if (fog) {
      fog.color.set(underwater ? "#2a6f86" : wet ? "#8d9fa3" : palette.fog);
      fog.near = underwater ? 1 : viewDistance * (wet ? 0.4 : 0.55);
      fog.far = underwater ? 34 : viewDistance - (wet ? 10 : 6);
    }
    backgroundRef.current?.set(underwater ? "#2a6f86" : wet ? "#98a9ad" : palette.sky);

    const hemi = hemiRef.current;
    if (hemi) {
      hemi.color.set(palette.ambient);
      hemi.groundColor.set(palette.ground);
      hemi.intensity = (0.35 + palette.light * 0.55) * (wet ? 0.78 : 1);
    }
    const dir = dirRef.current;
    if (dir) {
      dir.color.set(palette.sun);
      dir.intensity = palette.light * (wet ? 0.55 : 1);
    }

    const sunDistance = viewDistance * 0.9;
    const angle = Math.PI * 2 * (dayFraction(time) - 0.25);
    const elevation = sunHeight(time);
    const sun = sunRef.current;
    if (sun) {
      sun.position.set(
        camera.position.x + Math.cos(angle) * sunDistance * 0.6,
        camera.position.y + elevation * sunDistance * 0.7,
        camera.position.z - sunDistance * 0.62,
      );
      sun.lookAt(camera.position);
      sun.scale.setScalar(sunDistance * 0.075);
      sun.visible = elevation > -0.18;
      sunMaterialRef.current?.color.set(palette.sun);
    }
    const moon = moonRef.current;
    if (moon) {
      moon.position.set(
        camera.position.x - Math.cos(angle) * sunDistance * 0.55,
        camera.position.y - elevation * sunDistance * 0.65,
        camera.position.z - sunDistance * 0.58,
      );
      moon.lookAt(camera.position);
      moon.scale.setScalar(sunDistance * 0.045);
      moon.visible = elevation < 0.18;
    }

    const chunk = getChunkCoordinates(player.x, player.z);
    const chunkKeyNow = `${chunk.x},${chunk.z}`;
    if (chunkKeyNow !== lastChunkKey.current) {
      lastChunkKey.current = chunkKeyNow;
      callbacks.current.onChunkChange(chunk.x, chunk.z);
    }
    positionClock.current += dt;
    if (positionClock.current >= 0.4) {
      positionClock.current = 0;
      callbacks.current.onPosition({ x: player.x, y: player.y, z: player.z });
    }
    lookClock.current += dt;
    if (lookClock.current >= 0.25) {
      lookClock.current = 0;
      callbacks.current.onLook?.(yaw.current);
    }

    aimClock.current += dt;
    if (aimClock.current >= 0.06) {
      aimClock.current = 0;
      camera.getWorldDirection(direction);
      const nextTarget = traceVoxelWorld(
        callbacks.current.world,
        camera.position,
        direction,
        REACH_BLOCKS,
      );
      if (nextTarget) {
        target.current = nextTarget;
        const key = blockKey(nextTarget.cell.x, nextTarget.cell.y, nextTarget.cell.z);
        if (key !== aimCellKey.current) {
          aimCellKey.current = key;
          callbacks.current.onTarget(nextTarget);
        }
      } else {
        target.current = null;
        if (aimCellKey.current) {
          aimCellKey.current = "";
          callbacks.current.onTarget(null);
        }
      }
    }

    if (paused) {
      stopMining();
    } else if (miningRef.current) {
      const hit = target.current;
      if (!hit || blockKey(hit.cell.x, hit.cell.y, hit.cell.z) !== miningRef.current.key) {
        stopMining();
      } else {
        const step = advanceMining(
          miningRef.current.progress,
          dt,
          hit.cell.type,
          callbacks.current.tool,
        );
        miningRef.current.progress = step.progress;
        if (step.complete) {
          const cell = hit.cell;
          miningRef.current = null;
          lastMiningProgress.current = -1;
          callbacks.current.onMineProgress?.(0);
          callbacks.current.onMine(cell);
        } else if (step.progress - lastMiningProgress.current >= 0.02) {
          lastMiningProgress.current = step.progress;
          callbacks.current.onMineProgress?.(step.progress);
        }
      }
    }
  });

  return (
    <>
      <color ref={backgroundRef} attach="background" args={["#a9d9d1"]} />
      <fog ref={fogRef} attach="fog" args={["#b7ddd0", viewDistance * 0.55, viewDistance - 6]} />
      <WeatherParticles weather={weather} />
      <HeldTool tool={tool} paused={paused} />
      <hemisphereLight ref={hemiRef} args={["#f9e9ba", "#567558", 1.45]} />
      <directionalLight
        ref={dirRef}
        position={[-8, 15, 7]}
        intensity={2.05}
        color="#ffe3a4"
      />
      <mesh ref={sunRef}>
        <boxGeometry args={[1, 1, 0.08]} />
        <meshBasicMaterial ref={sunMaterialRef} color="#f1b76b" fog={false} />
      </mesh>
      <mesh ref={moonRef}>
        <boxGeometry args={[1, 1, 0.08]} />
        <meshBasicMaterial color="#dce9e6" fog={false} transparent opacity={0.82} />
      </mesh>
      {chunkList.map(({ chunk, signature }) => (
        <ChunkMesh
          key={`${chunk.cx},${chunk.cz}`}
          chunk={chunk}
          signature={signature}
          worldRef={worldRef}
          materials={materials}
        />
      ))}
      <DroppedLoot
        field={drops}
        player={player}
        worldRef={worldRef}
        paused={paused}
        onCollect={onCollectDrops}
      />
      {target.current && (
        <mesh position={[target.current.cell.x + 0.5, target.current.cell.y + 0.5, target.current.cell.z + 0.5]}>
          <boxGeometry args={[1.02, 1.02, 1.02]} />
          <meshBasicMaterial color="#fff0a3" wireframe transparent opacity={0.9} />
        </mesh>
      )}
    </>
  );
}
