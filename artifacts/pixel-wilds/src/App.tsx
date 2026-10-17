import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  BLOCK_TYPES,
  DEFAULT_RENDER_RADIUS,
  MAX_RENDER_RADIUS,
  MIN_RENDER_RADIUS,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  blockKey,
  createWorld,
  ensureChunks,
  findSpawnPoint,
  getBiomeAt,
  getBlock,
  getChunkCoordinates,
  getLoadedBlockCount,
  getLoadedChunkCount,
  getSettlementsNear,
  getVisibleBlocksNear,
  loadWorld,
  saveWorld,
  setBlock,
  type BlockCell,
  type BlockType,
  type WorldBlockType,
  type WorldData,
} from './game/world';
import { BLOCK_INFO } from './game/blocks';
import { CHUNK_SIZE, MAX_BUILD_HEIGHT, chunkKey, type Chunk } from './game/chunk';
import { buildChunkMesh, type MeshArrays } from './game/mesher';
import { createAtlasTexture } from './game/textures';
import {
  FACTION_COLORS,
  FACTION_LABELS,
  type SettlementKind,
} from './game/settlements';
import {
  PLAYER_RADIUS,
  createPlayerMotion,
  isEyeUnderwater,
  updatePlayerMotion,
  type PlayerMotion,
  type Position,
} from './game/physics';
import {
  CRAFTING_RECIPES,
  applyCraft,
  canCraft,
  type CraftRecipe,
} from './game/crafting';

const BLOCK_META = BLOCK_INFO;
const BLOCK_COLORS = Object.fromEntries(
  Object.values(BLOCK_INFO).map((info) => [info.name, info.colors]),
) as Record<WorldBlockType, [string, string, string]>;

/** Block-interaction reach: 4 m (8 blocks), a comfortable arm-plus-tool distance. */
const REACH_BLOCKS = 8;
/** Arrow-key turning speed, radians per second (about 150°/s). */
const TURN_SPEED = 2.6;
/** Two quick taps trigger a movement action (Space = flight, W = forward sprint). */
const DOUBLE_TAP_MS = 340;
const HOTBAR_SLOTS = 10;
const RENDER_RADIUS_KEY = 'pixel-wilds-render-radius';

const SETTLEMENT_KIND_LABELS: Record<SettlementKind, string> = {
  village: 'Village',
  town: 'Town',
  castle: 'Castle',
  kingdom: 'Kingdom',
  grove: 'Elven grove',
  hold: 'Mountain hold',
  camp: 'Orc camp',
  tower: 'Mage tower',
  lodge: 'Warden lodge',
};

/** What each design is, in one line (second row of the HUD card). */
const SETTLEMENT_TAGLINES: Record<SettlementKind, string> = {
  village: 'homes, farms & a watchtower',
  town: 'workshops, town hall & market',
  castle: 'moat, keep & garrison',
  kingdom: 'palace, wards & temples',
  grove: 'canopies & clearings',
  hold: 'deep halls & forges',
  camp: 'palisade & bonfires',
  tower: 'spire & star chamber',
  lodge: 'stands & fire pits',
};

/** Human settlements worth finding: streets, furniture, doors and walls. */
const HUMAN_SETTLEMENT_KINDS: SettlementKind[] = ['village', 'town', 'castle', 'kingdom'];
/** How far from you (and from a fresh origin) the HUD looks for one. */
const SETTLEMENT_SEARCH = 640;

function humanSettlementNear(world: WorldData, x: number, z: number) {
  return (
    getSettlementsNear(world.seed, x, z, SETTLEMENT_SEARCH).find((settlement) =>
      HUMAN_SETTLEMENT_KINDS.includes(settlement.kind),
    ) ?? null
  );
}

/** New worlds start at the guaranteed origin kingdom, not a nearer hamlet. */
function startingKingdomNear(world: WorldData) {
  return getSettlementsNear(world.seed, 0, 0, SETTLEMENT_SEARCH * 2)
    .find((settlement) => settlement.kind === 'kingdom') ?? null;
}

/** Compass word for the offset (dx, dz); north is -z, east is +x. */
function compassWord(dx: number, dz: number): string {
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const angle = Math.atan2(dx, -dz);
  return names[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
}

type AimTarget = { cell: BlockCell; adjacent: { x: number; y: number; z: number } };
type Inventory = Record<BlockType, number>;

function traceVoxelWorld(
  world: WorldData,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
): AimTarget | null {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  const stepX = Math.sign(direction.x);
  const stepY = Math.sign(direction.y);
  const stepZ = Math.sign(direction.z);
  const deltaX = stepX ? Math.abs(1 / direction.x) : Infinity;
  const deltaY = stepY ? Math.abs(1 / direction.y) : Infinity;
  const deltaZ = stepZ ? Math.abs(1 / direction.z) : Infinity;
  let nextX = stepX
    ? ((stepX > 0 ? x + 1 : x) - origin.x) / direction.x
    : Infinity;
  let nextY = stepY
    ? ((stepY > 0 ? y + 1 : y) - origin.y) / direction.y
    : Infinity;
  let nextZ = stepZ
    ? ((stepZ > 0 ? z + 1 : z) - origin.z) / direction.z
    : Infinity;
  let previous: { x: number; y: number; z: number } | null = null;

  for (let step = 0; step < 64; step += 1) {
    const type = getBlock(world, x, y, z);
    if (type && type !== 'water') {
      const dominant = Math.max(
        Math.abs(direction.x),
        Math.abs(direction.y),
        Math.abs(direction.z),
      );
      return {
        cell: { x, y, z, type },
        adjacent: previous ?? {
          x: x - (Math.abs(direction.x) === dominant ? stepX : 0),
          y: y - (Math.abs(direction.y) === dominant ? stepY : 0),
          z: z - (Math.abs(direction.z) === dominant ? stepZ : 0),
        },
      };
    }

    const nextDistance = Math.min(nextX, nextY, nextZ);
    if (!Number.isFinite(nextDistance) || nextDistance > maxDistance) return null;
    previous = { x, y, z };
    if (nextX <= nextY && nextX <= nextZ) {
      x += stepX;
      nextX += deltaX;
    } else if (nextY <= nextZ) {
      y += stepY;
      nextY += deltaY;
    } else {
      z += stepZ;
      nextZ += deltaZ;
    }
  }
  return null;
}

const DEFAULT_INVENTORY: Inventory = Object.fromEntries(
  BLOCK_TYPES.map((type) => [
    type,
    type.endsWith('_ore')
      ? 6
      : type === 'gold'
        ? 4
        : type === 'glass' || type === 'brick' || type === 'roof'
          ? 16
          : type === 'door' || type === 'marble'
            ? 8
            : type === 'chair' || type === 'table'
              ? 6
              : 24,
  ]),
) as Inventory;

const SAVE_KEY = 'pixel-wilds-player-v2';

function readPlayerSave() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const inventory = { ...DEFAULT_INVENTORY };
    if (parsed.inventory && typeof parsed.inventory === 'object') {
      for (const type of BLOCK_TYPES) {
        const count = Number(parsed.inventory[type]);
        if (Number.isFinite(count) && count >= 0) inventory[type] = Math.floor(count);
      }
    }
    const position = parsed.position;
    if (
      position &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y) &&
      Number.isFinite(position.z)
    ) {
      return {
        inventory,
        position: { x: position.x as number, y: position.y as number, z: position.z as number },
      };
    }
    return { inventory, position: null as Position | null };
  } catch {
    return null;
  }
}

function initialWorld(position: Position | null = null): WorldData {
  const x = position?.x ?? 0;
  const z = position?.z ?? 0;
  let loaded: WorldData;
  // A small area loads immediately; the rest streams in a few chunks at a time.
  try {
    loaded = loadWorld(x, z, 5);
  } catch {
    loaded = createWorld(undefined, x, z, 5);
  }
  if (position) return loaded;
  // A brand-new world opens at the nearest village, town, castle or kingdom,
  // with its chunks already generated, so a settlement is the first thing
  // you see instead of empty wilderness.
  const settlement = startingKingdomNear(loaded) ?? humanSettlementNear(loaded, 0, 0);
  if (!settlement) return loaded;
  const center = getChunkCoordinates(settlement.x, settlement.z);
  return ensureChunks(loaded, center.x, center.z, 7, 400);
}

function findSpawn(world: WorldData): Position {
  const settlement = startingKingdomNear(world) ?? humanSettlementNear(world, 0, 0);
  return findSpawnPoint(world, settlement?.x ?? 0, settlement?.z ?? 0);
}

function getHotbarIndexFromCode(code: string): number {
  if (code === 'Digit0') return 9;
  if (/^Digit[1-9]$/.test(code)) return Number(code.slice(-1)) - 1;
  return -1;
}

function toGeometry(mesh: MeshArrays | null): THREE.BufferGeometry | null {
  if (!mesh) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
  if (mesh.colors) geometry.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 4));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

interface ChunkMaterials {
  opaque: THREE.Material;
  clear: THREE.Material;
}

/**
 * One chunk = at most two meshes (solid and see-through). It only rebuilds when
 * its own blocks, or a neighbour's border blocks, change (`signature`).
 */
const ChunkMesh = memo(function ChunkMesh({
  chunk,
  signature,
  worldRef,
  materials,
}: {
  chunk: Chunk;
  signature: string;
  worldRef: { current: WorldData };
  materials: ChunkMaterials;
}) {
  const geometries = useMemo(() => {
    const chunks = worldRef.current.chunks;
    const data = buildChunkMesh(chunk, {
      px: chunks[chunkKey(chunk.cx + 1, chunk.cz)],
      nx: chunks[chunkKey(chunk.cx - 1, chunk.cz)],
      pz: chunks[chunkKey(chunk.cx, chunk.cz + 1)],
      nz: chunks[chunkKey(chunk.cx, chunk.cz - 1)],
    });
    return { opaque: toGeometry(data.opaque), clear: toGeometry(data.transparent) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunk, signature]);
  useEffect(() => () => {
    geometries.opaque?.dispose();
    geometries.clear?.dispose();
  }, [geometries]);
  return (
    <group position={[chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE]}>
      {geometries.opaque && <mesh geometry={geometries.opaque} material={materials.opaque} />}
      {geometries.clear && <mesh geometry={geometries.clear} material={materials.clear} renderOrder={1} />}
    </group>
  );
});

function chunkSignature(world: WorldData, chunk: Chunk): string {
  const { chunks } = world;
  const v = (cx: number, cz: number) => chunks[chunkKey(cx, cz)]?.version ?? -1;
  return `${chunk.version}|${v(chunk.cx + 1, chunk.cz)}|${v(chunk.cx - 1, chunk.cz)}|${v(chunk.cx, chunk.cz + 1)}|${v(chunk.cx, chunk.cz - 1)}`;
}

function GameWorld({
  world,
  onTarget,
  onMine,
  onPlace,
  onPosition,
  onChunkChange,
  savedPosition,
  mobileMove,
  renderRadius,
  paused,
}: {
  world: WorldData;
  onTarget: (target: AimTarget | null) => void;
  onMine: (cell: BlockCell) => void;
  onPlace: (cell: BlockCell, adjacent: AimTarget['adjacent']) => void;
  onPosition: (position: Position) => void;
  onChunkChange: (chunkX: number, chunkZ: number) => void;
  savedPosition: Position | null;
  mobileMove: { forward: number; side: number; jump: boolean };
  renderRadius: number;
  /** True while the workbench (or any overlay) is open: no moving or turning. */
  paused: boolean;
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
  const aimCellKey = useRef('');
  const lastChunkKey = useRef('');
  const lastSpaceTap = useRef(0);
  const lastWTap = useRef(0);
  const forwardBoost = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const touchLook = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const callbacks = useRef({
    onTarget,
    onMine,
    onPlace,
    onPosition,
    onChunkChange,
    world,
    mobileMove,
  });
  callbacks.current = {
    onTarget,
    onMine,
    onPlace,
    onPosition,
    onChunkChange,
    world,
    mobileMove,
  };

  useEffect(() => {
    camera.rotation.order = 'YXZ';
    camera.position.set(player.x, player.y, player.z);
  }, [camera]);

  useEffect(() => {
    const canvas = gl.domElement;
    const onKeyDown = (event: KeyboardEvent) => {
      const code = event.code;
      if (
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code) ||
        getHotbarIndexFromCode(code) >= 0
      ) event.preventDefault();
      keyState.current[code] = true;
      if (code === 'KeyW' && !event.repeat && !pausedRef.current) {
        const now = performance.now();
        if (now - lastWTap.current <= DOUBLE_TAP_MS && lastWTap.current > 0) forwardBoost.current = true;
        lastWTap.current = now;
      }
      // Double-tapping Space toggles flight: tap, tap, and you are airborne.
      if (code === 'Space' && !event.repeat && !pausedRef.current) {
        const now = performance.now();
        if (now - lastSpaceTap.current < DOUBLE_TAP_MS) {
          lastSpaceTap.current = 0;
          player.flying = !player.flying;
          player.velocityY = 0;
          window.dispatchEvent(new CustomEvent('pixel-wilds-fly', { detail: player.flying }));
        } else {
          lastSpaceTap.current = now;
        }
      }
      const slot = getHotbarIndexFromCode(code);
      if (slot >= 0) window.dispatchEvent(new CustomEvent('pixel-wilds-slot', { detail: slot }));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keyState.current[event.code] = false;
      if (event.code === 'KeyW') { forwardBoost.current = false; lastWTap.current = 0; }
    };
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      yaw.current -= event.movementX * 0.00215;
      pitch.current = THREE.MathUtils.clamp(pitch.current - event.movementY * 0.00215, -1.48, 1.48);
    };
    const onTouchStart = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
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
      yaw.current -= (event.clientX - activeTouch.x) * 0.006;
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - (event.clientY - activeTouch.y) * 0.006,
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
          !window.matchMedia('(pointer: coarse)').matches
        ) {
          canvas.requestPointerLock?.();
        }
        return;
      }
      const hit = target.current;
      if (!hit) return;
      if (event.button === 0) callbacks.current.onMine(hit.cell);
      if (event.button === 2) callbacks.current.onPlace(hit.cell, hit.adjacent);
    };
    const onContextMenu = (event: Event) => event.preventDefault();
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const direction = event.deltaY > 0 ? 1 : -1;
      window.dispatchEvent(new CustomEvent('pixel-wilds-cycle', { detail: direction }));
    };
    const onBlur = () => {
      keyState.current = {};
      forwardBoost.current = false;
      lastWTap.current = 0;
    };
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onTouchStart);
    canvas.addEventListener('pointermove', onTouchMove);
    canvas.addEventListener('pointerup', onTouchEnd);
    canvas.addEventListener('pointercancel', onTouchEnd);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onTouchStart);
      canvas.removeEventListener('pointermove', onTouchMove);
      canvas.removeEventListener('pointerup', onTouchEnd);
      canvas.removeEventListener('pointercancel', onTouchEnd);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [gl]);

  const direction = useMemo(() => new THREE.Vector3(), []);
  const mobileRef = useRef(mobileMove);
  mobileRef.current = mobileMove;
  const positionClock = useRef(0);
  const aimClock = useRef(0);

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

    if (player.y < -40) {
      const wasFlying = player.flying;
      Object.assign(
        player,
        createPlayerMotion(callbacks.current.world, findSpawn(callbacks.current.world)),
      );
      if (wasFlying) {
        window.dispatchEvent(new CustomEvent('pixel-wilds-fly', { detail: false }));
      }
    }
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
    camera.position.set(player.x, player.y, player.z);

    // Fog hides the edge of the loaded world; underwater it closes in and turns blue.
    const underwater = isEyeUnderwater(callbacks.current.world, player);
    const fog = fogRef.current;
    if (fog) {
      fog.color.set(underwater ? '#2a6f86' : '#b7ddd0');
      fog.near = underwater ? 1 : viewDistance * 0.55;
      fog.far = underwater ? 34 : viewDistance - 6;
    }
    backgroundRef.current?.set(underwater ? '#2a6f86' : '#a9d9d1');
    const sun = sunRef.current;
    if (sun) {
      const sunDistance = viewDistance * 0.9;
      sun.position.set(
        camera.position.x + sunDistance * 0.5,
        camera.position.y + sunDistance * 0.55,
        camera.position.z - sunDistance * 0.62,
      );
      sun.lookAt(camera.position);
      sun.scale.setScalar(sunDistance * 0.075);
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
          aimCellKey.current = '';
          callbacks.current.onTarget(null);
        }
      }
    }
  });

  return (
    <>
      <color ref={backgroundRef} attach="background" args={['#a9d9d1']} />
      <fog ref={fogRef} attach="fog" args={['#b7ddd0', viewDistance * 0.55, viewDistance - 6]} />
      <hemisphereLight args={['#f9e9ba', '#567558', 1.45]} />
      <directionalLight
        position={[-8, 15, 7]}
        intensity={2.05}
        color="#ffe3a4"
      />
      <mesh ref={sunRef}>
        <boxGeometry args={[1, 1, 0.08]} />
        <meshBasicMaterial color="#f1b76b" fog={false} />
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
      {target.current && (
        <mesh position={[target.current.cell.x + 0.5, target.current.cell.y + 0.5, target.current.cell.z + 0.5]}>
          <boxGeometry args={[1.02, 1.02, 1.02]} />
          <meshBasicMaterial color="#fff0a3" wireframe transparent opacity={0.9} />
        </mesh>
      )}
    </>
  );
}

function findColumnTop(world: WorldData, x: number, z: number) {
  for (let y = MAX_BUILD_HEIGHT; y >= 0; y -= 1) {
    const type = getBlock(world, x, y, z);
    if (type) return { y, type };
  }
  return null;
}

function VoxelFallback({
  world,
  onTarget,
  onMine,
  onPlace,
  onPosition,
  onChunkChange,
  savedPosition,
  mobileMove,
  started,
  onStart,
}: {
  world: WorldData;
  onTarget: (target: AimTarget | null) => void;
  onMine: (cell: BlockCell) => void;
  onPlace: (cell: BlockCell, adjacent: AimTarget['adjacent']) => void;
  onPosition: (position: Position) => void;
  onChunkChange: (chunkX: number, chunkZ: number) => void;
  savedPosition: Position | null;
  mobileMove: { forward: number; side: number; jump: boolean };
  started: boolean;
  onStart: () => void;
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
  const lastChunkKey = useRef('');
  moveRef.current = mobileMove;
  startedRef.current = started;

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
    onStart,
  });
  latest.current = {
    world,
    ordered,
    onTarget,
    onMine,
    onPlace,
    onPosition,
    onChunkChange,
    onStart,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
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

      context.strokeStyle = highlight ? '#fff1a3' : 'rgba(30, 55, 48, .27)';
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

    const updateTarget = (nextTarget: AimTarget | null) => {
      const previous = targetRef.current;
      const previousKey = previous
        ? blockKey(previous.cell.x, previous.cell.y, previous.cell.z)
        : '';
      const nextKey = nextTarget
        ? blockKey(nextTarget.cell.x, nextTarget.cell.y, nextTarget.cell.z)
        : '';
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
      if (event.button === 0) latest.current.onMine(hit.cell);
      if (event.button === 2) latest.current.onPlace(hit.cell, hit.adjacent);
    };
    const onContextMenu = (event: Event) => event.preventDefault();
    const onKeyDown = (event: KeyboardEvent) => {
      keys.current[event.code] = true;
      if (event.code === 'KeyW' && !event.repeat && startedRef.current) {
        const now = performance.now();
        if (now - lastWTap.current <= DOUBLE_TAP_MS && lastWTap.current > 0) forwardBoost.current = true;
        lastWTap.current = now;
      }
      if (event.code === 'Space' && !event.repeat && startedRef.current) {
        const now = performance.now();
        if (now - lastSpaceTap.current < DOUBLE_TAP_MS) {
          lastSpaceTap.current = 0;
          player.flying = !player.flying;
          player.velocityY = 0;
          window.dispatchEvent(new CustomEvent('pixel-wilds-fly', { detail: player.flying }));
        } else {
          lastSpaceTap.current = now;
        }
      }
      if (
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code) ||
        getHotbarIndexFromCode(event.code) >= 0
      ) {
        event.preventDefault();
      }
      const index = getHotbarIndexFromCode(event.code);
      if (index >= 0) window.dispatchEvent(new CustomEvent('pixel-wilds-slot', { detail: index }));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.current[event.code] = false;
      if (event.code === 'KeyW') { forwardBoost.current = false; lastWTap.current = 0; }
    };
    const onBlur = () => {
      keys.current = {};
      forwardBoost.current = false;
      lastWTap.current = 0;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      window.dispatchEvent(
        new CustomEvent('pixel-wilds-cycle', { detail: event.deltaY > 0 ? 1 : -1 }),
      );
    };
    const onResize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onResize);
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

      if (startedRef.current) {
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
        if (time - lastPositionSent.current > 350) {
          lastPositionSent.current = time;
          latest.current.onPosition({ x: player.x, y: player.y, z: player.z });
        }
      }

      const width = rect.width;
      const height = rect.height;
      const background = context.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, '#a9d9d1');
      background.addColorStop(0.58, '#c8dfc0');
      background.addColorStop(1, '#e8d8a5');
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      context.fillStyle = 'rgba(255, 229, 157, .88)';
      context.fillRect(width * 0.77, height * 0.16, 30, 30);
      context.fillRect(width * 0.77 + 7, height * 0.16 - 7, 16, 44);
      context.fillRect(width * 0.77 - 7, height * 0.16 + 7, 44, 16);

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

    };
    frame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frame);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
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
  const [worldMenuOpen, setWorldMenuOpen] = useState(false);\n  const [savedWorldSeeds, setSavedWorldSeeds] = useState<number[]>(() => listSavedWorldSeeds());\n  const [selectedWorld, setSelectedWorld] = useState(false);\n  const [creatingWorld, setCreatingWorld] = useState(false);
  const [seedInput, setSeedInput] = useState('');
  const [craftOpen, setCraftOpen] = useState(false);
  const [flying, setFlying] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'unsaved'>('saved');
  const [notice, setNotice] = useState('');
  const [mobileMove, setMobileMove] = useState({ forward: 0, side: 0, jump: false });
  const [supportsWebGL, setSupportsWebGL] = useState<boolean | null>(null);
  const noticeTimeout = useRef<number | undefined>(undefined);
  const [renderRadius, setRenderRadius] = useState<number>(() => {
    const saved = Number(localStorage.getItem(RENDER_RADIUS_KEY));
    return Number.isInteger(saved) && saved >= MIN_RENDER_RADIUS && saved <= MAX_RENDER_RADIUS
      ? saved
      : DEFAULT_RENDER_RADIUS;
  });
  // New saves start at the nearest settlement (see initialWorld), so the
  // streaming timer must follow that spot, not the origin.
  const spawnTarget = useMemo(
    () => (savedPlayer?.position ? null : humanSettlementNear(world, 0, 0)),
    [world.seed, savedPlayer?.position],
  );
  const streamCenter = useRef(
    getChunkCoordinates(
      savedPlayer?.position?.x ?? spawnTarget?.x ?? 0,
      savedPlayer?.position?.z ?? spawnTarget?.z ?? 0,
    ),
  );
  const selected = BLOCK_TYPES[selectedIndex] ?? 'grass';
  const hotbarPage = Math.floor(selectedIndex / HOTBAR_SLOTS);
  const hotbarPages = Math.ceil(BLOCK_TYPES.length / HOTBAR_SLOTS);
  const nearbySettlements = useMemo(
    () =>
      getSettlementsNear(
        world.seed,
        playerPosition?.x ?? 0.5,
        playerPosition?.z ?? 0.5,
        SETTLEMENT_SEARCH,
      ),
    // Settlements are cached per region, so only the rounded position matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world.seed, Math.floor((playerPosition?.x ?? 0) / 16), Math.floor((playerPosition?.z ?? 0) / 16)],
  );
  const nearestSettlement = nearbySettlements[0];
  // Up to two more, of kinds you have not been shown yet, so the card helps
  // you find every design out there.
  const otherNearby = useMemo(() => {
    if (!nearbySettlements.length) return [];
    const seen = new Set<string>([nearbySettlements[0].kind]);
    const picked: typeof nearbySettlements = [];
    for (const s of nearbySettlements) {
      if (picked.length >= 2) break;
      if (seen.has(s.kind)) continue;
      seen.add(s.kind);
      picked.push(s);
    }
    return picked;
  }, [nearbySettlements]);
  const settlementDistance = nearestSettlement
    ? Math.hypot(
      nearestSettlement.x - (playerPosition?.x ?? 0.5),
      nearestSettlement.z - (playerPosition?.z ?? 0.5),
    )
    : Infinity;
  const atSettlement =
    nearestSettlement !== null && settlementDistance <= nearestSettlement.radius + 16;

  useEffect(() => {
    const probe = document.createElement('canvas');
    const context = probe.getContext('webgl2');
    setSupportsWebGL(Boolean(context));
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.clearTimeout(noticeTimeout.current);
    noticeTimeout.current = window.setTimeout(() => setNotice(''), 1300);
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
      showNotice(on ? 'Flight on - Space rises, Ctrl sinks' : 'Back on the ground');
    };
    window.addEventListener('pixel-wilds-fly', onFly);
    return () => window.removeEventListener('pixel-wilds-fly', onFly);
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
    setSaveState('unsaved');
    try {
      saveWorld(next);
    } catch {
      showNotice('This landscape could not be saved');
    }
    window.setTimeout(() => setSaveState('saved'), 450);
  }, [showNotice]);

  const mineBlock = useCallback((cell: BlockCell) => {
    const current = worldRef.current;
    const found = getBlock(current, cell.x, cell.y, cell.z);
    if (!found) return;
    if (BLOCK_INFO[found].unbreakable) {
      showNotice('Bedrock will not budge');
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
    } else if (found === 'flower') {
      showNotice('Wild bloom cleared');
    } else {
      showNotice(`${BLOCK_META[found].label} cleared`);
    }
  }, [showNotice, setWorldEdited]);

  const placeBlock = useCallback((cell: BlockCell, adjacent: AimTarget['adjacent']) => {
    if (inventory[selected] < 1) {
      showNotice(`Out of ${BLOCK_META[selected].label.toLowerCase()}`);
      return;
    }
    const occupant = getBlock(worldRef.current, adjacent.x, adjacent.y, adjacent.z);
    if (occupant && occupant !== 'water') return;
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
      showNotice('A little more room, please');
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
        showNotice('Not enough materials yet');
        return;
      }
      setInventory((current) => applyCraft(recipe, current));
      showNotice(`Crafted ${recipe.label}`);
    },
    [inventory, showNotice],
  );

  const savePlayerState = useCallback((position?: Position) => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ inventory, position: position ?? playerPosition }));
    } catch {
      // The world helper remains the primary save path if local storage is unavailable.
    }
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
      if (event.code === 'KeyC' && !event.repeat && !event.ctrlKey && !event.metaKey) {
        setCraftOpen((open) => !open);
        return;
      }
      if (event.code === 'Escape') {
        setCraftOpen(false);
        return;
      }
      const step = event.code === 'KeyE' || event.code === 'BracketRight' ? 1
        : event.code === 'KeyQ' || event.code === 'BracketLeft' ? -1 : 0;
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
    window.addEventListener('pixel-wilds-select', onSelect);
    window.addEventListener('pixel-wilds-cycle', onCycle);
    window.addEventListener('pixel-wilds-slot', onSlot);
    window.addEventListener('keydown', onPageKey);
    document.addEventListener('pointerlockchange', onPointerChange);
    const saveOnExit = () => savePlayerState();
    window.addEventListener('beforeunload', saveOnExit);
    return () => {
      window.removeEventListener('pixel-wilds-select', onSelect);
      window.removeEventListener('pixel-wilds-cycle', onCycle);
      window.removeEventListener('pixel-wilds-slot', onSlot);
      window.removeEventListener('keydown', onPageKey);
      document.removeEventListener('pointerlockchange', onPointerChange);
      window.removeEventListener('beforeunload', saveOnExit);
    };
  }, [savePlayerState]);

  useEffect(() => {
    savePlayerState();
  }, [savePlayerState]);

  const createSeededWorld = (rawSeed: string) => {
    const trimmed = rawSeed.trim();
    const seed = trimmed ? Number(trimmed) : Math.floor(Math.random() * 2_147_000_000);
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2_147_483_647) {
      showNotice('Seed must be a whole number from 0 to 2147483647');
      return;
    }
    setCreatingWorld(true);
    try {
      // Generate the spawn region before making the world selectable. The
      // kingdom's full local chunk ring is prepared before the player is spawned.
      let freshWorld = createWorld(seed, 0, 0, 5);
      const kingdom = startingKingdomNear(freshWorld) ?? humanSettlementNear(freshWorld, 0, 0);
      if (kingdom) {
        const center = getChunkCoordinates(kingdom.x, kingdom.z);
        freshWorld = ensureChunks(freshWorld, center.x, center.z, 8);
      }
      saveWorld(freshWorld);
      localStorage.removeItem(SAVE_KEY);
      setSavedWorldSeeds(listSavedWorldSeeds());
      setWorldMenuOpen(false);
      window.location.reload();
    } catch {
      setCreatingWorld(false);
      showNotice('World creation failed. No world was selected; check browser storage and try again.');
    }
  };

  const selectSavedWorld = (seed: number) => {
    try {
      // Loading/generating the spawn ring is synchronous and completes before
      // reload; the game then resolves a fresh safe spawn for this seed.
      let selected = loadWorld(0, 0, 5, seed);
      const kingdom = startingKingdomNear(selected) ?? humanSettlementNear(selected, 0, 0);
      if (kingdom) {
        const center = getChunkCoordinates(kingdom.x, kingdom.z);
        selected = ensureChunks(selected, center.x, center.z, 8);
      }
      saveWorld(selected);
      localStorage.removeItem(SAVE_KEY);
      setSelectedWorld(true);
      window.location.reload();
    } catch {
      showNotice('Could not load that world safely. It remains in the list.');
    }
  };

  const removeSavedWorld = (seed: number) => {
    try {
      deleteSavedWorld(seed);
      setSavedWorldSeeds(listSavedWorldSeeds());
      if (world.seed === seed) {
        localStorage.removeItem(SAVE_KEY);
        setSelectedWorld(false);
        window.location.reload();
      }
    } catch {
      showNotice('Could not delete that world from browser storage.');
    }
  };

  const clearSavedWorlds = () => {
    try {
      deleteAllSavedWorlds();
      localStorage.removeItem(SAVE_KEY);
      setSavedWorldSeeds([]);
      setSelectedWorld(false);
      window.location.reload();
    } catch {
      showNotice('Could not clear saved worlds from browser storage.');
    }
  };

  const beginExplore = () => {
    if (!selectedWorld) {
      showNotice('Select or create a world before entering.');
      return;
    }
    setStarted(true);
    if (supportsWebGL !== true || window.matchMedia('(pointer: coarse)').matches) return;
    const canvas = document.querySelector('.game-canvas canvas') as HTMLCanvasElement | null;
    canvas?.requestPointerLock?.();
  };

  const loadedBlockCount = useMemo(() => getLoadedBlockCount(world), [world]);
  const loadedChunkCount = useMemo(() => getLoadedChunkCount(world), [world]);
  const biome = playerPosition ? getBiomeAt(world.seed, playerPosition.x, playerPosition.z) : null;
  const coordinates = playerPosition
    ? `${Math.floor(playerPosition.x)} · ${Math.floor(playerPosition.y)} · ${Math.floor(playerPosition.z)}`
    : 'ROAM FREE';

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
          gl={{ antialias: false, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.12;
          }}
        >
          <GameWorld
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
        <div className="brand-lockup" aria-label="Pixel Wilds">
          <div className="brand-stamp" aria-hidden="true"><span /></div>
          <div>
            <div className="brand-name">pixel wilds</div>
            <div className="brand-kicker">a pocket wilderness</div>
          </div>
        </div>
        <div className="top-right">
          <div className={`status-pill ${saveState === 'saved' ? 'is-saved' : ''}`} data-testid="status-save">
            <i className="status-dot" />
            {saveState === 'saved' ? 'landscape saved' : 'saving landscape'}
          </div>
          {flying && (
            <div className="status-pill is-flying" data-testid="status-flying">
              <i className="status-dot" />
              flying · space up · ctrl down
            </div>
          )}
          <label className="distance-control" title="How far you can see">
            <span>view {Math.round(renderRadius * CHUNK_SIZE * 0.5)} m</span>
            <input
              type="range"
              min={MIN_RENDER_RADIUS}
              max={MAX_RENDER_RADIUS}
              value={renderRadius}
              aria-label="View distance"
              data-testid="slider-view-distance"
              onChange={(event) => setRenderRadius(Number(event.target.value))}
            />
          </label>
          <button
            className="icon-button"
            type="button"
            aria-label="Save your current landscape"
            title="Save landscape"
            data-testid="button-save-world"
            onClick={() => {
              try {
                saveWorld(world);
                savePlayerState();
                setSaveState('saved');
                showNotice('Landscape tucked away');
              } catch {
                showNotice('Could not save this landscape');
              }
            }}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3 3.5h11.3L17 6.2v10.3H3V3.5Z" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6 3.8v5h7v-5M6.1 16.2v-5h7.8v5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 13h4" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>

        <div className="world-card">
          <small>WORLD SEED</small>
          <strong data-testid="status-world-seed">{world.seed}</strong>
          <button className="rules-toggle" type="button" onClick={() => { setSeedInput(String(world.seed)); setWorldMenuOpen(true); }}>
            Create / load world
          </button>

          <small>somewhere out there</small>
          <strong>Marigold Reach</strong>
          <p>Make a path. Leave it brighter.</p>
          <button
            className="rules-toggle"
            type="button"
            aria-expanded={rulesOpen}
            aria-controls="world-generation-rules"
            onClick={() => setRulesOpen((current) => !current)}
          >
            {rulesOpen ? 'Hide world rules' : 'How blocks generate'}
          </button>
        </div>

        {nearestSettlement && (
          <div
            className={`settlement-card ${atSettlement ? 'is-here' : ''}`}
            data-testid="status-nearby-settlement"
          >
            <small>
              <i style={{ backgroundColor: FACTION_COLORS[nearestSettlement.faction] }} />
              {FACTION_LABELS[nearestSettlement.faction]} · {SETTLEMENT_KIND_LABELS[nearestSettlement.kind]}
            </small>
            <strong>{nearestSettlement.name}</strong>
            <p>
              {nearestSettlement.buildings.length} buildings · {SETTLEMENT_TAGLINES[nearestSettlement.kind]}
            </p>
            <p>
              {atSettlement
                ? 'you are here'
                : `${Math.round(settlementDistance)} m to the ${compassWord(
                    nearestSettlement.x - (playerPosition?.x ?? 0.5),
                    nearestSettlement.z - (playerPosition?.z ?? 0.5),
                  )}`}
            </p>
            {nearestSettlement.landmarks.length > 0 && (
              <p>{nearestSettlement.landmarks.slice(0, 3).join(' · ')}</p>
            )}
            {otherNearby.length > 0 && (
              <p>
                also near:{' '}
                {otherNearby
                  .map((s) => {
                    const dx = s.x - (playerPosition?.x ?? 0.5);
                    const dz = s.z - (playerPosition?.z ?? 0.5);
                    return `${SETTLEMENT_KIND_LABELS[s.kind]} ${Math.round(Math.hypot(dx, dz))} m ${compassWord(dx, dz)}`;
                  })
                  .join(' · ')}
              </p>
            )}
          </div>
        )}

        {worldMenuOpen && (
          <div role="dialog" aria-modal="true" aria-labelledby="world-seed-title" style={{ position: 'fixed', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(8, 12, 10, 0.76)', backdropFilter: 'blur(8px)' }}>
            <section style={{ width: 'min(440px, 100%)', padding: 24, borderRadius: 18, color: '#f3f1e8', background: '#202a23', border: '1px solid rgba(255,255,255,.18)', boxShadow: '0 24px 80px rgba(0,0,0,.45)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <h2 id="world-seed-title" style={{ margin: 0 }}>Create a world</h2>
                <button type="button" aria-label="Close world creator" onClick={() => setWorldMenuOpen(false)} style={{ fontSize: 22, color: 'inherit', background: 'transparent', border: 0, cursor: 'pointer' }}>×</button>
              </div>
              <p style={{ lineHeight: 1.55, color: '#c7d0c7' }}>A seed generates a repeatable landscape. Use the same seed to revisit the same terrain, or choose a new seed for different land, biomes, rivers and settlement locations. Each seed has its own saved block edits.</p>
              <label htmlFor="world-seed-input" style={{ display: 'block', margin: '16px 0 6px', fontSize: 13, letterSpacing: '.06em' }}>WORLD SEED (0–2147483647)</label>
              <input id="world-seed-input" data-testid="input-world-seed" type="number" min="0" max="2147483647" step="1" value={seedInput} onChange={(event) => setSeedInput(event.target.value)} placeholder="Enter a seed number" style={{ boxSizing: 'border-box', width: '100%', padding: '12px 14px', borderRadius: 9, border: '1px solid #647668', background: '#111914', color: '#fff', font: 'inherit' }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
                <button type="button" onClick={() => createSeededWorld(seedInput)} style={{ padding: '11px 15px', borderRadius: 9, border: 0, background: '#d4e0a7', color: '#1b281c', fontWeight: 700, cursor: 'pointer' }}>Create this seed</button>
                <button type="button" onClick={() => createSeededWorld('')} style={{ padding: '11px 15px', borderRadius: 9, border: '1px solid #647668', background: 'transparent', color: '#f3f1e8', cursor: 'pointer' }}>Random world</button>
              </div>
              <p style={{ marginBottom: 0, fontSize: 12, color: '#aeb9ad' }}>Creating a world reloads the game. Save your current landscape first if you have made changes.</p>
            </section>
          </div>
        )}
        <aside
          className="world-rules-panel"
          id="world-generation-rules"
          aria-label="World generation rules"
          hidden={!rulesOpen}
        >
          <div className="world-rules-heading">
            <h2>How the wild grows</h2>
            <button
              type="button"
              aria-label="Close world rules"
              onClick={() => setRulesOpen(false)}
            >
              ×
            </button>
          </div>
          <p><b>Scale:</b> every block is 0.5 m. You are 2 m (4 blocks) tall, doors are 5 blocks high, and a step up is one block.</p>
          <p><b>Ground:</b> soil depends on climate: grass over dirt in temperate land, sand over sandstone in deserts, snow in the cold, mud and clay in swamps. Steep slopes show bare rock, with gravel scree below.</p>
          <p><b>Rock:</b> pink granite in the high country, pale limestone in low basins, stone elsewhere; coal and iron veins sit inside the rock, and bedrock lies at the bottom.</p>
          <p><b>Rivers &amp; lakes:</b> rivers wind through low ground with flat water, banks of sand, gravel, clay or mud, and freeze in the cold. Basins below sea level fill with water.</p>
          <p><b>Trees:</b> ten kinds with their own trunks - oaks and birches in mixed woods, pine belts with bare lower trunks, spruce in the cold, giant redwoods with 3 x 3 bases in old stands, palms leaning off beaches, willows trailing leaves in swamps, cactus in deserts.</p>
          <p><b>Settlements:</b> four designs, each with its own roster of houses - <b>villages</b> (well, hall, watchtower, market stalls, thatched roofs, farms), <b>towns</b> (three-storey town hall and guild hall, inns, forges, row houses, palisade with gate towers), <b>castles</b> (moat, gatehouses, curtain wall, five-storey keep, garrison, royal gardens) and <b>kingdoms</b> (moat, double walls, a domed palace, and paved districts for market, temple, barracks and warehouses). Multi-storey houses have stairs you can walk up; tall pieces like the watchtower are lookouts reached by flight. Every house gets a door, a table and chairs - and there are no mobs, just the buildings for you to explore.</p>
          <p><b>Finding them:</b> a new world spawns you in the nearest settlement, and the card top-right always shows the nearest one with its distance and compass direction.</p>
          <p><b>Crafting:</b> press <kbd className="keycap">C</kbd> for the workbench - planks from logs, doors, chairs and tables from planks, dressed stone, marble, bricks, roof tiles and glass from what you gather. Place them anywhere you like.</p>
          <p><b>Everywhere:</b> 16×16 chunks stream in around you out to the view distance you choose; terrain comes from the seed, and your edits persist.</p>
        </aside>

        <div className={`crosshair ${target ? 'crosshair-active' : ''}`} data-testid="status-crosshair" aria-label={target ? `Aiming at ${target.cell.type}` : 'Aim crosshair'}>
          <span className="crosshair-center" />
        </div>

        <div className="bottom-left">
          <div className="readout" data-testid="status-coordinates">
            FIELD POSITION{biome ? ` · ${biome.toUpperCase()}` : ''}
            <strong>{coordinates}</strong>
          </div>
          <div className="readout" data-testid="status-block-count">
            CHUNKS LOADED
            <strong>{loadedChunkCount} · {loadedBlockCount.toLocaleString()} blocks · {Math.round(renderRadius * CHUNK_SIZE * 0.5)} m view</strong>
          </div>
        </div>

        <div className="bottom-hud">
          <div className="hotbar" role="toolbar" aria-label="Block selection" data-testid="hotbar">
            {BLOCK_TYPES.slice(hotbarPage * HOTBAR_SLOTS, (hotbarPage + 1) * HOTBAR_SLOTS).map((type, slot) => {
              const index = hotbarPage * HOTBAR_SLOTS + slot;
              const [sideColor, topColor] = BLOCK_COLORS[type];
              return (
                <button
                  key={type}
                  className={`hotbar-slot ${selected === type ? 'selected' : ''}`}
                  type="button"
                  aria-label={`Select ${BLOCK_META[type].label}, ${inventory[type]} available`}
                  aria-pressed={selected === type}
                  data-testid={`button-hotbar-${type}`}
                  onClick={() => setSelectedIndex(index)}
                >
                  <span className="slot-number">{slot === 9 ? '0' : slot + 1}</span>
                  <span
                    className="voxel-swatch"
                    style={{ background: `linear-gradient(135deg, ${topColor} 0 50%, ${sideColor} 50% 100%)` }}
                    aria-hidden="true"
                  />
                  <span className="slot-label">{BLOCK_META[type].label}</span>
                  <span className="slot-count" data-testid={`count-${type}`}>{inventory[type]}</span>
                </button>
              );
            })}
            <button
              className="hotbar-page"
              type="button"
              aria-label="Next block page"
              data-testid="button-hotbar-page"
              onClick={() => setSelectedIndex(((hotbarPage + 1) % hotbarPages) * HOTBAR_SLOTS)}
            >
              {hotbarPage + 1}/{hotbarPages}
            </button>
          </div>
          <div className="hint-line" data-testid="status-controls">
            <span className="hint-item"><kbd className="keycap">W</kbd><kbd className="keycap">A</kbd><kbd className="keycap">S</kbd><kbd className="keycap">D</kbd> wander</span>
            <span className="hint-item"><kbd className="keycap">←</kbd><kbd className="keycap">→</kbd> turn</span>
            <span className="hint-item"><kbd className="keycap">SPACE</kbd> jump · autojump on</span>
            <span className="hint-item"><kbd className="keycap">SPACE ×2</kbd> fly</span>
            <span className="hint-item"><kbd className="keycap">C</kbd> craft</span>
            <span className="hint-item"><kbd className="keycap">LMB</kbd> gather</span>
            <span className="hint-item"><kbd className="keycap">RMB</kbd> place</span>
            <span className="hint-item"><kbd className="keycap">SHIFT</kbd> run</span>
            <span className="hint-item"><kbd className="keycap">1–9 / 0</kbd> choose</span>
            <span className="hint-item"><kbd className="keycap">Q</kbd><kbd className="keycap">E</kbd> block page</span>
          </div>
        </div>

        <section
          className={`craft-panel ${craftOpen ? 'open' : ''}`}
          aria-label="Workbench"
          aria-hidden={!craftOpen}
          data-testid="panel-craft"
        >
          <header className="craft-head">
            <div>
              <strong>Workbench</strong>
              <p>Spend gathered blocks on furniture and dressed stone - then place it like any block.</p>
            </div>
            <button type="button" aria-label="Close workbench" onClick={() => setCraftOpen(false)}>×</button>
          </header>
          <div className="craft-list">
            {CRAFTING_RECIPES.map((recipe) => {
              const afford = canCraft(recipe, inventory);
              const [sideColor, topColor] = BLOCK_COLORS[recipe.output];
              return (
                <button
                  key={recipe.id}
                  className={`craft-row ${afford ? '' : 'is-missing'}`}
                  type="button"
                  disabled={!afford}
                  data-testid={`button-craft-${recipe.id}`}
                  onClick={() => craft(recipe)}
                >
                  <span
                    className="voxel-swatch"
                    style={{ background: `linear-gradient(135deg, ${topColor} 0 50%, ${sideColor} 50% 100%)` }}
                    aria-hidden="true"
                  />
                  <span className="craft-body">
                    <strong>{recipe.label}</strong>
                    <em>{recipe.work}</em>
                    <span className="craft-cost">
                      {recipe.inputs.map((input) => (
                        <b key={input.item} className={(inventory[input.item] ?? 0) >= input.count ? '' : 'short'}>
                          {BLOCK_META[input.item].short} {inventory[input.item] ?? 0}/{input.count}
                        </b>
                      ))}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <footer className="craft-foot">press C to close · mine logs, stone and clay to refill</footer>
        </section>

        <div className={`toast-note ${notice ? 'show' : ''}`} role="status" data-testid="status-notice">{notice}</div>

        <div className={`welcome-overlay ${started || craftOpen ? 'hidden' : ''}`}>
          <section className="welcome-card" aria-labelledby="welcome-title">
            <div className="welcome-mark" aria-hidden="true" />
            <h1 id="welcome-title">The wild is yours.</h1>
            <p>Wander a little, gather what catches your eye, then make this strange place your own.</p>
            <button className="welcome-start" type="button" onClick={beginExplore} data-testid="button-enter-world">
              <span>Enter the wild</span>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h9M8 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
            <p className="welcome-foot">click the land to capture your view</p>
          </section>
        </div>

        <div className="mobile-controls" aria-label="Touch movement controls">
          <span />
          <button type="button" aria-label="Move forward" data-testid="button-move-forward"
            onTouchStart={(event) => { event.preventDefault(); setMobileMove((value) => ({ ...value, forward: 1 })); }}
            onTouchEnd={(event) => { event.preventDefault(); setMobileMove((value) => ({ ...value, forward: 0 })); }}
            onTouchCancel={() => setMobileMove((value) => ({ ...value, forward: 0 }))}>↑</button>
          <span />
          <button type="button" aria-label="Move left" data-testid="button-move-left"
            onTouchStart={(event) => { event.preventDefault(); setMobileMove((value) => ({ ...value, side: -1 })); }}
            onTouchEnd={(event) => { event.preventDefault(); setMobileMove((value) => ({ ...value, side: 0 })); }}
            onTouchCancel={() => setMobileMove((value) => ({ ...value, side: 0 }))}>←</button>
          <button type="button" aria-label="Jump" data-testid="button-jump"
            onTouchStart={(event) => { event.preventDefault(); setMobileMove((value) => ({ ...value, jump: true })); }}
            onTouchEnd={(event) => { event.preventDefault(); setMobileMove((value) => ({ ...value, jump: false })); }}
            onTouchCancel={() => setMobileMove((value) => ({ ...value, jump: false }))}>↑</button>
          <button type="button" aria-label="Move right" data-testid="button-move-right"
            onTouchStart={(event) => { event.preventDefault(); setMobileMove((value) => ({ ...value, side: 1 })); }}
            onTouchEnd={(event) => { event.preventDefault(); setMobileMove((value) => ({ ...value, side: 0 })); }}
            onTouchCancel={() => setMobileMove((value) => ({ ...value, side: 0 }))}>→</button>
        </div>
        <div className="mobile-actions" aria-label="Touch building controls">
          <button
            type="button"
            aria-label="Mine targeted block"
            data-testid="button-touch-mine"
            onClick={() => { if (target) mineBlock(target.cell); }}
          >
            Mine
          </button>
          <button
            type="button"
            aria-label="Place selected block"
            data-testid="button-touch-place"
            onClick={() => { if (target) placeBlock(target.cell, target.adjacent); }}
          >
            Place
          </button>
          <button
            type="button"
            aria-label="Open workbench"
            data-testid="button-touch-craft"
            onClick={() => setCraftOpen((open) => !open)}
          >
            Craft
          </button>
        </div>
      </div>
    </main>
  );
}

export default App;
