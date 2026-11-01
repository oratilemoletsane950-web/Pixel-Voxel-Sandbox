/**
 * Awards broken-block and harvest items.
 *
 * Normally each unit becomes a visible drop. When the capped drop field is
 * full the item goes straight to the pack instead, so mining and harvesting can
 * never silently lose resources.
 */
import type { BlockType } from "../blocks";
import type { DropField } from "../player/drops";

export interface BlockReward {
  item: BlockType;
  count: number;
}

export interface RewardResult<T extends Record<string, number>> {
  inventory: T;
  dropped: number;
  gathered: number;
}

export function collectBlockRewards<T extends Record<string, number>>(
  field: DropField,
  inventory: T,
  rewards: readonly BlockReward[],
  cell: { x: number; y: number; z: number },
): RewardResult<T> {
  let next = inventory;
  let dropped = 0;
  let gathered = 0;
  for (const reward of rewards) {
    const count = Math.max(0, Math.floor(reward.count));
    for (let index = 0; index < count; index += 1) {
      if (field.spawn(reward.item, cell)) {
        dropped += 1;
      } else {
        next = { ...next, [reward.item]: (next[reward.item] ?? 0) + 1 };
        gathered += 1;
      }
    }
  }
  return { inventory: next, dropped, gathered };
}
