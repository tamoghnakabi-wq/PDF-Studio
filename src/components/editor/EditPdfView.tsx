import { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Highlighter,
  ImagePlus,
  Minus,
  MousePointer2,
  PenLine,
  Plus,
  Redo2,
  Save,
  Signature,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import type { ToolDef } from "../../tools";
import type { PickedFile, SavedOutput } from "../../lib/types";
import type { Ann, AnnMap, StrokeAnn } from "../../lib/pdf/annotate";
import { burnAnnotations } from "../../lib/pdf/annotate";
import { loadPdf, renderPageToCanvas } from "../../lib/pdf/engine";
import {
  openFile,
  pickFiles,
  pickSavePath,
  readBytes,
  revealInFinder,
  saveOutputToPath,
  toPickedFiles,
} from "../../lib/fsio";
import { basename, clamp, extOf, nextId } from "../../lib/utils";
import { useStore } from "../../lib/store";
import DropZone from "../DropZone";
import AnnotationLayer from "./AnnotationLayer";
import SignaturePad from "./SignaturePad";
import type { EditorTool } from "./editorTypes";

const BASE_W = 740; // CSS px page width at 100 % zoom

const HIGHLIGHT_COLORS = ["#ffe066", "#a5f3a5", "#9fd9ff", "#ffb3d9"];

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

export default function EditPdfView({ tool }: { tool: ToolDef }) {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pageMeta, setPageMeta] = useState<{ widthPts: number; heightPts: number }[]>([]);
  const [pageImgs, setPageImgs] = useState<(string | null)[]>([]);

  const [anns, setAnns] = useState<AnnMap>({});
  const annsRef = useRef<AnnMap>({});
  const committedRef = useRef<AnnMap>({});
  const [past, setPast] = useState<AnnMap[]>([]);
  const [future, setFuture] = useState<AnnMap[]>([]);

  const [toolMode, setToolMode] = useState<EditorTool>("select");
  const [color, setColor] = useState("#e5484d");
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [fontSize, setFontSize] = useState(14);
  const [strokeWidth, setStrokeWidth] = useState(2.4);
  const [zoom, setZoom] = useState(100);

  const [selected, setSelected] = useState<{ page: number; id: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sigOpen, setSigOpen] = useState(false);
  const [lastOutputs, setLastOutputs] = useState<SavedOutput[]>([]);
  const targetPageRef = useRef(0);

  const enqueue = useStore((s) => s.enqueue);
  const setQueueOpen = useStore((s) => s.setQueueOpen);
  const takePendingPaths = useStore((s) => s.takePendingPaths);
  const droppedPaths = useStore((s) => s.droppedPaths);
  const setDroppedPaths = useStore((s) => s.setDroppedPaths);

  /* ------------------------------ history core ------------------------------ */

  const update = useCallback((page: number, list: Ann[]) => {
    const next = { ...annsRef.current, [page]: list };
    annsRef.current = next;
    setAnns(next);
  }, []);

  const commit = useCallback(() => {
    // no-change gestures (e.g. plain clicks in select mode) must not pollute
    // the undo stack with duplicate snapshots
    if (JSON.stringify(annsRef.current) === JSON.stringify(committedRef.current)) return;
    // capture eagerly: the setPast updater runs after committedRef is reassigned
    const prevSnapshot = committedRef.current;
    setPast((p) => [...p.slice(-49), prevSnapshot]);
    setFuture([]);
    committedRef.current = structuredClone(annsRef.current);
  }, []);

  const restore = (snapshot: AnnMap) => {
    const restored = structuredClone(snapshot);
    committedRef.current = structuredClone(snapshot);
    annsRef.current = restored;
    setAnns(restored);
    setSelected(null);
    setEditingId(null);
  };

  const undo = () => {
    if (!past.length) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([...future, committedRef.current]);
    restore(prev);
  };

  const redo = () => {
    if (!future.length) return;
    const next = future[future.length - 1];
    setFuture(future.slice(0, -1));
    setPast([...past, committedRef.current]);
    restore(next);
  };

  const annCount = Object.values(anns).reduce((a, l) => a + l.length, 0);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__editorDebug = {
      past: past.map((s) => Object.values(s).reduce((a, l) => a + l.length, 0)),
      future: future.map((s) => Object.values(s).reduce((a, l) => a + l.length, 0)),
      committed: Object.values(committedRef.current).reduce((a, l) => a + l.length, 0),
      current: annCount,
    };
  }

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    update(selected.page, (annsRef.current[selected.page] ?? []).filter((a) => a.id !== selected.id));
    setSelected(null);
    commit();
  }, [selected, update, commit]);

  /* ------------------------------- file loading ------------------------------ */

  const loadFile = useCallback(async (picked: PickedFile) => {
    setFile(picked);
    setAnns({});
    annsRef.current = {};
    committedRef.current = {};
    setPast([]);
    setFuture([]);
    setSelected(null);
    setEditingId(null);
    setLastOutputs([]);
    setPageMeta([]);
    setPageImgs([]);
    const data = await readBytes(picked.path);
    setPdfData(data);
  }, []);

  const acceptPaths = useCallback(
    async (paths: string[]) => {
      const pdfs = paths.filter((p) => extOf(p) === "pdf");
      if (!pdfs.length) return;
      const [picked] = await toPickedFiles([pdfs[0]]);
      loadFile(picked);
    },
    [loadFile],
  );

  useEffect(() => {
    const pending = takePendingPaths();
    if (pending.length) acceptPaths(pending);
    // dev-only: the browser smoke harness can inject a synthetic document
    if (import.meta.env.DEV) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (window as any).__editTestPdf as Uint8Array | undefined;
      if (data) {
        setFile({ path: "/dev/test.pdf", name: "test.pdf", size: data.length });
        setPdfData(data);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (droppedPaths?.length) {
      setDroppedPaths(null);
      acceptPaths(droppedPaths);
    }
  }, [droppedPaths, acceptPaths, setDroppedPaths]);

  // render pages progressively
  useEffect(() => {
    if (!pdfData) return;
    let alive = true;
    (async () => {
      const doc = await loadPdf(pdfData);
      if (!alive) {
        doc.destroy();
        return;
      }
      const metas: { widthPts: number; heightPts: number }[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        metas.push({ widthPts: vp.width, heightPts: vp.height });
        page.cleanup();
      }
      if (!alive) {
        doc.destroy();
        return;
      }
      setPageMeta(metas);
      setPageImgs(new Array(doc.numPages).fill(null));
      for (let p = 1; p <= doc.numPages; p++) {
        if (!alive) break;
        const renderScale = (BASE_W / metas[p - 1].widthPts) * 2;
        const { canvas } = await renderPageToCanvas(doc, p, renderScale);
        const url = canvas.toDataURL("image/jpeg", 0.9);
        canvas.width = 0;
        if (!alive) break;
        setPageImgs((prev) => {
          const next = [...prev];
          next[p - 1] = url;
          return next;
        });
      }
      await doc.destroy();
    })();
    return () => {
      alive = false;
    };
  }, [pdfData]);

  /* ------------------------------ object insertion --------------------------- */

  const placeOnTarget = (build: (meta: { widthPts: number; heightPts: number }, page: number) => Ann) => {
    const page = clamp(targetPageRef.current, 0, Math.max(0, pageMeta.length - 1));
    const meta = pageMeta[page];
    if (!meta) return;
    const ann = build(meta, page);
    update(page, [...(annsRef.current[page] ?? []), ann]);
    setSelected({ page, id: ann.id });
    setToolMode("select");
    commit();
  };

  const addImage = async () => {
    const files = await pickFiles(["jpg", "jpeg", "png"], false);
    if (!files.length) return;
    const bytes = await readBytes(files[0].path);
    const mime = extOf(files[0].name) === "png" ? "image/png" : "image/jpeg";
    const blob = new Blob([bytes.slice() as BlobPart], { type: mime });
    const bmp = await createImageBitmap(blob);
    const dataUrl = bytesToDataUrl(bytes, mime);
    placeOnTarget((meta, _page) => {
      const w = Math.min(bmp.width * 0.75, meta.widthPts * 0.5);
      const h = (bmp.height / bmp.width) * w;
      bmp.close();
      return {
        id: nextId("ann"),
        kind: "image",
        x: (meta.widthPts - w) / 2,
        y: (meta.heightPts - h) / 2,
        w,
        h,
        dataUrl,
      };
    });
  };

  const addSignature = (strokes: { x: number; y: number }[][], w: number, h: number) => {
    setSigOpen(false);
    placeOnTarget((meta) => {
      const boxW = Math.min(170, meta.widthPts * 0.4);
      const boxH = (h / w) * boxW;
      const ann: StrokeAnn = {
        id: nextId("ann"),
        kind: "signature",
        x: (meta.widthPts - boxW) / 2,
        y: meta.heightPts - boxH - 90,
        w: boxW,
        h: boxH,
        baseW: w,
        baseH: h,
        points: strokes,
        color,
        width: 2.4 * (w / boxW || 1),
      };
      return ann;
    });
  };

  /* ---------------------------------- saving --------------------------------- */

  const save = async () => {
    if (!file || !pdfData || annCount === 0) return;
    const suggested = tool.suggestName(file.name, {});
    const path = await pickSavePath(suggested, "pdf");
    if (!path) return;
    const snapshot = structuredClone(annsRef.current);
    const data = pdfData;
    enqueue(tool.id, file.name, async (report) => {
      const out = await burnAnnotations(data, snapshot, (frac, msg) =>
        report(frac * 0.92, msg),
      );
      report(0.96, "Saving…");
      const saved = await saveOutputToPath(path, { name: basename(path), data: out });
      setLastOutputs([saved]);
      return [saved];
    });
    setQueueOpen(true);
  };

  /* --------------------------------- keyboard -------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "TEXTAREA" || target.tagName === "INPUT" || editingId !== null;
      if ((e.key === "Delete" || e.key === "Backspace") && !typing && selected) {
        e.preventDefault();
        deleteSelected();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------------------------------- render --------------------------------- */

  const Icon = tool.icon;

  if (!file) {
    return (
      <div className="ps-fade-in mx-auto w-full max-w-3xl px-8 py-8">
        <div className="mb-5 flex items-center gap-3">
          <span className={`flex size-11 items-center justify-center rounded-xl ${tool.tint}`}>
            <Icon size={22} />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-tight">{tool.name}</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{tool.tagline}</p>
          </div>
        </div>
        <DropZone accept={["pdf"]} multiple={false} onFiles={(f) => f[0] && loadFile(f[0])} />
      </div>
    );
  }

  const toolBtn = (active: boolean) =>
    "flex size-8 items-center justify-center rounded-lg transition-colors " +
    (active
      ? "bg-red-500 text-white shadow-sm"
      : "text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100");
  const iconBtn =
    "flex size-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-800 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

  return (
    <div className="ps-fade-in flex h-full flex-col">
      {/* toolbar */}
      <div className="sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-1.5 border-b border-zinc-200 bg-zinc-50/95 px-4 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <span className={`flex size-8 items-center justify-center rounded-lg ${tool.tint}`}>
          <Icon size={16} />
        </span>
        <span className="mr-2 max-w-44 select-none truncate text-xs font-semibold">{file.name}</span>

        <button className={toolBtn(toolMode === "select")} onClick={() => setToolMode("select")} title="Select / move">
          <MousePointer2 size={15} />
        </button>
        <button className={toolBtn(toolMode === "text")} onClick={() => setToolMode("text")} title="Add text — click the page">
          <Type size={15} />
        </button>
        <button className={toolBtn(toolMode === "highlight")} onClick={() => setToolMode("highlight")} title="Highlight — drag over the page">
          <Highlighter size={15} />
        </button>
        <button className={toolBtn(toolMode === "draw")} onClick={() => setToolMode("draw")} title="Draw freehand">
          <PenLine size={15} />
        </button>
        <button className={iconBtn} onClick={addImage} title="Insert image">
          <ImagePlus size={15} />
        </button>
        <button className={iconBtn} onClick={() => setSigOpen(true)} title="Add signature">
          <Signature size={15} />
        </button>

        <div className="mx-1 h-5 w-px bg-zinc-300 dark:bg-zinc-700" />

        {toolMode === "highlight" ? (
          <div className="flex items-center gap-1" title="Highlight color">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setHighlightColor(c)}
                className={
                  "size-5 rounded-full border " +
                  (highlightColor === c
                    ? "border-zinc-700 ring-2 ring-red-400/60 dark:border-zinc-200"
                    : "border-zinc-300 dark:border-zinc-600")
                }
                style={{ background: c }}
              />
            ))}
          </div>
        ) : (
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="size-7 cursor-pointer rounded-md border border-zinc-300 bg-transparent dark:border-zinc-700"
            title="Color"
          />
        )}

        {toolMode === "text" && (
          <label className="flex items-center gap-1 text-[11px] text-zinc-500">
            Size
            <input
              type="number"
              min={6}
              max={96}
              value={fontSize}
              onChange={(e) => setFontSize(clamp(Number(e.target.value) || 14, 6, 96))}
              className="w-14 rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        )}
        {toolMode === "draw" && (
          <label className="flex items-center gap-1 text-[11px] text-zinc-500">
            Width
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
              className="w-20 accent-red-500"
            />
          </label>
        )}

        <div className="mx-1 h-5 w-px bg-zinc-300 dark:bg-zinc-700" />

        <button className={iconBtn} onClick={undo} disabled={!past.length} title="Undo (⌘Z)">
          <Undo2 size={15} />
        </button>
        <button className={iconBtn} onClick={redo} disabled={!future.length} title="Redo (⇧⌘Z)">
          <Redo2 size={15} />
        </button>
        <button className={iconBtn} onClick={deleteSelected} disabled={!selected} title="Delete selected">
          <Trash2 size={15} />
        </button>

        <div className="mx-1 h-5 w-px bg-zinc-300 dark:bg-zinc-700" />
        <button className={iconBtn} onClick={() => setZoom((z) => Math.max(50, z - 25))} title="Zoom out">
          <Minus size={14} />
        </button>
        <span className="w-10 select-none text-center text-[11px] tabular-nums text-zinc-500">{zoom}%</span>
        <button className={iconBtn} onClick={() => setZoom((z) => Math.min(200, z + 25))} title="Zoom in">
          <Plus size={14} />
        </button>

        <div className="flex-1" />

        <button
          className={iconBtn}
          onClick={() => {
            setFile(null);
            setPdfData(null);
          }}
          title="Close file"
        >
          <X size={15} />
        </button>
        <button
          onClick={save}
          disabled={annCount === 0}
          className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-red-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save size={13} />
          Save PDF{annCount > 0 ? ` (${annCount})` : ""}
        </button>
      </div>

      {/* pages */}
      <div className="flex-1 overflow-y-auto bg-zinc-200/60 py-6 dark:bg-zinc-900/40">
        <div className="flex flex-col items-center gap-6 px-6">
          {pageMeta.map((meta, i) => (
            <div key={i}>
              <AnnotationLayer
                pageIndex={i}
                imgUrl={pageImgs[i] ?? null}
                widthPts={meta.widthPts}
                heightPts={meta.heightPts}
                k={(BASE_W * (zoom / 100)) / meta.widthPts}
                anns={anns[i] ?? []}
                selectedId={selected?.page === i ? selected.id : null}
                editingId={selected?.page === i ? editingId : null}
                tool={toolMode}
                color={color}
                highlightColor={highlightColor}
                fontSize={fontSize}
                strokeWidth={strokeWidth}
                onSelect={(id) => {
                  setSelected(id ? { page: i, id } : null);
                  if (!id) setEditingId(null);
                }}
                setEditingId={setEditingId}
                onUpdate={update}
                onCommit={commit}
                onInteract={(p) => (targetPageRef.current = p)}
              />
              <div className="mt-1.5 select-none text-center text-[11px] text-zinc-400">
                {i + 1} / {pageMeta.length}
              </div>
            </div>
          ))}
          {pageMeta.length === 0 && (
            <div className="py-16 text-sm text-zinc-400">Opening document…</div>
          )}
        </div>
      </div>

      {/* saved confirmation */}
      {lastOutputs.length > 0 && (
        <div className="ps-fade-in absolute bottom-4 right-4 z-30 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-white px-3 py-2 shadow-lg dark:bg-zinc-900">
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Saved {lastOutputs[0].name}
          </span>
          <button
            className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
            onClick={() => openFile(lastOutputs[0].path)}
          >
            Open
          </button>
          <button
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            onClick={() => revealInFinder(lastOutputs[0].path)}
            title="Show in Finder"
          >
            <FolderOpen size={13} />
          </button>
          <button
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            onClick={() => setLastOutputs([])}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {sigOpen && (
        <SignaturePad
          color={color}
          onCancel={() => setSigOpen(false)}
          onDone={addSignature}
        />
      )}
    </div>
  );
}
