import { useEffect } from "react";
import { FileUp } from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import Titlebar from "./components/Titlebar";
import Sidebar from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import ToolView from "./components/ToolView";
import QueuePanel from "./components/QueuePanel";
import SettingsModal from "./components/SettingsModal";
import { useStore } from "./lib/store";
import { takeOpenedFiles } from "./lib/fsio";
import { isTauri } from "./lib/utils";
import { toolById } from "./tools";

function routeIncomingPaths(paths: string[]) {
  if (!paths.length) return;
  const { activeTool, setDroppedPaths, pushPendingPaths } = useStore.getState();
  if (activeTool) setDroppedPaths(paths);
  else pushPendingPaths(paths);
}

export default function App() {
  const theme = useStore((s) => s.theme);
  const activeTool = useStore((s) => s.activeTool);
  const dragHover = useStore((s) => s.dragHover);
  const setDragHover = useStore((s) => s.setDragHover);

  // dark mode: follow the explicit choice, or the system
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  // native drag & drop from Finder
  useEffect(() => {
    if (!isTauri) return;
    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setDragHover(true);
      } else if (event.payload.type === "drop") {
        setDragHover(false);
        routeIncomingPaths(event.payload.paths);
      } else {
        setDragHover(false);
      }
    });
    return () => {
      unlistenPromise.then((un) => un());
    };
  }, [setDragHover]);

  // Finder "Open With…" / dock drops
  useEffect(() => {
    if (!isTauri) return;
    takeOpenedFiles().then(routeIncomingPaths);
    const unlistenPromise = listen<string[]>("files-opened", (e) =>
      routeIncomingPaths(e.payload),
    );
    return () => {
      unlistenPromise.then((un) => un());
    };
  }, []);

  const tool = toolById(activeTool);

  return (
    <div className="flex h-full flex-col bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Titlebar />
      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative min-w-0 flex-1 overflow-y-auto bg-zinc-100 dark:bg-zinc-950">
          {tool ? (
            tool.Custom ? (
              <tool.Custom key={tool.id} tool={tool} />
            ) : (
              <ToolView key={tool.id} tool={tool} />
            )
          ) : (
            <Dashboard />
          )}
        </main>
        <QueuePanel />
        <SettingsModal />

        {dragHover && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-red-500/10 backdrop-blur-[1px]">
            <div className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-red-400 bg-white/95 px-8 py-5 shadow-2xl dark:bg-zinc-900/95">
              <FileUp className="text-red-500" size={22} />
              <span className="text-sm font-semibold">
                Drop files to {tool ? `add them to ${tool.name}` : "get started"}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
