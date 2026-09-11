import type { PricingDataset } from "@/lib/types";

/**
 * 服务端数据源：主源为 llmrates.ai 公开数据集接口，兜底为同结构的 GitHub 开放数据集。
 *
 * 注意：数据集约 3.2MB，超过 Next.js FetchCache 单条 2MB 上限，
 * 因此这里使用进程内内存缓存（30 分钟 TTL），全站共享，避免每次请求都打上游。
 */

const SOURCES = [
  {
    url: "https://www.llmrates.ai/api/dataset",
    source: "llmrates",
  },
  {
    url: "https://raw.githubusercontent.com/llmrates/llm-pricing-dataset/main/data/dataset.json",
    source: "github",
  },
] as const;

export const SERVER_CACHE_TTL_MS = 30 * 60 * 1000;

const FETCH_TIMEOUT_MS = 20_000;

export interface PricingSnapshot {
  dataset: PricingDataset;
  /** 上游数据的抓取时间（毫秒时间戳） */
  fetchedAt: number;
  /** llmrates | github */
  source: string;
  /** 是否命中服务端内存缓存 */
  fromMemoryCache: boolean;
  /** 上游刷新失败，返回的是过期缓存 */
  stale: boolean;
}

let memoryCache: Omit<PricingSnapshot, "fromMemoryCache" | "stale"> | null = null;
let inflight: Promise<PricingSnapshot> | null = null;

function isPricingDataset(value: unknown): value is PricingDataset {
  if (value == null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.models) && Array.isArray(record.providers);
}

async function fetchFromUpstream(): Promise<Omit<PricingSnapshot, "fromMemoryCache" | "stale">> {
  const errors: string[] = [];

  for (const { url, source } of SOURCES) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        errors.push(`${source}: HTTP ${response.status}`);
        continue;
      }
      const data: unknown = await response.json();
      if (!isPricingDataset(data)) {
        errors.push(`${source}: 响应结构异常`);
        continue;
      }
      return { dataset: data, fetchedAt: Date.now(), source };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "网络错误";
      errors.push(`${source}: ${reason}`);
    }
  }

  throw new Error(`所有上游数据源均不可用（${errors.join("；")}）`);
}

export async function getPricingSnapshot(force: boolean): Promise<PricingSnapshot> {
  const now = Date.now();

  if (!force && memoryCache && now - memoryCache.fetchedAt < SERVER_CACHE_TTL_MS) {
    return { ...memoryCache, fromMemoryCache: true, stale: false };
  }

  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    try {
      const fresh = await fetchFromUpstream();
      memoryCache = fresh;
      return { ...fresh, fromMemoryCache: false, stale: false };
    } catch (error) {
      if (memoryCache) {
        // 刷新失败但存在旧缓存：降级返回旧数据并标记 stale
        return { ...memoryCache, fromMemoryCache: true, stale: true };
      }
      throw error;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
