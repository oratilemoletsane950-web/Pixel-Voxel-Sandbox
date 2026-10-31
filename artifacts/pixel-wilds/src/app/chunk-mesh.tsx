/**
 * Chunk rendering.
 *
 * One chunk is at most two meshes (solid and see-through). A memoised
 * signature of the chunk and its four neighbours decides when to rebuild, so
 * editing one block only rebuilds the chunks whose faces can change.
 */
import { memo, useEffect, useMemo } from "react";
import * as THREE from "three";

import { CHUNK_SIZE, chunkKey, type Chunk } from "../game/chunk";
import { buildChunkMesh, type MeshArrays } from "../game/mesher";
import type { WorldData } from "../game/world";

export interface ChunkMaterials {
  opaque: THREE.Material;
  clear: THREE.Material;
}

function toGeometry(mesh: MeshArrays | null): THREE.BufferGeometry | null {
  if (!mesh) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  if (mesh.colors) geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 4));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export const ChunkMesh = memo(function ChunkMesh({
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

export function chunkSignature(world: WorldData, chunk: Chunk): string {
  const { chunks } = world;
  const v = (cx: number, cz: number) => chunks[chunkKey(cx, cz)]?.version ?? -1;
  return `${chunk.version}|${v(chunk.cx + 1, chunk.cz)}|${v(chunk.cx - 1, chunk.cz)}|${v(chunk.cx, chunk.cz + 1)}|${v(chunk.cx, chunk.cz - 1)}`;
}
