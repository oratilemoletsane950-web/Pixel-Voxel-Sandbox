/**
 * HUD components: status, world card and rules, crosshair, readouts, hotbar,
 * workbench, toast, welcome screen and touch controls.
 *
 * These are presentational: state and callbacks come from `App`, so a new panel
 * or control is added here without touching input handling, streaming or the
 * renderer.
 */
import type { Dispatch, SetStateAction } from "react";

import { BLOCK_TYPES } from "../game/blocks";
import { CHUNK_SIZE } from "../game/chunk";
import {
  CONTAINER_CAPACITY,
  containerTotal,
  type ContainerContents,
} from "../game/containers";
import { CRAFTING_RECIPES, canAfford, canCraft, type CraftRecipe } from "../game/crafting";
import {
  TOOL_DEFINITIONS,
  TOOL_TIER_LABELS,
  canRepairTool,
  type ToolBelt,
  type ToolDefinition,
  type ToolId,
} from "../game/player/tools";
import type { AimTarget } from "../game/player/aiming";
import { HOTBAR_SLOTS } from "../game/player/controls";
import type { Inventory } from "../game/player/inventory";
import {
  MAX_AIR,
  MAX_HUNGER,
  canEat,
  type DamageCause,
  type SurvivalState,
} from "../game/player/survival";
import {
  MAX_RENDER_RADIUS,
  MIN_RENDER_RADIUS,
  formatWorldTime,
  phaseLabel,
  type BlockCell,
} from "../game/world";
import type { WeatherState } from "../game/world/weather";
import { BLOCK_COLORS, BLOCK_META } from "./block-palette";

export interface MobileMove {
  forward: number;
  side: number;
  jump: boolean;
}

export type SaveState = "saved" | "unsaved";

export function WorldClock({ seconds }: { seconds: number }) {
  return (
    <div
      className="world-clock"
      aria-label={`World time ${formatWorldTime(seconds)}, ${phaseLabel(seconds)}`}
      data-testid="status-world-clock"
    >
      <span>{formatWorldTime(seconds)}</span>
      <small>{phaseLabel(seconds)}</small>
    </div>
  );
}

const WEATHER_ICONS: Record<WeatherState["kind"], string> = {
  clear: "☼",
  rain: "///",
  snow: "❄",
  storm: "⚡",
};

export function WeatherBadge({ weather }: { weather: WeatherState }) {
  return (
    <div
      className={`weather-badge weather-${weather.kind}`}
      data-testid="status-weather"
      aria-label={`Weather: ${weather.label}`}
    >
      <span className="weather-icon" aria-hidden="true">{WEATHER_ICONS[weather.kind]}</span>
      <span>
        <strong>{weather.label}</strong>
        <small>{weather.wet ? "find shelter or keep moving" : "good light for building"}</small>
      </span>
    </div>
  );
}

export function BrandLockup() {
  return (
    <div className="brand-lockup" aria-label="Pixel Wilds">
      <div className="brand-stamp" aria-hidden="true"><span /></div>
      <div>
        <div className="brand-name">pixel wilds</div>
        <div className="brand-kicker">a pocket wilderness</div>
      </div>
    </div>
  );
}

export function WorldStatus({
  saveState,
  flying,
  renderRadius,
  onRenderRadiusChange,
  onSave,
  onPause,
}: {
  saveState: SaveState;
  flying: boolean;
  renderRadius: number;
  onRenderRadiusChange: (value: number) => void;
  onSave: () => void;
  onPause: () => void;
}) {
  return (
    <div className="top-right">
      <div className={`status-pill ${saveState === "saved" ? "is-saved" : ""}`} data-testid="status-save">
        <i className="status-dot" />
        {saveState === "saved" ? "landscape saved" : "saving landscape"}
      </div>
      {flying && (
        <div className="status-pill is-flying" data-testid="status-flying">
          <i className="status-dot" />
          flying · space up · ctrl down
        </div>
      )}
      <label className="distance-control" title="How far you can see">
        <span>view {Math.round(renderRadius * CHUNK_SIZE * 0.5)} m</span>
        <input
          type="range"
          min={MIN_RENDER_RADIUS}
          max={MAX_RENDER_RADIUS}
          value={renderRadius}
          aria-label="View distance"
          data-testid="slider-view-distance"
          onChange={(event) => onRenderRadiusChange(Number(event.target.value))}
        />
      </label>
      <button
        className="icon-button"
        type="button"
        aria-label="Pause game"
        title="Pause (Esc)"
        data-testid="button-pause"
        onClick={onPause}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M6.5 4v12M13.5 4v12" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      <button
        className="icon-button"
        type="button"
        aria-label="Save your current landscape"
        title="Save landscape"
        data-testid="button-save-world"
        onClick={onSave}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3 3.5h11.3L17 6.2v10.3H3V3.5Z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 3.8v5h7v-5M6.1 16.2v-5h7.8v5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 13h4" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}

export function WorldCard({
  seed,
  biome,
  rulesOpen,
  onToggleRules,
}: {
  seed: number;
  biome: string;
  rulesOpen: boolean;
  onToggleRules: () => void;
}) {
  return (
    <div className="world-card">
      <small>WORLD SEED</small>
      <strong data-testid="status-world-seed">{seed}</strong>

      <small>GENERATED BIOME</small>
      <strong>{biome.toUpperCase()}</strong>
      <p>Terrain and ecology follow the local climate.</p>
      <button
        className="rules-toggle"
        type="button"
        aria-expanded={rulesOpen}
        aria-controls="world-generation-rules"
        onClick={onToggleRules}
      >
        {rulesOpen ? "Hide world rules" : "How blocks generate"}
      </button>
    </div>
  );
}

export function WorldRulesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <aside
      className="world-rules-panel"
      id="world-generation-rules"
      aria-label="World generation rules"
      hidden={!open}
    >
      <div className="world-rules-heading">
        <h2>How the wild grows</h2>
        <button type="button" aria-label="Close world rules" onClick={onClose}>
          ×
        </button>
      </div>
      <p><b>Scale:</b> every block is 0.5 m. You are 2 m (4 blocks) tall, doors are 5 blocks high, and a step up is one block.</p>
      <p><b>Layers:</b> bedrock, deep rock, mineral bands, soil and surface vegetation form the land. Caves open below a three-block roof, so the surface stays safe.</p>
      <p><b>Time:</b> a twelve-minute day cycles through dawn, daylight, dusk and night. The clock pauses with the game.</p>
      <p><b>Landforms:</b> seeded geological fields shape valleys, plateaus, ridges and mountains.</p>
      <p><b>Water:</b> rivers carve wet valleys, with lakes and sediment-rich banks.</p>
      <p><b>Biomes:</b> temperature, moisture, elevation and soil shape forests, wetlands, grasslands and deserts.</p>
      <p><b>Plants:</b> seeded ecological rules place trees, ferns, reeds, mushrooms and grass.</p>
      <p><b>Crafting:</b> press <kbd className="keycap">C</kbd> for the workbench - planks from logs, doors, chairs and tables from planks, dressed stone, marble, bricks, roof tiles and glass from what you gather. Place them anywhere you like.</p>
      <p><b>One persistent wilderness:</b> 16×16 chunks stream in around you; your edits persist.</p>
    </aside>
  );
}

export function SurvivalHud({ state, onEat }: { state: SurvivalState; onEat: () => void }) {
  const hearts = Array.from({ length: 10 }, (_, index) => state.health - index * 2);
  const meals = Array.from({ length: 10 }, (_, index) => state.hunger - index * 2);
  const bubbles = Array.from({ length: 5 }, (_, index) =>
    state.air > (index + 0.5) * (MAX_AIR / 5),
  );
  return (
    <section
      className={`survival-vitals ${state.health <= 6 ? "is-critical" : ""}`}
      aria-label="Survival vitals"
      data-testid="panel-survival"
    >
      <div className="vital-row">
        <span className="vital-label">Health</span>
        <span
          className="vital-track"
          role="meter"
          aria-label={`Health ${state.health} of 20`}
          aria-valuemin={0}
          aria-valuemax={20}
          aria-valuenow={state.health}
          data-testid="status-health"
        >
          {hearts.map((value, index) => (
            <i
              key={index}
              className={`vital-heart ${value >= 2 ? "is-full" : value >= 1 ? "is-half" : "is-empty"}`}
              aria-hidden="true"
            />
          ))}
        </span>
      </div>
      <div className="vital-row">
        <span className="vital-label">Hunger</span>
        <span
          className="vital-track"
          role="meter"
          aria-label={`Hunger ${Math.ceil(state.hunger)} of ${MAX_HUNGER}`}
          aria-valuemin={0}
          aria-valuemax={MAX_HUNGER}
          aria-valuenow={Math.ceil(state.hunger)}
          data-testid="status-hunger"
        >
          {meals.map((value, index) => (
            <i
              key={index}
              className={`vital-meal ${value >= 2 ? "is-full" : value >= 1 ? "is-half" : "is-empty"}`}
              aria-hidden="true"
            />
          ))}
        </span>
      </div>
      <div className={`vital-row vital-air ${state.air < MAX_AIR ? "is-visible" : ""}`}>
        <span className="vital-label">Breath</span>
        <span
          className="vital-track"
          role="meter"
          aria-label={`Breath ${Math.ceil(state.air)} of ${MAX_AIR} seconds`}
          aria-valuemin={0}
          aria-valuemax={MAX_AIR}
          aria-valuenow={Math.ceil(state.air)}
          data-testid="status-air"
        >
          {bubbles.map((filled, index) => (
            <i key={index} className={`vital-bubble ${filled ? "is-full" : "is-empty"}`} aria-hidden="true" />
          ))}
        </span>
      </div>
      <button
        className="berry-eat"
        type="button"
        onClick={onEat}
        disabled={!canEat(state)}
        title="Eat a handful of wild berries"
        data-testid="button-eat-berries"
      >
        <span>Wild berries <b>{state.berries}</b></span>
        <em>Eat <kbd className="keycap">F</kbd></em>
      </button>
    </section>
  );
}

const DEATH_TEXT: Record<DamageCause, { title: string; detail: string }> = {
  fall: { title: "The ground won.", detail: "A hard landing ended the wander. Watch the drop before you step off." },
  drowning: { title: "The water kept you.", detail: "Your breath ran out below the surface. Find air sooner next time." },
  starvation: { title: "The wild wore you down.", detail: "Hunger emptied your health. Clear leaves for berries and eat before you weaken." },
  void: { title: "You slipped out of the world.", detail: "The void is not a place to explore. Return to solid ground." },
};

export function DeathScreen({
  state,
  onRespawn,
  onQuit,
}: {
  state: SurvivalState;
  onRespawn: () => void;
  onQuit: () => void;
}) {
  const death = state.cause ? DEATH_TEXT[state.cause] : DEATH_TEXT.void;
  return (
    <div className="death-overlay" data-testid="panel-death" role="dialog" aria-modal="true" aria-labelledby="death-title">
      <section className="death-card">
        <p className="menu-eyebrow">The wild keeps its own counsel</p>
        <h2 id="death-title">{death.title}</h2>
        <p>{death.detail}</p>
        <div className="death-actions">
          <button className="death-respawn" type="button" onClick={onRespawn} data-testid="button-respawn">
            Respawn in the wild
          </button>
          <button className="death-quit" type="button" onClick={onQuit} data-testid="button-death-quit">
            Save and quit
          </button>
        </div>
        <small>Your gathered blocks and berries stay with you.</small>
      </section>
    </div>
  );
}

export function Crosshair({
  target,
  miningProgress = 0,
}: {
  target: AimTarget | null;
  miningProgress?: number;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, miningProgress)) * 100);
  return (
    <div
      className={`crosshair ${target ? "crosshair-active" : ""}`}
      data-testid="status-crosshair"
      aria-label={target ? `Aiming at ${target.cell.type}${percent ? `, mining ${percent}%` : ""}` : "Aim crosshair"}
    >
      {percent > 0 && (
        <span
          className="crosshair-mine"
          style={{ background: `conic-gradient(#ffe27b ${percent * 3.6}deg, rgba(255,244,215,.18) 0)` }}
          aria-hidden="true"
        />
      )}
      <span className="crosshair-center" />
    </div>
  );
}

export function Compass({ yaw }: { yaw: number }) {
  const degrees = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const label = labels[Math.round(degrees / 45) % labels.length];
  return (
    <div className="compass-hud" data-testid="status-compass" aria-label={`Facing ${label}, ${Math.round(degrees)} degrees`}>
      <span className="compass-ring" aria-hidden="true">
        <i className="compass-needle" style={{ transform: `translateX(-50%) rotate(${degrees}deg)` }} />
        <b>{label}</b>
      </span>
      <span className="compass-copy">facing <strong>{label}</strong><small>{Math.round(degrees)}°</small></span>
    </div>
  );
}

export function FieldReadouts({
  biome,
  coordinates,
  loadedChunkCount,
  loadedBlockCount,
  renderRadius,
}: {
  biome: string;
  coordinates: string;
  loadedChunkCount: number;
  loadedBlockCount: number;
  renderRadius: number;
}) {
  return (
    <div className="bottom-left">
      <div className="readout" data-testid="status-coordinates">
        FIELD POSITION{biome ? ` · ${biome.toUpperCase()}` : ""}
        <strong>{coordinates}</strong>
      </div>
      <div className="readout" data-testid="status-block-count">
        CHUNKS LOADED
        <strong>{loadedChunkCount} · {loadedBlockCount.toLocaleString()} blocks · {Math.round(renderRadius * CHUNK_SIZE * 0.5)} m view</strong>
      </div>
    </div>
  );
}

export function ToolbeltHud({
  tool,
  durability,
  onCycle,
}: {
  tool: ToolDefinition | null;
  durability: number;
  onCycle: () => void;
}) {
  const percent = tool ? Math.round((durability / tool.maxDurability) * 100) : 0;
  const worn = Boolean(tool && percent <= 20);
  return (
    <button
      className={`toolbelt-hud ${tool ? "has-tool" : "is-hand"} ${worn ? "is-worn" : ""}`}
      type="button"
      onClick={onCycle}
      aria-label={tool
        ? `${tool.label}, ${TOOL_TIER_LABELS[tool.tier]} tier, ${durability} uses left. Press T to change tool.`
        : "Bare hands. Press T to change tool."}
      data-testid="status-tool"
    >
      <span className={`tool-mark tool-${tool?.kind ?? "hand"}`} aria-hidden="true">
        {tool?.short ?? "HND"}
      </span>
      <span className="tool-copy">
        <strong>{tool?.label ?? "Bare hands"}</strong>
        <small data-testid="status-tool-durability">
          {tool ? `${TOOL_TIER_LABELS[tool.tier]} tier · ${durability} uses` : "mine slowly · craft tools at C"}
        </small>
        {tool && (
          <span className="tool-wear" aria-hidden="true">
            <i style={{ width: `${percent}%` }} />
          </span>
        )}
      </span>
      <kbd className="keycap">T</kbd>
    </button>
  );
}

export function Hotbar({
  inventory,
  selectedIndex,
  onSelect,
  unlimited = false,
  tool = null,
  toolDurability = 0,
  onCycleTool,
}: {
  inventory: Inventory;
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** Creative worlds do not consume blocks when placing. */
  unlimited?: boolean;
  tool?: ToolDefinition | null;
  toolDurability?: number;
  onCycleTool?: () => void;
}) {
  const selected = BLOCK_TYPES[selectedIndex] ?? "grass";
  const hotbarPage = Math.floor(selectedIndex / HOTBAR_SLOTS);
  const hotbarPages = Math.ceil(BLOCK_TYPES.length / HOTBAR_SLOTS);
  return (
    <div className="bottom-hud">
      <ToolbeltHud
        tool={tool}
        durability={toolDurability}
        onCycle={() => onCycleTool?.()}
      />
      <div className="hotbar" role="toolbar" aria-label="Block selection" data-testid="hotbar">
        {BLOCK_TYPES.slice(hotbarPage * HOTBAR_SLOTS, (hotbarPage + 1) * HOTBAR_SLOTS).map((type, slot) => {
          const index = hotbarPage * HOTBAR_SLOTS + slot;
          const [sideColor, topColor] = BLOCK_COLORS[type];
          return (
            <button
              key={type}
              className={`hotbar-slot ${selected === type ? "selected" : ""}`}
              type="button"
              aria-label={`Select ${BLOCK_META[type].label}, ${unlimited ? "unlimited" : inventory[type]} available`}
              aria-pressed={selected === type}
              data-testid={`button-hotbar-${type}`}
              onClick={() => onSelect(index)}
            >
              <span className="slot-number">{slot === 9 ? "0" : slot + 1}</span>
              <span
                className="voxel-swatch"
                style={{ background: `linear-gradient(135deg, ${topColor} 0 50%, ${sideColor} 50% 100%)` }}
                aria-hidden="true"
              />
              <span className="slot-label">{BLOCK_META[type].label}</span>
              <span className="slot-count" data-testid={`count-${type}`}>{unlimited ? "∞" : inventory[type]}</span>
            </button>
          );
        })}
        <button
          className="hotbar-page"
          type="button"
          aria-label="Next block page"
          data-testid="button-hotbar-page"
          onClick={() => onSelect(((hotbarPage + 1) % hotbarPages) * HOTBAR_SLOTS)}
        >
          {hotbarPage + 1}/{hotbarPages}
        </button>
      </div>
      <div className="hint-line" data-testid="status-controls">
        <span className="hint-item"><kbd className="keycap">W</kbd><kbd className="keycap">A</kbd><kbd className="keycap">S</kbd><kbd className="keycap">D</kbd> wander</span>
        <span className="hint-item"><kbd className="keycap">←</kbd><kbd className="keycap">→</kbd> turn</span>
        <span className="hint-item"><kbd className="keycap">SPACE</kbd> jump · autojump on</span>
        <span className="hint-item"><kbd className="keycap">SPACE ×2</kbd> fly</span>
        <span className="hint-item"><kbd className="keycap">C</kbd> craft</span>
        <span className="hint-item"><kbd className="keycap">T</kbd> change tool</span>
        <span className="hint-item"><kbd className="keycap">LMB</kbd> hold to mine</span>
        <span className="hint-item"><kbd className="keycap">RMB</kbd> place</span>
        <span className="hint-item"><kbd className="keycap">SHIFT</kbd> run</span>
        <span className="hint-item"><kbd className="keycap">1–9 / 0</kbd> choose</span>
        <span className="hint-item"><kbd className="keycap">Q</kbd><kbd className="keycap">E</kbd> block page</span>
      </div>
    </div>
  );
}

export function CraftPanel({
  open,
  inventory,
  toolbelt,
  equippedToolId,
  onClose,
  onCraft,
  onCraftTool,
  onEquipTool,
  onRepairTool,
  unlimited = false,
}: {
  open: boolean;
  inventory: Inventory;
  toolbelt: ToolBelt;
  equippedToolId: ToolId | null;
  onClose: () => void;
  onCraft: (recipe: CraftRecipe) => void;
  onCraftTool: (id: ToolId) => void;
  onEquipTool: (id: ToolId) => void;
  onRepairTool: (id: ToolId) => void;
  /** Creative worlds craft without spending gathered materials. */
  unlimited?: boolean;
}) {
  return (
    <section
      className={`craft-panel ${open ? "open" : ""}`}
      aria-label="Workbench"
      aria-hidden={!open}
      data-testid="panel-craft"
    >
      <header className="craft-head">
        <div>
          <strong>Workbench</strong>
          <p>Make field tools for faster mining, then spend gathered blocks on furniture and dressed stone.</p>
        </div>
        <button type="button" aria-label="Close workbench" onClick={onClose}>×</button>
      </header>
      <div className="craft-list">
        <section className="craft-section" aria-labelledby="craft-tools-title">
          <h3 className="craft-section-title" id="craft-tools-title">
            Field tools <span>durable · T to change</span>
          </h3>
          {TOOL_DEFINITIONS.map((tool) => {
            const durability = toolbelt[tool.id] ?? 0;
            const owned = durability > 0;
            const afford = unlimited || canAfford(tool.recipe.inputs, inventory);
            const equipped = equippedToolId === tool.id;
            const worn = owned && durability < tool.maxDurability;
            const repairAfford = worn && canRepairTool(
              tool.id,
              inventory,
              { belt: toolbelt, equipped: equippedToolId },
              unlimited,
            );
            return (
              <div
                key={tool.id}
                className={`craft-row tool-row ${afford ? "" : "is-missing"} ${equipped ? "is-equipped" : ""}`}
                data-testid={`tool-row-${tool.id}`}
              >
                <span className={`tool-mark tool-${tool.kind}`} aria-hidden="true">{tool.short}</span>
                <span className="craft-body">
                  <strong>{tool.label} <em className="tool-tier">{TOOL_TIER_LABELS[tool.tier]}</em></strong>
                  <em>{tool.recipe.work}</em>
                  <span className="craft-cost">
                    {unlimited ? (
                      <b>creative · no materials spent</b>
                    ) : (
                      tool.recipe.inputs.map((input) => (
                        <b key={input.item} className={(inventory[input.item] ?? 0) >= input.count ? "" : "short"}>
                          {BLOCK_META[input.item].short} {inventory[input.item] ?? 0}/{input.count}
                        </b>
                      ))
                    )}
                    {owned && <b className="tool-remaining">{durability}/{tool.maxDurability} uses</b>}
                  </span>
                </span>
                <span className="tool-actions">
                  {worn && (
                    <button
                      className="tool-repair"
                      type="button"
                      disabled={!repairAfford}
                      title={tool.repair.map((input) => `${BLOCK_META[input.item].label} x${input.count}`).join(" + ")}
                      data-testid={`button-repair-tool-${tool.id}`}
                      onClick={() => onRepairTool(tool.id)}
                    >
                      Repair
                    </button>
                  )}
                  {owned && (
                    <button
                      className="tool-equip"
                      type="button"
                      aria-pressed={equipped}
                      onClick={() => onEquipTool(tool.id)}
                    >
                      {equipped ? "Equipped" : "Equip"}
                    </button>
                  )}
                  <button
                    className="tool-craft"
                    type="button"
                    disabled={!afford}
                    data-testid={`button-craft-tool-${tool.id}`}
                    onClick={() => onCraftTool(tool.id)}
                  >
                    {owned ? "Recraft" : "Craft"}
                  </button>
                </span>
              </div>
            );
          })}
        </section>
        <section className="craft-section" aria-labelledby="craft-building-title">
          <h3 className="craft-section-title" id="craft-building-title">
            Building <span>place with RMB</span>
          </h3>
          {CRAFTING_RECIPES.map((recipe) => {
            const afford = unlimited || canCraft(recipe, inventory);
            const [sideColor, topColor] = BLOCK_COLORS[recipe.output];
            return (
              <button
                key={recipe.id}
                className={`craft-row ${afford ? "" : "is-missing"}`}
                type="button"
                disabled={!afford}
                data-testid={`button-craft-${recipe.id}`}
                onClick={() => onCraft(recipe)}
              >
                <span
                  className="voxel-swatch"
                  style={{ background: `linear-gradient(135deg, ${topColor} 0 50%, ${sideColor} 50% 100%)` }}
                  aria-hidden="true"
                />
                <span className="craft-body">
                  <strong>{recipe.label}</strong>
                  <em>{recipe.work}</em>
                  <span className="craft-cost">
                    {unlimited ? (
                      <b>creative · no materials spent</b>
                    ) : (
                      recipe.inputs.map((input) => (
                        <b key={input.item} className={(inventory[input.item] ?? 0) >= input.count ? "" : "short"}>
                          {BLOCK_META[input.item].short} {inventory[input.item] ?? 0}/{input.count}
                        </b>
                      ))
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </section>
      </div>
      <footer className="craft-foot">press C to close · tools wear with use · ore needs the right pickaxe</footer>
    </section>
  );
}

export function ContainerPanel({
  open,
  position,
  contents,
  inventory,
  onClose,
  onDeposit,
  onWithdraw,
}: {
  open: boolean;
  position: string;
  contents: ContainerContents;
  inventory: Inventory;
  onClose: () => void;
  onDeposit: (item: keyof Inventory, amount: number) => void;
  onWithdraw: (item: keyof Inventory, amount: number) => void;
}) {
  const total = containerTotal(contents);
  const rows = BLOCK_TYPES.filter((type) => (contents[type] ?? 0) > 0 || inventory[type] > 0);
  const full = total >= CONTAINER_CAPACITY;
  return (
    <section
      className={`container-panel ${open ? "open" : ""}`}
      aria-label="Chest contents"
      aria-hidden={!open}
      data-testid="panel-container"
    >
      <header className="container-head">
        <div>
          <strong>Chest</strong>
          <p>{position} · {total}/{CONTAINER_CAPACITY} stored</p>
        </div>
        <button type="button" aria-label="Close chest" onClick={onClose} data-testid="button-close-container">×</button>
      </header>
      <div className="container-list">
        {rows.length === 0 ? (
          <p className="container-empty">Both your pack and this chest are empty. Gather some blocks first.</p>
        ) : rows.map((type) => {
          const stored = contents[type] ?? 0;
          const carried = inventory[type] ?? 0;
          return (
            <div className="container-row" key={type} data-testid={`container-row-${type}`}>
              <span
                className="voxel-swatch"
                style={{ background: `linear-gradient(135deg, ${BLOCK_COLORS[type][1]} 0 50%, ${BLOCK_COLORS[type][0]} 50% 100%)` }}
                aria-hidden="true"
              />
              <span className="container-copy">
                <strong>{BLOCK_META[type].label}</strong>
                <small>pack {carried} · chest {stored}</small>
              </span>
              <span className="container-actions">
                <button type="button" disabled={carried < 1 || full} onClick={() => onDeposit(type, 1)}>Store</button>
                <button type="button" disabled={carried < 1 || full} onClick={() => onDeposit(type, 8)}>×8</button>
                <button type="button" disabled={stored < 1} onClick={() => onWithdraw(type, 1)}>Take</button>
                <button type="button" disabled={stored < 1} onClick={() => onWithdraw(type, 8)}>×8</button>
              </span>
            </div>
          );
        })}
      </div>
      <footer className="container-foot">Store blocks here to free hotbar space · chest contents survive save and reload</footer>
    </section>
  );
}

export function ToastNote({ notice }: { notice: string }) {
  return (
    <div className={`toast-note ${notice ? "show" : ""}`} role="status" data-testid="status-notice">{notice}</div>
  );
}

export function WelcomeOverlay({ hidden, onBegin }: { hidden: boolean; onBegin: () => void }) {
  return (
    <div className={`welcome-overlay ${hidden ? "hidden" : ""}`}>
      <section className="welcome-card" aria-labelledby="welcome-title">
        <div className="welcome-mark" aria-hidden="true" />
        <h1 id="welcome-title">The wild is yours.</h1>
        <p>Wander a little, gather what catches your eye, then make this strange place your own.</p>
        <button className="welcome-start" type="button" onClick={onBegin} data-testid="button-enter-world">
          <span>Enter the wild</span>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h9M8 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
        <p className="welcome-foot">click the land to capture your view</p>
      </section>
    </div>
  );
}

export function MobileControls({
  onMove,
  target,
  onMine,
  onPlace,
  onUse,
  onToggleCraft,
}: {
  onMove: Dispatch<SetStateAction<MobileMove>>;
  target: AimTarget | null;
  onMine: (cell: BlockCell) => void;
  onPlace: (cell: BlockCell, adjacent: AimTarget["adjacent"]) => void;
  onUse: (cell: BlockCell) => void;
  onToggleCraft: () => void;
}) {
  return (
    <>
      <div className="mobile-controls" aria-label="Touch movement controls">
        <span />
        <button type="button" aria-label="Move forward" data-testid="button-move-forward"
          onTouchStart={(event) => { event.preventDefault(); onMove((value) => ({ ...value, forward: 1 })); }}
          onTouchEnd={(event) => { event.preventDefault(); onMove((value) => ({ ...value, forward: 0 })); }}
          onTouchCancel={() => onMove((value) => ({ ...value, forward: 0 }))}>↑</button>
        <span />
        <button type="button" aria-label="Move left" data-testid="button-move-left"
          onTouchStart={(event) => { event.preventDefault(); onMove((value) => ({ ...value, side: -1 })); }}
          onTouchEnd={(event) => { event.preventDefault(); onMove((value) => ({ ...value, side: 0 })); }}
          onTouchCancel={() => onMove((value) => ({ ...value, side: 0 }))}>←</button>
        <button type="button" aria-label="Jump" data-testid="button-jump"
          onTouchStart={(event) => { event.preventDefault(); onMove((value) => ({ ...value, jump: true })); }}
          onTouchEnd={(event) => { event.preventDefault(); onMove((value) => ({ ...value, jump: false })); }}
          onTouchCancel={() => onMove((value) => ({ ...value, jump: false }))}>↑</button>
        <button type="button" aria-label="Move right" data-testid="button-move-right"
          onTouchStart={(event) => { event.preventDefault(); onMove((value) => ({ ...value, side: 1 })); }}
          onTouchEnd={(event) => { event.preventDefault(); onMove((value) => ({ ...value, side: 0 })); }}
          onTouchCancel={() => onMove((value) => ({ ...value, side: 0 }))}>→</button>
      </div>
      <div className="mobile-actions" aria-label="Touch building controls">
        <button
          type="button"
          aria-label="Mine targeted block"
          data-testid="button-touch-mine"
          onClick={() => { if (target) onMine(target.cell); }}
        >
          Mine
        </button>
        <button
          type="button"
          aria-label="Place selected block"
          data-testid="button-touch-place"
          onClick={() => { if (target) onPlace(target.cell, target.adjacent); }}
        >
          Place
        </button>
        <button
          type="button"
          aria-label="Use targeted chest"
          data-testid="button-touch-use"
          disabled={target?.cell.type !== "chest"}
          onClick={() => { if (target?.cell.type === "chest") onUse(target.cell); }}
        >
          Use
        </button>
        <button
          type="button"
          aria-label="Open workbench"
          data-testid="button-touch-craft"
          onClick={onToggleCraft}
        >
          Craft
        </button>
      </div>
    </>
  );
}
