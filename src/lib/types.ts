export interface PickedFile {
  /** Absolute path on disk */
  path: string;
  name: string;
  size: number;
}

/** A produced artifact, in memory, waiting to be written to disk. */
export interface OutputFile {
  name: string;
  data: Uint8Array;
}

/** A produced artifact after it has been written to disk. */
export interface SavedOutput {
  name: string;
  path: string;
  size: number;
}

export type JobStatus = "queued" | "running" | "done" | "error";

export interface QueueJob {
  id: string;
  toolId: string;
  label: string;
  status: JobStatus;
  /** 0..1 */
  progress: number;
  message?: string;
  outputs: SavedOutput[];
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export type ProgressFn = (frac: number, message?: string) => void;

export type ThemeMode = "system" | "light" | "dark";
