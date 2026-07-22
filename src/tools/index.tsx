import type { ReactElement } from "react";
import {
  AlignLeft,
  FileImage,
  FileOutput,
  FileText,
  FileType2,
  Hash,
  Image,
  Images,
  Layers,
  Minimize2,
  PenLine,
  RotateCw,
  ScanText,
  Scissors,
  Shuffle,
  Stamp,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import EditPdfView from "../components/editor/EditPdfView";
import type { OutputFile, ProgressFn } from "../lib/types";
import {
  chunkPages,
  formatBytes,
  hexToRgb01,
  parsePageRanges,
  parseRangeGroups,
  sanitizeWinAnsi,
  stem,
} from "../lib/utils";
import { extractText } from "../lib/pdf/engine";
import {
  addPageNumbers,
  compressPdf,
  deletePages,
  extractPages,
  imagesToPdf,
  mergePdfs,
  pageCountOf,
  pdfToImages,
  rearrangePdf,
  rotatePdf,
  splitPdf,
  watermarkPdf,
  type CompressLevel,
} from "../lib/pdf/ops";
import { ocrPdf } from "../lib/pdf/ocr";
import { wordToPdf } from "../lib/pdf/wordToPdf";
import { pdfToWord } from "../lib/pdf/pdfToWord";
import { Checkbox, Field, NumberInput, Segmented, Select, Slider, TextInput } from "../components/Field";

export interface LoadedFile {
  path: string;
  name: string;
  size: number;
  data: Uint8Array;
}

export interface ToolRunCtx {
  files: LoadedFile[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: any;
  progress: ProgressFn;
  /** Page tools: selected pages (select mode) or the full new order (order mode), 1-based. */
  pages?: number[];
  /** Surface a human-readable outcome note on the finished job (e.g. "already optimized"). */
  setNote?: (note: string) => void;
}

export type ToolGroup = "Organize" | "Optimize" | "Edit" | "Convert";

export interface ToolDef {
  id: string;
  name: string;
  tagline: string;
  icon: LucideIcon;
  /** tailwind classes for the icon chip */
  tint: string;
  group: ToolGroup;
  accept: string[];
  multi: boolean;
  minFiles: number;
  pageMode?: "select" | "order";
  pageHint?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaults: any;
  Options?: (props: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onChange: (v: any) => void;
  }) => ReactElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outputPlan: (fileCount: number, options: any) => "one" | "many";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  suggestName: (firstName: string, options: any) => string;
  run: (ctx: ToolRunCtx) => Promise<OutputFile[]>;
  /** Interactive tools render their own workspace instead of the generic ToolView. */
  Custom?: (props: { tool: ToolDef }) => ReactElement;
}

/** Map a per-file fraction into overall job progress. */
function per(progress: ProgressFn, i: number, n: number): ProgressFn {
  return (frac, msg) => progress((i + frac) / n, msg);
}

async function pagesFromRange(
  range: string,
  data: Uint8Array,
): Promise<number[] | "all"> {
  const trimmed = range.trim();
  if (!trimmed) return "all";
  return parsePageRanges(trimmed, await pageCountOf(data));
}

export const TOOLS: ToolDef[] = [
  /* -------------------------------- Organize ------------------------------- */
  {
    id: "merge",
    name: "Merge PDF",
    tagline: "Combine PDFs in the order you want",
    icon: Layers,
    tint: "bg-red-500/15 text-red-600 dark:text-red-400",
    group: "Organize",
    accept: ["pdf"],
    multi: true,
    minFiles: 2,
    defaults: {},
    outputPlan: () => "one",
    suggestName: (first) => `${stem(first)} (merged).pdf`,
    run: ({ files, progress }) => mergePdfs(files, progress),
  },
  {
    id: "split",
    name: "Split PDF",
    tagline: "Separate pages into independent PDFs",
    icon: Scissors,
    tint: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    group: "Organize",
    accept: ["pdf"],
    multi: false,
    minFiles: 1,
    defaults: { mode: "each", every: 2, ranges: "" },
    Options: ({ value, onChange }) => (
      <>
        <Field label="Split mode">
          <Select
            value={value.mode}
            onChange={(mode) => onChange({ ...value, mode })}
            options={[
              { value: "each", label: "Every page → its own PDF" },
              { value: "every", label: "Chunks of N pages" },
              { value: "ranges", label: "Custom ranges" },
            ]}
          />
        </Field>
        {value.mode === "every" && (
          <Field label="Pages per chunk">
            <NumberInput
              value={value.every}
              min={1}
              onChange={(every) => onChange({ ...value, every })}
            />
          </Field>
        )}
        {value.mode === "ranges" && (
          <Field label="Ranges (e.g. 1-3, 4-6, 9)">
            <TextInput
              value={value.ranges}
              placeholder="1-3, 4-6"
              onChange={(ranges) => onChange({ ...value, ranges })}
            />
          </Field>
        )}
      </>
    ),
    outputPlan: () => "many",
    suggestName: (first) => `${stem(first)}.pdf`,
    run: async ({ files, options, progress }) => {
      const outputs: OutputFile[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const total = await pageCountOf(f.data);
        const groups =
          options.mode === "each"
            ? chunkPages(total, 1)
            : options.mode === "every"
              ? chunkPages(total, Math.max(1, Number(options.every) || 1))
              : parseRangeGroups(options.ranges, total);
        if (!groups.length) throw new Error("No page ranges to split by");
        outputs.push(...(await splitPdf(f.name, f.data, groups, per(progress, i, files.length))));
      }
      return outputs;
    },
  },
  {
    id: "extract",
    name: "Extract pages",
    tagline: "Pull selected pages into a new PDF",
    icon: FileOutput,
    tint: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    group: "Organize",
    accept: ["pdf"],
    multi: false,
    minFiles: 1,
    pageMode: "select",
    pageHint: "Click pages to include them in the new PDF.",
    defaults: {},
    outputPlan: () => "one",
    suggestName: (first) => `${stem(first)} (extracted).pdf`,
    run: async ({ files, pages, progress }) => {
      if (!pages?.length) throw new Error("Select at least one page to extract");
      progress(0.3, "Extracting pages");
      return [
        {
          name: `${stem(files[0].name)} (extracted).pdf`,
          data: await extractPages(files[0].data, pages),
        },
      ];
    },
  },
  {
    id: "delete",
    name: "Delete pages",
    tagline: "Remove pages you don't need",
    icon: Trash2,
    tint: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    group: "Organize",
    accept: ["pdf"],
    multi: false,
    minFiles: 1,
    pageMode: "select",
    pageHint: "Click the pages you want to remove.",
    defaults: {},
    outputPlan: () => "one",
    suggestName: (first) => `${stem(first)} (edited).pdf`,
    run: async ({ files, pages, progress }) => {
      if (!pages?.length) throw new Error("Select at least one page to delete");
      progress(0.3, "Deleting pages");
      return [
        {
          name: `${stem(files[0].name)} (edited).pdf`,
          data: await deletePages(files[0].data, pages),
        },
      ];
    },
  },
  {
    id: "rearrange",
    name: "Rearrange pages",
    tagline: "Drag pages into a new order",
    icon: Shuffle,
    tint: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    group: "Organize",
    accept: ["pdf"],
    multi: false,
    minFiles: 1,
    pageMode: "order",
    pageHint: "Drag thumbnails to reorder. Use Reverse to flip the document.",
    defaults: {},
    outputPlan: () => "one",
    suggestName: (first) => `${stem(first)} (reordered).pdf`,
    run: async ({ files, pages, progress }) => {
      if (!pages?.length) throw new Error("Nothing to reorder");
      progress(0.3, "Rewriting page order");
      return [
        {
          name: `${stem(files[0].name)} (reordered).pdf`,
          data: await rearrangePdf(files[0].data, pages),
        },
      ];
    },
  },
  {
    id: "rotate",
    name: "Rotate PDF",
    tagline: "Rotate all pages or just a range",
    icon: RotateCw,
    tint: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    group: "Organize",
    accept: ["pdf"],
    multi: true,
    minFiles: 1,
    defaults: { angle: 90, range: "" },
    Options: ({ value, onChange }) => (
      <>
        <Field label="Rotation">
          <Segmented
            value={String(value.angle)}
            onChange={(v) => onChange({ ...value, angle: Number(v) })}
            options={[
              { value: "90", label: "90° ⟳" },
              { value: "180", label: "180°" },
              { value: "270", label: "90° ⟲" },
            ]}
          />
        </Field>
        <Field label="Pages (blank = all)">
          <TextInput
            value={value.range}
            placeholder="e.g. 1-3, 5"
            onChange={(range) => onChange({ ...value, range })}
          />
        </Field>
      </>
    ),
    outputPlan: (n) => (n === 1 ? "one" : "many"),
    suggestName: (first) => `${stem(first)} (rotated).pdf`,
    run: async ({ files, options, progress }) => {
      const outputs: OutputFile[] = [];
      for (let i = 0; i < files.length; i++) {
        progress(i / files.length, `Rotating ${files[i].name}`);
        const pages = await pagesFromRange(options.range, files[i].data);
        outputs.push({
          name: `${stem(files[i].name)} (rotated).pdf`,
          data: await rotatePdf(files[i].data, options.angle, pages),
        });
      }
      return outputs;
    },
  },

  /* -------------------------------- Optimize ------------------------------- */
  {
    id: "compress",
    name: "Compress PDF",
    tagline: "Shrink files while keeping them usable",
    icon: Minimize2,
    tint: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    group: "Optimize",
    accept: ["pdf"],
    multi: true,
    minFiles: 1,
    defaults: { level: "medium" },
    Options: ({ value, onChange }) => (
      <>
        <Field label="Compression level">
          <Select
            value={value.level}
            onChange={(level) => onChange({ ...value, level })}
            options={[
              { value: "low", label: "Low — minimal quality loss" },
              { value: "medium", label: "Medium — balanced" },
              { value: "high", label: "High — maximum size reduction" },
            ]}
          />
        </Field>
        <p className="text-xs leading-relaxed text-zinc-500">
          {value.level === "low" &&
            "Lossless cleanup: rewrites the file structure and strips dead metadata. Content is untouched."}
          {value.level === "medium" &&
            "Lossless cleanup, plus image-heavy documents are re-rendered at 144 dpi when that produces a smaller file."}
          {value.level === "high" &&
            "Tries everything, including a 110 dpi re-render — text can become non-selectable if the re-render wins."}{" "}
          The result is never larger than the original — files that can't be
          shrunk are kept as-is and reported.
        </p>
      </>
    ),
    outputPlan: (n) => (n === 1 ? "one" : "many"),
    suggestName: (first) => `${stem(first)} (compressed).pdf`,
    run: async ({ files, options, progress, setNote }) => {
      const outputs: OutputFile[] = [];
      const skipped: string[] = [];
      let savedBytes = 0;
      for (let i = 0; i < files.length; i++) {
        const result = await compressPdf(
          files[i].data,
          options.level as CompressLevel,
          per(progress, i, files.length),
        );
        if (result.alreadyOptimized) {
          skipped.push(files[i].name);
        } else {
          savedBytes += result.before - result.after;
          outputs.push({
            name: `${stem(files[i].name)} (compressed).pdf`,
            data: result.data,
          });
        }
      }
      if (skipped.length === files.length) {
        setNote?.(
          files.length === 1
            ? "This PDF is already optimized. No further compression was possible."
            : "These PDFs are already optimized. No further compression was possible.",
        );
      } else if (skipped.length > 0) {
        setNote?.(
          `Saved ${formatBytes(savedBytes)}. ${skipped.length} of ${files.length} files were already optimized and kept unchanged: ${skipped.join(", ")}`,
        );
      } else if (files.length > 0) {
        setNote?.(`Saved ${formatBytes(savedBytes)} across ${outputs.length} file${outputs.length === 1 ? "" : "s"}.`);
      }
      return outputs;
    },
  },
  {
    id: "ocr",
    name: "OCR PDF",
    tagline: "Make scanned PDFs searchable",
    icon: ScanText,
    tint: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
    group: "Optimize",
    accept: ["pdf"],
    multi: true,
    minFiles: 1,
    defaults: { saveTxt: true },
    Options: ({ value, onChange }) => (
      <>
        <Checkbox
          checked={value.saveTxt}
          onChange={(saveTxt) => onChange({ ...value, saveTxt })}
          label="Also save recognized text (.txt)"
        />
        <p className="text-xs leading-relaxed text-zinc-500">
          Runs Tesseract OCR (English) on every page and adds an invisible
          text layer, so the PDF becomes selectable and searchable. Everything
          happens on this Mac — no uploads.
        </p>
      </>
    ),
    outputPlan: (n, o) => (n === 1 && !o.saveTxt ? "one" : "many"),
    suggestName: (first) => `${stem(first)} (searchable).pdf`,
    run: async ({ files, options, progress }) => {
      const outputs: OutputFile[] = [];
      for (let i = 0; i < files.length; i++) {
        const result = await ocrPdf(files[i].data, per(progress, i, files.length));
        outputs.push({
          name: `${stem(files[i].name)} (searchable).pdf`,
          data: result.searchablePdf,
        });
        if (options.saveTxt) {
          outputs.push({
            name: `${stem(files[i].name)}.txt`,
            data: new TextEncoder().encode(result.text),
          });
        }
      }
      return outputs;
    },
  },

  /* ---------------------------------- Edit --------------------------------- */
  {
    id: "edit",
    name: "Edit PDF",
    tagline: "Add text, highlights, drawings, images & signatures",
    icon: PenLine,
    tint: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
    group: "Edit",
    accept: ["pdf"],
    multi: false,
    minFiles: 1,
    defaults: {},
    outputPlan: () => "one",
    suggestName: (first) => `${stem(first)} (edited).pdf`,
    run: async () => {
      throw new Error("Edit PDF is interactive — open it from the sidebar");
    },
    Custom: EditPdfView,
  },
  {
    id: "watermark",
    name: "Watermark",
    tagline: "Stamp text over every page",
    icon: Stamp,
    tint: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
    group: "Edit",
    accept: ["pdf"],
    multi: true,
    minFiles: 1,
    defaults: {
      text: "CONFIDENTIAL",
      fontSize: 48,
      opacity: 30,
      position: "diagonal",
      color: "#e5484d",
      range: "",
    },
    Options: ({ value, onChange }) => (
      <>
        <Field label="Watermark text">
          <TextInput value={value.text} onChange={(text) => onChange({ ...value, text })} />
        </Field>
        <Field label="Position">
          <Select
            value={value.position}
            onChange={(position) => onChange({ ...value, position })}
            options={[
              { value: "diagonal", label: "Diagonal" },
              { value: "center", label: "Center" },
              { value: "top", label: "Top" },
              { value: "bottom", label: "Bottom" },
            ]}
          />
        </Field>
        <Field label="Font size">
          <Slider
            value={value.fontSize}
            min={12}
            max={120}
            onChange={(fontSize) => onChange({ ...value, fontSize })}
            suffix="pt"
          />
        </Field>
        <Field label="Opacity">
          <Slider
            value={value.opacity}
            min={5}
            max={100}
            onChange={(opacity) => onChange({ ...value, opacity })}
            suffix="%"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Color">
            <input
              type="color"
              value={value.color}
              onChange={(e) => onChange({ ...value, color: e.target.value })}
              className="h-8 w-full cursor-pointer rounded-lg border border-zinc-300 bg-transparent dark:border-zinc-700"
            />
          </Field>
          <Field label="Pages (blank = all)">
            <TextInput
              value={value.range}
              placeholder="1-3"
              onChange={(range) => onChange({ ...value, range })}
            />
          </Field>
        </div>
      </>
    ),
    outputPlan: (n) => (n === 1 ? "one" : "many"),
    suggestName: (first) => `${stem(first)} (watermarked).pdf`,
    run: async ({ files, options, progress }) => {
      const outputs: OutputFile[] = [];
      for (let i = 0; i < files.length; i++) {
        progress(i / files.length, `Watermarking ${files[i].name}`);
        const pages = await pagesFromRange(options.range, files[i].data);
        outputs.push({
          name: `${stem(files[i].name)} (watermarked).pdf`,
          data: await watermarkPdf(files[i].data, {
            text: sanitizeWinAnsi(options.text),
            fontSize: options.fontSize,
            opacity: options.opacity / 100,
            position: options.position,
            color: hexToRgb01(options.color),
            pages,
          }),
        });
      }
      return outputs;
    },
  },
  {
    id: "pagenumbers",
    name: "Page numbers",
    tagline: "Add numbering to every page",
    icon: Hash,
    tint: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
    group: "Edit",
    accept: ["pdf"],
    multi: true,
    minFiles: 1,
    defaults: {
      format: "{n} / {N}",
      position: "bottom-center",
      fontSize: 11,
      start: 1,
      margin: 28,
    },
    Options: ({ value, onChange }) => (
      <>
        <Field label="Format — {n} = page, {N} = total">
          <TextInput value={value.format} onChange={(format) => onChange({ ...value, format })} />
        </Field>
        <Field label="Position">
          <Select
            value={value.position}
            onChange={(position) => onChange({ ...value, position })}
            options={[
              { value: "bottom-center", label: "Bottom center" },
              { value: "bottom-left", label: "Bottom left" },
              { value: "bottom-right", label: "Bottom right" },
              { value: "top-center", label: "Top center" },
              { value: "top-left", label: "Top left" },
              { value: "top-right", label: "Top right" },
            ]}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Size">
            <NumberInput value={value.fontSize} min={6} max={36} onChange={(fontSize) => onChange({ ...value, fontSize })} />
          </Field>
          <Field label="Start at">
            <NumberInput value={value.start} min={0} onChange={(start) => onChange({ ...value, start })} />
          </Field>
          <Field label="Margin">
            <NumberInput value={value.margin} min={8} max={96} onChange={(margin) => onChange({ ...value, margin })} />
          </Field>
        </div>
      </>
    ),
    outputPlan: (n) => (n === 1 ? "one" : "many"),
    suggestName: (first) => `${stem(first)} (numbered).pdf`,
    run: async ({ files, options, progress }) => {
      const outputs: OutputFile[] = [];
      for (let i = 0; i < files.length; i++) {
        progress(i / files.length, `Numbering ${files[i].name}`);
        outputs.push({
          name: `${stem(files[i].name)} (numbered).pdf`,
          data: await addPageNumbers(files[i].data, options),
        });
      }
      return outputs;
    },
  },

  /* -------------------------------- Convert -------------------------------- */
  {
    id: "pdf2jpg",
    name: "PDF to JPG",
    tagline: "Export every page as a JPG image",
    icon: FileImage,
    tint: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
    group: "Convert",
    accept: ["pdf"],
    multi: true,
    minFiles: 1,
    defaults: { dpi: 150, quality: 85 },
    Options: ({ value, onChange }) => (
      <>
        <Field label="Resolution">
          <Select
            value={String(value.dpi)}
            onChange={(v) => onChange({ ...value, dpi: Number(v) })}
            options={[
              { value: "96", label: "96 dpi — screen" },
              { value: "150", label: "150 dpi — standard" },
              { value: "300", label: "300 dpi — print" },
            ]}
          />
        </Field>
        <Field label="JPG quality">
          <Slider value={value.quality} min={30} max={100} onChange={(quality) => onChange({ ...value, quality })} suffix="%" />
        </Field>
      </>
    ),
    outputPlan: () => "many",
    suggestName: (first) => `${stem(first)}.jpg`,
    run: async ({ files, options, progress }) => {
      const outputs: OutputFile[] = [];
      for (let i = 0; i < files.length; i++) {
        outputs.push(
          ...(await pdfToImages(
            files[i].name,
            files[i].data,
            { format: "jpeg", dpi: options.dpi, quality: options.quality / 100 },
            per(progress, i, files.length),
          )),
        );
      }
      return outputs;
    },
  },
  {
    id: "pdf2png",
    name: "PDF to PNG",
    tagline: "Export pages as lossless PNGs",
    icon: Image,
    tint: "bg-lime-500/15 text-lime-600 dark:text-lime-400",
    group: "Convert",
    accept: ["pdf"],
    multi: true,
    minFiles: 1,
    defaults: { dpi: 150 },
    Options: ({ value, onChange }) => (
      <Field label="Resolution">
        <Select
          value={String(value.dpi)}
          onChange={(v) => onChange({ ...value, dpi: Number(v) })}
          options={[
            { value: "96", label: "96 dpi — screen" },
            { value: "150", label: "150 dpi — standard" },
            { value: "300", label: "300 dpi — print" },
          ]}
        />
      </Field>
    ),
    outputPlan: () => "many",
    suggestName: (first) => `${stem(first)}.png`,
    run: async ({ files, options, progress }) => {
      const outputs: OutputFile[] = [];
      for (let i = 0; i < files.length; i++) {
        outputs.push(
          ...(await pdfToImages(
            files[i].name,
            files[i].data,
            { format: "png", dpi: options.dpi, quality: 1 },
            per(progress, i, files.length),
          )),
        );
      }
      return outputs;
    },
  },
  {
    id: "img2pdf",
    name: "JPG to PDF",
    tagline: "Turn images into a PDF",
    icon: Images,
    tint: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
    group: "Convert",
    accept: ["jpg", "jpeg", "png"],
    multi: true,
    minFiles: 1,
    defaults: { pageSize: "a4", margin: 24, combine: true },
    Options: ({ value, onChange }) => (
      <>
        <Field label="Page size">
          <Select
            value={value.pageSize}
            onChange={(pageSize) => onChange({ ...value, pageSize })}
            options={[
              { value: "a4", label: "A4" },
              { value: "letter", label: "US Letter" },
              { value: "fit", label: "Same as image" },
            ]}
          />
        </Field>
        {value.pageSize !== "fit" && (
          <Field label="Margin">
            <Slider value={value.margin} min={0} max={96} onChange={(margin) => onChange({ ...value, margin })} suffix="pt" />
          </Field>
        )}
        <Checkbox
          checked={value.combine}
          onChange={(combine) => onChange({ ...value, combine })}
          label="Combine all images into one PDF"
        />
      </>
    ),
    outputPlan: (n, o) => (o.combine || n === 1 ? "one" : "many"),
    suggestName: (first, o) => (o.combine ? "images.pdf" : `${stem(first)}.pdf`),
    run: ({ files, options, progress }) => imagesToPdf(files, options, progress),
  },
  {
    id: "word2pdf",
    name: "Word to PDF",
    tagline: "Convert .docx documents to PDF",
    icon: FileText,
    tint: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    group: "Convert",
    accept: ["docx"],
    multi: true,
    minFiles: 1,
    defaults: {},
    outputPlan: (n) => (n === 1 ? "one" : "many"),
    suggestName: (first) => `${stem(first)}.pdf`,
    run: async ({ files, progress }) => {
      const outputs: OutputFile[] = [];
      for (let i = 0; i < files.length; i++) {
        outputs.push({
          name: `${stem(files[i].name)}.pdf`,
          data: await wordToPdf(files[i].data, per(progress, i, files.length)),
        });
      }
      return outputs;
    },
  },
  {
    id: "pdf2word",
    name: "PDF to Word",
    tagline: "Convert PDFs to editable .docx",
    icon: FileType2,
    tint: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    group: "Convert",
    accept: ["pdf"],
    multi: true,
    minFiles: 1,
    defaults: {},
    Options: () => (
      <p className="text-xs leading-relaxed text-zinc-500">
        Text, paragraphs and headings become editable Word content. Scanned
        pages (no text layer) are embedded as page images — run OCR first if
        you want them editable.
      </p>
    ),
    outputPlan: (n) => (n === 1 ? "one" : "many"),
    suggestName: (first) => `${stem(first)}.docx`,
    run: async ({ files, progress }) => {
      const outputs: OutputFile[] = [];
      for (let i = 0; i < files.length; i++) {
        outputs.push({
          name: `${stem(files[i].name)}.docx`,
          data: await pdfToWord(files[i].data, per(progress, i, files.length)),
        });
      }
      return outputs;
    },
  },
  {
    id: "pdf2text",
    name: "PDF to text",
    tagline: "Extract plain text from PDFs",
    icon: AlignLeft,
    tint: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
    group: "Convert",
    accept: ["pdf"],
    multi: true,
    minFiles: 1,
    defaults: { combine: false },
    Options: ({ value, onChange }) => (
      <Checkbox
        checked={value.combine}
        onChange={(combine) => onChange({ ...value, combine })}
        label="Combine everything into one .txt"
      />
    ),
    outputPlan: (n, o) => (o.combine || n === 1 ? "one" : "many"),
    suggestName: (first, o) => (o.combine ? "extracted-text.txt" : `${stem(first)}.txt`),
    run: async ({ files, options, progress }) => {
      const texts: string[] = [];
      const outputs: OutputFile[] = [];
      for (let i = 0; i < files.length; i++) {
        progress(i / files.length, `Extracting text from ${files[i].name}`);
        const text = await extractText(files[i].data, (p, total) =>
          per(progress, i, files.length)(p / total, `Extracting ${files[i].name} — page ${p}/${total}`),
        );
        if (options.combine) {
          texts.push(`────────  ${files[i].name}  ────────\n\n${text}`);
        } else {
          outputs.push({
            name: `${stem(files[i].name)}.txt`,
            data: new TextEncoder().encode(text),
          });
        }
      }
      if (options.combine) {
        outputs.push({
          name: "extracted-text.txt",
          data: new TextEncoder().encode(texts.join("\n\n\n")),
        });
      }
      return outputs;
    },
  },
];

export const TOOL_GROUPS: ToolGroup[] = ["Organize", "Optimize", "Edit", "Convert"];

export function toolById(id: string | null): ToolDef | null {
  return TOOLS.find((t) => t.id === id) ?? null;
}
