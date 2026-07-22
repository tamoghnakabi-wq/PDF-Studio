import { useEffect, useRef, useState } from "react";
import { Eraser, X } from "lucide-react";
import { strokesBounds } from "../../lib/pdf/annotate";

const PAD_W = 480;
const PAD_H = 180;

/**
 * Draw-a-signature modal. Returns strokes normalized to their bounding box
 * (origin 0,0) plus the box size, ready to become a StrokeAnn.
 */
export default function SignaturePad(props: {
  color: string;
  onCancel: () => void;
  onDone: (strokes: { x: number; y: number }[][], w: number, h: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<{ x: number; y: number }[][]>([]);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PAD_W, PAD_H);
    ctx.strokeStyle = props.color;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokesRef.current) {
      if (!stroke.length) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (const p of stroke.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = PAD_W * dpr;
    canvas.height = PAD_H * dpr;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.color]);

  const point = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
      <div className="ps-fade-in select-none rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Draw your signature</h2>
          <button
            onClick={props.onCancel}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X size={15} />
          </button>
        </div>
        <canvas
          ref={canvasRef}
          style={{ width: PAD_W, height: PAD_H, touchAction: "none" }}
          className="cursor-crosshair rounded-xl border border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950"
          onPointerDown={(e) => {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* synthetic or vanished pointer — drawing still works */
            }
            drawingRef.current = true;
            strokesRef.current.push([point(e)]);
            setHasInk(true);
            redraw();
          }}
          onPointerMove={(e) => {
            if (!drawingRef.current) return;
            strokesRef.current[strokesRef.current.length - 1].push(point(e));
            redraw();
          }}
          onPointerUp={() => (drawingRef.current = false)}
        />
        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={() => {
              strokesRef.current = [];
              setHasInk(false);
              redraw();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Eraser size={13} /> Clear
          </button>
          <div className="flex gap-2">
            <button
              onClick={props.onCancel}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              disabled={!hasInk}
              onClick={() => {
                const bounds = strokesBounds(strokesRef.current);
                if (!bounds) return;
                const normalized = strokesRef.current
                  .filter((s) => s.length)
                  .map((s) => s.map((p) => ({ x: p.x - bounds.x, y: p.y - bounds.y })));
                props.onDone(normalized, bounds.w, bounds.h);
              }}
              className="rounded-lg bg-red-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-40"
            >
              Use signature
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
