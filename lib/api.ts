import type {
  FxRates,
  PerformancePayload,
  PricingCatalog,
} from "./domain/types";

/** 本次数据的来源：服务端数据源适配器 id（llmrates / github / …） */
export type DataSource = string;

export interface PricingResult {
  catalog: PricingCatalog;
  /** 上游数据的抓取时间（毫秒时间戳） */
  fetchedAt: number;
  source: DataSource;
  /** 上游刷新失败，展示的是服务端过期磁盘缓存 */
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

  const catalog = (await response.json()) as PricingCatalog;
  const sourceHeader = response.headers.get("X-Data-Source");
  const fetchedAtHeader = response.headers.get("X-Fetched-At");
  const fetchedAt = fetchedAtHeader ? Date.parse(fetchedAtHeader) : Date.now();

  return {
    catalog,
    fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : Date.now(),
    source: sourceHeader ?? "unknown",
    stale: response.headers.get("X-Stale") === "1",
    serverCacheHit: response.headers.get("X-Cache-Hit") === "1",
  };
}

/**
 * 获取价格数据：直接代理服务端 /api/pricing；服务端 6 小时磁盘缓存 + 多源回退由服务端负责。
 * 失败向上抛出，由调用方决定 UI 行为。
 */
export async function getPricingData(options?: {
  force?: boolean;
}): Promise<PricingResult> {
  const force = options?.force ?? false;
  return requestFromServer(force);
}

/**
 * 获取 Artificial Analysis 性能数据（sid → 输出速度 / 首 Token 延迟）。
 * 与价格数据相互独立：失败返回 null，不阻断主流程。
 */
export async function getPerformanceData(options?: {
  force?: boolean;
}): Promise<PerformancePayload | null> {
  const force = options?.force ?? false;
  try {
    const response = await fetch(`/api/performance${force ? "?force=1" : ""}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as PerformancePayload;
    const usable =
      payload != null &&
      typeof payload === "object" &&
      typeof payload.metrics === "object";
    return usable ? payload : null;
  } catch {
    return null;
  }
}

/**
 * 获取 USD 基准汇率（价格展示币种换算用）。
 * 失败返回 null，不阻断主流程。
 */
export async function getFxData(options?: {
  force?: boolean;
}): Promise<FxRates | null> {
  const force = options?.force ?? false;
  try {
    const response = await fetch(`/api/fx${force ? "?force=1" : ""}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const fx = (await response.json()) as FxRates;
    const usable =
      fx != null &&
      typeof fx.rates === "object" &&
      Object.keys(fx.rates).length > 0;
    return usable ? fx : null;
  } catch {
    return null;
  }
}
