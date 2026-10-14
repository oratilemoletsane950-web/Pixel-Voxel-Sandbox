import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  FACTION_COLORS,
  FACTION_SKIN_COLORS,
  SETTLEMENT_FACTIONS,
  type Humanoid,
  type SettlementFaction,
} from "../game/settlements";

function FactionBatch({
  faction,
  inhabitants,
}: {
  faction: SettlementFaction;
  inhabitants: Humanoid[];
}) {
  const body = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.InstancedMesh>(null);
  const lowerBody = useRef<THREE.InstancedMesh>(null);
  const arms = useRef<THREE.InstancedMesh>(null);
  const hat = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const clock = useRef(0);
  const updateElapsed = useRef(0);
  // Designed at ~1.8 units tall; people are 2 m (4 blocks) tall in a 0.5 m-per-block world.
  const NPC_SCALE = 2.05;
  const heightScale = faction === "dwarves" ? 0.78 : faction === "elves" ? 1.08 : 1;
  const widthScale = faction === "orcs" ? 1.2 : faction === "dwarves" ? 1.12 : 1;

  useFrame((_, delta) => {
    clock.current += delta;
    updateElapsed.current += delta;
    if (updateElapsed.current < 0.1) return;
    updateElapsed.current = 0;
    for (let index = 0; index < inhabitants.length; index += 1) {
      const person = inhabitants[index];
      const bob = Math.sin(clock.current * 1.7 + person.phase) * 0.025;
      const turn = Math.sin(clock.current * 0.35 + person.phase) * 0.12;
      const setPart = (
        mesh: THREE.InstancedMesh | null,
        y: number,
        scaleX: number,
        scaleY: number,
        scaleZ: number,
        zOffset = 0,
        rotationZ = 0,
      ) => {
        if (!mesh) return;
        dummy.position.set(person.x, person.y + (y * heightScale + bob) * NPC_SCALE, person.z + zOffset * NPC_SCALE);
        dummy.rotation.set(0, person.phase + turn, rotationZ);
        dummy.scale.set(scaleX * widthScale * NPC_SCALE, scaleY * heightScale * NPC_SCALE, scaleZ * widthScale * NPC_SCALE);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      };

      setPart(body.current, 0.92, 0.4, 0.6, 0.28);
      setPart(head.current, 1.36, 0.31, 0.34, 0.31);
      setPart(lowerBody.current, 0.34, 0.33, 0.42, 0.24);
      setPart(arms.current, 0.96, 0.68, 0.16, 0.18, 0, Math.sin(clock.current + person.phase) * 0.035);
      setPart(hat.current, 1.68, 0.38, 0.4, 0.38);
    }
    for (const mesh of [body.current, head.current, lowerBody.current, arms.current, hat.current]) {
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group name={`${faction}-settlers`}>
      <instancedMesh
        ref={body}
        args={[undefined, undefined, inhabitants.length]}
        castShadow={false}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color={FACTION_COLORS[faction]} />
      </instancedMesh>
      <instancedMesh
        ref={head}
        args={[undefined, undefined, inhabitants.length]}
        castShadow={false}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color={FACTION_SKIN_COLORS[faction]} />
      </instancedMesh>
      <instancedMesh
        ref={lowerBody}
        args={[undefined, undefined, inhabitants.length]}
        castShadow={false}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color={FACTION_COLORS[faction]} />
      </instancedMesh>
      <instancedMesh
        ref={arms}
        args={[undefined, undefined, inhabitants.length]}
        castShadow={false}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color={FACTION_COLORS[faction]} />
      </instancedMesh>
      {faction === "mages" && (
        <instancedMesh
          ref={hat}
          args={[undefined, undefined, inhabitants.length]}
          castShadow={false}
          frustumCulled={false}
        >
          <coneGeometry args={[0.24, 0.42, 4]} />
          <meshLambertMaterial color="#d8a958" />
        </instancedMesh>
      )}
    </group>
  );
}

export default function HumanoidBatches({ inhabitants }: { inhabitants: Humanoid[] }) {
  const byFaction = useMemo(() => {
    const groups = Object.fromEntries(
      SETTLEMENT_FACTIONS.map((faction) => [faction, [] as Humanoid[]]),
    ) as Record<SettlementFaction, Humanoid[]>;
    for (const inhabitant of inhabitants) groups[inhabitant.faction].push(inhabitant);
    return groups;
  }, [inhabitants]);

  return SETTLEMENT_FACTIONS.map((faction) =>
    byFaction[faction].length > 0 ? (
      <FactionBatch
        key={faction}
        faction={faction}
        inhabitants={byFaction[faction]}
      />
    ) : null,
  );
}
