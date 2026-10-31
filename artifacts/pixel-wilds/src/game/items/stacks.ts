/**
 * Stack and capacity rules.
 *
 * Inventory counts remain a sparse count map for save compatibility, but they
 * are interpreted as stacks of STACK_LIMIT. That gives the backpack a real
 * capacity budget without changing every call site or old player save.
 */
export const STACK_LIMIT = 64;
export const INVENTORY_SLOT_COUNT = 36;
export const INVENTORY_CAPACITY = STACK_LIMIT * INVENTORY_SLOT_COUNT;

export interface InventoryAddResult<T extends Record<string, number>> {
  inventory: T;
  accepted: number;
  overflow: number;
}

export function stackCount(count: number): number {
  return count > 0 ? Math.ceil(count / STACK_LIMIT) : 0;
}

export function usedInventorySlots(inventory: Record<string, number>): number {
  let used = 0;
  for (const count of Object.values(inventory)) used += stackCount(Number(count) || 0);
  return used;
}

export function freeInventorySlots(inventory: Record<string, number>): number {
  return Math.max(0, INVENTORY_SLOT_COUNT - usedInventorySlots(inventory));
}

export function inventoryCapacity(inventory: Record<string, number>): {
  used: number;
  total: number;
  free: number;
  items: number;
} {
  const used = usedInventorySlots(inventory);
  return {
    used,
    total: INVENTORY_SLOT_COUNT,
    free: Math.max(0, INVENTORY_SLOT_COUNT - used),
    items: Object.values(inventory).reduce((sum, count) => sum + Math.max(0, count), 0),
  };
}

export function canAcceptItem(
  inventory: Record<string, number>,
  item: string,
  amount: number,
): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return true;
  const current = Math.max(0, inventory[item] ?? 0);
  const additionalSlots = stackCount(current + Math.floor(amount)) - stackCount(current);
  return additionalSlots <= freeInventorySlots(inventory);
}

/** Adds as much as the stack budget allows and reports the overflow. */
export function addItem<T extends Record<string, number>>(
  inventory: T,
  item: string,
  amount: number,
): InventoryAddResult<T> {
  const requested = Math.max(0, Math.floor(Number(amount) || 0));
  if (requested === 0) return { inventory, accepted: 0, overflow: 0 };
  const current = Math.max(0, inventory[item] ?? 0);
  const freeSlots = freeInventorySlots(inventory);
  const roomInExisting = current % STACK_LIMIT === 0 && current > 0
    ? 0
    : STACK_LIMIT - (current % STACK_LIMIT);
  const maxBySlots = roomInExisting + freeSlots * STACK_LIMIT;
  const accepted = Math.min(requested, Math.max(0, maxBySlots));
  if (accepted <= 0) return { inventory, accepted: 0, overflow: requested };
  return {
    inventory: { ...inventory, [item]: current + accepted } as T,
    accepted,
    overflow: requested - accepted,
  };
}

export function removeItem<T extends Record<string, number>>(
  inventory: T,
  item: string,
  amount: number,
): { inventory: T; removed: number } {
  const requested = Math.max(0, Math.floor(Number(amount) || 0));
  const removed = Math.min(requested, Math.max(0, inventory[item] ?? 0));
  if (removed === 0) return { inventory, removed: 0 };
  return {
    inventory: { ...inventory, [item]: (inventory[item] ?? 0) - removed } as T,
    removed,
  };
}

export type InventorySort = "category" | "name" | "count";

/** Pure ordering used by the backpack. It never mutates the inventory. */
export function sortedInventoryItems<T extends string>(
  items: readonly T[],
  inventory: Record<T, number>,
  sort: InventorySort,
): T[] {
  const copy = items.filter((item) => (inventory[item] ?? 0) > 0);
  const compareName = (a: T, b: T) => a.localeCompare(b);
  if (sort === "count") {
    return copy.sort((a, b) => inventory[b] - inventory[a] || compareName(a, b));
  }
  if (sort === "name") return copy.sort(compareName);
  return copy.sort((a, b) => {
    const group = inventoryGroup(a).localeCompare(inventoryGroup(b));
    return group || compareName(a, b);
  });
}

/** Broad backpack groups; category order is stable for predictable sorting. */
export function inventoryGroup(item: string): string {
  if (item.includes("ore") || ["stone", "granite", "limestone", "sandstone", "cobblestone", "stone_bricks", "marble", "brick", "roof"].includes(item)) return "1 stone";
  if (["wood", "birch_wood", "spruce_wood", "planks", "dark_planks", "leaves", "birch_leaves", "spruce_leaves", "thatch", "cactus"].includes(item)) return "2 timber";
  if (["grass", "dirt", "mud", "path", "farmland", "sand", "gravel", "clay", "snow", "ice", "moss"].includes(item)) return "0 ground";
  if (["chest", "furnace", "barrel", "hopper", "door", "chair", "table"].includes(item)) return "4 storage";
  if (["flower", "wheat", "fern", "tall_grass", "reed", "mushroom", "vine"].includes(item)) return "3 plants";
  return "5 other";
}
