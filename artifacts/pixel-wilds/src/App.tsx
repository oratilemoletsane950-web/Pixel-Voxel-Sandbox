/**
 * Application shell: navigation between the launcher, world management,
 * settings and one running world.
 *
 * Gameplay lives in `app/game-screen.tsx`; screens live in `app/world-menu.tsx`.
 * This file only owns profiles, settings and routing.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createWorldArchive,
  createWorldProfile,
  deleteWorldProfile,
  duplicateWorldProfile,
  importWorldArchive,
  listWorldProfiles,
  loadWorldData,
  renameWorldProfile,
  saveWorldProfile,
  serializeWorldArchive,
  setActiveWorldProfile,
  touchWorldProfile,
  type WorldProfile,
} from "./game/world";
import { readSettings, saveSettings, type AppSettings } from "./game/settings";
import { GameScreen } from "./app/game-screen";
import {
  MainMenu,
  SettingsScreen,
  WorldCreate,
  WorldSelect,
  type CreateWorldInput,
} from "./app/world-menu";

type View =
  | { kind: "menu" }
  | { kind: "worlds" }
  | { kind: "create" }
  | { kind: "settings" }
  | { kind: "game"; id: string };

function App() {
  const [view, setView] = useState<View>({ kind: "menu" });
  const [profiles, setProfiles] = useState<WorldProfile[]>(() => listWorldProfiles());
  const [settings, setSettings] = useState<AppSettings>(() => readSettings());
  const [notice, setNotice] = useState("");
  const noticeTimeout = useRef<number | undefined>(undefined);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.clearTimeout(noticeTimeout.current);
    noticeTimeout.current = window.setTimeout(() => setNotice(""), 2600);
  }, []);

  useEffect(() => () => window.clearTimeout(noticeTimeout.current), []);

  const refreshProfiles = useCallback(() => {
    setProfiles(listWorldProfiles());
  }, []);

  const changeSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  // A world can disappear while a screen is open (deleted in another tab).
  useEffect(() => {
    if (view.kind !== "game") return;
    if (!profiles.some((profile) => profile.id === view.id)) setView({ kind: "worlds" });
  }, [profiles, view]);

  const createWorld = (input: CreateWorldInput) => {
    try {
      const profile = createWorldProfile({
        ...input,
        rules: { structures: input.structures !== false },
      });
      saveWorldProfile(profile);
      loadWorldData(profile.id, profile.seed, 0, 0, 5);
      setActiveWorldProfile(profile.id);
      refreshProfiles();
      setView({ kind: "game", id: profile.id });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "That world could not be created.");
    }
  };

  const playWorld = (id: string) => {
    try {
      touchWorldProfile(id);
      refreshProfiles();
      setView({ kind: "game", id });
    } catch {
      showNotice("That world could not be opened.");
    }
  };

  const renameWorld = (id: string, name: string) => {
    try {
      renameWorldProfile(id, name);
      refreshProfiles();
      showNotice("World renamed.");
    } catch {
      showNotice("That name could not be saved.");
    }
  };

  const duplicateWorld = (id: string) => {
    try {
      const copy = duplicateWorldProfile(id);
      if (!copy) {
        showNotice("That world could not be copied.");
        return;
      }
      refreshProfiles();
      showNotice(`Copied to "${copy.name}".`);
    } catch {
      showNotice("That world could not be copied.");
    }
  };

  const exportWorld = (id: string) => {
    try {
      const archive = createWorldArchive(id);
      if (!archive) {
        showNotice("That world could not be exported.");
        return;
      }
      const blob = new Blob([serializeWorldArchive(archive)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeName = archive.profile.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "pixel-wilds";
      anchor.href = url;
      anchor.download = `${safeName}.pixelwilds.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      showNotice(`Exported "${archive.profile.name}".`);
    } catch {
      showNotice("That world could not be exported.");
    }
  };

  const importWorld = async (file: File) => {
    try {
      const profile = importWorldArchive(await file.text());
      refreshProfiles();
      showNotice(`Imported "${profile.name}".`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "That archive could not be imported.");
    }
  };

  const removeWorld = (id: string) => {
    try {
      deleteWorldProfile(id);
      refreshProfiles();
      showNotice("World deleted.");
    } catch {
      showNotice("That world could not be deleted.");
    }
  };

  const quitGame = () => {
    saveSettings(settings);
    window.close();
    // Browsers may refuse window.close() for tabs they did not open.
    showNotice("Close this tab to leave the wild.");
  };

  const activeProfile =
    view.kind === "game" ? profiles.find((profile) => profile.id === view.id) ?? null : null;

  if (view.kind === "game" && activeProfile) {
    return (
      <GameScreen
        key={activeProfile.id}
        profile={activeProfile}
        settings={settings}
        onSettingsChange={changeSettings}
        onExit={() => {
          refreshProfiles();
          setView({ kind: "worlds" });
        }}
      />
    );
  }

  if (view.kind === "create") {
    return (
      <WorldCreate
        onBack={() => setView({ kind: "worlds" })}
        onCreate={createWorld}
      />
    );
  }

  if (view.kind === "worlds") {
    return (
      <WorldSelect
        profiles={profiles}
        notice={notice}
        onBack={() => setView({ kind: "menu" })}
        onCreate={() => setView({ kind: "create" })}
        onPlay={playWorld}
        onRename={renameWorld}
        onDuplicate={duplicateWorld}
        onExport={exportWorld}
        onImport={(file) => { void importWorld(file); }}
        onDelete={removeWorld}
      />
    );
  }

  if (view.kind === "settings") {
    return (
      <SettingsScreen
        settings={settings}
        onChange={changeSettings}
        onBack={() => setView({ kind: "menu" })}
      />
    );
  }

  return (
    <MainMenu
      worldCount={profiles.length}
      notice={notice}
      onPlay={() => {
        refreshProfiles();
        setView({ kind: "worlds" });
      }}
      onSettings={() => setView({ kind: "settings" })}
      onQuit={quitGame}
    />
  );
}

export default App;
