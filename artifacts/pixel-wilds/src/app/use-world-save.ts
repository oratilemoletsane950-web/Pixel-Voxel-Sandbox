/**
 * One save transaction for a running world.
 *
 * Manual saves, save-and-quit and the pagehide/beforeunload safety net all use
 * the same ordered snapshot here. That keeps a new save slot from being added
 * to one path and forgotten in another.
 */
import { useCallback, useEffect } from "react";

import { saveWorldClock, saveWorldData } from "../game/world";
import { savePlayer } from "../game/player/inventory";
import { saveDropState, type DropField } from "../game/player/drops";
import { saveSurvival, type SurvivalState } from "../game/player/survival";
import { saveToolState, type ToolState } from "../game/player/tools";
import { saveContainers, type ContainerMap } from "../game/containers";
import type { WorldData } from "../game/world/types";
import type { Position } from "../game/physics";
import type { Inventory } from "../game/player/inventory";
import type { FarmingSession } from "./use-farming";

export function useWorldSave({
  worldId,
  worldRef,
  worldTimeRef,
  playerPositionRef,
  inventory,
  survivalMode,
  survivalRef,
  toolStateRef,
  dropField,
  containersRef,
  farming,
  setSaveState,
  showNotice,
}: {
  worldId: string;
  worldRef: { current: WorldData };
  worldTimeRef: { current: number };
  playerPositionRef: { current: Position | null };
  inventory: Inventory;
  survivalMode: boolean;
  survivalRef: { current: SurvivalState };
  toolStateRef: { current: ToolState };
  dropField: DropField;
  containersRef: { current: ContainerMap };
  farming: FarmingSession;
  setSaveState: (state: "saved" | "unsaved") => void;
  showNotice: (message: string) => void;
}): (announce?: boolean) => boolean {
  const saveNow = useCallback(
    (announce = true) => {
      try {
        saveWorldData(worldId, worldRef.current);
        savePlayer(worldId, inventory, playerPositionRef.current);
        saveWorldClock(worldId, worldTimeRef.current);
        if (survivalMode) saveSurvival(worldId, survivalRef.current);
        saveToolState(worldId, toolStateRef.current);
        saveDropState(worldId, dropField);
        saveContainers(worldId, containersRef.current);
        farming.saveNow();
        setSaveState("saved");
        if (announce) showNotice("Landscape tucked away");
        return true;
      } catch {
        if (announce) showNotice("Could not save this landscape");
        return false;
      }
    },
    [
      dropField,
      farming.saveNow,
      inventory,
      playerPositionRef,
      setSaveState,
      showNotice,
      survivalMode,
      survivalRef,
      toolStateRef,
      containersRef,
      worldId,
      worldRef,
      worldTimeRef,
    ],
  );

  useEffect(() => {
    const onExit = () => {
      saveNow(false);
    };
    window.addEventListener("beforeunload", onExit);
    window.addEventListener("pagehide", onExit);
    return () => {
      window.removeEventListener("beforeunload", onExit);
      window.removeEventListener("pagehide", onExit);
    };
  }, [saveNow]);

  return saveNow;
}
