/**
 * Container identity and generic storage transfer.
 *
 * Furnace-specific slot rules live in furnace.ts; hoppers are just a scheduler
 * that calls transferBetween. This keeps storage behaviour composable instead
 * of growing one switch with every container type.
 */
import { BLOCK_TYPES, type BlockType } from "../blocks";
import { STACK_LIMIT } from "../items/stacks";
import {
  CONTAINER_SLOT_COUNTS,
  emptyFurnace,
  type ContainerContents,
  type ContainerKind,
  type ContainerMap,
  type ContainerState,
  type ContainerTransfer,
} from "./types";

export function containerKey(cell: { x: number; y: number; z: number }): string {
  return `${cell.x},${cell.y},${cell.z}`;
}

export function parseContainerKey(key: string): { x: number; y: number; z: number } | null {
  const parts = key.split(",").map(Number);
  if (parts.length !== 3 || !parts.every(Number.isSafeInteger)) return null;
  return { x: parts[0], y: parts[1], z: parts[2] };
}

export function containerKindForBlock(type: string): ContainerKind | null {
  return type === "chest" || type === "barrel" || type === "furnace" || type === "hopper"
    ? type
    : null;
}

export function isContainerBlock(type: string | null | undefined): boolean {
  return Boolean(type && containerKindForBlock(type));
}

export function createContainer(kind: ContainerKind): ContainerState {
  return {
    kind,
    contents: {},
    ...(kind === "furnace" ? { furnace: emptyFurnace() } : {}),
  };
}

export function containerCapacity(kind: ContainerKind): number {
  return CONTAINER_SLOT_COUNTS[kind] * STACK_LIMIT;
}

export function contentsOf(container: ContainerState): ContainerContents {
  return container.contents;
}

export function isContainerState(value: unknown): value is ContainerState {
  return Boolean(value && typeof value === "object" && "kind" in value && "contents" in value);
}

export function containerEntries(container: ContainerState): Array<[BlockType, number]> {
  if (container.kind === "furnace" && container.furnace) {
    const entries: Array<[BlockType, number]> = [];
    if (container.furnace.input && container.furnace.inputCount > 0) {
      entries.push([container.furnace.input, container.furnace.inputCount]);
    }
    if (container.furnace.fuel && container.furnace.fuelCount > 0) {
      entries.push([container.furnace.fuel, container.furnace.fuelCount]);
    }
    if (container.furnace.output && container.furnace.outputCount > 0) {
      entries.push([container.furnace.output, container.furnace.outputCount]);
    }
    return entries;
  }
  return Object.entries(container.contents)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([item, count]) => [item as BlockType, count ?? 0]);
}

export function containerTotal(value: ContainerState | ContainerContents): number {
  if (!isContainerState(value)) {
    return Object.values(value).reduce((total, count) => total + Math.max(0, count ?? 0), 0);
  }
  if (value.kind === "furnace" && value.furnace) {
    return value.furnace.inputCount + value.furnace.fuelCount + value.furnace.outputCount;
  }
  return Object.values(value.contents).reduce(
    (total, count) => total + Math.max(0, count ?? 0),
    0,
  );
}

export function containerUsedSlots(value: ContainerState | ContainerContents): number {
  if (isContainerState(value)) {
    if (value.kind === "furnace" && value.furnace) {
      return [value.furnace.inputCount, value.furnace.fuelCount, value.furnace.outputCount]
        .filter((count) => count > 0).length;
    }
    return Object.values(value.contents)
      .filter((count) => (count ?? 0) > 0)
      .reduce((sum, count) => sum + Math.ceil((count ?? 0) / STACK_LIMIT), 0);
  }
  return Object.values(value)
    .filter((count) => (count ?? 0) > 0)
    .reduce((sum, count) => sum + Math.ceil((count ?? 0) / STACK_LIMIT), 0);
}

export function isItem(value: string): value is BlockType {
  return (BLOCK_TYPES as readonly string[]).includes(value);
}

export function deposit(
  container: ContainerState,
  inventory: Record<string, number>,
  item: BlockType,
  amount: number,
): ContainerTransfer {
  if (container.kind === "furnace") {
    // Imported lazily through the module boundary in furnace.ts would create a
    // cycle; the furnace implementation dispatches here through its own API.
    return depositGeneric(container, inventory, item, amount);
  }
  return depositGeneric(container, inventory, item, amount);
}

function depositGeneric(
  container: ContainerState,
  inventory: Record<string, number>,
  item: BlockType,
  amount: number,
): ContainerTransfer {
  const requested = Math.max(0, Math.floor(amount));
  const current = Math.max(0, container.contents[item] ?? 0);
  const total = Object.values(container.contents).reduce(
    (sum, count) => sum + Math.max(0, count ?? 0),
    0,
  );
  const room = Math.max(0, containerCapacity(container.kind) - total);
  const carried = Math.max(0, inventory[item] ?? 0);
  const moved = Math.min(requested, carried, room);
  if (moved <= 0) {
    return { container, inventory, moved: 0, blocked: requested > room };
  }
  return {
    container: {
      ...container,
      contents: { ...container.contents, [item]: current + moved },
    },
    inventory: { ...inventory, [item]: carried - moved },
    moved,
    blocked: requested > room,
  };
}

export function withdraw(
  container: ContainerState,
  inventory: Record<string, number>,
  item: BlockType,
  amount: number,
): ContainerTransfer {
  const requested = Math.max(0, Math.floor(amount));
  if (container.kind === "furnace") {
    return { container, inventory, moved: 0, blocked: false };
  }
  const stored = Math.max(0, container.contents[item] ?? 0);
  const moved = Math.min(requested, stored);
  if (moved <= 0) return { container, inventory, moved: 0, blocked: false };
  const contents = { ...container.contents };
  const remaining = stored - moved;
  if (remaining > 0) contents[item] = remaining;
  else delete contents[item];
  return {
    container: { ...container, contents },
    inventory: { ...inventory, [item]: Math.max(0, inventory[item] ?? 0) + moved },
    moved,
    blocked: false,
  };
}

/** Moves a stack between two containers without routing it through the pack. */
export function transferBetween(
  source: ContainerState,
  target: ContainerState,
  item: BlockType,
  amount: number,
): { source: ContainerState; target: ContainerState; moved: number } {
  const carrier = { [item]: 0 };
  const taken = withdraw(source, carrier, item, amount);
  if (taken.moved <= 0) return { source, target, moved: 0 };
  const placed = deposit(target, taken.inventory, item, taken.moved);
  const moved = placed.moved;
  if (moved === 0) return { source, target, moved: 0 };
  return { source: taken.container, target: placed.container, moved };
}

/** First non-empty item in a container, useful for hopper ticks and transfer-all. */
export function firstContainerItem(container: ContainerState): BlockType | null {
  if (container.kind === "furnace" && container.furnace) {
    return container.furnace.output;
  }
  for (const [item, count] of Object.entries(container.contents)) {
    if ((count ?? 0) > 0) return item as BlockType;
  }
  return null;
}

export function containerMapWith(
  containers: ContainerMap,
  key: string,
  container: ContainerState | null,
): ContainerMap {
  const next = { ...containers };
  if (container) next[key] = container;
  else delete next[key];
  return next;
}
