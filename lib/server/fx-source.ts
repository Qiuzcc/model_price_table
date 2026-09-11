import type { FxRates } from "@/lib/types";

/**
 * 服务端数据源：美元基准汇率（用于价格展示币种换算）。
 *
 * - 主源 Frankfurter（ECB 参考汇率，免 key），兜底 open.er-api.com；
 *   ECB 每个工作日更新一次，内存缓存 12 小时，失败时降级返回旧缓存。
 * - 仅服务端调用：客户端通过 /api/fx 获取，避免向第三方免费源直接暴露访客流量。
 */

const SOURCES = [
  {
    url: "https://api.frankfurter.dev/v1/latest?base=USD",
    source: "frankfurter",
  },
  {
    url: "https://open.er-api.com/v6/latest/USD",
    source: "open-er-api",
  },
] as const;

export const FX_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 10_000;

let memoryCache: FxRates | null = null;
let inflight: Promise<FxRates> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 兼容两代免费源：Frankfurter（date + rates）/ open.er-api（time_last_update_utc + rates） */
function parseRates(
  payload: unknown,
): { rates: Record<string, number>; asOf: string | null } | null {
  if (!isRecord(payload) || !isRecord(payload.rates)) return null;

  const rates: Record<string, number> = {};
  for (const [unit, value] of Object.entries(payload.rates)) {
    const rate = toNumber(value);
    if (rate != null && rate > 0) rates[unit] = rate;
  }
  if (Object.keys(rates).length === 0) return null;

  // Frankfurter 不含基准自身；open.er-api 已含 USD: 1，统一补齐
  rates.USD = 1;

  let asOf: string | null = null;
  if (typeof payload.date === "string") {
    asOf = payload.date.slice(0, 10);
  } else if (typeof payload.time_last_update_utc === "string") {
    const parsed = new Date(payload.time_last_update_utc);
    asOf = Number.isNaN(parsed.getTime())
      ? null
      : parsed.toISOString().slice(0, 10);
  }
  return { rates, asOf };
}

async function fetchRates(): Promise<FxRates> {
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
      const parsed = parseRates(await response.json());
      if (!parsed) {
        errors.push(`${source}: 响应结构异常`);
        continue;
      }
      const fx: FxRates = {
        base: "USD",
        rates: parsed.rates,
        asOf: parsed.asOf,
        fetchedAt: Date.now(),
        source,
      };
      memoryCache = fx;
      return fx;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "网络错误";
      errors.push(`${source}: ${reason}`);
    }
  }

  throw new Error(`所有汇率数据源均不可用（${errors.join("；")}）`);
}

export async function getFxRates(force: boolean): Promise<FxRates> {
  const now = Date.now();

  if (!force && memoryCache && now - memoryCache.fetchedAt < FX_CACHE_TTL_MS) {
    return memoryCache;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      return await fetchRates();
    } catch (error) {
      console.warn(
        `[fx] 汇率拉取失败：${error instanceof Error ? error.message : "网络错误"}`,
      );
      if (memoryCache) return memoryCache;
      throw error;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
