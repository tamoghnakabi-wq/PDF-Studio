import { FileUp } from "lucide-react";
import { pickFiles } from "../lib/fsio";
import type { PickedFile } from "../lib/types";

export default function DropZone(props: {
  accept: string[];
  multiple: boolean;
  compact?: boolean;
  onFiles: (files: PickedFile[]) => void;
}) {
  const browse = async () => {
    const files = await pickFiles(props.accept, props.multiple);
    if (files.length) props.onFiles(files);
  };

  if (props.compact) {
    return (
      <button
        onClick={browse}
        className="flex w-full select-none items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 py-2.5 text-xs font-medium text-zinc-500 transition-colors hover:border-red-400 hover:text-red-500 dark:border-zinc-700 dark:text-zinc-400"
      >
        <FileUp size={14} />
        Add more files ({props.accept.map((e) => "." + e).join(", ")})
      </button>
    );
  }

  return (
    <button
      onClick={browse}
      className="flex h-56 w-full select-none flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-zinc-300 bg-white/60 transition-colors hover:border-red-400 hover:bg-red-500/[0.03] dark:border-zinc-700 dark:bg-zinc-900/40 dark:hover:border-red-500/70"
    >
      <span className="flex size-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
        <FileUp size={26} />
      </span>
      <span className="text-sm font-semibold">
        Drop {props.accept.map((e) => "." + e).join(" / ")} files here
      </span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        or click to browse{props.multiple ? " — multiple files welcome" : ""}
      </span>
    </button>
  );
}
