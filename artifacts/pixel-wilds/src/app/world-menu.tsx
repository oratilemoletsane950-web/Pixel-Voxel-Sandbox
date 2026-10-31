/**
 * Launcher, world management and pause screens.
 *
 * These components are presentational: profiles, settings and callbacks come
 * from `App`/`GameScreen`. Form state that only matters while a screen is open
 * (rename draft, delete confirmation, seed text) stays local.
 */
import { useRef, useState } from "react";

import {
  DIFFICULTIES,
  GAME_MODES,
  MAX_SEED,
  MAX_RENDER_RADIUS,
  MIN_RENDER_RADIUS,
  type Difficulty,
  type GameMode,
  type WorldProfile,
} from "../game/world";
import {
  MAX_FOV,
  MAX_TOUCH_SENSITIVITY,
  MIN_FOV,
  MIN_TOUCH_SENSITIVITY,
  type AppSettings,
} from "../game/settings";

export interface CreateWorldInput {
  name: string;
  seed: number;
  mode: GameMode;
  difficulty: Difficulty;
}

const MODE_LABELS: Record<GameMode, string> = {
  creative: "Creative",
  survival: "Survival",
};

const MODE_HINTS: Record<GameMode, string> = {
  creative: "Every block, unlimited placement, flight.",
  survival: "Start empty, forage berries, manage health and hunger, no flight.",
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  peaceful: "Peaceful",
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
};

function formatPlayed(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function MenuNotice({ notice }: { notice: string }) {
  return (
    <div className={`menu-notice ${notice ? "show" : ""}`} role="status" data-testid="status-menu-notice">
      {notice}
    </div>
  );
}

export function MainMenu({
  worldCount,
  onPlay,
  onSettings,
  onQuit,
  notice,
}: {
  worldCount: number;
  onPlay: () => void;
  onSettings: () => void;
  onQuit: () => void;
  notice: string;
}) {
  return (
    <main className="menu-shell" data-testid="screen-main-menu">
      <div className="menu-sky" aria-hidden="true" />
      <div className="menu-brand">
        <div className="brand-stamp" aria-hidden="true"><span /></div>
        <div>
          <div className="brand-name">pixel wilds</div>
          <div className="brand-kicker">a pocket wilderness</div>
        </div>
      </div>

      <section className="menu-card menu-card-main" aria-labelledby="main-menu-title">
        <p className="menu-eyebrow">Open-world voxel sandbox</p>
        <h1 id="main-menu-title">The wild is yours.</h1>
        <p className="menu-lede">
          Shape a world block by block, or wander until the horizon runs out.
        </p>

        <div className="menu-actions">
          <button className="menu-action is-primary" type="button" onClick={onPlay} data-testid="button-singleplayer">
            <strong>Singleplayer</strong>
            <span>{worldCount === 0 ? "Create your first world" : `Continue one of ${worldCount} worlds`}</span>
          </button>
          <button
            className="menu-action"
            type="button"
            disabled
            title="LAN multiplayer is the next increment"
            data-testid="button-multiplayer"
          >
            <strong>Multiplayer (LAN)</strong>
            <span>Open to LAN arrives in the next increment</span>
          </button>
          <button className="menu-action" type="button" onClick={onSettings} data-testid="button-settings">
            <strong>Settings</strong>
            <span>View distance, field of view</span>
          </button>
          <button className="menu-action is-quiet" type="button" onClick={onQuit} data-testid="button-quit">
            <strong>Quit Game</strong>
            <span>Return to your desktop</span>
          </button>
        </div>

        <p className="menu-note">
          LAN multiplayer is the next increment; this build is local-only.
        </p>
      </section>

      <MenuNotice notice={notice} />
      <p className="menu-foot">Every world keeps its own terrain, inventory and edits.</p>
    </main>
  );
}

export function WorldSelect({
  profiles,
  onBack,
  onCreate,
  onPlay,
  onRename,
  onDuplicate,
  onExport,
  onImport,
  onDelete,
  notice,
}: {
  profiles: WorldProfile[];
  onBack: () => void;
  onCreate: () => void;
  onPlay: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string) => void;
  onImport: (file: File) => void;
  onDelete: (id: string) => void;
  notice: string;
}) {
  const importInput = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const startRename = (profile: WorldProfile) => {
    setConfirmingId(null);
    setRenamingId(profile.id);
    setDraftName(profile.name);
  };

  const submitRename = () => {
    if (!renamingId || !draftName.trim()) return;
    onRename(renamingId, draftName);
    setRenamingId(null);
  };

  return (
    <main className="menu-shell" data-testid="screen-world-select">
      <div className="menu-sky" aria-hidden="true" />
      <header className="menu-topbar">
        <button className="menu-back" type="button" onClick={onBack} data-testid="button-back">
          ← Back
        </button>
        <div>
          <p className="menu-eyebrow">Singleplayer</p>
          <h1 className="menu-title">Your worlds</h1>
        </div>
        <div className="world-header-actions">
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            className="visually-hidden"
            data-testid="input-import-world"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onImport(file);
            }}
          />
          <button
            className="menu-action is-quiet is-compact"
            type="button"
            onClick={() => importInput.current?.click()}
            data-testid="button-import-world"
          >
            <strong>Import</strong>
          </button>
          <button className="menu-action is-primary is-compact" type="button" onClick={onCreate} data-testid="button-create-world">
            <strong>New world</strong>
          </button>
        </div>
      </header>

      <section className="world-panel" aria-label="Saved worlds">
        {profiles.length === 0 ? (
          <div className="world-empty">
            <h2>No worlds yet.</h2>
            <p>Create one and the wild will grow around a seed of your choosing.</p>
            <button className="menu-action is-primary" type="button" onClick={onCreate}>
              <strong>Create a world</strong>
            </button>
          </div>
        ) : (
          <ul className="world-list">
            {profiles.map((profile) => (
              <li className="world-row" key={profile.id} data-testid="world-row">
                <div className="world-row-main">
                  {renamingId === profile.id ? (
                    <form
                      className="rename-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitRename();
                      }}
                    >
                      <input
                        autoFocus
                        value={draftName}
                        maxLength={48}
                        aria-label="World name"
                        data-testid="input-rename-world"
                        onChange={(event) => setDraftName(event.target.value)}
                      />
                      <button className="chip" type="submit">Save</button>
                      <button className="chip" type="button" onClick={() => setRenamingId(null)}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <h2>{profile.name}</h2>
                      <p className="world-meta">
                        {MODE_LABELS[profile.mode]} · {DIFFICULTY_LABELS[profile.difficulty]} · seed {profile.seed}
                      </p>
                      <p className="world-played">Last played {formatPlayed(profile.lastPlayedAt)}</p>
                    </>
                  )}
                </div>

                <div className="world-row-actions">
                  <button className="chip is-primary" type="button" onClick={() => onPlay(profile.id)} data-testid="button-play-world">
                    Play
                  </button>
                  <button className="chip" type="button" onClick={() => startRename(profile)}>
                    Rename
                  </button>
                  <button className="chip" type="button" onClick={() => onDuplicate(profile.id)}>
                    Duplicate
                  </button>
                  <button
                    className="chip"
                    type="button"
                    onClick={() => onExport(profile.id)}
                    data-testid="button-export-world"
                  >
                    Export
                  </button>
                  {confirmingId === profile.id ? (
                    <>
                      <button
                        className="chip is-danger"
                        type="button"
                        onClick={() => {
                          onDelete(profile.id);
                          setConfirmingId(null);
                        }}
                        data-testid="button-confirm-delete"
                      >
                        Really delete
                      </button>
                      <button className="chip" type="button" onClick={() => setConfirmingId(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button className="chip is-quiet" type="button" onClick={() => setConfirmingId(profile.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="menu-foot world-archive-note">
        Export saves a portable JSON archive. Import always creates a new world copy.
      </p>
      <MenuNotice notice={notice} />
    </main>
  );
}

export function WorldCreate({
  onBack,
  onCreate,
}: {
  onBack: () => void;
  onCreate: (input: CreateWorldInput) => void;
}) {
  const [name, setName] = useState("New Wilderness");
  const [seed, setSeed] = useState(() => String(Math.floor(Math.random() * MAX_SEED)));
  const [mode, setMode] = useState<GameMode>("creative");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [error, setError] = useState("");

  const randomizeSeed = () => {
    setSeed(String(Math.floor(Math.random() * MAX_SEED)));
    setError("");
  };

  const submit = () => {
    const parsed = Number(seed.trim());
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_SEED) {
      setError(`Seed must be a whole number from 0 to ${MAX_SEED}.`);
      return;
    }
    if (!name.trim()) {
      setError("Give the world a name.");
      return;
    }
    onCreate({ name: name.trim(), seed: parsed, mode, difficulty });
  };

  return (
    <main className="menu-shell" data-testid="screen-world-create">
      <div className="menu-sky" aria-hidden="true" />
      <header className="menu-topbar">
        <button className="menu-back" type="button" onClick={onBack} data-testid="button-back">
          ← Back
        </button>
        <div>
          <p className="menu-eyebrow">New world</p>
          <h1 className="menu-title">Shape a wilderness</h1>
        </div>
        <span />
      </header>

      <form
        className="create-panel"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="field">
          <span>World name</span>
          <input
            value={name}
            maxLength={48}
            onChange={(event) => setName(event.target.value)}
            data-testid="input-world-name"
          />
        </label>

        <label className="field">
          <span>Seed</span>
          <div className="field-row">
            <input
              value={seed}
              inputMode="numeric"
              onChange={(event) => setSeed(event.target.value)}
              data-testid="input-world-seed"
            />
            <button className="chip" type="button" onClick={randomizeSeed} data-testid="button-random-seed">
              Random
            </button>
          </div>
          <small>The same seed and settings always grow the same terrain.</small>
        </label>

        <fieldset className="field">
          <legend>Game mode</legend>
          <div className="segmented">
            {GAME_MODES.map((option) => (
              <button
                key={option}
                type="button"
                className={`segment ${mode === option ? "is-active" : ""}`}
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
                data-testid={`button-mode-${option}`}
              >
                <strong>{MODE_LABELS[option]}</strong>
                <span>{MODE_HINTS[option]}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>Difficulty</span>
          <select
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value as Difficulty)}
            data-testid="select-difficulty"
          >
            {DIFFICULTIES.map((option) => (
              <option key={option} value={option}>{DIFFICULTY_LABELS[option]}</option>
            ))}
          </select>
          <small>Controls hunger, starvation, drowning and fall damage in survival.</small>
        </label>

        {error && <p className="field-error" role="alert">{error}</p>}

        <div className="create-actions">
          <button className="menu-action is-primary" type="submit" data-testid="button-submit-world">
            <strong>Create world</strong>
            <span>Generate the first chunks</span>
          </button>
          <button className="chip" type="button" onClick={onBack}>Cancel</button>
        </div>
      </form>

      <p className="menu-foot">Structures, cheats and LAN rules live on the world profile for later stages.</p>
    </main>
  );
}

export function SettingsFields({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}) {
  return (
    <div className="settings-fields">
      <label className="field">
        <span>View distance · {Math.round(settings.renderRadius * 8)} m</span>
        <input
          type="range"
          min={MIN_RENDER_RADIUS}
          max={MAX_RENDER_RADIUS}
          value={settings.renderRadius}
          onChange={(event) => onChange({ ...settings, renderRadius: Number(event.target.value) })}
          data-testid="slider-view-distance"
        />
        <small>More chunks visible costs more memory and frame time.</small>
      </label>
      <label className="field">
        <span>Field of view · {settings.fov}°</span>
        <input
          type="range"
          min={MIN_FOV}
          max={MAX_FOV}
          value={settings.fov}
          onChange={(event) => onChange({ ...settings, fov: Number(event.target.value) })}
          data-testid="slider-fov"
        />
        <small>Settings are remembered between sessions.</small>
      </label>
      <label className="field">
        <span>Touch look · {settings.touchSensitivity.toFixed(1)}x</span>
        <input
          type="range"
          min={MIN_TOUCH_SENSITIVITY}
          max={MAX_TOUCH_SENSITIVITY}
          step={0.1}
          value={settings.touchSensitivity}
          onChange={(event) => onChange({ ...settings, touchSensitivity: Number(event.target.value) })}
          data-testid="slider-touch-sensitivity"
        />
        <small>Adjusts drag-to-look on touch screens.</small>
      </label>
    </div>
  );
}

export function SettingsScreen({
  settings,
  onChange,
  onBack,
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onBack: () => void;
}) {
  return (
    <main className="menu-shell" data-testid="screen-settings">
      <div className="menu-sky" aria-hidden="true" />
      <header className="menu-topbar">
        <button className="menu-back" type="button" onClick={onBack} data-testid="button-back">
          ← Back
        </button>
        <div>
          <p className="menu-eyebrow">Settings</p>
          <h1 className="menu-title">Graphics</h1>
        </div>
        <span />
      </header>
      <section className="create-panel">
        <SettingsFields settings={settings} onChange={onChange} />
        <p className="menu-note">Audio, controls and accessibility options are scheduled with the options pass.</p>
      </section>
    </main>
  );
}

export function PauseMenu({
  open,
  profile,
  settings,
  onChangeSettings,
  onResume,
  onSaveQuit,
}: {
  open: boolean;
  profile: WorldProfile;
  settings: AppSettings;
  onChangeSettings: (settings: AppSettings) => void;
  onResume: () => void;
  onSaveQuit: () => void;
}) {
  if (!open) return null;
  return (
    <div className="pause-overlay" data-testid="panel-pause">
      <section className="pause-card" aria-labelledby="pause-title">
        <p className="menu-eyebrow">Paused</p>
        <h2 id="pause-title">{profile.name}</h2>
        <p className="pause-meta">
          {MODE_LABELS[profile.mode]} · {DIFFICULTY_LABELS[profile.difficulty]} · seed {profile.seed}
        </p>

        <div className="pause-actions">
          <button className="menu-action is-primary" type="button" onClick={onResume} data-testid="button-resume">
            <strong>Resume Game</strong>
          </button>
          <button className="menu-action" type="button" disabled title="LAN multiplayer is the next increment">
            <strong>Open to LAN</strong>
            <span>Coming with the multiplayer increment</span>
          </button>
          <button className="menu-action is-quiet" type="button" onClick={onSaveQuit} data-testid="button-save-quit">
            <strong>Save and Quit</strong>
            <span>Keep this world and return to the menu</span>
          </button>
        </div>

        <SettingsFields settings={settings} onChange={onChangeSettings} />
      </section>
    </div>
  );
}
