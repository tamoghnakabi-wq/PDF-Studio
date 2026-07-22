import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useStore } from "../lib/store";
import { Field, Segmented } from "./Field";
import type { ThemeMode } from "../lib/types";

export default function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const [version, setVersion] = useState("…");
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("dev"));
  }, []);

  if (!open) return null;

  const checkUpdates = async () => {
    setChecking(true);
    setUpdateMsg("Checking for updates…");
    try {
      const update = await check();
      if (update) {
        setUpdateMsg(`Update ${update.version} found — downloading…`);
        await update.downloadAndInstall((e) => {
          if (e.event === "Progress") setUpdateMsg(`Downloading update ${update.version}…`);
        });
        setUpdateMsg("Update installed — restarting…");
        await relaunch();
      } else {
        setUpdateMsg("You're on the latest version.");
      }
    } catch {
      setUpdateMsg("No update available (or the update server is unreachable).");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        className="ps-fade-in w-[420px] select-none rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Settings</h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <Field label="Appearance">
            <Segmented<ThemeMode>
              value={theme}
              onChange={setTheme}
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          </Field>

          <Field label="Updates">
            <div className="flex items-center gap-2">
              <button
                onClick={checkUpdates}
                disabled={checking}
                className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                <RefreshCw size={13} className={checking ? "animate-spin" : ""} />
                Check for updates
              </button>
              <span className="text-[11px] text-zinc-400">v{version}</span>
            </div>
            {updateMsg && (
              <p className="mt-2 text-[11px] leading-snug text-zinc-500">{updateMsg}</p>
            )}
          </Field>

          <p className="rounded-lg bg-zinc-100 p-3 text-[11px] leading-relaxed text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
            PDF Studio processes everything locally — files are never uploaded.
            Tip: you can drop files onto the app from Finder at any time, and
            outputs offer a one-click “Show in Finder”.
          </p>
        </div>
      </div>
    </div>
  );
}
