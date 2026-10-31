import type { BlockType } from "../blocks";

export const CONTAINER_KINDS = ["chest", "barrel", "furnace", "hopper"] as const;
export type ContainerKind = (typeof CONTAINER_KINDS)[number];

export type ContainerContents = Partial<Record<BlockType, number>>;

/** Furnaces keep their three functional slots separate from generic storage. */
export interface FurnaceState {
  input: BlockType | null;
  inputCount: number;
  fuel: BlockType | null;
  fuelCount: number;
  output: BlockType | null;
  outputCount: number;
  /** Seconds left in the current fuel burn. */
  burn: number;
  /** Seconds of progress on the current item. */
  progress: number;
}

export interface ContainerState {
  kind: ContainerKind;
  contents: ContainerContents;
  furnace?: FurnaceState;
}

export type ContainerMap = Record<string, ContainerState>;

export interface ContainerTransfer {
  container: ContainerState;
  inventory: Record<string, number>;
  moved: number;
  blocked: boolean;
}

export const CONTAINER_SLOT_COUNTS: Record<ContainerKind, number> = Object.freeze({
  chest: 27,
  barrel: 18,
  furnace: 3,
  hopper: 5,
});

export function emptyFurnace(): FurnaceState {
  return {
    input: null,
    inputCount: 0,
    fuel: null,
    fuelCount: 0,
    output: null,
    outputCount: 0,
    burn: 0,
    progress: 0,
  };
}

export function isContainerKind(value: unknown): value is ContainerKind {
  return typeof value === "string" && (CONTAINER_KINDS as readonly string[]).includes(value);
}
