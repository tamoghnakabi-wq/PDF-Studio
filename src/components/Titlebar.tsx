import { ListChecks, Moon, Settings, Sun, MonitorSmartphone } from "lucide-react";
import { useStore } from "../lib/store";

export default function Titlebar() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const setQueueOpen = useStore((s) => s.setQueueOpen);
  const queueOpen = useStore((s) => s.queueOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const jobs = useStore((s) => s.jobs);
  const active = jobs.filter((j) => j.status === "running" || j.status === "queued").length;

  const cycleTheme = () => {
    setTheme(theme === "system" ? "light" : theme === "light" ? "dark" : "system");
  };

  const btn =
    "flex size-7 items-center justify-center rounded-md text-zinc-500 transition-colors " +
    "hover:bg-zinc-200/70 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

  return (
    <header
      data-tauri-drag-region
      className="flex h-11 shrink-0 select-none items-center border-b border-zinc-200/80 bg-zinc-50/90 pr-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90"
    >
      {/* room for the macOS traffic lights */}
      <div data-tauri-drag-region className="w-20" />
      <div data-tauri-drag-region className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <span data-tauri-drag-region className="flex size-5 items-center justify-center rounded-md bg-red-500 text-[10px] font-bold text-white">
          P
        </span>
        <span data-tauri-drag-region>PDF Studio</span>
      </div>
      <div data-tauri-drag-region className="flex-1" />
      <div className="flex items-center gap-1.5">
        <button
          className={btn + (queueOpen ? " bg-zinc-200/70 dark:bg-zinc-800" : "")}
          onClick={() => setQueueOpen(!queueOpen)}
          title="Task queue"
        >
          <span className="relative">
            <ListChecks size={16} />
            {active > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex size-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                {active}
              </span>
            )}
          </span>
        </button>
        <button className={btn} onClick={cycleTheme} title={`Theme: ${theme}`}>
          {theme === "dark" ? <Moon size={16} /> : theme === "light" ? <Sun size={16} /> : <MonitorSmartphone size={16} />}
        </button>
        <button className={btn} onClick={() => setSettingsOpen(true)} title="Settings">
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
