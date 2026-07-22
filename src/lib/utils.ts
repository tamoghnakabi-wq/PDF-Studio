/** True when running inside the Tauri shell (vs. a plain browser tab). */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i <= 0 ? "/" : path.slice(0, i);
}

/** "report.pdf" -> "report" */
export function stem(name: string): string {
  const b = basename(name);
  const i = b.lastIndexOf(".");
  return i <= 0 ? b : b.slice(0, i);
}

export function extOf(name: string): string {
  const b = basename(name);
  const i = b.lastIndexOf(".");
  return i === -1 ? "" : b.slice(i + 1).toLowerCase();
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? dir + name : `${dir}/${name}`;
}

/**
 * Parse a 1-based page-range spec like "1-3, 5, 8-10, 12-" against a page
 * total. Open ends are allowed ("-3" = from start, "4-" = to end) and
 * descending ranges keep their order ("7-5" -> 7,6,5). Out-of-range pages are
 * clamped; duplicates are dropped (first occurrence wins).
 * Throws on tokens that aren't ranges at all.
 */
export function parsePageRanges(spec: string, total: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const push = (p: number) => {
    if (p >= 1 && p <= total && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  };
  for (const rawSeg of spec.split(",")) {
    const seg = rawSeg.trim();
    if (!seg) continue;
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(seg);
    if (m) {
      if (!m[1] && !m[2]) throw new Error(`Invalid range "${seg}"`);
      let a = m[1] ? parseInt(m[1], 10) : 1;
      let b = m[2] ? parseInt(m[2], 10) : total;
      // a range that lies entirely outside the document contributes nothing
      // ("5-" on a 3-page PDF must not silently become page 3)
      if ((m[1] && a > total) || (m[2] && b < 1)) continue;
      a = Math.min(Math.max(a, 1), total);
      b = Math.min(Math.max(b, 1), total);
      if (a <= b) for (let p = a; p <= b; p++) push(p);
      else for (let p = a; p >= b; p--) push(p);
    } else if (/^\d+$/.test(seg)) {
      push(parseInt(seg, 10));
    } else {
      throw new Error(`Invalid page range "${seg}"`);
    }
  }
  return out;
}

/**
 * Parse "1-3, 4-6" into groups of pages — one group per comma-separated
 * segment — for splitting a PDF into multiple documents.
 */
export function parseRangeGroups(spec: string, total: number): number[][] {
  const groups: number[][] = [];
  for (const rawSeg of spec.split(",")) {
    const seg = rawSeg.trim();
    if (!seg) continue;
    const pages = parsePageRanges(seg, total);
    if (pages.length) groups.push(pages);
  }
  return groups;
}

/** Inverse of parsePageRanges for sorted input: [1,2,3,5] -> "1-3, 5" */
export function pagesToRangeText(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j === i ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

/** Chunk 1..total into groups of n pages: chunkPages(5, 2) -> [[1,2],[3,4],[5]] */
export function chunkPages(total: number, n: number): number[][] {
  const groups: number[][] = [];
  if (n < 1) n = 1;
  for (let start = 1; start <= total; start += n) {
    const g: number[] = [];
    for (let p = start; p < start + n && p <= total; p++) g.push(p);
    groups.push(g);
  }
  return groups;
}

/** Make `name` unique against `taken` by appending " (2)", " (3)", … before the extension. */
export function uniqueName(taken: Set<string>, name: string): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot <= 0 ? name : name.slice(0, dot);
  const ext = dot <= 0 ? "" : name.slice(dot);
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * pdf-lib's standard fonts only encode WinAnsi. Swap typographic characters
 * for ASCII equivalents and drop anything else that can't be encoded.
 */
export function sanitizeWinAnsi(text: string): string {
  const map: Record<string, string> = {
    "‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"',
    "„": '"', "–": "-", "—": "-", "…": "...", " ": " ",
    "•": "-", "‐": "-", "‑": "-", "−": "-", "‹": "<",
    "›": ">", "ˆ": "^", "˜": "~", "™": "(tm)",
  };
  let out = "";
  for (const ch of text.replace(/\r\n?/g, "\n")) {
    if (ch === "\n" || ch === "\t") {
      out += ch;
      continue;
    }
    const mapped = map[ch] ?? ch;
    const code = mapped.codePointAt(0)!;
    if (code >= 32 && code <= 255) out += mapped;
    else if (mapped.length > 1) out += mapped; // multi-char replacements are ASCII
  }
  return out;
}

/** "#rrggbb" → components in 0..1 (red fallback for malformed input) */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0xe5484d;
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

let idCounter = 0;
export function nextId(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
