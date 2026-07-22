import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare, FolderOpen, Play, Square, Undo2, X } from "lucide-react";
import type { ToolDef } from "../tools";
import type { PickedFile, SavedOutput } from "../lib/types";
import { useStore } from "../lib/store";
import {
  pickDirectory,
  pickSavePath,
  readBytes,
  revealInFinder,
  saveOutputToPath,
  saveOutputsToDir,
  toPickedFiles,
  openFile,
} from "../lib/fsio";
import { dirname, extOf, formatBytes, pagesToRangeText, parsePageRanges } from "../lib/utils";
import { getPageCount } from "../lib/pdf/engine";
import DropZone from "./DropZone";
import FileList from "./FileList";
import PageGrid from "./PageGrid";
import { TextInput } from "./Field";

export default function ToolView({ tool }: { tool: ToolDef }) {
  const [files, setFiles] = useState<PickedFile[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [options, setOptions] = useState<any>(tool.defaults);
  const [error, setError] = useState<string | null>(null);
  const [lastOutputs, setLastOutputs] = useState<SavedOutput[]>([]);
  const [lastNote, setLastNote] = useState<string | null>(null);

  // page-tool state (single PDF)
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [order, setOrder] = useState<number[]>([]);
  const [rangeText, setRangeText] = useState("");

  const enqueue = useStore((s) => s.enqueue);
  const setQueueOpen = useStore((s) => s.setQueueOpen);
  const takePendingPaths = useStore((s) => s.takePendingPaths);
  const pushPendingPaths = useStore((s) => s.pushPendingPaths);
  const droppedPaths = useStore((s) => s.droppedPaths);
  const setDroppedPaths = useStore((s) => s.setDroppedPaths);

  const addFiles = useCallback(
    (picked: PickedFile[]) => {
      const accepted = picked.filter((f) => tool.accept.includes(extOf(f.name)));
      if (!accepted.length) {
        if (picked.length) {
          setError(
            `Only ${tool.accept.map((e) => "." + e).join(", ")} files can be used with ${tool.name}.`,
          );
        }
        return;
      }
      setError(null);
      setLastOutputs([]);
      setLastNote(null);
      setFiles((prev) => {
        if (!tool.multi) return [accepted[0]];
        const seen = new Set(prev.map((f) => f.path));
        return [...prev, ...accepted.filter((f) => !seen.has(f.path))];
      });
    },
    [tool],
  );

  // files waiting on the dashboard (drops / Finder "Open With") — types this
  // tool can't use go back to the pending pool instead of vanishing
  useEffect(() => {
    const pending = takePendingPaths();
    if (pending.length) {
      toPickedFiles(pending).then((picked) => {
        const rejected = picked.filter((f) => !tool.accept.includes(extOf(f.name)));
        if (rejected.length) pushPendingPaths(rejected.map((f) => f.path));
        addFiles(picked.filter((f) => tool.accept.includes(extOf(f.name))));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.id]);

  // files dropped while this tool is open
  useEffect(() => {
    if (droppedPaths && droppedPaths.length) {
      setDroppedPaths(null);
      toPickedFiles(droppedPaths).then(addFiles);
    }
  }, [droppedPaths, addFiles, setDroppedPaths]);

  // load page data for page-level tools
  useEffect(() => {
    if (!tool.pageMode || files.length === 0) {
      setPdfData(null);
      setPageCount(0);
      setSelection(new Set());
      setOrder([]);
      setRangeText("");
      return;
    }
    let alive = true;
    (async () => {
      try {
        const data = await readBytes(files[0].path);
        if (!alive) return;
        const count = await getPageCount(data);
        if (!alive) return;
        setPdfData(data);
        setPageCount(count);
        setSelection(new Set());
        setOrder(Array.from({ length: count }, (_, i) => i + 1));
        setRangeText("");
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [tool.pageMode, files]);

  const togglePage = (page: number) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      setRangeText(pagesToRangeText([...next]));
      return next;
    });
  };

  const onRangeText = (text: string) => {
    setRangeText(text);
    try {
      setSelection(new Set(parsePageRanges(text, pageCount)));
    } catch {
      /* keep typing */
    }
  };

  const totalSize = useMemo(() => files.reduce((a, f) => a + f.size, 0), [files]);
  const runningRef = useRef(false);

  const run = async () => {
    if (runningRef.current) return;
    setError(null);
    if (files.length < tool.minFiles) {
      setError(
        tool.minFiles > 1
          ? `Add at least ${tool.minFiles} files first.`
          : "Add a file first.",
      );
      return;
    }
    let pages: number[] | undefined;
    if (tool.pageMode === "select") {
      pages = [...selection].sort((a, b) => a - b);
      if (!pages.length) {
        setError("Select at least one page first.");
        return;
      }
    } else if (tool.pageMode === "order") {
      pages = order;
    }

    // Decide where results go *before* the job starts.
    const plan = tool.outputPlan(files.length, options);
    let savePath: string | null = null;
    let saveDir: string | null = null;
    if (plan === "one") {
      const suggested = tool.suggestName(files[0].name, options);
      savePath = await pickSavePath(suggested, extOf(suggested) || "pdf");
      if (!savePath) return;
    } else {
      saveDir = await pickDirectory("Choose where to save the results");
      if (!saveDir) return;
    }

    const label = files.length === 1 ? files[0].name : `${files.length} files`;
    const snapshot = { files: [...files], options, pages };
    runningRef.current = true;
    setLastNote(null);
    enqueue(tool.id, label, async (report, setNote) => {
      try {
        report(0.01, "Reading input files…");
        const loaded = [];
        for (const f of snapshot.files) {
          loaded.push({ ...f, data: await readBytes(f.path) });
        }
        let note: string | null = null;
        const outputs = await tool.run({
          files: loaded,
          options: snapshot.options,
          pages: snapshot.pages,
          progress: (frac, msg) => report(0.02 + frac * 0.93, msg),
          setNote: (msg) => {
            note = msg;
            setNote(msg);
          },
        });
        if (!outputs.length && !note) throw new Error("Nothing was produced");
        report(0.97, "Saving…");
        let saved: SavedOutput[];
        if (savePath && outputs.length) {
          saved = [await saveOutputToPath(savePath, outputs[0])];
          if (outputs.length > 1) {
            saved = saved.concat(await saveOutputsToDir(dirname(savePath), outputs.slice(1)));
          }
        } else if (outputs.length) {
          saved = await saveOutputsToDir(saveDir!, outputs);
        } else {
          saved = [];
        }
        setLastOutputs(saved);
        setLastNote(note);
        return saved;
      } finally {
        runningRef.current = false;
      }
    });
    setQueueOpen(true);
  };

  const Icon = tool.icon;
  const OptionsComp = tool.Options;

  return (
    <div className="ps-fade-in mx-auto flex w-full max-w-6xl gap-6 px-8 py-8">
      {/* main column */}
      <div className="min-w-0 flex-1">
        <div className="mb-5 flex items-center gap-3">
          <span className={`flex size-11 items-center justify-center rounded-xl ${tool.tint}`}>
            <Icon size={22} />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-tight">{tool.name}</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{tool.tagline}</p>
          </div>
        </div>

        {files.length === 0 ? (
          <DropZone accept={tool.accept} multiple={tool.multi} onFiles={addFiles} />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>
                {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(totalSize)}
                {pageCount > 0 && ` · ${pageCount} pages`}
              </span>
              <button
                className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-zinc-200/60 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                onClick={() => setFiles([])}
              >
                <X size={12} /> Clear
              </button>
            </div>

            {!tool.pageMode && (
              <>
                <FileList
                  files={files}
                  reorderable={tool.id === "merge" || tool.id === "img2pdf"}
                  onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  onMove={(i, dir) =>
                    setFiles((prev) => {
                      const next = [...prev];
                      const [m] = next.splice(i, 1);
                      next.splice(i + dir, 0, m);
                      return next;
                    })
                  }
                />
                {tool.multi && (
                  <DropZone accept={tool.accept} multiple compact onFiles={addFiles} />
                )}
              </>
            )}

            {tool.pageMode && pdfData && (
              <>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{tool.pageHint}</p>
                {tool.pageMode === "select" && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <TextInput
                        value={rangeText}
                        placeholder="Pages, e.g. 1-3, 5"
                        onChange={onRangeText}
                      />
                    </div>
                    <button
                      className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      onClick={() => {
                        const all = new Set(Array.from({ length: pageCount }, (_, i) => i + 1));
                        const target = selection.size === pageCount ? new Set<number>() : all;
                        setSelection(target);
                        setRangeText(pagesToRangeText([...target]));
                      }}
                    >
                      {selection.size === pageCount ? <Square size={13} /> : <CheckSquare size={13} />}
                      {selection.size === pageCount ? "None" : "All"}
                    </button>
                  </div>
                )}
                {tool.pageMode === "order" && (
                  <div className="flex items-center gap-2">
                    <button
                      className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      onClick={() => setOrder((prev) => [...prev].reverse())}
                    >
                      <Undo2 size={13} /> Reverse
                    </button>
                    <button
                      className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      onClick={() => setOrder(Array.from({ length: pageCount }, (_, i) => i + 1))}
                    >
                      Reset order
                    </button>
                  </div>
                )}
                <PageGrid
                  data={pdfData}
                  mode={tool.pageMode}
                  selection={selection}
                  onToggle={togglePage}
                  order={order}
                  onReorder={setOrder}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* options column */}
      <aside className="w-72 shrink-0">
        <div className="sticky top-0 flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Options
          </h2>
          {OptionsComp ? (
            <OptionsComp value={options} onChange={setOptions} />
          ) : (
            <p className="text-xs text-zinc-400">No options — just hit run.</p>
          )}

          <button
            onClick={run}
            disabled={files.length < tool.minFiles}
            className="flex items-center justify-center gap-2 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-red-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play size={15} />
            {tool.name}
          </button>

          {error && <p className="text-xs leading-snug text-red-500">{error}</p>}

          {lastNote && (
            <div className="rounded-xl bg-amber-500/10 p-3">
              <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                {lastNote}
              </p>
            </div>
          )}

          {lastOutputs.length > 0 && (
            <div className="rounded-xl bg-emerald-500/10 p-3">
              <p className="mb-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                Done — {lastOutputs.length} file{lastOutputs.length === 1 ? "" : "s"} saved
              </p>
              <div className="flex flex-col gap-1">
                {lastOutputs.slice(0, 4).map((o) => (
                  <div key={o.path} className="flex items-center gap-1.5 text-[11px]">
                    <button
                      onClick={() => openFile(o.path)}
                      className="min-w-0 flex-1 truncate text-left text-zinc-600 hover:underline dark:text-zinc-300"
                    >
                      {o.name}
                    </button>
                    <button
                      onClick={() => revealInFinder(o.path)}
                      className="shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      title="Show in Finder"
                    >
                      <FolderOpen size={12} />
                    </button>
                  </div>
                ))}
                {lastOutputs.length > 4 && (
                  <button
                    onClick={() => revealInFinder(lastOutputs[0].path)}
                    className="text-left text-[11px] text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    Show all {lastOutputs.length} in Finder
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
