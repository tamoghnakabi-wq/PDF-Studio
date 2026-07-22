import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, FileText, X } from "lucide-react";
import type { PickedFile } from "../lib/types";
import { extOf, formatBytes } from "../lib/utils";
import { readBytes } from "../lib/fsio";
import { loadPdf, renderThumbnail } from "../lib/pdf/engine";

const thumbCache = new Map<string, Promise<string | null>>();
const MAX_CACHED_THUMBS = 300;

function getThumb(path: string): Promise<string | null> {
  let p = thumbCache.get(path);
  if (!p) {
    if (thumbCache.size >= MAX_CACHED_THUMBS) {
      // drop the oldest entry — Map preserves insertion order
      const oldest = thumbCache.keys().next().value;
      if (oldest !== undefined) thumbCache.delete(oldest);
    }
    p = (async () => {
      try {
        const ext = extOf(path);
        const bytes = await readBytes(path);
        if (ext === "pdf") {
          const doc = await loadPdf(bytes);
          const url = await renderThumbnail(doc, 1, 80);
          await doc.destroy();
          return url;
        }
        if (["jpg", "jpeg", "png"].includes(ext)) {
          const blob = new Blob([bytes.slice() as BlobPart]);
          const bmp = await createImageBitmap(blob);
          const k = 80 / Math.max(bmp.width, bmp.height);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(bmp.width * k));
          canvas.height = Math.max(1, Math.round(bmp.height * k));
          canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
          bmp.close();
          return canvas.toDataURL("image/jpeg", 0.8);
        }
        return null;
      } catch {
        return null;
      }
    })();
    thumbCache.set(path, p);
  }
  return p;
}

function Thumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getThumb(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);
  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
      {url ? (
        <img src={url} alt="" className="size-full object-contain" draggable={false} />
      ) : (
        <FileText size={16} className="text-zinc-400" />
      )}
    </div>
  );
}

export default function FileList(props: {
  files: PickedFile[];
  reorderable?: boolean;
  onRemove: (index: number) => void;
  onMove?: (index: number, dir: -1 | 1) => void;
}) {
  return (
    <ul className="flex select-none flex-col gap-1.5">
      {props.files.map((f, i) => (
        <li
          key={f.path + i}
          className="ps-fade-in group flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <span className="w-5 text-center text-xs font-semibold text-zinc-400">{i + 1}</span>
          <Thumb path={f.path} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{f.name}</div>
            <div className="text-[11px] text-zinc-400">{formatBytes(f.size)}</div>
          </div>
          {props.reorderable && (
            <div className="flex flex-col opacity-0 transition-opacity group-hover:opacity-100">
              <button
                className="text-zinc-400 hover:text-zinc-700 disabled:opacity-30 dark:hover:text-zinc-200"
                disabled={i === 0}
                onClick={() => props.onMove?.(i, -1)}
                title="Move up"
              >
                <ChevronUp size={14} />
              </button>
              <button
                className="text-zinc-400 hover:text-zinc-700 disabled:opacity-30 dark:hover:text-zinc-200"
                disabled={i === props.files.length - 1}
                onClick={() => props.onMove?.(i, 1)}
                title="Move down"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          )}
          <button
            className="rounded-md p-1 text-zinc-400 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
            onClick={() => props.onRemove(i)}
            title="Remove"
          >
            <X size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}
