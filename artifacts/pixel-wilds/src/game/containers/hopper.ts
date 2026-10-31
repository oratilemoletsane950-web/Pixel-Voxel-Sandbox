/**
 * Hopper routing: pull one item from the container above, push one item into
 * the container below. Facing variants can be added by changing this scheduler,
 * without touching storage, UI or save formats.
 */
import type { BlockType } from "../blocks";
import type { ContainerMap, ContainerState } from "./types";
import { containerKey, firstContainerItem, transferBetween } from "./core";

export function tickHoppers(containers: ContainerMap): ContainerMap {
  let next = containers;
  for (const [key, hopper] of Object.entries(containers)) {
    if (hopper.kind !== "hopper") continue;
    const [x, y, z] = key.split(",").map(Number);
    if (![x, y, z].every(Number.isFinite)) continue;

    const aboveKey = containerKey({ x, y: y + 1, z });
    const belowKey = containerKey({ x, y: y - 1, z });
    const above = next[aboveKey];
    const below = next[belowKey];

    if (above) {
      const item = firstContainerItem(above);
      if (item) {
        const moved = transferBetween(above, hopper, item, 1);
        if (moved.moved > 0) {
          next = { ...next, [key]: moved.target, [aboveKey]: moved.source };
        }
      }
    }

    if (below) {
      const item = firstContainerItem(next[key] ?? hopper);
      if (item) {
        const moved = transferBetween(next[key] ?? hopper, below, item, 1);
        if (moved.moved > 0) {
          next = { ...next, [key]: moved.source, [belowKey]: moved.target };
        }
      }
    }
  }
  return next;
}

/** Moves the whole contents of one generic container into another in one go. */
export function transferAll(
  source: ContainerState,
  target: ContainerState,
): { source: ContainerState; target: ContainerState; moved: number } {
  let sourceNow = source;
  let targetNow = target;
  let total = 0;
  for (const [item, count] of Object.entries(source.contents) as Array<[BlockType, number]>) {
    const result = transferBetween(sourceNow, targetNow, item, count ?? 0);
    sourceNow = result.source;
    targetNow = result.target;
    total += result.moved;
  }
  return { source: sourceNow, target: targetNow, moved: total };
}

/** Kept as a tiny named operation for UI code that wants a single unit move. */
export function moveOne(
  source: ContainerState,
  target: ContainerState,
): { source: ContainerState; target: ContainerState; moved: number } {
  const item = firstContainerItem(source);
  return item
    ? transferBetween(source, target, item, 1)
    : { source, target, moved: 0 };
}

