"use client";

import { useEffect, useRef, useState } from "react";
import { COLUMNS } from "@/lib/metrics";

interface ColumnSettingsProps {
  visible: string[];
  onChange: (keys: string[]) => void;
  onReset: () => void;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-3 w-3" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 对比表格列显示 / 隐藏设置 */
export default function ColumnSettings({ visible, onChange, onReset }: ColumnSettingsProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const visibleSet = new Set(visible);

  const toggle = (key: string) => {
    if (visibleSet.has(key)) {
      onChange(visible.filter((item) => item !== key));
    } else {
      onChange([...visible, key]);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className={`flex h-9 items-center gap-1.5 rounded-lg border bg-white px-3 text-sm shadow-sm transition-colors hover:border-slate-300 ${
          open ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200"
        }`}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4 text-slate-500" aria-hidden="true">
          <path d="M3 5h14M6 10h8M8.5 15h3" strokeLinecap="round" />
        </svg>
        <span className="text-slate-700">列设置</span>
        <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-500">{visible.length}</span>
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[280px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
            勾选需要在对比表格中展示的指标列
          </div>
          <div className="max-h-[320px] overflow-y-auto py-1">
            {COLUMNS.map((column) => {
              const checked = visibleSet.has(column.key);
              return (
                <button
                  key={column.key}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggle(column.key)}
                  className="flex h-9 w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                      checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-transparent"
                    }`}
                  >
                    <CheckIcon />
                  </span>
                  <span className="flex-1 truncate text-sm text-slate-700">{column.label}</span>
                  {column.hint ? (
                    <span className="shrink-0 text-xs text-slate-400">{column.hint}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
            <button
              type="button"
              onClick={onReset}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
            >
              恢复默认
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded px-2 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
            >
              完成
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
