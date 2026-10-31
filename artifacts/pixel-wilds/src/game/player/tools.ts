/**
 * Field tools: the toolbelt, its recipes, wear and per-world save slot.
 *
 * Tools deliberately live beside the block inventory rather than inside it.
 * The hotbar remains an ordered block palette (a save format), while a
 * toolbelt is a small owned-item map with durability. That keeps old player
 * saves readable and lets tools be added without changing block ids.
 */
import type { ToolKind } from "../blocks";
import { canAfford, payCost, type Ingredient } from "../crafting";
import {
  TOOL_SAVE_PREFIX,
  browserStorage,
  type KeyValueStorage,
} from "../storage";

export interface ToolRecipe {
  inputs: Ingredient[];
  /** One line shown in the workbench. */
  work: string;
}

export type ToolId =
  | "wood_pickaxe"
  | "stone_pickaxe"
  | "iron_pickaxe"
  | "wood_axe"
  | "stone_axe"
  | "iron_axe"
  | "wood_shovel"
  | "stone_shovel"
  | "iron_shovel";

export interface ToolDefinition {
  id: ToolId;
  label: string;
  short: string;
  kind: ToolKind;
  tier: number;
  /** Multiplier applied when the tool matches the block's tool kind. */
  speed: number;
  maxDurability: number;
  recipe: ToolRecipe;
  /** Cheaper than recrafting; repairs restore the full durability bar. */
  repair: Ingredient[];
}

export const TOOL_DEFINITIONS = [
  {
    id: "wood_pickaxe",
    label: "Wooden pickaxe",
    short: "WPK",
    kind: "pickaxe",
    tier: 1,
    speed: 2.2,
    maxDurability: 60,
    recipe: {
      inputs: [
        { item: "planks", count: 3 },
        { item: "wood", count: 2 },
      ],
      work: "Lash plank heads to a forked oak handle",
    },
    repair: [{ item: "planks", count: 1 }],
  },
  {
    id: "stone_pickaxe",
    label: "Stone pickaxe",
    short: "SPK",
    kind: "pickaxe",
    tier: 2,
    speed: 3.6,
    maxDurability: 160,
    recipe: {
      inputs: [
        { item: "stone", count: 3 },
        { item: "planks", count: 2 },
      ],
      work: "Bind a knapped stone head to a plank haft",
    },
    repair: [
      { item: "planks", count: 1 },
      { item: "stone", count: 1 },
    ],
  },
  {
    id: "iron_pickaxe",
    label: "Iron pickaxe",
    short: "IPK",
    kind: "pickaxe",
    tier: 3,
    speed: 5.6,
    maxDurability: 420,
    recipe: {
      inputs: [
        { item: "iron_ore", count: 3 },
        { item: "planks", count: 2 },
      ],
      work: "Field-forge an iron head around a plank haft",
    },
    repair: [
      { item: "planks", count: 1 },
      { item: "iron_ore", count: 1 },
    ],
  },
  {
    id: "wood_axe",
    label: "Wooden axe",
    short: "WAX",
    kind: "axe",
    tier: 1,
    speed: 2.2,
    maxDurability: 70,
    recipe: {
      inputs: [
        { item: "planks", count: 3 },
        { item: "wood", count: 2 },
      ],
      work: "Chip a wedge edge onto an oak handle",
    },
    repair: [{ item: "planks", count: 1 }],
  },
  {
    id: "stone_axe",
    label: "Stone axe",
    short: "SAX",
    kind: "axe",
    tier: 2,
    speed: 3.8,
    maxDurability: 170,
    recipe: {
      inputs: [
        { item: "stone", count: 3 },
        { item: "planks", count: 2 },
      ],
      work: "Bind a chipped stone blade to a plank haft",
    },
    repair: [
      { item: "planks", count: 1 },
      { item: "stone", count: 1 },
    ],
  },
  {
    id: "iron_axe",
    label: "Iron axe",
    short: "IAX",
    kind: "axe",
    tier: 3,
    speed: 5.4,
    maxDurability: 420,
    recipe: {
      inputs: [
        { item: "iron_ore", count: 3 },
        { item: "planks", count: 2 },
      ],
      work: "Forge a keen iron blade for felling",
    },
    repair: [
      { item: "planks", count: 1 },
      { item: "iron_ore", count: 1 },
    ],
  },
  {
    id: "wood_shovel",
    label: "Wooden shovel",
    short: "WSH",
    kind: "shovel",
    tier: 1,
    speed: 2.2,
    maxDurability: 55,
    recipe: {
      inputs: [
        { item: "planks", count: 2 },
        { item: "wood", count: 2 },
      ],
      work: "Shape a broad plank scoop",
    },
    repair: [{ item: "planks", count: 1 }],
  },
  {
    id: "stone_shovel",
    label: "Stone shovel",
    short: "SSH",
    kind: "shovel",
    tier: 2,
    speed: 3.8,
    maxDurability: 160,
    recipe: {
      inputs: [
        { item: "stone", count: 3 },
        { item: "planks", count: 2 },
      ],
      work: "Lash a flat stone blade to a haft",
    },
    repair: [
      { item: "planks", count: 1 },
      { item: "stone", count: 1 },
    ],
  },
  {
    id: "iron_shovel",
    label: "Iron shovel",
    short: "ISH",
    kind: "shovel",
    tier: 3,
    speed: 5.6,
    maxDurability: 420,
    recipe: {
      inputs: [
        { item: "iron_ore", count: 3 },
        { item: "planks", count: 2 },
      ],
      work: "Forge a deep-biting iron spade",
    },
    repair: [
      { item: "planks", count: 1 },
      { item: "iron_ore", count: 1 },
    ],
  },
] as const satisfies readonly ToolDefinition[];

export type ToolBelt = Record<ToolId, number>;

export interface ToolState {
  /** Remaining durability per owned tool; 0 means the tool is not owned. */
  belt: ToolBelt;
  equipped: ToolId | null;
}

export const TOOL_BY_ID = Object.fromEntries(
  TOOL_DEFINITIONS.map((tool) => [tool.id, tool]),
) as unknown as Record<ToolId, ToolDefinition>;

export const TOOL_TIER_LABELS: Record<number, string> = {
  1: "field",
  2: "stone",
  3: "iron",
};

export function createEmptyToolbelt(): ToolBelt {
  return Object.fromEntries(TOOL_DEFINITIONS.map((tool) => [tool.id, 0])) as ToolBelt;
}

export function createToolState(): ToolState {
  return { belt: createEmptyToolbelt(), equipped: null };
}

export function isToolId(value: unknown): value is ToolId {
  return typeof value === "string" && value in TOOL_BY_ID;
}

export function toolDefinition(id: string): ToolDefinition | null {
  return isToolId(id) ? TOOL_BY_ID[id] : null;
}

export function ownedToolIds(state: ToolState): ToolId[] {
  return TOOL_DEFINITIONS.filter((tool) => state.belt[tool.id] > 0).map(
    (tool) => tool.id,
  );
}

export function equippedTool(state: ToolState): ToolDefinition | null {
  if (!state.equipped) return null;
  const tool = TOOL_BY_ID[state.equipped];
  return tool && state.belt[tool.id] > 0 ? tool : null;
}

export function canCraftTool(
  id: ToolId,
  inventory: Record<string, number>,
  free = false,
): boolean {
  return free || canAfford(TOOL_BY_ID[id].recipe.inputs, inventory);
}

/**
 * Spends the recipe and adds a fresh tool, auto-equipping it. Creative worlds
 * pass `free` and keep their inventory untouched.
 */
export function craftTool<T extends Record<string, number>>(
  id: ToolId,
  inventory: T,
  state: ToolState,
  free = false,
): { inventory: T; state: ToolState } | null {
  if (!canCraftTool(id, inventory, free)) return null;
  const definition = TOOL_BY_ID[id];
  const nextInventory = free
    ? inventory
    : payCost<T>(definition.recipe.inputs, inventory);
  return {
    inventory: nextInventory,
    state: {
      belt: { ...state.belt, [id]: definition.maxDurability },
      equipped: id,
    },
  };
}

/** Wears one tool by a block. A tool at zero durability is removed from hand. */
export function canRepairTool(
  id: ToolId,
  inventory: Record<string, number>,
  state: ToolState,
  free = false,
): boolean {
  const definition = TOOL_BY_ID[id];
  const durability = state.belt[id] ?? 0;
  return durability > 0 && durability < definition.maxDurability &&
    (free || canAfford(definition.repair, inventory));
}

/**
 * Restores a worn tool to full durability for its repair cost. Broken tools
 * are not repaired: they must be crafted again, so the repair bench is a
 * maintenance loop rather than a way to recover a lost tool.
 */
export function repairTool<T extends Record<string, number>>(
  id: ToolId,
  inventory: T,
  state: ToolState,
  free = false,
): { inventory: T; state: ToolState } | null {
  if (!canRepairTool(id, inventory, state, free)) return null;
  const definition = TOOL_BY_ID[id];
  return {
    inventory: free ? inventory : payCost<T>(definition.repair, inventory),
    state: {
      ...state,
      belt: { ...state.belt, [id]: definition.maxDurability },
    },
  };
}

export function wearTool(
  state: ToolState,
  id: ToolId,
  amount = 1,
): { state: ToolState; broke: boolean } {
  const remaining = (state.belt[id] ?? 0) - Math.max(0, amount);
  if (remaining > 0) {
    return { state: { ...state, belt: { ...state.belt, [id]: remaining } }, broke: false };
  }
  if (state.belt[id] <= 0) return { state, broke: false };
  return {
    state: {
      belt: { ...state.belt, [id]: 0 },
      equipped: state.equipped === id ? null : state.equipped,
    },
    broke: true,
  };
}

/** Cycles bare hands and every usable tool in catalogue order. */
export function cycleTool(state: ToolState): ToolState {
  const owned = ownedToolIds(state);
  if (owned.length === 0) return { ...state, equipped: null };
  const options: Array<ToolId | null> = [null, ...owned];
  const index = options.indexOf(state.equipped);
  const next = options[index < 0 ? 1 : (index + 1) % options.length];
  return { ...state, equipped: next };
}

export function equipTool(state: ToolState, id: ToolId | null): ToolState {
  if (id !== null && state.belt[id] <= 0) return state;
  return { ...state, equipped: id };
}

export function toolSaveKey(worldId: string): string {
  return `${TOOL_SAVE_PREFIX}${worldId}`;
}

/** Reads a toolbelt, tolerating missing, malformed or older values. */
export function readToolState(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): ToolState {
  if (!worldId || !storage) return createToolState();
  try {
    const parsed: unknown = JSON.parse(storage.getItem(toolSaveKey(worldId)) || "null");
    if (!parsed || typeof parsed !== "object") return createToolState();
    const record = parsed as { belt?: unknown; equipped?: unknown };
    const belt = createEmptyToolbelt();
    if (record.belt && typeof record.belt === "object") {
      for (const definition of TOOL_DEFINITIONS) {
        const raw = Number((record.belt as Record<string, unknown>)[definition.id]);
        if (Number.isFinite(raw) && raw > 0) {
          belt[definition.id] = Math.min(definition.maxDurability, Math.floor(raw));
        }
      }
    }
    const equipped = isToolId(record.equipped) && belt[record.equipped] > 0
      ? record.equipped
      : null;
    return { belt, equipped };
  } catch {
    return createToolState();
  }
}

/** Persists the toolbelt. Returns false when storage is unavailable. */
export function saveToolState(
  worldId: string,
  state: ToolState,
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  if (!worldId || !storage) return false;
  try {
    storage.setItem(toolSaveKey(worldId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
