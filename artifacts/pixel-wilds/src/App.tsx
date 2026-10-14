import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import HumanoidBatches from './components/HumanoidBatches';
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
  FACTION_SKIN_COLORS,
  type Humanoid,
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

const BLOCK_META = BLOCK_INFO;
const BLOCK_COLORS = Object.fromEntries(
  Object.values(BLOCK_INFO).map((info) => [info.name, info.colors]),
) as Record<WorldBlockType, [string, string, string]>;

/** Block-interaction reach: 4 m (8 blocks), a comfortable arm-plus-tool distance. */
const REACH_BLOCKS = 8;
const HOTBAR_SLOTS = 10;
const RENDER_RADIUS_KEY = 'pixel-wilds-render-radius';

const SETTLEMENT_KIND_LABELS: Record<SettlementKind, string> = {
  village: 'Village',
  town: 'Town',
  city: 'City',
  grove: 'Elven grove',
  hold: 'Mountain hold',
  camp: 'Orc camp',
  tower: 'Mage tower',
  lodge: 'Warden lodge',
};

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
  BLOCK_TYPES.map((type) => [type, type.endsWith('_ore') ? 6 : type === 'glass' || type === 'brick' || type === 'roof' ? 16 : 24]),
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
  // A small area loads immediately; the rest streams in a few chunks at a time.
  try {
    return loadWorld(x, z, 5);
  } catch {
    return createWorld(undefined, x, z, 5);
  }
}

function findSpawn(world: WorldData): Position {
  return findSpawnPoint(world);
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
  inhabitants,
  savedPosition,
  mobileMove,
  renderRadius,
}: {
  world: WorldData;
  onTarget: (target: AimTarget | null) => void;
  onMine: (cell: BlockCell) => void;
  onPlace: (cell: BlockCell, adjacent: AimTarget['adjacent']) => void;
  onPosition: (position: Position) => void;
  onChunkChange: (chunkX: number, chunkZ: number) => void;
  inhabitants: Humanoid[];
  savedPosition: Position | null;
  mobileMove: { forward: number; side: number; jump: boolean };
  renderRadius: number;
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
  const touchLook = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const callbacks = useRef({
    onTarget,
    onMine,
    onPlace,
    onPosition,
    onChunkChange,
    inhabitants,
    world,
    mobileMove,
  });
  callbacks.current = {
    onTarget,
    onMine,
    onPlace,
    onPosition,
    onChunkChange,
    inhabitants,
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
      const slot = getHotbarIndexFromCode(code);
      if (slot >= 0) window.dispatchEvent(new CustomEvent('pixel-wilds-slot', { detail: slot }));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keyState.current[event.code] = false;
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
    const forward =
      Number(Boolean(keys.KeyW || keys.ArrowUp)) -
      Number(Boolean(keys.KeyS || keys.ArrowDown)) +
      mobileRef.current.forward;
    const side =
      Number(Boolean(keys.KeyD || keys.ArrowRight)) -
      Number(Boolean(keys.KeyA || keys.ArrowLeft)) +
      mobileRef.current.side;
    updatePlayerMotion(
      callbacks.current.world,
      player,
      {
        forward,
        side,
        jump: Boolean(keys.Space || mobileRef.current.jump),
        sprint: Boolean(keys.ShiftLeft || keys.ShiftRight),
      },
      yaw.current,
      dt,
    );

    if (player.y < -40) {
      Object.assign(
        player,
        createPlayerMotion(callbacks.current.world, findSpawn(callbacks.current.world)),
      );
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
      <HumanoidBatches inhabitants={inhabitants} />
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
  inhabitants,
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
  inhabitants: Humanoid[];
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
    inhabitants,
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
    inhabitants,
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
    };
    const onBlur = () => {
      keys.current = {};
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
        const inputForward =
          Number(Boolean(keys.current.KeyW || keys.current.ArrowUp)) -
          Number(Boolean(keys.current.KeyS || keys.current.ArrowDown)) +
          moveRef.current.forward;
        const inputSide =
          Number(Boolean(keys.current.KeyD || keys.current.ArrowRight)) -
          Number(Boolean(keys.current.KeyA || keys.current.ArrowLeft)) +
          moveRef.current.side;
        updatePlayerMotion(
          latest.current.world,
          player,
          {
            forward: inputForward,
            side: inputSide,
            jump: Boolean(keys.current.Space || moveRef.current.jump),
            sprint: Boolean(keys.current.ShiftLeft || keys.current.ShiftRight),
          },
          0,
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

      for (const person of latest.current.inhabitants) {
        const dx = person.x - player.x;
        const dz = person.z - player.z;
        if (Math.abs(dx) > 30 || Math.abs(dz) > 30) continue;
        const centerX = width / 2 + ((dx - dz) * tileWidth) / 2;
        const feetY = centerY + ((dx + dz) * tileHeight) / 2 -
          (person.y - baseY) * blockHeight;
        const pixel = Math.max(3, Math.round(tileWidth * 0.23));
        if (centerX < -pixel * 3 || centerX > width + pixel * 3 ||
          feetY < -pixel * 10 || feetY > height + pixel * 3) continue;
        context.fillStyle = 'rgba(47, 59, 48, 0.35)';
        context.fillRect(centerX - pixel * 1.15, feetY - pixel * 0.4, pixel * 2.3, pixel * 0.7);
        context.fillStyle = FACTION_COLORS[person.faction];
        context.fillRect(centerX - pixel, feetY - pixel * 3, pixel * 2, pixel * 2);
        context.fillStyle = FACTION_SKIN_COLORS[person.faction];
        context.fillRect(centerX - pixel * 0.75, feetY - pixel * 4.4, pixel * 1.5, pixel * 1.4);
        context.fillStyle = '#3c3b34';
        context.fillRect(centerX - pixel * 0.82, feetY - pixel, pixel * 0.68, pixel);
        context.fillRect(centerX + pixel * 0.14, feetY - pixel, pixel * 0.68, pixel);
        if (person.faction === 'mages') {
          context.fillStyle = '#d8a958';
          context.fillRect(centerX - pixel, feetY - pixel * 5.1, pixel * 2, pixel * 0.8);
          context.fillRect(centerX - pixel * 0.55, feetY - pixel * 6, pixel * 1.1, pixel);
        }
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
  const streamCenter = useRef(getChunkCoordinates(savedPlayer?.position?.x ?? 0, savedPlayer?.position?.z ?? 0));
  const selected = BLOCK_TYPES[selectedIndex] ?? 'grass';
  const hotbarPage = Math.floor(selectedIndex / HOTBAR_SLOTS);
  const hotbarPages = Math.ceil(BLOCK_TYPES.length / HOTBAR_SLOTS);
  const nearbySettlements = useMemo(
    () =>
      getSettlementsNear(
        world.seed,
        playerPosition?.x ?? 0.5,
        playerPosition?.z ?? 0.5,
        90,
      ),
    // Settlements are cached per region, so only the rounded position matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world.seed, Math.floor((playerPosition?.x ?? 0) / 16), Math.floor((playerPosition?.z ?? 0) / 16)],
  );
  const inhabitants = useMemo(
    () =>
      nearbySettlements
        .flatMap((settlement) => settlement.inhabitants)
        .filter((person) =>
          Math.hypot(
            person.x - (playerPosition?.x ?? 0.5),
            person.z - (playerPosition?.z ?? 0.5),
          ) < 96,
        ),
    [nearbySettlements, playerPosition],
  );
  const nearestSettlement = nearbySettlements[0];
  const settlementDistance = nearestSettlement
    ? Math.hypot(
      nearestSettlement.x - (playerPosition?.x ?? 0.5),
      nearestSettlement.z - (playerPosition?.z ?? 0.5),
    )
    : Infinity;
  const visibleSettlement = nearestSettlement && settlementDistance <= nearestSettlement.radius + 16 ? nearestSettlement : null;

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

  const beginExplore = () => {
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
          inhabitants={inhabitants}
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
            inhabitants={inhabitants}
            savedPosition={playerPosition}
            mobileMove={mobileMove}
            renderRadius={renderRadius}
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

        {visibleSettlement && (
          <div className="settlement-card" data-testid="status-nearby-settlement">
            <small>
              <i style={{ backgroundColor: FACTION_COLORS[visibleSettlement.faction] }} />
              {FACTION_LABELS[visibleSettlement.faction]} · {SETTLEMENT_KIND_LABELS[visibleSettlement.kind]}
            </small>
            <strong>{visibleSettlement.name}</strong>
            <p>
              {visibleSettlement.inhabitants.length} residents · {visibleSettlement.inhabitants[0]?.name}
            </p>
            <p>{visibleSettlement.inhabitants[0]?.role}</p>
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
          <p><b>Trees:</b> oak and birch in forests, spruce in cold and high places, cactus in deserts, broad oaks in swamps.</p>
          <p><b>Settlements:</b> sites are levelled, with streets, a plaza, houses facing the street, and walls for towns and cities.</p>
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
            <span className="hint-item"><kbd className="keycap">SPACE</kbd> hop / swim up</span>
            <span className="hint-item"><kbd className="keycap">LMB</kbd> gather</span>
            <span className="hint-item"><kbd className="keycap">RMB</kbd> place</span>
            <span className="hint-item"><kbd className="keycap">SHIFT</kbd> run</span>
            <span className="hint-item"><kbd className="keycap">1–9 / 0</kbd> choose</span>
            <span className="hint-item"><kbd className="keycap">Q</kbd><kbd className="keycap">E</kbd> block page</span>
          </div>
        </div>

        <div className={`toast-note ${notice ? 'show' : ''}`} role="status" data-testid="status-notice">{notice}</div>

        <div className={`welcome-overlay ${started ? 'hidden' : ''}`}>
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
        </div>
      </div>
    </main>
  );
}

export default App;
