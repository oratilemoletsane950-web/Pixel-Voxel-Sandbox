/** Per-world crop save slot. Invalid, duplicate and out-of-range records are dropped. */
import {
  CROP_SAVE_PREFIX,
  browserStorage,
  type KeyValueStorage,
} from "../storage";
import {
  createCropField,
  isCropRecord,
  type CropField,
  type CropRecord,
} from "./crops";

export const MAX_CROPS = 2048;

interface StoredCrops {
  version: 1;
  crops: CropRecord[];
}

export function readCropField(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): CropField {
  if (!storage || !worldId) return createCropField();
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`${CROP_SAVE_PREFIX}${worldId}`) || "null");
    if (!parsed || typeof parsed !== "object") return createCropField();
    const record = parsed as Partial<StoredCrops>;
    if (record.version !== 1 || !Array.isArray(record.crops)) return createCropField();
    return createCropField(record.crops.filter(isCropRecord).slice(0, MAX_CROPS));
  } catch {
    return createCropField();
  }
}

export function saveCropField(
  worldId: string,
  field: CropField,
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  if (!storage || !worldId) return false;
  try {
    const key = `${CROP_SAVE_PREFIX}${worldId}`;
    if (field.records.length === 0) {
      storage.removeItem(key);
      return true;
    }
    const snapshot: StoredCrops = {
      version: 1,
      crops: field.records.slice(0, MAX_CROPS).map((crop) => ({ ...crop })),
    };
    storage.setItem(key, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function deleteCropSave(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (!storage || !worldId) return;
  storage.removeItem(`${CROP_SAVE_PREFIX}${worldId}`);
}
