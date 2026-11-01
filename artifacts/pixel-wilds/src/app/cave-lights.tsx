/**
 * Local underground lighting.
 *
 * Glow crystals are ordinary blocks, so the renderer discovers them in loaded
 * chunks and renders a small capped pool of point lights around the camera.
 * Discovery is throttled, keeping the render loop independent of chunk size.
 */
import { useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";

import { ID } from "../game/blocks";
import { CHUNK_SIZE, WORLD_HEIGHT } from "../game/chunk";
import type { WorldData } from "../game/world";

interface CaveLight {
  x: number;
  y: number;
  z: number;
  distance: number;
}

export function CaveLights({ worldRef }: { worldRef: { current: WorldData } }) {
  const { camera } = useThree();
  const [lights, setLights] = useState<CaveLight[]>([]);
  const clock = useRef(0);

  useFrame((_, delta) => {
    clock.current += delta;
    if (clock.current < 0.5) return;
    clock.current = 0;
    const px = Math.floor(camera.position.x);
    const py = Math.floor(camera.position.y);
    const pz = Math.floor(camera.position.z);
    const found: CaveLight[] = [];
    const seen = new Set<string>();

    for (const chunk of Object.values(worldRef.current.chunks)) {
      if (Math.abs(chunk.cx * CHUNK_SIZE + 8 - px) > 40) continue;
      if (Math.abs(chunk.cz * CHUNK_SIZE + 8 - pz) > 40) continue;
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
          const wx = chunk.cx * CHUNK_SIZE + lx;
          const wz = chunk.cz * CHUNK_SIZE + lz;
          if (Math.abs(wx - px) > 24 || Math.abs(wz - pz) > 24) continue;
          const base = (lx * CHUNK_SIZE + lz) * WORLD_HEIGHT;
          for (let y = Math.max(0, py - 18); y <= Math.min(WORLD_HEIGHT - 1, py + 18); y += 1) {
            if (chunk.blocks[base + y] !== ID.glow_crystal) continue;
            const distance = Math.hypot(wx - px, y - py, wz - pz);
            if (distance > 24) continue;
            const key = `${wx},${y},${wz}`;
            if (seen.has(key)) continue;
            seen.add(key);
            found.push({ x: wx + 0.5, y: y + 0.5, z: wz + 0.5, distance });
          }
        }
      }
    }

    found.sort((a, b) => a.distance - b.distance);
    const next = found.slice(0, 6);
    setLights((current) => {
      if (
        current.length === next.length &&
        current.every(
          (light, index) =>
            light.x === next[index].x && light.y === next[index].y && light.z === next[index].z,
        )
      ) return current;
      return next;
    });
  });

  return (
    <>
      {lights.map((light) => (
        <pointLight
          key={`${light.x}:${light.y}:${light.z}`}
          position={[light.x, light.y, light.z]}
          color="#a9f4e8"
          intensity={1.7}
          distance={12}
          decay={2}
        />
      ))}
    </>
  );
}
