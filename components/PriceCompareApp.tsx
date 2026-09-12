"use client";

import { useEffect, useMemo, useState } from "react";
import CompareTable from "./CompareTable";
import ModelPicker from "./ModelPicker";
import ProviderFilter from "./ProviderFilter";
import {
  getFxData,
  getPerformanceData,
  getPricingData,
  type DataSource,
  type PricingResult,
} from "@/lib/api";
import {
  DEFAULT_VISIBLE_COLUMNS,
  MAX_COMPARE_MODELS,
  PERFORMANCE_COLUMN_KEYS,
  formatDateTime,
  getColumn,
  toModelRow,
  type ModelRow,
} from "@/lib/metrics";
import {
  VISIBLE_COLUMNS_VERSION,
  loadDisplayCurrency,
  loadSelectedSids,
  loadVisibleColumns,
  loadVisibleColumnsVersion,
  saveDisplayCurrency,
  saveSelectedSids,
  saveVisibleColumns,
  saveVisibleColumnsVersion,
} from "@/lib/store";
import type {
  DisplayCurrency,
  FxRates,
  Model,
  PerformancePayload,
  PricingCatalog,
} from "@/lib/domain/types";

type Status = "loading" | "ready" | "error";

interface DataMeta {
  fetchedAt: number;
  source: DataSource;
  stale: boolean;
  serverCacheHit: boolean;
}

function describeSource(meta: DataMeta): string {
  switch (meta.source) {
    case "cache":
      return "本地缓存（30 分钟内有效）";
    case "stale-cache":
      return "本地过期缓存（刷新失败）";
    case "github":
      return "GitHub 兜底数据源";
    case "llmrates":
      return meta.serverCacheHit ? "服务端缓存（6 小时内有效）" : "llmrates.ai 数据源";
    default:
      return meta.serverCacheHit ? "服务端缓存（6 小时内有效）" : meta.source;
  }
}

export default function PriceCompareApp() {
  const [status, setStatus] = useState<Status>("loading");
  const [catalog, setCatalog] = useState<PricingCatalog | null>(null);
  const [performance, setPerformance] = useState<PerformancePayload | null>(null);
  const [fx, setFx] = useState<FxRates | null>(null);
  const [meta, setMeta] = useState<DataMeta | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [capWarning, setCapWarning] = useState<string | null>(null);

  const [providerSel, setProviderSel] = useState<string[]>([]);
  const [modelSel, setModelSel] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>("native");
  const [hydrated, setHydrated] = useState(false);

  // 应用一次取数结果：更新数据集 / 元信息 / 过期提示
  const applyResult = (result: PricingResult) => {
    setCatalog(result.catalog);
    setMeta({
      fetchedAt: result.fetchedAt,
      source: result.source,
      stale: result.stale,
      serverCacheHit: result.serverCacheHit,
    });
    setNotice(result.stale && result.error ? `数据刷新失败（${result.error}），当前展示缓存数据` : null);
  };

  // 首次加载：本地缓存（30 分钟）优先，过期则请求服务端
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [result, perf, fxData] = await Promise.all([
          getPricingData(),
          getPerformanceData(),
          getFxData(),
        ]);
        if (cancelled) return;
        applyResult(result);
        setPerformance(perf);
        setFx(fxData);

        // 恢复本地已选模型（剔除数据集中已不存在的 sid）
        const sids = new Set(result.catalog.models.map((model) => model.sid));
        const storedSids = loadSelectedSids();
        if (storedSids) {
          setModelSel(storedSids.filter((sid) => sids.has(sid)));
        }

        // 恢复列可见性（忽略已失效的列 key）；旧版本列设置一次性补上新增的性能列
        const storedColumns = loadVisibleColumns();
        if (storedColumns) {
          const valid = storedColumns.filter((key) => getColumn(key) !== undefined);
          const needsMigration = loadVisibleColumnsVersion() < VISIBLE_COLUMNS_VERSION;
          setVisibleColumns(needsMigration ? Array.from(new Set([...valid, ...PERFORMANCE_COLUMN_KEYS])) : valid);
        }

        // 恢复价格展示币种偏好
        const storedCurrency = loadDisplayCurrency();
        if (storedCurrency) setDisplayCurrency(storedCurrency);

        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "数据加载失败");
        setStatus("error");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 持久化选择与列设置（等待首次恢复完成后再写入，避免用空值覆盖）
  useEffect(() => {
    if (hydrated) saveSelectedSids(modelSel);
  }, [modelSel, hydrated]);

  useEffect(() => {
    if (hydrated) {
      saveVisibleColumns(visibleColumns);
      saveVisibleColumnsVersion(VISIBLE_COLUMNS_VERSION);
    }
  }, [visibleColumns, hydrated]);

  useEffect(() => {
    if (hydrated) saveDisplayCurrency(displayCurrency);
  }, [displayCurrency, hydrated]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      const [result, perf, fxData] = await Promise.all([
        getPricingData({ force: true }),
        getPerformanceData({ force: true }),
        getFxData({ force: true }),
      ]);
      applyResult(result);
      setPerformance(perf);
      setFx(fxData);
      const sids = new Set(result.catalog.models.map((model) => model.sid));
      setModelSel((prev) => prev.filter((sid) => sids.has(sid)));
      if (!result.stale) {
        const perfUsable = perf != null && Object.keys(perf.metrics).length > 0;
        setNotice(perfUsable ? "数据已刷新" : "价格数据已刷新；性能指标暂不可用");
      }
    } catch (error) {
      setNotice(`刷新失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setRefreshing(false);
    }
  };

  const providers = useMemo(() => {
    if (!catalog) return [];
    return [...catalog.providers].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  }, [catalog]);

  const modelBySid = useMemo(() => {
    const map = new Map<string, Model>();
    catalog?.models.forEach((model) => map.set(model.sid, model));
    return map;
  }, [catalog]);

  /** 二级过滤：按已选供应商筛选候选模型；未选供应商时展示全量模型 */
  const candidates = useMemo(() => {
    if (!catalog) return [];
    if (providerSel.length === 0) return catalog.models;
    const providerSet = new Set(providerSel);
    return catalog.models.filter((model) => providerSet.has(model.provider.slug));
  }, [catalog, providerSel]);

  /** 对比表格行：按勾选顺序排列，合并 Artificial Analysis 性能指标 */
  const rows: ModelRow[] = useMemo(
    () =>
      modelSel
        .map((sid) => modelBySid.get(sid))
        .filter((model): model is Model => model !== undefined)
        .map((model) => toModelRow(model, performance?.metrics[model.sid] ?? null)),
    [modelSel, modelBySid, performance],
  );

  /** 汇率不可用时回退为原生币种展示（保留用户偏好，待汇率恢复后自动生效） */
  const effectiveCurrency: DisplayCurrency = fx ? displayCurrency : "native";

  const handleModelChange = (values: string[]) => {
    if (values.length > MAX_COMPARE_MODELS) {
      setModelSel(values.slice(0, MAX_COMPARE_MODELS));
      setCapWarning(`对比列表最多同时展示 ${MAX_COMPARE_MODELS} 个模型，已自动保留前 ${MAX_COMPARE_MODELS} 个`);
    } else {
      setModelSel(values);
      setCapWarning(null);
    }
  };

  const handleRemoveModel = (sid: string) => {
    setModelSel((prev) => prev.filter((item) => item !== sid));
    setCapWarning(null);
  };

  const handleClearModels = () => {
    setModelSel([]);
    setCapWarning(null);
  };

  const handleColumnsChange = (keys: string[]) => {
    setVisibleColumns(keys);
  };

  const handleResetColumns = () => {
    setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
  };

  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
      {/* 顶部栏 */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            模型价格对比
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            对比各模型供应商的 API 价格与规格，数据每 30 分钟自动缓存一次
          </p>
        </div>
        <div className="flex items-center gap-3">
          {meta ? (
            <div className="text-right text-xs leading-relaxed text-slate-500">
              <div className={meta.stale ? "font-medium text-amber-600" : "font-medium text-slate-600"}>
                {describeSource(meta)}
              </div>
              <div>数据更新于 {formatDateTime(meta.fetchedAt)}</div>
              {performance && performance.matchedCount > 0 ? (
                <div>
                  性能指标已匹配 {performance.matchedCount}/{performance.totalModels} 个模型
                </div>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || status === "loading"}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            >
              <path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6M16.5 3.5v3.6h-3.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {refreshing ? "刷新中…" : "刷新数据"}
          </button>
        </div>
      </header>

      {notice ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          {notice}
        </div>
      ) : null}

      {status === "loading" ? (
        <div className="space-y-4">
          <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        </div>
      ) : status === "error" ? (
        <div className="rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <p className="text-base font-medium text-slate-800">数据加载失败</p>
          <p className="mt-2 text-sm text-slate-500">{errorMessage}</p>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
          >
            重试
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* 过滤区 */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
              <div>
                <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[11px] font-semibold text-blue-600">
                    1
                  </span>
                  模型供应商
                  <span className="font-normal text-slate-400">（可多选，不选代表全部）</span>
                </label>
                <ProviderFilter providers={providers} selected={providerSel} onChange={setProviderSel} />
              </div>
              <div>
                <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[11px] font-semibold text-blue-600">
                    2
                  </span>
                  勾选要对比的具体模型
                </label>
                <ModelPicker candidates={candidates} selected={modelSel} onChange={handleModelChange} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>
                当前候选 <span className="font-medium text-slate-700">{candidates.length}</span> 个模型
                （{providerSel.length === 0 ? "全部供应商" : `已筛 ${providerSel.length} 个供应商`}）
              </span>
              <span className="text-slate-200">|</span>
              <span>
                已选 <span className="font-medium text-blue-600">{modelSel.length}</span> / {MAX_COMPARE_MODELS}
              </span>
              <span className="text-slate-200">|</span>
              <span>
                数据集共 {catalog?.models.length ?? 0} 个模型、{catalog?.providers.length ?? 0} 个供应商
              </span>
            </div>
            {capWarning ? <p className="mt-2 text-xs font-medium text-amber-600">{capWarning}</p> : null}

            {modelSel.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
                <span className="mr-1 text-xs text-slate-500">已选：</span>
                {modelSel.map((sid) => {
                  const model = modelBySid.get(sid);
                  if (!model) return null;
                  return (
                    <span
                      key={sid}
                      className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 py-0.5 pl-2.5 pr-1 text-xs text-blue-700"
                    >
                      <span className="max-w-[220px] truncate" title={`${model.name} · ${model.provider.name}`}>
                        {model.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveModel(sid)}
                        aria-label={`移除 ${model.name}`}
                        className="rounded-full p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-700"
                      >
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3 w-3" aria-hidden="true">
                          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                        </svg>
                      </button>
                    </span>
                  );
                })}
                <button
                  type="button"
                  onClick={handleClearModels}
                  className="ml-1 rounded px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
                >
                  清空
                </button>
              </div>
            ) : null}
          </section>

          {/* 对比表格 */}
          {rows.length > 0 ? (
            <CompareTable
              rows={rows}
              visibleColumns={visibleColumns}
              onVisibleColumnsChange={handleColumnsChange}
              onResetColumns={handleResetColumns}
              onRemove={handleRemoveModel}
              onClear={handleClearModels}
              displayCurrency={effectiveCurrency}
              onDisplayCurrencyChange={setDisplayCurrency}
              fx={fx}
            />
          ) : (
            <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
              <p className="text-base font-medium text-slate-700">还没有选择要对比的模型</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                先用「模型供应商」筛选范围，再打开「具体模型」下拉，勾选任意模型即可加入对比列表。
                对比表格以模型为行、指标为列展示。
              </p>
            </section>
          )}

          {/* 数据署名 */}
          <footer className="space-y-1.5 pb-6 text-center text-xs leading-relaxed text-slate-500">
            <p>
              数据来自{" "}
              <a
                href="https://www.llmrates.ai"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-slate-300 underline-offset-2 hover:text-slate-600"
              >
                LLMRates.ai
              </a>{" "}
              开放数据集（CC BY 4.0）。
            </p>
            <p>
              价格为各厂商原生币种的标准档（standard），可切换人民币/美元折算展示（汇率仅供参考），请以厂商官方页面为准。
            </p>
            <p>
              性能指标（输出速度、首 Token 延迟）来自{" "}
              <a
                href="https://artificialanalysis.ai/"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-slate-300 underline-offset-2 hover:text-slate-600"
              >
                Artificial Analysis
              </a>
              ，为跨供应商实测中位数。
            </p>
          </footer>
        </div>
      )}
    </main>
  );
}
