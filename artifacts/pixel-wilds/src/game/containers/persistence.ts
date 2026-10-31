import { BLOCK_TYPES, type BlockType } from "../blocks";
import {
  CONTAINER_SAVE_PREFIX,
  browserStorage,
  type KeyValueStorage,
} from "../storage";
import { containerTotal, isContainerState } from "./core";
import {
  emptyFurnace,
  isContainerKind,
  type ContainerContents,
  type ContainerMap,
  type ContainerState,
  type FurnaceState,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isItem(value: string): value is BlockType {
  return (BLOCK_TYPES as readonly string[]).includes(value);
}

function parseContents(raw: unknown): ContainerContents {
  if (!isRecord(raw)) return {};
  const contents: ContainerContents = {};
  for (const [item, count] of Object.entries(raw)) {
    if (!isItem(item)) continue;
    const value = Math.floor(Number(count));
    if (Number.isFinite(value) && value > 0) contents[item] = value;
  }
  return contents;
}

function parseFurnace(raw: unknown): FurnaceState {
  const fallback = emptyFurnace();
  if (!isRecord(raw)) return fallback;
  const item = (value: unknown): BlockType | null =>
    typeof value === "string" && isItem(value) ? value : null;
  const count = (value: unknown) => {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : 0;
  };
  return {
    input: item(raw.input),
    inputCount: count(raw.inputCount),
    fuel: item(raw.fuel),
    fuelCount: count(raw.fuelCount),
    output: item(raw.output),
    outputCount: count(raw.outputCount),
    burn: Math.max(0, Number(raw.burn) || 0),
    progress: Math.max(0, Number(raw.progress) || 0),
  };
}

function parseContainer(raw: unknown): ContainerState | null {
  if (!isRecord(raw)) return null;
  const kind = isContainerKind(raw.kind) ? raw.kind : "chest";
  const container: ContainerState = { kind, contents: parseContents(raw.contents) };
  if (kind === "furnace") container.furnace = parseFurnace(raw.furnace);
  return container;
}

export function readContainers(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): ContainerMap {
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`${CONTAINER_SAVE_PREFIX}${worldId}`) || "null");
    if (!isRecord(parsed)) return {};
    // v1 stored a plain contents map. v2 stores container state by kind.
    const rawContainers = parsed.version === 2 && isRecord(parsed.containers)
      ? parsed.containers
      : isRecord(parsed.containers) ? parsed.containers : parsed;
    const containers: ContainerMap = {};
    for (const [key, raw] of Object.entries(rawContainers)) {
      if (!/^-?\d+,-?\d+,-?\d+$/.test(key)) continue;
      if (isContainerState(raw)) {
        const container = parseContainer(raw);
        if (container) containers[key] = container;
      } else {
        const contents = parseContents(raw);
        if (Object.keys(contents).length > 0) containers[key] = { kind: "chest", contents };
      }
    }
    return containers;
  } catch {
    return {};
  }
}

export function saveContainers(
  worldId: string,
  containers: ContainerMap,
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    const key = `${CONTAINER_SAVE_PREFIX}${worldId}`;
    const nonEmpty = Object.fromEntries(
      Object.entries(containers).filter(([, container]) => containerTotal(container) > 0),
    );
    if (Object.keys(nonEmpty).length === 0) {
      storage.removeItem(key);
      return true;
    }
    storage.setItem(key, JSON.stringify({ version: 2, containers: nonEmpty }));
    return true;
  } catch {
    return false;
  }
}

export function containerSaveKey(worldId: string): string {
  return `${CONTAINER_SAVE_PREFIX}${worldId}`;
}
