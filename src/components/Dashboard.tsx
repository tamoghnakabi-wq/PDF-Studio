import { FileUp } from "lucide-react";
import { TOOLS, TOOL_GROUPS } from "../tools";
import { useStore } from "../lib/store";

export default function Dashboard() {
  const setActiveTool = useStore((s) => s.setActiveTool);
  const pending = useStore((s) => s.pendingPaths);

  return (
    <div className="ps-fade-in mx-auto w-full max-w-5xl select-none px-8 py-8">
      <h1 className="text-2xl font-bold tracking-tight">
        Every PDF tool you need.
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Merge, split, compress, convert and more — fast, private, and fully
        offline.
      </p>

      <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-100/60 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-400">
        <FileUp size={16} className="shrink-0" />
        {pending.length > 0 ? (
          <span>
            <b className="text-zinc-700 dark:text-zinc-200">
              {pending.length} file{pending.length === 1 ? "" : "s"} ready
            </b>{" "}
            — pick a tool below to use {pending.length === 1 ? "it" : "them"}.
          </span>
        ) : (
          <span>Drop files anywhere, or pick a tool to get started.</span>
        )}
      </div>

      {TOOL_GROUPS.map((group) => (
        <section key={group} className="mt-8">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
            {group}
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {TOOLS.filter((t) => t.group === group).map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={() => setActiveTool(tool.id)}
                  className="group flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                >
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tool.tint}`}>
                    <Icon size={18} />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{tool.name}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-zinc-500 dark:text-zinc-400">
                      {tool.tagline}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
