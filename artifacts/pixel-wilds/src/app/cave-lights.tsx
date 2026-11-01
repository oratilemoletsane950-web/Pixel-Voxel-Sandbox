/**
 * Local underground lighting.
 *
 * Glow crystals are ordinary blocks, so the renderer asks the headless light
 * field which crystals are actually reachable from the camera's cave volume.
 * A bounded flood fill keeps lights from bleeding through walls and estimates
 * each crystal's reachable pool for its intensity. Discovery is throttled.
 */
import { useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";

import { caveLightsNear, type CaveLightPoint } from "../game/world/cave-light";
import type { WorldData } from "../game/world";

export function CaveLights({ worldRef }: { worldRef: { current: WorldData } }) {
  const { camera } = useThree();
  const [lights, setLights] = useState<CaveLightPoint[]>([]);
  const clock = useRef(0);

  useFrame((_, delta) => {
    clock.current += delta;
    if (clock.current < 0.5) return;
    clock.current = 0;
    const next = caveLightsNear(worldRef.current, {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    }, 26, 6);
    setLights((current) => {
      if (
        current.length === next.length &&
        current.every(
          (light, index) =>
            light.x === next[index].x &&
            light.y === next[index].y &&
            light.z === next[index].z &&
            Math.abs(light.intensity - next[index].intensity) < 0.05,
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
          position={light.position}
          color="#a9f4e8"
          intensity={light.intensity}
          distance={12}
          decay={2}
        />
      ))}
    </>
  );
}
