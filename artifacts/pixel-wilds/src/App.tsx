import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  BLOCK_TYPES,
  CHUNK_LOAD_RADIUS,
  MAX_BUILD_HEIGHT,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  WORLD_BLOCK_TYPES,
  blockKey,
  createWorld,
  ensureChunks,
  getBlock,
  getChunkCoordinates,
  getLoadedBlockCount,
  getLoadedChunkCount,
  getVisibleBlocks,
  loadWorld,
  saveWorld,
  setBlock,
  type BlockCell,
  type BlockType,
  type WorldBlockType,
  type WorldData,
} from './game/world';
import {
  createPlayerMotion,
  updatePlayerMotion,
  type PlayerMotion,
  type Position,
} from './game/physics';

const BLOCK_META: Record<WorldBlockType, { label: string; short: string }> = {
  grass: { label: 'Grass', short: 'GRS' },
  dirt: { label: 'Dirt', short: 'DRT' },
  stone: { label: 'Stone', short: 'STN' },
  sand: { label: 'Sand', short: 'SND' },
  wood: { label: 'Wood', short: 'WOD' },
  leaves: { label: 'Leaves', short: 'LVF' },
  gravel: { label: 'Gravel', short: 'GRV' },
  clay: { label: 'Clay', short: 'CLY' },
  snow: { label: 'Snow', short: 'SNW' },
  cobblestone: { label: 'Cobble', short: 'CBL' },
  flower: { label: 'Wild bloom', short: 'FLR' },
};

const BLOCK_COLORS: Record<WorldBlockType, [string, string, string]> = {
  grass: ['#788d53', '#829e5b', '#bc8459'],
  dirt: ['#9b6b48', '#ad7950', '#ad7950'],
  stone: ['#82877c', '#9b9d8b', '#777c73'],
  sand: ['#d1b870', '#e3cb83', '#c3a965'],
  wood: ['#956044', '#bd8150', '#80513e'],
  leaves: ['#4c7957', '#6f9b61', '#416b50'],
  gravel: ['#8a8578', '#b7ad98', '#706d63'],
  clay: ['#a66f65', '#ce9480', '#8c5d59'],
  snow: ['#aabac2', '#eef0dc', '#869da6'],
  cobblestone: ['#686f6b', '#93968a', '#5a625f'],
  flower: ['#59845b', '#7aa76a', '#507b54'],
};

type AimTarget = { cell: BlockCell; adjacent: { x: number; y: number; z: number } };
type Inventory = Record<BlockType, number>;

const DEFAULT_INVENTORY: Inventory = {
  grass: 24,
  dirt: 32,
  stone: 18,
  sand: 12,
  wood: 14,
  leaves: 12,
  gravel: 16,
  clay: 12,
  snow: 10,
  cobblestone: 16,
};

const SAVE_KEY = 'pixel-wilds-player-v1';

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
  try {
    return loadWorld(x, z) ?? createWorld(undefined, x, z);
  } catch {
    return createWorld(undefined, x, z);
  }
}

function findSpawn(world: WorldData): Position {
  let best: { x: number; z: number; y: number; score: number } | null = null;
  for (let x = -5; x <= 5; x += 1) {
    for (let z = -5; z <= 5; z += 1) {
      let top = -Infinity;
      let topType: WorldBlockType | null = null;
      for (let y = MAX_BUILD_HEIGHT; y >= 0; y -= 1) {
        const type = getBlock(world, x, y, z);
        if (type) {
          top = y;
          topType = type;
          break;
        }
      }
      if (topType !== 'grass' && topType !== 'sand') continue;
      if (getBlock(world, x, top + 1, z) || getBlock(world, x, top + 2, z)) continue;
      const score = Math.abs(x) + Math.abs(z) + Math.abs(top) * 0.05;
      if (!best || score < best.score) best = { x, z, y: top, score };
    }
  }
  if (best) return {
    x: best.x + 0.5,
    y: best.y + 1 + PLAYER_EYE_HEIGHT,
    z: best.z + 0.5,
  };
  return { x: 0.5, y: 6, z: 0.5 };
}

function getHotbarIndexFromCode(code: string): number {
  if (code === 'Digit0') return 9;
  if (/^Digit[1-9]$/.test(code)) return Number(code.slice(-1)) - 1;
  return -1;
}

function pixelTexture(type: WorldBlockType, face: number) {
  const [side, top, base] = BLOCK_COLORS[type];
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const isTop = face === 2;
  ctx.fillStyle = isTop ? top : side;
  ctx.fillRect(0, 0, 16, 16);
  if (type === 'grass' && face !== 2) {
    ctx.fillStyle = '#a77750';
    ctx.fillRect(0, 4, 16, 12);
    ctx.fillStyle = '#6e9c59';
    ctx.fillRect(0, 0, 16, 4);
    ctx.fillRect(0, 3, 6, 2);
    ctx.fillRect(9, 2, 7, 2);
  }
  if (type === 'wood') {
    ctx.fillStyle = isTop ? '#d09a62' : '#744938';
    if (isTop) {
      ctx.fillRect(2, 2, 12, 12);
      ctx.fillStyle = '#a66a47';
      ctx.fillRect(5, 5, 6, 6);
      ctx.fillStyle = '#dda96b';
      ctx.fillRect(7, 7, 2, 2);
    } else {
      ctx.fillRect(3, 0, 2, 16);
      ctx.fillRect(11, 0, 2, 16);
      ctx.fillStyle = '#d09a62';
      ctx.fillRect(6, 1, 2, 7);
      ctx.fillRect(8, 10, 2, 5);
    }
  }
  if (type === 'flower' && isTop) {
    ctx.fillStyle = '#93b56a';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#f4d276';
    ctx.fillRect(6, 3, 4, 4);
    ctx.fillStyle = '#d8796e';
    ctx.fillRect(5, 2, 2, 2);
    ctx.fillRect(9, 2, 2, 2);
    ctx.fillRect(5, 6, 2, 2);
    ctx.fillRect(9, 6, 2, 2);
  }
  const colors = type === 'stone' || type === 'cobblestone'
    ? ['#c0bca1', '#626e69', '#9e9f90']
    : type === 'sand' || type === 'snow'
      ? ['#f0d993', '#b99d61', '#e2c77e']
      : type === 'gravel'
        ? ['#b7ad98', '#706d63', '#8a8578']
        : type === 'clay'
          ? ['#ce9480', '#8c5d59', '#a66f65']
      : type === 'leaves'
        ? ['#91b66a', '#416c50', '#6d985d']
        : ['#d3a16c', '#644a3c', base];
  let seed = type.split('').reduce((total, char) => total + char.charCodeAt(0), 0) + face * 31;
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < 31; i += 1) {
    const x = Math.floor(random() * 16);
    const y = Math.floor(random() * 16);
    if (type === 'grass' && face !== 2 && y < 5) continue;
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    ctx.globalAlpha = 0.35 + random() * 0.35;
    ctx.fillRect(x, y, random() > 0.72 ? 2 : 1, random() > 0.8 ? 2 : 1);
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const textureCache = new Map<string, THREE.CanvasTexture | null>();

function getMaterials(type: WorldBlockType) {
  return [0, 1, 2, 3, 4, 5].map((face) => {
    const key = `${type}-${face}`;
    if (!textureCache.has(key)) textureCache.set(key, pixelTexture(type, face));
    return new THREE.MeshLambertMaterial({ map: textureCache.get(key), color: '#fffaf0' });
  });
}

function VoxelBatch({ type, cells }: { type: WorldBlockType; cells: BlockCell[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materials = useMemo(() => getMaterials(type), [type]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    cells.forEach((cell, index) => {
      dummy.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.userData.cells = cells;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [cells, dummy]);
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, cells.length]}
      userData={{ cells }}
      castShadow
      receiveShadow
      material={materials}
    >
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
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
}: {
  world: WorldData;
  onTarget: (target: AimTarget | null) => void;
  onMine: (cell: BlockCell) => void;
  onPlace: (cell: BlockCell, adjacent: AimTarget['adjacent']) => void;
  onPosition: (position: Position) => void;
  onChunkChange: (chunkX: number, chunkZ: number) => void;
  savedPosition: Position | null;
  mobileMove: { forward: number; side: number; jump: boolean };
}) {
  const visible = useMemo(() => getVisibleBlocks(world), [world]);
  const cellsByType = useMemo(() => {
    const grouped = Object.fromEntries(
      WORLD_BLOCK_TYPES.map((type) => [type, [] as BlockCell[]]),
    ) as Record<WorldBlockType, BlockCell[]>;
    for (const cell of visible) grouped[cell.type].push(cell);
    return grouped;
  }, [visible]);
  const { camera, gl, scene } = useThree();
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
    world,
    mobileMove,
  });
  callbacks.current = { onTarget, onMine, onPlace, onPosition, onChunkChange, world, mobileMove };

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
      if (slot >= 0) {
        const type = BLOCK_TYPES[slot];
        if (type) window.dispatchEvent(new CustomEvent('pixel-wilds-select', { detail: type }));
      }
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

  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const normalMatrix = useMemo(() => new THREE.Matrix3(), []);
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

    if (player.y < -12) {
      Object.assign(
        player,
        createPlayerMotion(callbacks.current.world, findSpawn(callbacks.current.world)),
      );
    }
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
    camera.position.set(player.x, player.y, player.z);
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
      raycaster.set(camera.position, direction);
      raycaster.far = 6.2;
      const hit = raycaster.intersectObjects(scene.children, true).find((intersection) => {
        const object = intersection.object as THREE.InstancedMesh;
        return object.userData?.cells && Number.isInteger(intersection.instanceId) && intersection.face;
      });
      if (hit?.face) {
        const mesh = hit.object as THREE.InstancedMesh;
        const cell = mesh.userData.cells[hit.instanceId as number] as BlockCell;
        normalMatrix.getNormalMatrix(mesh.matrixWorld);
        const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).round();
        const nextTarget: AimTarget = {
          cell,
          adjacent: { x: cell.x + normal.x, y: cell.y + normal.y, z: cell.z + normal.z },
        };
        target.current = nextTarget;
        const key = blockKey(cell.x, cell.y, cell.z);
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
      <color attach="background" args={['#a9d9d1']} />
      <fog attach="fog" args={['#b7ddd0', 18, 43]} />
      <hemisphereLight args={['#f9e9ba', '#567558', 1.45]} />
      <directionalLight
        position={[-8, 15, 7]}
        intensity={2.05}
        color="#ffe3a4"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
      />
      <mesh position={[14, 13, -24]} rotation={[0.15, 0, 0]}>
        <boxGeometry args={[3.2, 3.2, 0.25]} />
        <meshBasicMaterial color="#f1b76b" />
      </mesh>
      {WORLD_BLOCK_TYPES.map((type) => (
        <VoxelBatch key={type} type={type} cells={cellsByType[type]} />
      ))}
      {target.current && (
        <mesh position={[target.current.cell.x + 0.5, target.current.cell.y + 0.5, target.current.cell.z + 0.5]}>
          <boxGeometry args={[1.012, 1.012, 1.012]} />
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
  const lastPositionSent = useRef(0);
  const lastChunkKey = useRef('');
  moveRef.current = mobileMove;
  startedRef.current = started;

  const ordered = useMemo(
    () =>
      getVisibleBlocks(world).sort(
        (a, b) => a.x + a.z + a.y - (b.x + b.z + b.y),
      ),
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
      if (
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code) ||
        getHotbarIndexFromCode(event.code) >= 0
      ) {
        event.preventDefault();
      }
      const index = getHotbarIndexFromCode(event.code);
      if (index >= 0) {
        const type = BLOCK_TYPES[index];
        if (type) window.dispatchEvent(new CustomEvent('pixel-wilds-select', { detail: type }));
      }
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
  const selected = BLOCK_TYPES[selectedIndex] ?? 'grass';

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

  const streamChunks = useCallback((chunkX: number, chunkZ: number) => {
    const next = ensureChunks(worldRef.current, chunkX, chunkZ, CHUNK_LOAD_RADIUS);
    if (next === worldRef.current) return;
    worldRef.current = next;
    setWorld(next);
  }, []);

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
    setWorldEdited((latestWorld) => setBlock(latestWorld, cell.x, cell.y, cell.z, null));
    if (found !== 'flower') {
      setInventory((currentInventory) => ({
        ...currentInventory,
        [found]: currentInventory[found] + 1,
      }));
      showNotice(`${BLOCK_META[found].label} gathered`);
    } else {
      showNotice('Wild bloom cleared');
    }
  }, [showNotice, setWorldEdited]);

  const placeBlock = useCallback((cell: BlockCell, adjacent: AimTarget['adjacent']) => {
    if (inventory[selected] < 1) {
      showNotice(`Out of ${BLOCK_META[selected].label.toLowerCase()}`);
      return;
    }
    if (getBlock(worldRef.current, adjacent.x, adjacent.y, adjacent.z)) return;
    const feetY = (playerPosition?.y ?? 4) - PLAYER_EYE_HEIGHT;
    const headY = feetY + PLAYER_HEIGHT;
    const overlapsPlayer =
      adjacent.x < (playerPosition?.x ?? 0.5) + 0.28 &&
      adjacent.x + 1 > (playerPosition?.x ?? 0.5) - 0.28 &&
      adjacent.z < (playerPosition?.z ?? 0.5) + 0.28 &&
      adjacent.z + 1 > (playerPosition?.z ?? 0.5) - 0.28 &&
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
    const onPointerChange = () => {
      const locked = document.pointerLockElement !== null;
      setStarted(locked);
    };
    window.addEventListener('pixel-wilds-select', onSelect);
    window.addEventListener('pixel-wilds-cycle', onCycle);
    document.addEventListener('pointerlockchange', onPointerChange);
    const saveOnExit = () => savePlayerState();
    window.addEventListener('beforeunload', saveOnExit);
    return () => {
      window.removeEventListener('pixel-wilds-select', onSelect);
      window.removeEventListener('pixel-wilds-cycle', onCycle);
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
          shadows
          dpr={[1, 1.6]}
          camera={{ position: [0.5, 5, 0.5], fov: 74, near: 0.08, far: 90 }}
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
          <p><b>Grasslands:</b> grass over two dirt layers; trees add wood trunks and leaf crowns, with occasional flowers.</p>
          <p><b>Drylands:</b> sand surface with gravel seams over deep stone.</p>
          <p><b>Wet lowlands:</b> clay at the surface where damp terrain stays low.</p>
          <p><b>Cold peaks:</b> snow caps higher, colder hills; dirt and stone below.</p>
          <p><b>Rocky ridges:</b> cobblestone on exposed high ground, with gravel patches.</p>
          <p><b>Everywhere:</b> 16×16 chunks stream in a 5×5 area around you; the world seed keeps terrain stable and your edits persist when chunks unload.</p>
        </aside>

        <div className={`crosshair ${target ? 'crosshair-active' : ''}`} data-testid="status-crosshair" aria-label={target ? `Aiming at ${target.cell.type}` : 'Aim crosshair'}>
          <span className="crosshair-center" />
        </div>

        <div className="bottom-left">
          <div className="readout" data-testid="status-coordinates">
            FIELD POSITION
            <strong>{coordinates}</strong>
          </div>
          <div className="readout" data-testid="status-block-count">
            CHUNKS LOADED
            <strong>{loadedChunkCount} · {loadedBlockCount.toLocaleString()} blocks</strong>
          </div>
        </div>

        <div className="bottom-hud">
          <div className="hotbar" role="toolbar" aria-label="Block selection" data-testid="hotbar">
            {BLOCK_TYPES.map((type, index) => (
              <button
                key={type}
                className={`hotbar-slot ${selected === type ? 'selected' : ''}`}
                type="button"
                aria-label={`Select ${BLOCK_META[type].label}, ${inventory[type]} available`}
                aria-pressed={selected === type}
                data-testid={`button-hotbar-${type}`}
                onClick={() => setSelectedIndex(index)}
              >
                <span className="slot-number">{index === 9 ? '0' : index + 1}</span>
                <span className={`voxel-swatch swatch-${type}`} aria-hidden="true" />
                <span className="slot-label">{BLOCK_META[type].label}</span>
                <span className="slot-count" data-testid={`count-${type}`}>{inventory[type]}</span>
              </button>
            ))}
          </div>
          <div className="hint-line" data-testid="status-controls">
            <span className="hint-item"><kbd className="keycap">W</kbd><kbd className="keycap">A</kbd><kbd className="keycap">S</kbd><kbd className="keycap">D</kbd> wander</span>
            <span className="hint-item"><kbd className="keycap">SPACE</kbd> hop</span>
            <span className="hint-item"><kbd className="keycap">LMB</kbd> gather</span>
            <span className="hint-item"><kbd className="keycap">RMB</kbd> place</span>
            <span className="hint-item"><kbd className="keycap">SHIFT</kbd> run</span>
            <span className="hint-item"><kbd className="keycap">1–9 / 0</kbd> choose</span>
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
