# PDF Studio

An offline-first macOS desktop app — every PDF tool you need, in the spirit of
iLovePDF, built with **Tauri 2, React 18, TypeScript and Tailwind CSS 4**.

![](src-tauri/app-icon.png)

## Tools

| Organize | Optimize | Edit | Convert |
| --- | --- | --- | --- |
| Merge PDF | Compress PDF (Low / Medium / High — candidate-based, never produces a larger file; already-optimized files are detected and kept) | **Edit PDF** (text, highlight, freehand drawing, image insertion, signatures — with select/move/resize, undo/redo, zoom) | PDF → JPG |
| Split PDF (each page / chunks / ranges) | OCR for scanned PDFs (searchable text layer + .txt) | Watermark | PDF → PNG |
| Extract pages (visual picker) | | Page numbers | JPG/PNG → PDF |
| Delete pages (visual picker) | | | Word (.docx) → PDF |
| Rearrange pages (drag & drop) | | | PDF → Word (.docx) |
| | | | PDF → text |
| Rotate PDF | | | |

## Desktop features

- Native macOS app (Apple Silicon), overlay title bar, dark mode (system/light/dark)
- Drag & drop files from Finder anywhere in the window
- Finder integration: "Open With → PDF Studio" file associations, plus
  "Show in Finder" on every produced file
- Batch processing with a multi-file queue and per-job progress
- Live page thumbnails and file previews
- 100% offline: pdf-lib + pdf.js + Tesseract (bundled language data) — files
  never leave the machine
- Automatic updates via the Tauri updater (signed manifest; configure the
  GitHub endpoint in `src-tauri/tauri.conf.json`)

## Development

```bash
npm install
npm run assets        # copies tesseract wasm + downloads eng.traineddata (once)
npm run tauri dev
```

## Tests

```bash
npm test              # vitest unit tests
cd src-tauri && cargo test
```

## Release build

```bash
npm run tauri build   # produces .app and .dmg under src-tauri/target/release/bundle/
```

The macOS bundle is ad-hoc signed (`signingIdentity: "-"`). For distribution,
set a Developer ID certificate in `tauri.conf.json` and export
`APPLE_SIGNING_IDENTITY` / notarization credentials. Updater artifacts are
signed with the key in `src-tauri/updater.key` (keep it private; the public
key is embedded in the config).

## Architecture

- `src/tools/index.tsx` — declarative registry of all 16 tools (icon, options
  form, output planning, `run()` implementation; interactive tools provide a
  `Custom` view instead)
- `src/components/editor/` — the Edit PDF workspace: `EditPdfView` (toolbar,
  undo/redo history, save), `AnnotationLayer` (per-page gestures: place text,
  drag highlights, freehand strokes, move/resize/delete), `SignaturePad`
  (draw-to-sign modal); `src/lib/pdf/annotate.ts` burns annotations into the
  PDF via pdf-lib (geometry stored in top-left page points, converted once at
  export)
- `src/lib/pdf/` — the engine: `ops.ts` (pdf-lib operations), `engine.ts`
  (pdf.js rendering/text), `ocr.ts` (tesseract.js), `wordToPdf.ts`
  (mammoth → layout)
- `src/lib/store.ts` — zustand store with the serial job queue
- `src-tauri/` — thin Rust shell: dialogs, fs, opener (Finder), updater,
  "Open With" event buffering
