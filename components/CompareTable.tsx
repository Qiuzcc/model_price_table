"use client";

import { useMemo, useState } from "react";
import ColumnSettings from "./ColumnSettings";
import {
  COLUMNS,
  MODEL_TYPE_LABELS,
  convertCurrency,
  formatDate,
  formatLatency,
  formatPrice,
  formatSpeed,
  formatTokens,
  modalityLabel,
  type MetricColumn,
  type ModelRow,
} from "@/lib/metrics";
import type { DisplayCurrency, FxRates } from "@/lib/types";

interface CompareTableProps {
  rows: ModelRow[];
  visibleColumns: string[];
  onVisibleColumnsChange: (keys: string[]) => void;
  onResetColumns: () => void;
  onRemove: (sid: string) => void;
  onClear: () => void;
  /** 价格展示币种（effective：汇率不可用时父级已回退为 native） */
  displayCurrency: DisplayCurrency;
  onDisplayCurrencyChange: (value: DisplayCurrency) => void;
  /** 汇率数据（USD 基准），为 null 时禁用换算 */
  fx: FxRates | null;
}

type ExtremeKind = "min" | "max";

type SortDir = "asc" | "desc";

interface SortState {
  key: string;
  dir: SortDir;
}

interface CellOptions {
  displayCurrency: DisplayCurrency;
  rates: Record<string, number> | null;
  /** 该单元格命中的极值标记（最低 / 最高），由表格计算后传入 */
  extreme?: ExtremeKind | null;
}

/** 价格列在当前展示币种下的数值与单位（含换算；与单元格展示逻辑保持一致） */
function getDisplayPrice(
  row: ModelRow,
  column: MetricColumn,
  options: CellOptions,
): { value: number; unit: string | null } | null {
  const raw = column.get(row) as number | null;
  if (raw == null || !Number.isFinite(raw)) return null;
  const unit = row.headline?.priceUnit ?? null;
  if (options.displayCurrency !== "native" && options.rates && unit) {
    const converted = convertCurrency(raw, unit, options.displayCurrency, options.rates);
    if (converted != null) return { value: converted, unit: options.displayCurrency };
  }
  return { value: raw, unit };
}

/**
 * 排序 / 极值比较用的数值：价格列统一折算到可比基准（展示币种；展示原生时折算为 USD），
 * 避免原生币种混合时按裸数值比较产生误导；无汇率或币种缺失时退回原始值。
 */
function getNumericValue(
  row: ModelRow,
  column: MetricColumn,
  options: CellOptions,
): number | null {
  if (column.kind !== "price") {
    const raw = column.get(row);
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  const raw = column.get(row) as number | null;
  if (raw == null || !Number.isFinite(raw)) return null;
  const unit = row.headline?.priceUnit ?? null;
  const target = options.displayCurrency !== "native" ? options.displayCurrency : "USD";
  if (options.rates && unit) {
    const converted = convertCurrency(raw, unit, target, options.rates);
    if (converted != null) return converted;
  }
  return raw;
}

/** 命中列内最低 / 最高时返回对应标记；无有效值或全部相同时不标记 */
function getCellExtreme(
  row: ModelRow,
  column: MetricColumn,
  extremes: Map<string, { min: number; max: number }>,
  options: CellOptions,
): ExtremeKind | null {
  const range = extremes.get(column.key);
  if (!range) return null;
  const value = getNumericValue(row, column, options);
  if (value == null) return null;
  if (value === range.min) return "min";
  if (value === range.max) return "max";
  return null;
}

function SortIcon({ dir }: { dir: SortDir | null }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-3 w-3 shrink-0 ${
        dir ? "text-blue-600" : "text-slate-300 group-hover/sort:text-slate-400"
      }`}
      aria-hidden="true"
    >
      {dir === "desc" ? (
        <path d="M6 2.5v7M3.5 7 6 9.5 8.5 7" />
      ) : (
        <path d="M6 9.5v-7M3.5 5 6 2.5 8.5 5" />
      )}
    </svg>
  );
}

const CURRENCY_OPTIONS: { value: DisplayCurrency; label: string }[] = [
  { value: "native", label: "原生" },
  { value: "CNY", label: "¥ 人民币" },
  { value: "USD", label: "$ 美元" },
];

function fxSourceLabel(source: string): string {
  if (source.startsWith("frankfurter")) return "ECB 参考汇率";
  if (source.startsWith("open-er-api")) return "exchangerate-api.com";
  return source;
}

function formatFxRate(rate: number | undefined): string {
  return rate != null && Number.isFinite(rate) ? rate.toFixed(4) : "—";
}

function renderCell(row: ModelRow, column: MetricColumn, options: CellOptions) {
  const value = column.get(row);

  switch (column.kind) {
    case "price": {
      const price = getDisplayPrice(row, column, options);
      if (!price) return <span className="tabular-nums text-slate-300">—</span>;
      const extreme = options.extreme ?? null;
      return (
        <span
          className={`flex items-center gap-1.5 tabular-nums ${
            extreme === "min"
              ? "font-semibold text-emerald-600"
              : extreme === "max"
                ? "font-semibold text-rose-500"
                : "font-medium text-slate-800"
          }`}
        >
          {formatPrice(price.value, price.unit)}
          {extreme ? (
            <span
              className={`rounded px-1 py-0.5 text-xs font-normal ${
                extreme === "min" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"
              }`}
            >
              {extreme === "min" ? "最低" : "最高"}
            </span>
          ) : null}
        </span>
      );
    }
    case "tokens":
      return typeof value === "number" ? (
        <span className="tabular-nums">{formatTokens(value)}</span>
      ) : (
        <span className="text-slate-300">—</span>
      );
    case "speed":
      return typeof value === "number" ? (
        <span className="font-medium tabular-nums text-slate-800">{formatSpeed(value)}</span>
      ) : (
        <span className="text-slate-300">—</span>
      );
    case "latency":
      return typeof value === "number" ? (
        <span className="font-medium tabular-nums text-slate-800">{formatLatency(value)}</span>
      ) : (
        <span className="text-slate-300">—</span>
      );
    case "boolean":
      return value === true ? (
        <span className="font-semibold text-emerald-600">支持</span>
      ) : (
        <span className="text-slate-300">—</span>
      );
    case "chips": {
      const chips = (value as string[] | null | undefined) ?? [];
      if (chips.length === 0) return <span className="text-slate-300">—</span>;
      return (
        <span className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <span key={chip} className="rounded-md bg-slate-100/80 px-1.5 py-0.5 text-xs text-slate-500">
              {modalityLabel(chip)}
            </span>
          ))}
        </span>
      );
    }
    case "date":
      return value ? (
        <span className="tabular-nums">{formatDate(value as string)}</span>
      ) : (
        <span className="text-slate-300">—</span>
      );
    case "link":
      return value ? (
        <a
          href={String(value)}
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 hover:underline"
          title={String(value)}
        >
          查看来源
        </a>
      ) : (
        <span className="text-slate-300">—</span>
      );
    case "modelType":
      return value ? (
        <span>{MODEL_TYPE_LABELS[String(value)] ?? String(value)}</span>
      ) : (
        <span className="text-slate-300">—</span>
      );
    default:
      return value != null && value !== "" ? (
        <span>{String(value)}</span>
      ) : (
        <span className="text-slate-300">—</span>
      );
  }
}

/** 对比表格：行 = 模型，列 = 指标 */
export default function CompareTable({
  rows,
  visibleColumns,
  onVisibleColumnsChange,
  onResetColumns,
  onRemove,
  onClear,
  displayCurrency,
  onDisplayCurrencyChange,
  fx,
}: CompareTableProps) {
  const columns = useMemo(() => {
    const visibleSet = new Set(visibleColumns);
    return COLUMNS.filter((column) => visibleSet.has(column.key));
  }, [visibleColumns]);

  const cellOptions: CellOptions = useMemo(
    () => ({ displayCurrency, rates: fx?.rates ?? null }),
    [displayCurrency, fx],
  );

  // 排序状态：null = 按勾选顺序；点击表头循环「升序 → 降序 → 取消」
  const [sort, setSort] = useState<SortState | null>(null);

  /** 各价格列的最低 / 最高值（按当前展示币种比较）；无有效值或全部相同则不标记 */
  const extremes = useMemo(() => {
    const map = new Map<string, { min: number; max: number }>();
    for (const column of columns) {
      if (!column.highlightExtremes) continue;
      let min = Infinity;
      let max = -Infinity;
      for (const row of rows) {
        const value = getNumericValue(row, column, cellOptions);
        if (value == null) continue;
        if (value < min) min = value;
        if (value > max) max = value;
      }
      if (min !== Infinity && min !== max) map.set(column.key, { min, max });
    }
    return map;
  }, [columns, rows, cellOptions]);

  /** 排序后的行：缺失值（—）恒排最后 */
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((item) => item.key === sort.key);
    if (!column) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = getNumericValue(a, column, cellOptions);
      const vb = getNumericValue(b, column, cellOptions);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va === vb) return 0;
      return va < vb ? -factor : factor;
    });
  }, [rows, columns, cellOptions, sort]);

  const handleSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold tracking-tight text-slate-900">对比结果</h2>
          <span className="text-sm text-slate-500">
            共 <span className="font-semibold tabular-nums text-blue-600">{rows.length}</span> 个模型
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="价格展示币种"
            className="flex h-9 items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm"
          >
            {CURRENCY_OPTIONS.map((option) => {
              const active = displayCurrency === option.value;
              const disabled = option.value !== "native" && !fx;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  disabled={disabled}
                  title={
                    disabled
                      ? "汇率数据暂不可用"
                      : option.value === "native"
                        ? "不做汇率换算，展示各厂商原生币种"
                        : `折算为${option.label}展示`
                  }
                  onClick={() => onDisplayCurrencyChange(option.value)}
                  className={`h-8 rounded-md px-2 text-sm transition-colors ${
                    active ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
                  } ${disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <ColumnSettings
            visible={visibleColumns}
            onChange={onVisibleColumnsChange}
            onReset={onResetColumns}
          />
          <button
            type="button"
            onClick={onClear}
            className="flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            清空列表
          </button>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-0 z-30 min-w-[220px] border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-left font-medium text-slate-500"
              >
                模型
              </th>
              {columns.map((column, index) => {
                const activeDir: SortDir | null =
                  sort && sort.key === column.key ? sort.dir : null;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      activeDir
                        ? activeDir === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className={`sticky top-0 z-20 whitespace-nowrap bg-slate-50 px-3.5 py-3 text-left font-medium text-slate-500 ${
                      index < columns.length - 1 ? "border-r border-slate-200" : ""
                    } border-b border-slate-200`}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(column.key)}
                        title="点击切换排序：升序 → 降序 → 取消"
                        className={`group/sort flex items-center gap-1 text-[13px] leading-tight transition-colors ${
                          activeDir ? "text-blue-600" : "hover:text-slate-800"
                        }`}
                      >
                        <span>{column.label}</span>
                        <SortIcon dir={activeDir} />
                      </button>
                    ) : (
                      <span className="block text-[13px] leading-tight">{column.label}</span>
                    )}
                    {column.hint ? (
                      <span className="block text-xs font-normal leading-tight text-slate-400">
                        {column.hint}
                      </span>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const { model } = row;
              const deprecated = Boolean(model.deprecatedAt);
              return (
                <tr key={model.sid} className="group">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 min-w-[220px] max-w-[280px] border-b border-r border-slate-100 bg-white px-4 py-3 text-left align-top transition-colors group-hover:bg-slate-50"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-slate-800" title={model.name}>
                            {model.name}
                          </span>
                          {deprecated ? (
                            <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-500">
                              已弃用
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-xs font-normal text-slate-500">
                          {model.provider.name}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemove(model.sid)}
                        title="从对比中移除"
                        aria-label={`移除 ${model.name}`}
                        className="shrink-0 rounded p-0.5 text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                      >
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5" aria-hidden="true">
                          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                        </svg>
                      </button>
                    </span>
                  </th>
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={`whitespace-nowrap px-3.5 py-3 align-top text-slate-700 ${
                        index < columns.length - 1 ? "border-r border-slate-100" : ""
                      } border-b border-slate-100`}
                    >
                      {renderCell(row, column, {
                        ...cellOptions,
                        extreme: getCellExtreme(row, column, extremes, cellOptions),
                      })}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="space-y-1.5 border-t border-slate-100 px-4 py-3 text-xs leading-relaxed text-slate-500 sm:px-5">
        <p>
          {displayCurrency !== "native" && fx ? (
            <>
              价格已折算为{displayCurrency === "CNY" ? "人民币" : "美元"}（汇率参考：1 USD ={" "}
              {formatFxRate(fx.rates.CNY)} CNY，{fx.asOf ?? "日期未知"}，{fxSourceLabel(fx.source)}
              ，仅供参考）；原价为各厂商原生币种的标准档（standard）。
            </>
          ) : (
            <>价格为各厂商原生币种的标准档（standard），未做汇率换算。</>
          )}
        </p>
        <p>输出速度与首 Token 延迟为 Artificial Analysis 跨供应商实测中位数。</p>
        <p>
          点击带排序图标的表头可对数值列排序，价格列的「最低 / 最高」标签在原生币种混合时按汇率折算后比较；点击「列设置」可增减对比指标。
        </p>
      </footer>
    </section>
  );
}
