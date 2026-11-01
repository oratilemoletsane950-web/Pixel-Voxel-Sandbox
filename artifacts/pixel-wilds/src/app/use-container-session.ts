/**
 * Container session state for one world.
 *
 * The game screen owns input and the world; this hook owns chest/barrel/
 * furnace/hopper state, its save slot and the four transfer operations the
 * storage panel needs. Keeping it here makes the screen a composition layer
 * instead of a second container implementation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { BLOCK_META } from "./block-palette";
import type { BlockType } from "../game/blocks";
import {
  containerEntries,
  containerKey,
  containerKindForBlock,
  containerTotal,
  createContainer,
  deposit as depositIntoContainer,
  furnaceDeposit,
  furnaceWithdraw,
  readContainers,
  saveContainers,
  tickFurnaces,
  tickHoppers,
  withdraw as withdrawFromContainer,
  type ContainerMap,
} from "../game/containers";
import type { Inventory } from "../game/player/inventory";
import { getBlock } from "../game/world/access";
import type { WorldData } from "../game/world/types";

export interface ContainerSession {
  containers: ContainerMap;
  containersRef: { current: ContainerMap };
  transferChestItem: (
    item: BlockType,
    amount: number,
    mode: "deposit" | "withdraw",
  ) => void;
  transferFurnaceItem: (item: BlockType, amount: number) => void;
  takeFurnaceOutput: (amount: number) => void;
  removeContainerAt: (cell: { x: number; y: number; z: number }) => void;
}

export function useContainerSession({
  worldId,
  worldRef,
  inventory,
  setInventory,
  openChest,
  showNotice,
}: {
  worldId: string;
  worldRef: { current: WorldData };
  inventory: Inventory;
  setInventory: Dispatch<SetStateAction<Inventory>>;
  openChest: { x: number; y: number; z: number } | null;
  showNotice: (message: string) => void;
}): ContainerSession {
  const saved = useMemo(() => readContainers(worldId), [worldId]);
  const [containers, setContainers] = useState<ContainerMap>(saved);
  const containersRef = useRef(containers);
  containersRef.current = containers;

  useEffect(() => {
    saveContainers(worldId, containers);
  }, [containers, worldId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setContainers((current) => {
        const next = tickFurnaces(current, 0.5);
        if (next !== current) containersRef.current = next;
        return next;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setContainers((current) => {
        const next = tickHoppers(current);
        if (next !== current) containersRef.current = next;
        return next;
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  const transferChestItem = useCallback(
    (item: BlockType, amount: number, mode: "deposit" | "withdraw") => {
      if (!openChest) return;
      const key = containerKey(openChest);
      const found = getBlock(worldRef.current, openChest.x, openChest.y, openChest.z);
      const kind = containerKindForBlock(found ?? "") ?? "chest";
      if (kind === "furnace") {
        showNotice("Use the furnace's input and output controls");
        return;
      }
      const current = containersRef.current[key] ?? createContainer(kind);
      const result = mode === "deposit"
        ? depositIntoContainer(current, inventory, item, amount)
        : withdrawFromContainer(current, inventory, item, amount);
      if (result.moved === 0) {
        showNotice(result.blocked ? "That storage is full" : "Nothing to move");
        return;
      }
      const next = { ...containersRef.current };
      if (containerTotal(result.container) === 0) delete next[key];
      else next[key] = result.container;
      containersRef.current = next;
      setContainers(next);
      setInventory(result.inventory as Inventory);
      saveContainers(worldId, next);
      showNotice(
        `${mode === "deposit" ? "Stored" : "Took"} ${result.moved} ${BLOCK_META[item].label.toLowerCase()}`,
      );
    },
    [inventory, openChest, setInventory, showNotice, worldId, worldRef],
  );

  const transferFurnaceItem = useCallback(
    (item: BlockType, amount: number) => {
      if (!openChest) return;
      const key = containerKey(openChest);
      const found = getBlock(worldRef.current, openChest.x, openChest.y, openChest.z);
      if (found !== "furnace") return;
      const current = containersRef.current[key] ?? createContainer("furnace");
      const result = furnaceDeposit(current, inventory, item, amount);
      if (result.moved === 0) {
        showNotice("The furnace cannot take that item");
        return;
      }
      const next = { ...containersRef.current, [key]: result.container };
      containersRef.current = next;
      setContainers(next);
      setInventory(result.inventory as Inventory);
      saveContainers(worldId, next);
      showNotice(`Loaded ${result.moved} ${BLOCK_META[item].label.toLowerCase()}`);
    },
    [inventory, openChest, setInventory, showNotice, worldId, worldRef],
  );

  const takeFurnaceOutput = useCallback(
    (amount: number) => {
      if (!openChest) return;
      const key = containerKey(openChest);
      const found = getBlock(worldRef.current, openChest.x, openChest.y, openChest.z);
      if (found !== "furnace") return;
      const current = containersRef.current[key] ?? createContainer("furnace");
      const result = furnaceWithdraw(current, inventory, amount);
      if (result.moved === 0) {
        showNotice("The output is empty");
        return;
      }
      const next = { ...containersRef.current, [key]: result.container };
      containersRef.current = next;
      setContainers(next);
      setInventory(result.inventory as Inventory);
      saveContainers(worldId, next);
      showNotice(`Took ${result.moved} from the furnace`);
    },
    [inventory, openChest, setInventory, showNotice, worldId, worldRef],
  );

  const removeContainerAt = useCallback((cell: { x: number; y: number; z: number }) => {
    const key = containerKey(cell);
    if (!(key in containersRef.current)) return;
    const next = { ...containersRef.current };
    delete next[key];
    containersRef.current = next;
    setContainers(next);
    saveContainers(worldId, next);
  }, [worldId]);

  return {
    containers,
    containersRef,
    transferChestItem,
    transferFurnaceItem,
    takeFurnaceOutput,
    removeContainerAt,
  };
}
