import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FolderOpen,
  Loader2,
  Trash,
  X,
} from "lucide-react";
import { useStore } from "../lib/store";
import { openFile, revealInFinder } from "../lib/fsio";
import { formatBytes } from "../lib/utils";
import { toolById } from "../tools";

export default function QueuePanel() {
  const open = useStore((s) => s.queueOpen);
  const setOpen = useStore((s) => s.setQueueOpen);
  const jobs = useStore((s) => s.jobs);
  const clearFinished = useStore((s) => s.clearFinishedJobs);

  if (!open) return null;

  return (
    <aside className="ps-fade-in absolute inset-y-0 right-0 z-30 flex w-96 select-none flex-col border-l border-zinc-200 bg-white/95 shadow-2xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Task queue</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={clearFinished}
            title="Clear finished"
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            <Trash size={14} />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {jobs.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-zinc-400">
            Nothing here yet — run a tool and its progress will show up.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {jobs.map((job) => {
            const tool = toolById(job.toolId);
            return (
              <li
                key={job.id}
                className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-center gap-2">
                  {job.status === "running" && (
                    <Loader2 size={14} className="shrink-0 animate-spin text-red-500" />
                  )}
                  {job.status === "queued" && <Clock size={14} className="shrink-0 text-zinc-400" />}
                  {job.status === "done" && (
                    <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />
                  )}
                  {job.status === "error" && (
                    <AlertCircle size={14} className="shrink-0 text-red-500" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {tool?.name ?? job.toolId} — {job.label}
                  </span>
                </div>

                {(job.status === "running" || job.status === "queued") && (
                  <>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-red-500 transition-[width] duration-200"
                        style={{ width: `${Math.round(job.progress * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1.5 truncate text-[11px] text-zinc-400">{job.message}</div>
                  </>
                )}

                {job.status === "error" && (
                  <p className="mt-1.5 text-[11px] leading-snug text-red-500">{job.error}</p>
                )}

                {job.status === "done" && job.message && (
                  <p className="mt-1.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                    {job.message}
                  </p>
                )}

                {job.status === "done" && job.outputs.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {job.outputs.slice(0, 8).map((out) => (
                      <li key={out.path} className="flex items-center gap-1.5 text-[11px]">
                        <button
                          className="min-w-0 flex-1 truncate text-left text-zinc-600 hover:text-red-500 hover:underline dark:text-zinc-300"
                          onClick={() => openFile(out.path)}
                          title={`Open ${out.name}`}
                        >
                          {out.name}
                        </button>
                        <span className="shrink-0 text-zinc-400">{formatBytes(out.size)}</span>
                        <button
                          className="shrink-0 rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                          onClick={() => revealInFinder(out.path)}
                          title="Show in Finder"
                        >
                          <FolderOpen size={12} />
                        </button>
                      </li>
                    ))}
                    {job.outputs.length > 8 && (
                      <li className="text-[11px] text-zinc-400">
                        … and {job.outputs.length - 8} more —{" "}
                        <button
                          className="underline hover:text-red-500"
                          onClick={() => revealInFinder(job.outputs[0].path)}
                        >
                          show all in Finder
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
