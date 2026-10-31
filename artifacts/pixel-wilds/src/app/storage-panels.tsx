/**
 * Full pack and container UI.
 *
 * The panel is presentational: moving items is decided by the game session.
 * Drag payloads carry only a source and item id, never counts or world data.
 */
import { useMemo, useState, type DragEvent } from "react";

import { BLOCK_TYPES, type BlockType } from "../game/blocks";
import {
  CONTAINER_KINDS,
  FURNACE_FUEL,
  SMELT_RECIPES,
  containerCapacity,
  containerEntries,
  containerTotal,
  type ContainerKind,
  type ContainerState,
  type FurnaceState,
} from "../game/containers";
import {
  inventoryCapacity,
  sortedInventoryItems,
  stackCount,
  type InventorySort,
} from "../game/items/stacks";
import type { Inventory } from "../game/player/inventory";
import { BLOCK_COLORS, BLOCK_META } from "./block-palette";

export interface OpenContainer {
  key: string;
  kind: ContainerKind;
  state: ContainerState;
  label: string;
}

const SORT_LABELS: Array<{ id: InventorySort; label: string }> = [
  { id: "category", label: "Type" },
  { id: "name", label: "Name" },
  { id: "count", label: "Count" },
];

function swatch(item: BlockType): string {
  const [side, top] = BLOCK_COLORS[item];
  return `linear-gradient(135deg, ${top} 0 50%, ${side} 50% 100%)`;
}

function dragPayload(event: DragEvent, source: "pack" | "container", item: BlockType): void {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-pixel-wilds-item", JSON.stringify({ source, item }));
}

function readPayload(event: DragEvent): { source: "pack" | "container"; item: BlockType } | null {
  try {
    const raw = event.dataTransfer.getData("application/x-pixel-wilds-item");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { source?: unknown; item?: unknown };
    if (
      (parsed.source === "pack" || parsed.source === "container") &&
      typeof parsed.item === "string" &&
      (BLOCK_TYPES as readonly string[]).includes(parsed.item)
    ) {
      return { source: parsed.source, item: parsed.item as BlockType };
    }
  } catch {
    // A drag from another app is not a game item.
  }
  return null;
}

function PackSlot({
  item,
  count,
  selected,
  onSelect,
  onDragStart,
}: {
  item: BlockType;
  count: number;
  selected: boolean;
  onSelect: (item: BlockType) => void;
  onDragStart: (event: DragEvent) => void;
}) {
  return (
    <button
      className={`pack-slot ${selected ? "is-selected" : ""}`}
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={() => onSelect(item)}
      aria-label={`${BLOCK_META[item].label}, ${count} stored in ${stackCount(count)} stack${stackCount(count) === 1 ? "" : "s"}`}
      data-testid={`pack-slot-${item}`}
    >
      <span className="pack-swatch" style={{ background: swatch(item) }} aria-hidden="true" />
      <span className="pack-name">{BLOCK_META[item].short}</span>
      <span className="pack-count">{count}</span>
      <span className="pack-stacks">{stackCount(count)} stack{stackCount(count) === 1 ? "" : "s"}</span>
    </button>
  );
}

export function StoragePanel({
  open,
  inventory,
  selected,
  packOpen,
  container,
  unlimited,
  onClose,
  onSelect,
  onDeposit,
  onWithdraw,
  onDepositAll,
  onWithdrawAll,
  onFurnaceDeposit,
  onFurnaceWithdraw,
}: {
  open: boolean;
  inventory: Inventory;
  selected: BlockType;
  packOpen: boolean;
  container: OpenContainer | null;
  unlimited: boolean;
  onClose: () => void;
  onSelect: (item: BlockType) => void;
  onDeposit: (item: BlockType, amount: number) => void;
  onWithdraw: (item: BlockType, amount: number) => void;
  onDepositAll: (item: BlockType) => void;
  onWithdrawAll: (item: BlockType) => void;
  onFurnaceDeposit: (item: BlockType, amount: number) => void;
  onFurnaceWithdraw: (amount: number) => void;
}) {
  const [sort, setSort] = useState<InventorySort>("category");
  const [query, setQuery] = useState("");
  const capacity = inventoryCapacity(inventory);
  const packItems = useMemo(() => {
    const list = sortedInventoryItems(BLOCK_TYPES as readonly BlockType[], inventory, sort);
    const needle = query.trim().toLowerCase();
    return needle
      ? list.filter((item) => BLOCK_META[item].label.toLowerCase().includes(needle))
      : list;
  }, [inventory, query, sort]);

  const dropOnContainer = (event: DragEvent) => {
    event.preventDefault();
    const payload = readPayload(event);
    if (!payload || payload.source !== "pack" || !container) return;
    onDepositAll(payload.item);
  };
  const dropOnPack = (event: DragEvent) => {
    event.preventDefault();
    const payload = readPayload(event);
    if (!payload || payload.source !== "container" || !container) return;
    onWithdrawAll(payload.item);
  };

  return (
    <section
      className={`storage-panel ${open ? "open" : ""} ${packOpen ? "pack-open" : ""}`}
      aria-label={container ? `${container.label} and pack` : "Backpack"}
      aria-hidden={!open}
      data-testid={container ? "panel-container" : "panel-backpack"}
    >
      <header className="storage-head">
        <div>
          <p className="storage-eyebrow">{container ? container.label : "Field pack"}</p>
          <h2>{container ? "Pack and storage" : "Your pack"}</h2>
          <p className="storage-caption">
            {capacity.used}/{capacity.total} slots used · {capacity.items} items ·{" "}
            {capacity.free} slots free
          </p>
        </div>
        <button type="button" aria-label="Close pack" onClick={onClose} data-testid="button-close-container">×</button>
      </header>

      <div className="storage-tools">
        <div className="storage-sort" role="group" aria-label="Sort pack">
          {SORT_LABELS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={sort === option.id}
              className={sort === option.id ? "is-active" : ""}
              onClick={() => setSort(option.id)}
              data-testid={`button-sort-${option.id}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="storage-search">
          <span className="visually-hidden">Filter pack</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter blocks"
            data-testid="input-filter-pack"
          />
        </label>
        {packOpen && container && (
          <button className="storage-all" type="button" onClick={() => onDepositAll(selected)}>
            Store selected
          </button>
        )}
      </div>

      <div className="storage-columns">
        <div className="pack-pane" onDragOver={(event) => event.preventDefault()} onDrop={dropOnPack}>
          <div className="storage-pane-heading">
            <strong>Pack</strong>
            <span>{unlimited ? "creative infinite" : "survival"}</span>
          </div>
          {packItems.length === 0 ? (
            <p className="storage-empty">
              {query ? "No block matches that filter." : "Nothing gathered yet. Break a block or open a chest."}
            </p>
          ) : (
            <div className="pack-grid" data-testid="pack-grid">
              {packItems.map((item) => (
                <PackSlot
                  key={item}
                  item={item}
                  count={inventory[item]}
                  selected={selected === item}
                  onSelect={onSelect}
                  onDragStart={(event) => dragPayload(event, "pack", item)}
                />
              ))}
            </div>
          )}
        </div>

        {container && (
          <div
            className={`container-pane container-${container.kind}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={dropOnContainer}
          >
            <div className="storage-pane-heading">
              <strong>{container.label}</strong>
              <span>
                {containerTotal(container.state)}/{containerCapacity(container.kind)} stored
              </span>
            </div>
            {container.kind === "furnace" ? (
              <FurnacePane
                furnace={container.state.furnace}
                inventory={inventory}
                onDeposit={onFurnaceDeposit}
                onWithdraw={onFurnaceWithdraw}
              />
            ) : (
              <GenericContainerPane
                container={container}
                inventory={inventory}
                onDeposit={onDeposit}
                onWithdraw={onWithdraw}
                onDepositAll={onDepositAll}
                onWithdrawAll={onWithdrawAll}
                onDragStart={(event, item) => dragPayload(event, "container", item)}
              />
            )}
          </div>
        )}
      </div>
      <footer className="storage-foot">
        {container
          ? "Drag a pack item onto storage to store the stack · drag stored items back to the pack · B closes the pack"
          : "B opens the pack · drag blocks to a storage panel · C opens the workbench"}
      </footer>
    </section>
  );
}

function GenericContainerPane({
  container,
  inventory,
  onDeposit,
  onWithdraw,
  onDepositAll,
  onWithdrawAll,
  onDragStart,
}: {
  container: OpenContainer;
  inventory: Inventory;
  onDeposit: (item: BlockType, amount: number) => void;
  onWithdraw: (item: BlockType, amount: number) => void;
  onDepositAll: (item: BlockType) => void;
  onWithdrawAll: (item: BlockType) => void;
  onDragStart: (event: DragEvent, item: BlockType) => void;
}) {
  const rows = BLOCK_TYPES.filter(
    (type) => (container.state.contents[type] ?? 0) > 0 || inventory[type] > 0,
  );
  if (rows.length === 0) {
    return <p className="storage-empty">Empty. Drag a block here, or use the buttons in your pack.</p>;
  }
  return (
    <div className="container-list" data-testid="container-list">
      {rows.map((type) => {
        const stored = container.state.contents[type] ?? 0;
        const carried = inventory[type];
        return (
          <div
            className="container-row"
            key={type}
            draggable={stored > 0}
            onDragStart={(event) => onDragStart(event, type)}
            data-testid={`container-row-${type}`}
          >
            <span className="voxel-swatch" style={{ background: swatch(type) }} aria-hidden="true" />
            <span className="container-copy">
              <strong>{BLOCK_META[type].label}</strong>
              <small>pack {carried} · stored {stored}</small>
            </span>
            <span className="container-actions">
              <button type="button" disabled={carried < 1} onClick={() => onDeposit(type, 1)}>Store</button>
              <button type="button" disabled={carried < 1} onClick={() => onDepositAll(type)}>All</button>
              <button type="button" disabled={stored < 1} onClick={() => onWithdraw(type, 1)}>Take</button>
              <button type="button" disabled={stored < 1} onClick={() => onWithdrawAll(type)}>All</button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FurnacePane({
  furnace,
  inventory,
  onDeposit,
  onWithdraw,
}: {
  furnace: FurnaceState | undefined;
  inventory: Inventory;
  onDeposit: (item: BlockType, amount: number) => void;
  onWithdraw: (amount: number) => void;
}) {
  if (!furnace) return <p className="storage-empty">This furnace has no usable state.</p>;
  const recipe = SMELT_RECIPES.find((entry) => entry.input === furnace.input);
  const burnPercent = Math.round((furnace.burn / 10) * 100);
  const progressPercent = recipe ? Math.round((furnace.progress / recipe.seconds) * 100) : 0;
  const fuels = [...FURNACE_FUEL];
  return (
    <div className="furnace-pane" data-testid="furnace-pane">
      <div className="furnace-slots">
        <div className="furnace-slot">
          <small>Input</small>
          <strong>{furnace.input ? BLOCK_META[furnace.input].label : "empty"}</strong>
          <span>{furnace.inputCount}/{64}</span>
        </div>
        <div className="furnace-slot is-fire">
          <small>Fire</small>
          <strong>{furnace.burn > 0 ? "burning" : "cold"}</strong>
          <span>{furnace.fuel ? `${BLOCK_META[furnace.fuel].short} · ${furnace.fuelCount}` : "add fuel"}</span>
          <i style={{ width: `${burnPercent}%` }} aria-hidden="true" />
        </div>
        <div className="furnace-slot">
          <small>Output</small>
          <strong>{furnace.output ? BLOCK_META[furnace.output].label : "empty"}</strong>
          <span>{furnace.outputCount}/{64}</span>
          <button type="button" disabled={!furnace.output} onClick={() => onWithdraw(64)}>Take</button>
        </div>
      </div>
      <div className="furnace-progress" aria-label={`Smelting ${progressPercent}%`}>
        <i style={{ width: `${Math.max(progressPercent, 0)}%` }} />
      </div>
      <p className="furnace-status">
        {recipe ? recipe.label : "Add sand, clay, cobble, wood or mud to the input."}
        {furnace.burn > 0 && " · fire is drawing air"}
      </p>
      <details open>
        <summary>Load input</summary>
        <div className="furnace-buttons">
          {SMELT_RECIPES.map((entry) => (
            <button
              key={entry.input}
              type="button"
              disabled={inventory[entry.input] < 1}
              onClick={() => onDeposit(entry.input, 1)}
              data-testid={`button-furnace-input-${entry.input}`}
            >
              {BLOCK_META[entry.input].short} ×1
            </button>
          ))}
        </div>
      </details>
      <details>
        <summary>Load fuel</summary>
        <div className="furnace-buttons">
          {fuels.map((item) => (
            <button
              key={item}
              type="button"
              disabled={inventory[item] < 1}
              onClick={() => onDeposit(item, 1)}
              data-testid={`button-furnace-fuel-${item}`}
            >
              {BLOCK_META[item].short} ×1
            </button>
          ))}
        </div>
      </details>
      <p className="furnace-hint">Fuel burns for ten seconds. Add more input while the fire is hot.</p>
    </div>
  );
}

export { CONTAINER_KINDS };
