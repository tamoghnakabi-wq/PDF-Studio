import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile, stat, exists, mkdir } from "@tauri-apps/plugin-fs";
import { revealItemInDir, openPath as openerOpenPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import type { OutputFile, PickedFile, SavedOutput } from "./types";
import { basename, joinPath } from "./utils";

export async function statSize(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return Number(s.size ?? 0);
  } catch {
    // fall back to the Rust command (works for paths fs scope may not cover)
    try {
      return Number(await invoke<number>("file_size", { path }));
    } catch {
      return 0;
    }
  }
}

export async function toPickedFiles(paths: string[]): Promise<PickedFile[]> {
  return Promise.all(
    paths.map(async (path) => ({
      path,
      name: basename(path),
      size: await statSize(path),
    })),
  );
}

export async function pickFiles(
  exts: string[],
  multiple = true,
): Promise<PickedFile[]> {
  const result = await open({
    multiple,
    directory: false,
    filters: [{ name: exts.map((e) => e.toUpperCase()).join("/"), extensions: exts }],
  });
  if (!result) return [];
  const paths = Array.isArray(result) ? result : [result];
  return toPickedFiles(paths);
}

export async function pickDirectory(title?: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title });
  return typeof result === "string" ? result : null;
}

export async function pickSavePath(
  defaultName: string,
  ext: string,
): Promise<string | null> {
  return save({
    defaultPath: defaultName,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
}

export async function readBytes(path: string): Promise<Uint8Array> {
  return readFile(path);
}

export async function writeBytes(path: string, data: Uint8Array): Promise<void> {
  await writeFile(path, data);
}

/**
 * Write outputs into `dir` without clobbering anything that's already there.
 * Collisions (within this batch or with files on disk) count up from the
 * ORIGINAL name: "a.pdf" → "a (2).pdf" → "a (3).pdf", never "a (2) (2).pdf".
 */
export async function saveOutputsToDir(
  dir: string,
  outputs: OutputFile[],
): Promise<SavedOutput[]> {
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  const taken = new Set<string>();
  const saved: SavedOutput[] = [];
  for (const out of outputs) {
    const dot = out.name.lastIndexOf(".");
    const base = dot <= 0 ? out.name : out.name.slice(0, dot);
    const ext = dot <= 0 ? "" : out.name.slice(dot);
    let name = out.name;
    for (let i = 2; taken.has(name) || (await exists(joinPath(dir, name))); i++) {
      name = `${base} (${i})${ext}`;
    }
    taken.add(name);
    const path = joinPath(dir, name);
    await writeFile(path, out.data);
    saved.push({ name, path, size: out.data.byteLength });
  }
  return saved;
}

export async function saveOutputToPath(
  path: string,
  output: OutputFile,
): Promise<SavedOutput> {
  await writeFile(path, output.data);
  return { name: basename(path), path, size: output.data.byteLength };
}

export async function revealInFinder(path: string): Promise<void> {
  await revealItemInDir(path);
}

export async function openFile(path: string): Promise<void> {
  await openerOpenPath(path);
}

export async function takeOpenedFiles(): Promise<string[]> {
  try {
    return await invoke<string[]>("take_opened_files");
  } catch {
    return [];
  }
}
