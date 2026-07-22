import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Loader2 } from "lucide-react";
import type { Ann, StrokeAnn, TextAnn } from "../../lib/pdf/annotate";
import { LINE_HEIGHT, strokesBounds } from "../../lib/pdf/annotate";
import { clamp, nextId } from "../../lib/utils";
import type { EditorTool } from "./editorTypes";

interface Props {
  pageIndex: number;
  imgUrl: string | null;
  widthPts: number;
  heightPts: number;
  /** points → CSS pixels */
  k: number;
  anns: Ann[];
  selectedId: string | null;
  editingId: string | null;
  tool: EditorTool;
  color: string;
  highlightColor: string;
  fontSize: number;
  strokeWidth: number;
  onSelect: (id: string | null) => void;
  setEditingId: (id: string | null) => void;
  onUpdate: (pageIndex: number, anns: Ann[]) => void;
  onCommit: () => void;
  onInteract: (pageIndex: number) => void;
}

type Gesture =
  | { mode: "move" | "resize"; id: string; startX: number; startY: number; orig: Ann }
  | null;

/** Pointer capture can fail for vanished/synthetic pointers — never fatal. */
function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* gesture still works through bubbling events */
  }
}

export default function AnnotationLayer(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture>(null);
  const [draftStroke, setDraftStroke] = useState<{ x: number; y: number }[] | null>(null);
  const [draftRect, setDraftRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const { k } = props;
  const toPt = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / k, 0, props.widthPts),
      y: clamp((e.clientY - r.top) / k, 0, props.heightPts),
    };
  };

  const patch = (id: string, changes: Partial<Ann>) => {
    props.onUpdate(
      props.pageIndex,
      props.anns.map((a) => (a.id === id ? ({ ...a, ...changes } as Ann) : a)),
    );
  };

  const append = (ann: Ann) => props.onUpdate(props.pageIndex, [...props.anns, ann]);
  const remove = (id: string) => {
    props.onUpdate(props.pageIndex, props.anns.filter((a) => a.id !== id));
    props.onSelect(null);
    props.onCommit();
  };

  /* ------------------------- container-level gestures ------------------------ */

  const onContainerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    props.onInteract(props.pageIndex);
    if (e.target !== e.currentTarget && props.tool === "select") return;
    const pt = toPt(e);
    if (props.tool === "text") {
      // Creation happens in onContainerClick, AFTER the click completes:
      // WKWebView's default mouseup focus handling would otherwise blur the
      // freshly-focused textarea and the empty box would self-delete.
      // preventDefault suppresses that default focus behavior entirely.
      e.preventDefault();
    } else if (props.tool === "highlight") {
      capture(e.currentTarget, e.pointerId);
      setDraftRect({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
    } else if (props.tool === "draw") {
      capture(e.currentTarget, e.pointerId);
      setDraftStroke([pt]);
    } else {
      props.onSelect(null);
    }
  };

  const onContainerMove = (e: React.PointerEvent) => {
    if (draftRect) {
      const pt = toPt(e);
      setDraftRect({ ...draftRect, x1: pt.x, y1: pt.y });
    } else if (draftStroke) {
      setDraftStroke([...draftStroke, toPt(e)]);
    }
  };

  const onContainerClick = (e: React.MouseEvent) => {
    if (props.tool !== "text") return;
    const pt = toPt(e);
    const ann: TextAnn = {
      id: nextId("ann"),
      kind: "text",
      x: pt.x,
      y: pt.y,
      w: 180,
      h: props.fontSize * LINE_HEIGHT,
      text: "",
      size: props.fontSize,
      color: props.color,
    };
    append(ann);
    props.onSelect(ann.id);
    props.setEditingId(ann.id);
  };

  const onContainerUp = () => {
    if (draftRect) {
      const x = Math.min(draftRect.x0, draftRect.x1);
      const y = Math.min(draftRect.y0, draftRect.y1);
      const w = Math.abs(draftRect.x1 - draftRect.x0);
      const h = Math.abs(draftRect.y1 - draftRect.y0);
      if (w >= 3 && h >= 3) {
        append({ id: nextId("ann"), kind: "highlight", x, y, w, h, color: props.highlightColor });
        props.onCommit();
      }
      setDraftRect(null);
    }
    if (draftStroke) {
      if (draftStroke.length > 1) {
        const b = strokesBounds([draftStroke])!;
        const ann: StrokeAnn = {
          id: nextId("ann"),
          kind: "draw",
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
          baseW: b.w,
          baseH: b.h,
          points: [draftStroke.map((p) => ({ x: p.x - b.x, y: p.y - b.y }))],
          color: props.color,
          width: props.strokeWidth,
        };
        append(ann);
        props.onCommit();
      }
      setDraftStroke(null);
    }
  };

  /* --------------------------- object-level gestures ------------------------- */

  const startObjectGesture = (
    e: React.PointerEvent,
    ann: Ann,
    mode: "move" | "resize",
  ) => {
    if (props.tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    props.onSelect(ann.id);
    const pt = toPt(e);
    gestureRef.current = { mode, id: ann.id, startX: pt.x, startY: pt.y, orig: { ...ann } };
    capture(e.currentTarget as HTMLElement, e.pointerId);
  };

  const onObjectMove = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    const pt = toPt(e);
    const dx = pt.x - g.startX;
    const dy = pt.y - g.startY;
    if (g.mode === "move") {
      patch(g.id, {
        x: clamp(g.orig.x + dx, -g.orig.w / 2, props.widthPts - g.orig.w / 2),
        y: clamp(g.orig.y + dy, -g.orig.h / 2, props.heightPts - g.orig.h / 2),
      });
    } else {
      patch(g.id, {
        w: Math.max(10, g.orig.w + dx),
        h: Math.max(10, g.orig.h + dy),
      });
    }
  };

  const onObjectUp = () => {
    if (gestureRef.current) {
      gestureRef.current = null;
      props.onCommit();
    }
  };

  /* --------------------------------- render --------------------------------- */

  const cursor =
    props.tool === "text"
      ? "text"
      : props.tool === "select"
        ? "default"
        : "crosshair";

  return (
    <div
      ref={ref}
      data-page-index={props.pageIndex}
      className="relative mx-auto overflow-hidden rounded-md bg-white shadow-md ring-1 ring-black/10 dark:ring-white/10"
      style={{
        width: props.widthPts * k,
        height: props.heightPts * k,
        cursor,
        touchAction: "none",
      }}
      onPointerDown={onContainerDown}
      onPointerMove={onContainerMove}
      onPointerUp={onContainerUp}
      onClick={onContainerClick}
    >
      {props.imgUrl ? (
        <img
          src={props.imgUrl}
          alt={`Page ${props.pageIndex + 1}`}
          className="pointer-events-none absolute inset-0 size-full select-none"
          draggable={false}
          style={{ WebkitUserSelect: "none" }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={18} className="animate-spin text-zinc-300" />
        </div>
      )}

      {props.anns.map((ann) => {
        const selected = props.selectedId === ann.id;
        const editing = props.editingId === ann.id;
        const base: React.CSSProperties = {
          position: "absolute",
          left: ann.x * k,
          top: ann.y * k,
          width: ann.w * k,
          height: ann.h * k,
          pointerEvents: props.tool === "select" ? "auto" : "none",
        };
        const frame = selected
          ? " outline outline-2 outline-red-500/80 outline-offset-1"
          : props.tool === "select"
            ? " hover:outline hover:outline-1 hover:outline-red-400/60"
            : "";

        if (ann.kind === "text" && editing) {
          return (
            <textarea
              key={ann.id}
              autoFocus
              ref={(el) => {
                // focus + caret at end when editing starts; re-assert once on
                // the next tick in case the originating click steals focus back
                if (el && el.dataset.caretInit !== "1") {
                  el.dataset.caretInit = "1";
                  const focusIt = () => {
                    el.focus({ preventScroll: true });
                    const n = el.value.length;
                    el.setSelectionRange(n, n);
                  };
                  focusIt();
                  setTimeout(focusIt, 0);
                }
              }}
              value={ann.text}
              spellCheck={false}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                const text = e.target.value;
                const lines = text.split("\n");
                const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
                patch(ann.id, {
                  text,
                  w: Math.max(120, longest * ann.size * 0.62 + 14),
                  h: Math.max(1, lines.length) * ann.size * LINE_HEIGHT + 6,
                } as Partial<Ann>);
              }}
              onBlur={() => {
                props.setEditingId(null);
                if (!ann.text.trim()) {
                  props.onUpdate(props.pageIndex, props.anns.filter((a) => a.id !== ann.id));
                  props.onSelect(null);
                }
                props.onCommit();
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
              }}
              style={{
                ...base,
                pointerEvents: "auto",
                fontSize: ann.size * k,
                lineHeight: LINE_HEIGHT,
                color: ann.color,
                fontFamily: "Helvetica, Arial, sans-serif",
                WebkitUserSelect: "text",
                userSelect: "text",
              }}
              className="resize-none overflow-hidden rounded-sm bg-transparent p-0 outline-dashed outline-1 outline-red-400"
            />
          );
        }

        return (
          <div
            key={ann.id}
            style={base}
            className={"group select-none" + frame}
            onPointerDown={(e) => startObjectGesture(e, ann, "move")}
            onPointerMove={onObjectMove}
            onPointerUp={onObjectUp}
            onDoubleClick={() => ann.kind === "text" && props.setEditingId(ann.id)}
          >
            {ann.kind === "highlight" && (
              <div
                className="size-full"
                style={{ background: ann.color, opacity: 0.4, mixBlendMode: "multiply" }}
              />
            )}
            {ann.kind === "text" && (
              <div
                className="size-full whitespace-pre-wrap"
                style={{
                  fontSize: ann.size * k,
                  lineHeight: LINE_HEIGHT,
                  color: ann.color,
                  fontFamily: "Helvetica, Arial, sans-serif",
                }}
              >
                {ann.text}
              </div>
            )}
            {ann.kind === "image" && (
              <img src={ann.dataUrl} alt="" className="size-full" draggable={false} />
            )}
            {(ann.kind === "draw" || ann.kind === "signature") && (
              <svg
                viewBox={`0 0 ${ann.baseW} ${ann.baseH}`}
                preserveAspectRatio="none"
                className="size-full overflow-visible"
              >
                {ann.points.map((stroke, i) => (
                  <polyline
                    key={i}
                    points={stroke.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={ann.color}
                    strokeWidth={ann.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </svg>
            )}

            {selected && props.tool === "select" && (
              <>
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => remove(ann.id)}
                  className="absolute -right-2.5 -top-2.5 flex size-5 items-center justify-center rounded-full bg-red-500 text-white shadow"
                  title="Delete"
                >
                  <X size={11} strokeWidth={3} />
                </button>
                {ann.kind !== "text" && (
                  <div
                    onPointerDown={(e) => {
                      startObjectGesture(e, ann, "resize");
                    }}
                    onPointerMove={onObjectMove}
                    onPointerUp={onObjectUp}
                    className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-sm border border-white bg-red-500 shadow"
                  />
                )}
              </>
            )}
          </div>
        );
      })}

      {/* in-progress visuals */}
      {draftRect && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: Math.min(draftRect.x0, draftRect.x1) * k,
            top: Math.min(draftRect.y0, draftRect.y1) * k,
            width: Math.abs(draftRect.x1 - draftRect.x0) * k,
            height: Math.abs(draftRect.y1 - draftRect.y0) * k,
            background: props.highlightColor,
            opacity: 0.4,
            mixBlendMode: "multiply",
          }}
        />
      )}
      {draftStroke && (
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          viewBox={`0 0 ${props.widthPts} ${props.heightPts}`}
          preserveAspectRatio="none"
        >
          <polyline
            points={draftStroke.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={props.color}
            strokeWidth={props.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
