/** Food values for cooked and harvested items. */
import type { BlockType } from "../blocks";

export interface FoodDefinition {
  item: BlockType;
  label: string;
  /** Hunger points restored; the survival bar is 20 points. */
  nutrition: number;
}

export const FOODS: Readonly<Partial<Record<BlockType, FoodDefinition>>> = Object.freeze({
  bread: Object.freeze({ item: "bread", label: "Fresh bread", nutrition: 8 }),
  wheat_grain: Object.freeze({ item: "wheat_grain", label: "Wheat grain", nutrition: 2 }),
  carrot: Object.freeze({ item: "carrot", label: "Carrot", nutrition: 3 }),
});

export function foodFor(item: string): FoodDefinition | null {
  return Object.prototype.hasOwnProperty.call(FOODS, item)
    ? FOODS[item as BlockType] ?? null
    : null;
}
