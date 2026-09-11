"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface MultiSelectOption {
  value: string;
  label: string;
  /** 列表项右侧的灰色补充信息，如模型数 / 供应商名 */
  hint?: string;
  /** 参与搜索匹配的附加文本（label 外的关键词） */
  keywords?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  /** 触发器文案，如「模型供应商」 */
  label: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** 启用虚拟滚动（大列表，如 2000+ 模型） */
  virtualized?: boolean;
  /** 自定义弹层宽度等样式 */
  popoverClassName?: string;
}

const ROW_HEIGHT = 40;
const MAX_LIST_HEIGHT = 320;

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-3 w-3" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function MultiSelect({
  options,
  selected,
  onChange,
  label,
  searchPlaceholder = "搜索…",
  emptyText = "没有匹配的选项",
  virtualized = false,
  popoverClassName = "w-[340px]",
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return options;
    return options.filter((option) => {
      const haystack = `${option.label} ${option.hint ?? ""} ${option.keywords ?? ""}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [options, query]);

  // react-compiler 无法安全记忆化该库的返回函数，此处接受跳过自动记忆化
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    enabled: virtualized,
  });

  // 点击外部 / Esc 关闭
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

  // 打开时聚焦搜索框并回到顶部
  useEffect(() => {
    if (!open) return;
    setQuery("");
    listRef.current?.scrollTo({ top: 0 });
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  // 搜索结果变化时回到顶部
  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: 0 });
  }, [query, open]);

  const toggleValue = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter((item) => item !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const selectAllFiltered = () => {
    const next = [...selected];
    const nextSet = new Set(selected);
    for (const option of filtered) {
      if (!nextSet.has(option.value)) {
        next.push(option.value);
        nextSet.add(option.value);
      }
    }
    onChange(next);
  };

  const clearAll = () => onChange([]);

  const listHeight = Math.min(MAX_LIST_HEIGHT, Math.max(ROW_HEIGHT, filtered.length * ROW_HEIGHT));

  const renderOption = (option: MultiSelectOption) => {
    const checked = selectedSet.has(option.value);
    return (
      <button
        key={option.value}
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => toggleValue(option.value)}
        className="flex h-10 w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
            checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-transparent"
          }`}
        >
          <CheckIcon />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{option.label}</span>
        {option.hint ? (
          <span className="shrink-0 text-xs text-slate-400">{option.hint}</span>
        ) : null}
      </button>
    );
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 text-sm shadow-sm transition-colors hover:border-slate-300 ${
          open ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-slate-700">{label}</span>
          {selected.length > 0 ? (
            <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              {selected.length}
            </span>
          ) : null}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open ? (
        <div
          className={`absolute left-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 ${popoverClassName}`}
        >
          <div className="border-b border-slate-100 p-2.5">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <div className="mt-2 flex items-center justify-between px-0.5 text-xs text-slate-500">
              <span>
                已选 <span className="font-medium text-blue-600">{selected.length}</span> / 当前结果 {filtered.length}
              </span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  disabled={filtered.length === 0}
                  className="rounded px-1.5 py-0.5 font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  全选
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={selected.length === 0}
                  className="rounded px-1.5 py-0.5 font-medium text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  清空
                </button>
              </span>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-slate-400">{emptyText}</div>
          ) : virtualized ? (
            <div ref={listRef} className="overflow-y-auto" style={{ height: listHeight }}>
              <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((item) => (
                  <div
                    key={item.key}
                    className="absolute left-0 top-0 w-full"
                    style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                  >
                    {renderOption(filtered[item.index])}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: MAX_LIST_HEIGHT }}>
              {filtered.map(renderOption)}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
