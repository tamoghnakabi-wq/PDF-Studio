// Copies tesseract.js runtime assets into public/ so OCR works fully offline,
// and fetches the English traineddata once (build-time only).
import { mkdirSync, existsSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");
const pubTess = join(root, "public", "tesseract");
const pubData = join(root, "public", "tessdata");
mkdirSync(pubTess, { recursive: true });
mkdirSync(pubData, { recursive: true });

// 1. tesseract.js worker
const workerSrc = join(nm, "tesseract.js", "dist", "worker.min.js");
if (existsSync(workerSrc)) {
  copyFileSync(workerSrc, join(pubTess, "worker.min.js"));
  console.log("copied worker.min.js");
} else {
  console.warn("WARN: tesseract.js worker not found at", workerSrc);
}

// 2. tesseract.js-core wasm runtime (copy every dist file; worker picks the right one)
const coreDir = join(nm, "tesseract.js-core");
if (existsSync(coreDir)) {
  let n = 0;
  for (const f of readdirSync(coreDir)) {
    const p = join(coreDir, f);
    if (statSync(p).isFile() && (f.endsWith(".js") || f.endsWith(".wasm"))) {
      copyFileSync(p, join(pubTess, f));
      n++;
    }
  }
  console.log(`copied ${n} tesseract core files`);
} else {
  console.warn("WARN: tesseract.js-core not found");
}

// 3. eng.traineddata.gz (one-time download; skipped when present → offline builds)
const lang = join(pubData, "eng.traineddata.gz");
if (!existsSync(lang)) {
  const url = "https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz";
  console.log("downloading", url);
  try {
    execFileSync("curl", ["-fsSL", "--retry", "3", "-o", lang, url], { stdio: "inherit" });
    console.log("downloaded eng.traineddata.gz");
  } catch (e) {
    console.warn("WARN: could not download traineddata — OCR will need it at runtime.", String(e));
  }
} else {
  console.log("eng.traineddata.gz already present");
}
