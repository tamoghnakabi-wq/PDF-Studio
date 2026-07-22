import { LayoutGrid } from "lucide-react";
import { TOOLS, TOOL_GROUPS } from "../tools";
import { useStore } from "../lib/store";

export default function Sidebar() {
  const activeTool = useStore((s) => s.activeTool);
  const setActiveTool = useStore((s) => s.setActiveTool);

  return (
    <nav className="flex w-56 shrink-0 select-none flex-col gap-1 overflow-y-auto border-r border-zinc-200/80 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <button
        onClick={() => setActiveTool(null)}
        className={
          "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors " +
          (activeTool === null
            ? "bg-red-500/10 text-red-600 dark:text-red-400"
            : "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-900")
        }
      >
        <LayoutGrid size={15} />
        All tools
      </button>

      {TOOL_GROUPS.map((group) => (
        <div key={group} className="mt-3 first:mt-0">
          <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
            {group}
          </div>
          {TOOLS.filter((t) => t.group === group).map((tool) => {
            const Icon = tool.icon;
            const active = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                onClick={() => setActiveTool(tool.id)}
                className={
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors " +
                  (active
                    ? "bg-red-500/10 text-red-600 dark:text-red-400"
                    : "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-900")
                }
              >
                <Icon size={15} className={active ? "" : "opacity-70"} />
                {tool.name}
              </button>
            );
          })}
        </div>
      ))}

      <div className="mt-auto px-2.5 pt-4 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-600">
        100% offline — your files never leave this Mac.
      </div>
    </nav>
  );
}
