/**
 * Smelting and cooking. The furnace is a small state machine with explicit
 * input, fuel and output slots; a UI never has to infer what a count means.
 */
import type { BlockType } from "../blocks";
import { STACK_LIMIT } from "../items/stacks";
import type { ContainerMap, ContainerState, ContainerTransfer } from "./types";

export interface SmeltRecipe {
  input: BlockType;
  output: BlockType;
  seconds: number;
  label: string;
}

export const SMELT_RECIPES: readonly SmeltRecipe[] = Object.freeze([
  { input: "sand", output: "glass", seconds: 7, label: "Melt sand into glass" },
  { input: "clay", output: "brick", seconds: 8, label: "Fire clay into brick" },
  { input: "cobblestone", output: "stone", seconds: 9, label: "Smooth cobble into stone" },
  { input: "wood", output: "coal_ore", seconds: 12, label: "Char oak into fuel" },
  { input: "mud", output: "dirt", seconds: 5, label: "Dry mud into dirt" },
]);

export const SMELT_BY_INPUT: Record<string, SmeltRecipe> = Object.fromEntries(
  SMELT_RECIPES.map((recipe) => [recipe.input, recipe]),
);

export const FURNACE_FUEL = new Set<BlockType>([
  "coal_ore",
  "wood",
  "birch_wood",
  "spruce_wood",
  "planks",
  "dark_planks",
  "thatch",
  "leaves",
]);

export function isFuel(item: BlockType): boolean {
  return FURNACE_FUEL.has(item);
}

export function isSmeltable(item: BlockType): boolean {
  return Boolean(SMELT_BY_INPUT[item]);
}

export function furnaceDeposit(
  container: ContainerState,
  inventory: Record<string, number>,
  item: BlockType,
  amount: number,
): ContainerTransfer {
  const furnace = container.furnace;
  if (!furnace) return { container, inventory, moved: 0, blocked: true };
  const requested = Math.max(0, Math.floor(amount));
  const carried = Math.max(0, inventory[item] ?? 0);
  const canInput = isSmeltable(item) && (furnace.input === null || furnace.input === item);
  const canFuel = isFuel(item) && (furnace.fuel === null || furnace.fuel === item);
  if (!canInput && !canFuel) return { container, inventory, moved: 0, blocked: true };

  if (canInput) {
    const room = STACK_LIMIT - (furnace.input === item ? furnace.inputCount : 0);
    const moved = Math.min(requested, carried, Math.max(0, room));
    if (moved > 0) {
      return {
        container: {
          ...container,
          furnace: { ...furnace, input: item, inputCount: furnace.inputCount + moved },
        },
        inventory: { ...inventory, [item]: carried - moved },
        moved,
        blocked: requested > room,
      };
    }
  }
  const room = STACK_LIMIT - (furnace.fuel === item ? furnace.fuelCount : 0);
  const moved = Math.min(requested, carried, Math.max(0, room));
  if (moved <= 0) return { container, inventory, moved: 0, blocked: true };
  return {
    container: {
      ...container,
      furnace: { ...furnace, fuel: item, fuelCount: furnace.fuelCount + moved },
    },
    inventory: { ...inventory, [item]: carried - moved },
    moved,
    blocked: requested > room,
  };
}

export function furnaceWithdraw(
  container: ContainerState,
  inventory: Record<string, number>,
  amount: number,
): ContainerTransfer {
  const furnace = container.furnace;
  if (!furnace || !furnace.output || furnace.outputCount <= 0) {
    return { container, inventory, moved: 0, blocked: false };
  }
  const moved = Math.min(Math.max(0, Math.floor(amount)), furnace.outputCount);
  const outputCount = furnace.outputCount - moved;
  return {
    container: {
      ...container,
      furnace: {
        ...furnace,
        output: outputCount > 0 ? furnace.output : null,
        outputCount,
      },
    },
    inventory: {
      ...inventory,
      [furnace.output]: Math.max(0, inventory[furnace.output] ?? 0) + moved,
    },
    moved,
    blocked: false,
  };
}

/** Advances one furnace. A full output pauses progress rather than voiding items. */
export function tickFurnace(container: ContainerState, deltaSeconds: number): ContainerState {
  const furnace = container.furnace;
  if (!furnace || deltaSeconds <= 0) return container;
  const dt = Math.min(2, deltaSeconds);
  const recipe = furnace.input ? SMELT_BY_INPUT[furnace.input] : undefined;
  let next = { ...furnace };
  let changed = false;

  if (next.burn <= 0 && recipe && furnace.inputCount > 0 && furnace.outputCount < STACK_LIMIT) {
    if (!furnace.fuel || furnace.fuelCount <= 0) return container;
    next = { ...next, burn: 10, fuelCount: furnace.fuelCount - 1 };
    changed = true;
  }
  if (next.burn <= 0) return changed ? { ...container, furnace: next } : container;

  next = { ...next, burn: Math.max(0, next.burn - dt), progress: next.progress + dt };
  changed = true;
  if (recipe && next.progress >= recipe.seconds && next.inputCount > 0) {
    if (next.outputCount >= STACK_LIMIT) {
      next = { ...next, progress: recipe.seconds };
    } else {
      next = {
        ...next,
        output: recipe.output,
        outputCount: next.outputCount + 1,
        inputCount: next.inputCount - 1,
        progress: 0,
      };
      if (next.inputCount <= 0) next = { ...next, input: null };
    }
  }
  return changed ? { ...container, furnace: next } : container;
}

export function tickFurnaces(containers: ContainerMap, deltaSeconds: number): ContainerMap {
  let changed = false;
  const next: ContainerMap = {};
  for (const [key, container] of Object.entries(containers)) {
    const updated = container.kind === "furnace" ? tickFurnace(container, deltaSeconds) : container;
    if (updated !== container) changed = true;
    next[key] = updated;
  }
  return changed ? next : containers;
}
