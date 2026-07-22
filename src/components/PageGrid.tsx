import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdf, renderThumbnail } from "../lib/pdf/engine";

/**
 * Thumbnail grid for page-level tools.
 *  - mode "select": click pages to toggle them (extract / delete)
 *  - mode "order":  drag thumbnails to rearrange
 */
export default function PageGrid(props: {
  data: Uint8Array;
  mode: "select" | "order";
  selection?: Set<number>;
  onToggle?: (page: number) => void;
  order?: number[];
  onReorder?: (order: number[]) => void;
}) {
  const [thumbs, setThumbs] = useState<(string | null)[]>([]);
  const [count, setCount] = useState(0);
  const dragFrom = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    let doc: PDFDocumentProxy | null = null;
    (async () => {
      doc = await loadPdf(props.data);
      if (!alive) return;
      setCount(doc.numPages);
      setThumbs(new Array(doc.numPages).fill(null));
      for (let p = 1; p <= doc.numPages; p++) {
        if (!alive) break;
        const url = await renderThumbnail(doc, p, 120);
        if (!alive) break;
        setThumbs((prev) => {
          const next = [...prev];
          next[p - 1] = url;
          return next;
        });
      }
    })();
    return () => {
      alive = false;
      doc?.destroy();
    };
  }, [props.data]);

  if (!count) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-400">
        <Loader2 size={16} className="animate-spin" /> Rendering pages…
      </div>
    );
  }

  const pages = props.mode === "order" ? (props.order ?? []) : Array.from({ length: count }, (_, i) => i + 1);

  const moveTo = (slot: number) => {
    if (props.mode !== "order" || dragFrom.current === null || dragFrom.current === slot) return;
    const order = [...(props.order ?? [])];
    const [moved] = order.splice(dragFrom.current, 1);
    order.splice(slot, 0, moved);
    dragFrom.current = slot;
    props.onReorder?.(order);
  };

  return (
    <div
      className="grid select-none grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3"
      onPointerUp={() => (dragFrom.current = null)}
      onPointerLeave={() => (dragFrom.current = null)}
    >
      {pages.map((pageNum, slot) => {
        const selected = props.selection?.has(pageNum) ?? false;
        return (
          <div
            key={`${pageNum}`}
            onClick={() => props.mode === "select" && props.onToggle?.(pageNum)}
            onPointerDown={(e) => {
              if (props.mode === "order") {
                e.preventDefault();
                dragFrom.current = slot;
              }
            }}
            onPointerEnter={() => moveTo(slot)}
            className={
              "group relative overflow-hidden rounded-lg border-2 bg-white shadow-sm transition-all dark:bg-zinc-900 " +
              (props.mode === "select" ? "cursor-pointer " : "cursor-grab active:cursor-grabbing ") +
              (selected
                ? "border-red-500 ring-2 ring-red-500/30"
                : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500")
            }
          >
            <div className="flex aspect-[3/4] items-center justify-center">
              {thumbs[pageNum - 1] ? (
                <img
                  src={thumbs[pageNum - 1]!}
                  alt={`Page ${pageNum}`}
                  className="max-h-full max-w-full object-contain"
                  draggable={false}
                />
              ) : (
                <Loader2 size={14} className="animate-spin text-zinc-300" />
              )}
            </div>
            <div className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {pageNum}
            </div>
            {props.mode === "select" && selected && (
              <div className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-red-500 text-white">
                <Check size={12} strokeWidth={3} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
