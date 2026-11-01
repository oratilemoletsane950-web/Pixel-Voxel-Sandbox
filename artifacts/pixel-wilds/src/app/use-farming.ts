/**
 * Farming session state.
 *
 * The game screen owns the world and clock; this hook owns crop records,
 * persistence, growth reconciliation and the two mutations the UI needs. The
 * crop domain itself stays headless in `game/farming`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  harvestCrop,
  isIrrigated,
  plantCrop,
  readCropField,
  saveCropField,
  syncCropField,
  type CropField,
  type CropHarvest,
  type PlantResult,
} from "../game/farming";
import { setBlock } from "../game/world/access";
import type { WorldData } from "../game/world/types";

export interface FarmingSession {
  crops: CropField;
  cropsRef: { current: CropField };
  plant: (world: WorldData, x: number, y: number, z: number, worldTime: number, kind?: "wheat" | "carrot") => PlantResult;
  harvest: (x: number, y: number, z: number, worldTime: number) => CropHarvest;
  saveNow: () => void;
}

export function useFarming({
  worldId,
  active,
  worldRef,
  worldTimeRef,
  rainingRef,
  onWorldChanged,
}: {
  worldId: string;
  active: boolean;
  worldRef: { current: WorldData };
  worldTimeRef: { current: number };
  rainingRef: { current: boolean };
  onWorldChanged: (world: WorldData) => void;
}): FarmingSession {
  const initial = useMemo(() => readCropField(worldId), [worldId]);
  const [crops, setCrops] = useState<CropField>(initial);
  const cropsRef = useRef(crops);
  cropsRef.current = crops;

  const commit = useCallback(
    (next: CropField) => {
      cropsRef.current = next;
      setCrops(next);
      saveCropField(worldId, next);
    },
    [worldId],
  );

  useEffect(() => {
    saveCropField(worldId, crops);
  }, [crops, worldId]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      const result = syncCropField(cropsRef.current, worldRef.current, worldTimeRef.current, {
        raining: rainingRef.current,
      });
      if (!result.changed && result.field === cropsRef.current) return;
      cropsRef.current = result.field;
      setCrops(result.field);
      if (result.changed) onWorldChanged(result.world);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active, onWorldChanged, rainingRef, worldRef, worldTimeRef]);

  const plant = useCallback(
    (
      world: WorldData,
      x: number,
      y: number,
      z: number,
      worldTime: number,
      kind: "wheat" | "carrot" = "wheat",
    ): PlantResult => {
      const result = plantCrop(cropsRef.current, world, x, y, z, worldTime, kind);
      if (result.planted) commit(result.field);
      return result;
    },
    [commit],
  );

  const harvest = useCallback(
    (x: number, y: number, z: number, worldTime: number): CropHarvest => {
      const result = harvestCrop(cropsRef.current, x, y, z, worldTime, {
        irrigated: isIrrigated(worldRef.current, x, y, z),
        raining: rainingRef.current,
      });
      if (result.record) commit(result.field);
      return result;
    },
    [commit, rainingRef, worldRef],
  );

  const saveNow = useCallback(() => {
    saveCropField(worldId, cropsRef.current);
  }, [worldId]);

  return { crops, cropsRef, plant, harvest, saveNow };
}

/** Applies a harvested crop's stage removal to the world. */
export function clearCropBlock(world: WorldData, x: number, y: number, z: number): WorldData {
  return setBlock(world, x, y, z, null);
}
