import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import {
  PricingFetchError,
  getFxData,
  getPerformanceData,
  getPricingData,
  readClientCache,
  writeClientCache,
} from "@/lib/api";
import { readCache, removeCache, writeCache } from "@/lib/cache";
import type {
  FxRates,
  PerformancePayload,
  PricingCatalog,
} from "@/lib/domain/types";

const catalog: PricingCatalog = {
  meta: {
    name: "test",
    publisher: "test",
    license: "CC BY 4.0",
    datasetUrl: "",
    repoUrl: "",
    note: "",
    modelCount: 0,
    providerCount: 0,
    priceRowCount: 0,
  },
  providers: [],
  models: [],
};

const performance: PerformancePayload = {
  generatedAt: 100,
  source: "artificial_analysis",
  matchedCount: 0,
  totalModels: 0,
  metrics: {},
};

const fx: FxRates = {
  base: "USD",
  rates: { USD: 1, CNY: 7.2 },
  asOf: "2026-09-12",
  fetchedAt: 200,
  source: "frankfurter",
};

interface MockResponseInit {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  jsonThrows?: boolean;
}

/** 轻量 fetch 响应替身：仅实现 lib/api 使用到的字段 */
function mockResponse(init: MockResponseInit = {}) {
  const status = init.status ?? 200;
  const headers = init.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => {
      if (init.jsonThrows) throw new Error("invalid json");
      return init.body;
    },
  };
}

function stubFetch(...responses: ReturnType<typeof mockResponse>[]) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getPricingData", () => {
  it("请求 /api/pricing 并解析响应头（来源 / 时间 / 缓存 / 过期标记）", async () => {
    const fetchMock = stubFetch(
      mockResponse({
        headers: {
          "X-Data-Source": "llmrates",
          "X-Fetched-At": "2026-09-13T00:00:00.000Z",
          "X-Stale": "1",
          "X-Cache-Hit": "1",
        },
        body: catalog,
      }),
    );

    const result = await getPricingData();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/pricing", {
      cache: "no-store",
    });
    expect(result.catalog).toEqual(catalog);
    expect(result.source).toBe("llmrates");
    expect(result.fetchedAt).toBe(Date.parse("2026-09-13T00:00:00.000Z"));
    expect(result.stale).toBe(true);
    expect(result.serverCacheHit).toBe(true);
  });

  it("force 时携带 ?force=1 参数", async () => {
    const fetchMock = stubFetch(mockResponse({ body: catalog }));
    await getPricingData({ force: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/pricing?force=1", {
      cache: "no-store",
    });
  });

  it("响应头缺失时回退为 unknown 与当前时间", async () => {
    stubFetch(mockResponse({ body: catalog }));
    const before = Date.now();
    const result = await getPricingData();
    expect(result.source).toBe("unknown");
    expect(result.fetchedAt).toBeGreaterThanOrEqual(before);
    expect(result.stale).toBe(false);
    expect(result.serverCacheHit).toBe(false);
  });

  it("X-Fetched-At 非法时回退为当前时间", async () => {
    stubFetch(
      mockResponse({
        headers: { "X-Fetched-At": "not-a-date" },
        body: catalog,
      }),
    );
    const before = Date.now();
    const result = await getPricingData();
    expect(result.fetchedAt).toBeGreaterThanOrEqual(before);
  });

  it("非 2xx 时抛出 PricingFetchError 并携带服务端错误信息", async () => {
    stubFetch(
      mockResponse({ status: 502, body: { error: "上游数据源暂时不可用" } }),
    );

    const promise = getPricingData();
    await expect(promise).rejects.toThrow(PricingFetchError);
    await expect(promise).rejects.toThrow("上游数据源暂时不可用");
  });

  it("错误响应体不是 JSON 时使用 HTTP 状态码文案", async () => {
    stubFetch(mockResponse({ status: 500, jsonThrows: true }));
    await expect(getPricingData()).rejects.toThrow("数据请求失败（HTTP 500）");
  });
});

describe("getPerformanceData", () => {
  it("成功时返回性能数据包", async () => {
    const fetchMock = stubFetch(mockResponse({ body: performance }));
    await expect(getPerformanceData()).resolves.toEqual(performance);
    expect(fetchMock).toHaveBeenCalledWith("/api/performance", {
      cache: "no-store",
    });
  });

  it("非 2xx、结构异常或网络错误时返回 null（不阻断主流程）", async () => {
    stubFetch(mockResponse({ status: 503 }));
    await expect(getPerformanceData()).resolves.toBeNull();

    stubFetch(mockResponse({ body: { metrics: "not-an-object" } }));
    await expect(getPerformanceData()).resolves.toBeNull();

    stubFetch(mockResponse({ body: null }));
    await expect(getPerformanceData()).resolves.toBeNull();

    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getPerformanceData()).resolves.toBeNull();
  });
});

describe("getFxData", () => {
  it("成功时返回汇率数据", async () => {
    const fetchMock = stubFetch(mockResponse({ body: fx }));
    await expect(getFxData()).resolves.toEqual(fx);
    expect(fetchMock).toHaveBeenCalledWith("/api/fx", { cache: "no-store" });
  });

  it("rates 为空、结构异常或网络错误时返回 null", async () => {
    stubFetch(mockResponse({ body: { ...fx, rates: {} } }));
    await expect(getFxData()).resolves.toBeNull();

    stubFetch(mockResponse({ body: { rates: null } }));
    await expect(getFxData()).resolves.toBeNull();

    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getFxData()).resolves.toBeNull();
  });
});

describe("客户端首屏缓存", () => {
  const clientCacheKey = "client-bundle-v1";

  // 该 key 为固定值，每个用例前清理，避免用例间相互影响
  beforeEach(async () => {
    await removeCache(clientCacheKey);
  });

  it("写入后可读回，且不含 error 字段", async () => {
    const result = {
      catalog,
      fetchedAt: 300,
      source: "llmrates",
      stale: false,
      serverCacheHit: true,
    };
    await writeClientCache(result, performance, fx);

    const bundle = await readClientCache();
    expect(bundle).toEqual({
      pricing: {
        catalog,
        fetchedAt: 300,
        source: "llmrates",
        stale: false,
        serverCacheHit: true,
      },
      performance,
      fx,
    });
    expect(bundle?.pricing).not.toHaveProperty("error");
  });

  it("缓存不存在时返回 null", async () => {
    await expect(readClientCache()).resolves.toBeNull();
  });

  it("结构不符时返回 null 并清理无效缓存", async () => {
    await writeCache(clientCacheKey, { pricing: { notUsable: true } }, 1);

    await expect(readClientCache()).resolves.toBeNull();
    await vi.waitFor(async () => {
      await expect(readCache(clientCacheKey)).resolves.toBeNull();
    });
  });
});
