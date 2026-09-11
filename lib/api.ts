import { readCache, writeCache } from "./cache";
import type { FxRates, PerformancePayload, PricingDataset } from "./types";

/** 客户端本地缓存有效期：30 分钟 */
export const CLIENT_CACHE_TTL_MS = 30 * 60 * 1000;

const CACHE_KEY = "dataset-v1";

/** 本次数据的来源：本地缓存 / llmrates 主源 / GitHub 兜底源 / 过期缓存 */
export type DataSource = "llmrates" | "github" | "cache" | "stale-cache";

export interface PricingResult {
  dataset: PricingDataset;
  /** 上游数据的抓取时间（毫秒时间戳） */
  fetchedAt: number;
  source: DataSource;
  /** 是否来自本地缓存 */
  fromCache: boolean;
  /** 上游刷新失败，展示的是过期缓存 */
  stale: boolean;
  /** 是否命中服务端磁盘缓存（6 小时） */
  serverCacheHit: boolean;
  error?: string;
}

export class PricingFetchError extends Error {}

async function requestFromServer(force: boolean): Promise<PricingResult> {
  const response = await fetch(`/api/pricing${force ? "?force=1" : ""}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new PricingFetchError(
      body?.error ?? `数据请求失败（HTTP ${response.status}）`,
    );
  }

  const dataset = (await response.json()) as PricingDataset;
  const sourceHeader = response.headers.get("X-Data-Source");
  const fetchedAtHeader = response.headers.get("X-Fetched-At");
  const fetchedAt = fetchedAtHeader ? Date.parse(fetchedAtHeader) : Date.now();

  return {
    dataset,
    fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : Date.now(),
    source: sourceHeader === "github" ? "github" : "llmrates",
    fromCache: false,
    stale: response.headers.get("X-Stale") === "1",
    serverCacheHit: response.headers.get("X-Cache-Hit") === "1",
  };
}

/**
 * 获取价格数据：
 * 1. 本地缓存命中且未过期（30 分钟）→ 直接返回；
 * 2. 否则请求 /api/pricing 并回写本地缓存；
 * 3. 请求失败但存在过期缓存 → 降级返回过期缓存（stale=true）。
 */
export async function getPricingData(options?: {
  force?: boolean;
}): Promise<PricingResult> {
  const force = options?.force ?? false;
  const cached = await readCache<PricingDataset>(CACHE_KEY);
  const now = Date.now();

  if (!force && cached && now - cached.fetchedAt < CLIENT_CACHE_TTL_MS) {
    return {
      dataset: cached.data,
      fetchedAt: cached.fetchedAt,
      source: "cache",
      fromCache: true,
      stale: false,
      serverCacheHit: false,
    };
  }

  try {
    const result = await requestFromServer(force);
    await writeCache(CACHE_KEY, result.dataset, result.fetchedAt);
    return result;
  } catch (error) {
    if (cached) {
      return {
        dataset: cached.data,
        fetchedAt: cached.fetchedAt,
        source: "stale-cache",
        fromCache: true,
        stale: true,
        serverCacheHit: false,
        error: error instanceof Error ? error.message : "数据刷新失败",
      };
    }
    throw error;
  }
}

/** 性能数据（Artificial Analysis）客户端缓存有效期：12 小时 */
export const PERF_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const PERF_CACHE_KEY = "performance-v1";

/**
 * 获取 Artificial Analysis 性能数据（sid → 输出速度 / 首 Token 延迟）。
 * 与价格数据相互独立：任何失败都返回 null 或过期缓存，不阻断主流程。
 */
export async function getPerformanceData(options?: {
  force?: boolean;
}): Promise<PerformancePayload | null> {
  const force = options?.force ?? false;
  const cached = await readCache<PerformancePayload>(PERF_CACHE_KEY);
  const now = Date.now();

  if (!force && cached && now - cached.fetchedAt < PERF_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const response = await fetch(`/api/performance${force ? "?force=1" : ""}`, {
      cache: "no-store",
    });
    if (!response.ok) return cached?.data ?? null;
    const payload = (await response.json()) as PerformancePayload;
    const usable =
      payload != null &&
      typeof payload === "object" &&
      typeof payload.metrics === "object";
    if (!usable) return cached?.data ?? null;
    // 仅有内容时才写入缓存，避免把「未配置/暂不可用」的空结果锁定 12 小时
    if (Object.keys(payload.metrics).length > 0) {
      await writeCache(PERF_CACHE_KEY, payload, Date.now());
    }
    return payload;
  } catch {
    return cached?.data ?? null;
  }
}

/** 汇率数据客户端缓存有效期：12 小时（ECB 每工作日更新一次） */
export const FX_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const FX_CACHE_KEY = "fx-v1";

/**
 * 获取 USD 基准汇率（价格展示币种换算用）。
 * 失败返回 null 或过期缓存，不阻断主流程。
 */
export async function getFxData(options?: {
  force?: boolean;
}): Promise<FxRates | null> {
  const force = options?.force ?? false;
  const cached = await readCache<FxRates>(FX_CACHE_KEY);
  const now = Date.now();

  if (!force && cached && now - cached.fetchedAt < FX_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const response = await fetch(`/api/fx${force ? "?force=1" : ""}`, {
      cache: "no-store",
    });
    if (!response.ok) return cached?.data ?? null;
    const fx = (await response.json()) as FxRates;
    const usable =
      fx != null &&
      typeof fx.rates === "object" &&
      Object.keys(fx.rates).length > 0;
    if (!usable) return cached?.data ?? null;
    await writeCache(FX_CACHE_KEY, fx, Date.now());
    return fx;
  } catch {
    return cached?.data ?? null;
  }
}
