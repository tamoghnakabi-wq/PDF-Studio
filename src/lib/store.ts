import { create } from "zustand";
import type { QueueJob, SavedOutput, ThemeMode, ProgressFn } from "./types";
import { nextId } from "./utils";

interface AppState {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;

  activeTool: string | null; // null = dashboard
  setActiveTool: (id: string | null) => void;

  /** Paths dropped on the dashboard (or sent by Finder) waiting for a tool. */
  pendingPaths: string[];
  pushPendingPaths: (paths: string[]) => void;
  takePendingPaths: () => string[];

  /** Paths dropped while a tool is open — the tool view consumes these. */
  droppedPaths: string[] | null;
  setDroppedPaths: (paths: string[] | null) => void;

  dragHover: boolean;
  setDragHover: (v: boolean) => void;

  queueOpen: boolean;
  setQueueOpen: (v: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;

  jobs: QueueJob[];
  enqueue: (
    toolId: string,
    label: string,
    task: (report: ProgressFn, setNote: (note: string) => void) => Promise<SavedOutput[]>,
  ) => string;
  clearFinishedJobs: () => void;
}

const THEME_KEY = "pdfstudio.theme";

function loadTheme(): ThemeMode {
  const t = localStorage.getItem(THEME_KEY);
  return t === "light" || t === "dark" || t === "system" ? t : "system";
}

export const useStore = create<AppState>((set, get) => ({
  theme: loadTheme(),
  setTheme: (t) => {
    localStorage.setItem(THEME_KEY, t);
    set({ theme: t });
  },

  activeTool: null,
  setActiveTool: (id) => set({ activeTool: id }),

  pendingPaths: [],
  pushPendingPaths: (paths) =>
    set((s) => ({ pendingPaths: [...s.pendingPaths, ...paths] })),
  takePendingPaths: () => {
    const p = get().pendingPaths;
    if (p.length) set({ pendingPaths: [] });
    return p;
  },

  droppedPaths: null,
  setDroppedPaths: (paths) => set({ droppedPaths: paths }),

  dragHover: false,
  setDragHover: (v) => set({ dragHover: v }),

  queueOpen: false,
  setQueueOpen: (v) => set({ queueOpen: v }),
  settingsOpen: false,
  setSettingsOpen: (v) => set({ settingsOpen: v }),

  jobs: [],
  enqueue: (toolId, label, task) => {
    const id = nextId("job");
    const job: QueueJob = {
      id,
      toolId,
      label,
      status: "queued",
      progress: 0,
      outputs: [],
    };
    set((s) => ({ jobs: [job, ...s.jobs] }));
    scheduleJob(id, task);
    return id;
  },
  clearFinishedJobs: () =>
    set((s) => ({
      jobs: s.jobs.filter((j) => j.status === "queued" || j.status === "running"),
    })),
}));

function patchJob(id: string, patch: Partial<QueueJob>) {
  useStore.setState((s) => ({
    jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
  }));
}

/** Jobs run one at a time so heavy PDF work doesn't thrash the machine. */
let chain: Promise<void> = Promise.resolve();

function scheduleJob(
  id: string,
  task: (report: ProgressFn, setNote: (note: string) => void) => Promise<SavedOutput[]>,
) {
  chain = chain.then(async () => {
    patchJob(id, { status: "running", startedAt: Date.now(), message: "Starting…" });
    const report: ProgressFn = (frac, message) => {
      patchJob(id, {
        progress: Math.min(Math.max(frac, 0), 1),
        ...(message !== undefined ? { message } : {}),
      });
    };
    let note: string | undefined;
    try {
      const outputs = await task(report, (n) => (note = n));
      patchJob(id, {
        status: "done",
        progress: 1,
        outputs,
        message:
          note ??
          (outputs.length
            ? `${outputs.length} file${outputs.length === 1 ? "" : "s"} saved`
            : "Done"),
        finishedAt: Date.now(),
      });
    } catch (e) {
      patchJob(id, {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
        message: "Failed",
        finishedAt: Date.now(),
      });
    }
  });
}
