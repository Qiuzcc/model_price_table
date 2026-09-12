import { readCache, removeCache, writeCache } from "./cache";
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

/* ------------------------------ 客户端首屏缓存 ------------------------------ */

/**
 * 客户端本地缓存包：价格 / 性能 / 汇率整体读写，保证首屏渲染的数据集互相一致。
 * key 带结构版本号，字段调整时升级版本即可让旧缓存自然失效。
 */
const CLIENT_CACHE_KEY = "client-bundle-v1";

export interface ClientCacheBundle {
  /** 最近一次成功取数的结果（不含 error 字段） */
  pricing: Omit<PricingResult, "error">;
  performance: PerformancePayload | null;
  fx: FxRates | null;
}

function isUsableBundle(value: unknown): value is ClientCacheBundle {
  if (value == null || typeof value !== "object") return false;
  const { pricing } = value as { pricing?: Partial<PricingResult> };
  return (
    pricing != null &&
    typeof pricing === "object" &&
    typeof pricing.fetchedAt === "number" &&
    typeof pricing.source === "string" &&
    Array.isArray(pricing.catalog?.models) &&
    Array.isArray(pricing.catalog?.providers)
  );
}

/**
 * 读取本地首屏缓存（打开页面时优先渲染用）。
 * 未写入过 / 结构不符 / IndexedDB 不可用时返回 null，由调用方回退到网络直取。
 */
export async function readClientCache(): Promise<ClientCacheBundle | null> {
  const envelope = await readCache<unknown>(CLIENT_CACHE_KEY);
  if (!envelope) return null;
  if (!isUsableBundle(envelope.data)) {
    // 旧版本残留 / 写入中断导致的无效数据：清理后按无缓存处理
    void removeCache(CLIENT_CACHE_KEY);
    return null;
  }
  return envelope.data;
}

/** 取数成功后刷新本地缓存（价格 / 性能 / 汇率整体写入）；失败静默降级 */
export async function writeClientCache(
  result: PricingResult,
  performance: PerformancePayload | null,
  fx: FxRates | null,
): Promise<void> {
  await writeCache<ClientCacheBundle>(CLIENT_CACHE_KEY, {
    pricing: {
      catalog: result.catalog,
      fetchedAt: result.fetchedAt,
      source: result.source,
      stale: result.stale,
      serverCacheHit: result.serverCacheHit,
    },
    performance,
    fx,
  });
}
