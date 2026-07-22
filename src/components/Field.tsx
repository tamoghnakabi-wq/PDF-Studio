import type { ReactNode } from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm " +
  "text-zinc-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-500/20 " +
  "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export function TextInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      className={inputCls}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      spellCheck={false}
    />
  );
}

export function NumberInput(props: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      className={inputCls}
      value={props.value}
      min={props.min}
      max={props.max}
      step={props.step}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) props.onChange(v);
      }}
    />
  );
}

export function Select<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      className={inputCls}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as T)}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex rounded-lg bg-zinc-200/70 p-0.5 dark:bg-zinc-800">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => props.onChange(o.value)}
          className={
            "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors " +
            (props.value === o.value
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="size-4 rounded accent-red-500"
      />
      {props.label}
    </label>
  );
}

export function Slider(props: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        className="w-full accent-red-500"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-zinc-500">
        {props.value}
        {props.suffix ?? ""}
      </span>
    </div>
  );
}
