import type { BlockType } from "./blocks";

/**
 * The workbench (press C): recipes turn blocks you have gathered into blocks
 * you cannot pick up off the ground - planks from logs, furniture from
 * planks, dressed stone from raw stone, and kiln goods from clay or sand.
 *
 * Recipes are deliberately "our own way" rather than a copy of any other
 * game: a few simple, memorable transformations, several of them needing
 * coal as kiln fuel, all using materials found by exploring and mining.
 */

export interface CraftRecipe {
  id: string;
  /** Name of the thing you get. */
  label: string;
  output: BlockType;
  count: number;
  inputs: Array<{ item: BlockType; count: number }>;
  /** What you do at the bench - shown as the recipe's caption. */
  work: string;
}

export const CRAFTING_RECIPES: CraftRecipe[] = [
  {
    id: "planks",
    label: "Planks x4",
    output: "planks",
    count: 4,
    inputs: [{ item: "wood", count: 1 }],
    work: "Rip an oak log into boards",
  },
  {
    id: "planks_birch",
    label: "Planks x4",
    output: "planks",
    count: 4,
    inputs: [{ item: "birch_wood", count: 1 }],
    work: "Rip a birch log into boards",
  },
  {
    id: "dark_planks",
    label: "Dark planks x4",
    output: "dark_planks",
    count: 4,
    inputs: [{ item: "spruce_wood", count: 1 }],
    work: "Rip a spruce log into boards",
  },
  {
    id: "door",
    label: "Wooden door",
    output: "door",
    count: 1,
    inputs: [{ item: "planks", count: 4 }],
    work: "Hang the planks on hinges - it is buildable, and walk-through",
  },
  {
    id: "chair",
    label: "Chair",
    output: "chair",
    count: 1,
    inputs: [{ item: "planks", count: 3 }],
    work: "Saw and peg a seat with a braced back",
  },
  {
    id: "table",
    label: "Table",
    output: "table",
    count: 1,
    inputs: [
      { item: "planks", count: 4 },
      { item: "wood", count: 1 },
    ],
    work: "Join a plank top to an oak frame",
  },
  {
    id: "stone_bricks",
    label: "Stone bricks x4",
    output: "stone_bricks",
    count: 4,
    inputs: [{ item: "stone", count: 4 }],
    work: "Chisel rough stone into dressed blocks",
  },
  {
    id: "marble",
    label: "Marble x4",
    output: "marble",
    count: 4,
    inputs: [{ item: "limestone", count: 4 }],
    work: "Dress and polish limestone pale",
  },
  {
    id: "brick",
    label: "Bricks x4",
    output: "brick",
    count: 4,
    inputs: [{ item: "clay", count: 3 }],
    work: "Press clay into bricks and dry them",
  },
  {
    id: "roof",
    label: "Roof tiles x4",
    output: "roof",
    count: 4,
    inputs: [
      { item: "clay", count: 3 },
      { item: "coal_ore", count: 1 },
    ],
    work: "Fire tiles in a coal kiln",
  },
  {
    id: "glass",
    label: "Glass x4",
    output: "glass",
    count: 4,
    inputs: [
      { item: "sand", count: 4 },
      { item: "coal_ore", count: 1 },
    ],
    work: "Melt sand in a coal kiln",
  },
];

export function canCraft(recipe: CraftRecipe, inventory: Record<string, number>): boolean {
  return recipe.inputs.every((input) => (inventory[input.item] ?? 0) >= input.count);
}

/** Returns the inventory after paying the recipe's cost (or the same one if it cannot be paid). */
export function applyCraft<T extends Record<string, number>>(
  recipe: CraftRecipe,
  inventory: T,
): T {
  if (!canCraft(recipe, inventory)) return inventory;
  const next: Record<string, number> = { ...inventory };
  for (const input of recipe.inputs) {
    next[input.item] = Math.max(0, (next[input.item] ?? 0) - input.count);
  }
  next[recipe.output] = (next[recipe.output] ?? 0) + recipe.count;
  return next as T;
}
