// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * fx-source 使用模块级内存缓存与 inflight 去重，每个用例通过
 * vi.resetModules() + 动态 import 获得干净实例。
 */

const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest?base=USD";
const OPEN_ER_URL = "https://open.er-api.com/v6/latest/USD";
const T0 = "2026-09-13T08:00:00Z";

interface MockResponseInit {
  status?: number;
  body?: unknown;
}

/** 轻量 fetch 响应替身：仅实现 fx-source 使用到的字段 */
function mockResponse(init: MockResponseInit = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => init.body,
  };
}

async function loadFxSource() {
  vi.resetModules();
  return import("@/lib/server/fx-source");
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0));
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("getFxRates", () => {
  it("主源成功：解析汇率、补齐 USD 基准、记录发布日期", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockResponse({
          body: { date: "2026-09-12", rates: { CNY: 7.2, EUR: 0.92 } },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { getFxRates } = await loadFxSource();

    const fx = await getFxRates(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(FRANKFURTER_URL);
    expect(fx).toEqual({
      base: "USD",
      rates: { CNY: 7.2, EUR: 0.92, USD: 1 },
      asOf: "2026-09-12",
      fetchedAt: Date.parse(T0),
      source: "frankfurter",
    });
  });

  it("主源失败时回退 open.er-api，兼容 time_last_update_utc 时间字段", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ status: 500 }))
      .mockResolvedValueOnce(
        mockResponse({
          body: {
            time_last_update_utc: "Sun, 13 Sep 2026 00:00:00 +0000",
            rates: { USD: 1, CNY: 7.1 },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { getFxRates } = await loadFxSource();

    const fx = await getFxRates(false);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(OPEN_ER_URL);
    expect(fx.source).toBe("open-er-api");
    expect(fx.asOf).toBe("2026-09-13");
    expect(fx.rates.CNY).toBe(7.1);
  });

  it("跳过高于 0 的非法汇率项", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        body: {
          date: "2026-09-12",
          rates: { CNY: 7.2, BAD: -1, ALSO_BAD: "x" },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getFxRates } = await loadFxSource();

    const fx = await getFxRates(false);

    expect(fx.rates).toEqual({ CNY: 7.2, USD: 1 });
  });

  it("所有数据源均不可用时抛出聚合错误", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ status: 502 }))
      .mockResolvedValueOnce(mockResponse({ body: { rates: "broken" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { getFxRates } = await loadFxSource();

    await expect(getFxRates(false)).rejects.toThrow(
      /所有汇率数据源均不可用（frankfurter: HTTP 502；open-er-api: 响应结构异常）/,
    );
  });

  it("网络异常时记录源名并聚合错误", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket hang up"));
    vi.stubGlobal("fetch", fetchMock);
    const { getFxRates } = await loadFxSource();

    await expect(getFxRates(false)).rejects.toThrow(
      /frankfurter: socket hang up/,
    );
  });

  it("12 小时 TTL 内直接命中内存缓存，不重复请求", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ body: { date: "2026-09-12", rates: { CNY: 7.2 } } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { getFxRates } = await loadFxSource();

    const first = await getFxRates(false);
    const second = await getFxRates(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("超过 TTL 后重新拉取；强制刷新绕过缓存", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ body: { date: "2026-09-12", rates: { CNY: 7.2 } } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { getFxRates } = await loadFxSource();

    await getFxRates(false);

    // 强制刷新：TTL 内也重新请求
    fetchMock.mockResolvedValueOnce(
      mockResponse({ body: { date: "2026-09-12", rates: { CNY: 7.25 } } }),
    );
    const forced = await getFxRates(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(forced.rates.CNY).toBe(7.25);

    // 超过 12 小时：自动重新请求
    vi.setSystemTime(new Date("2026-09-14T00:00:00Z"));
    fetchMock.mockResolvedValueOnce(
      mockResponse({ body: { date: "2026-09-13", rates: { CNY: 7.3 } } }),
    );
    const refreshed = await getFxRates(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(refreshed.rates.CNY).toBe(7.3);
    expect(refreshed.fetchedAt).toBe(Date.parse("2026-09-14T00:00:00Z"));
  });

  it("刷新失败但有旧缓存时降级返回旧缓存，不抛错", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ body: { date: "2026-09-12", rates: { CNY: 7.2 } } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { getFxRates } = await loadFxSource();

    const cached = await getFxRates(false);

    vi.setSystemTime(new Date("2026-09-14T00:00:00Z"));
    fetchMock.mockRejectedValue(new Error("network down"));

    const fallback = await getFxRates(false);
    expect(fallback).toBe(cached);
  });

  it("并发调用共享同一个 inflight 请求", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ body: { date: "2026-09-12", rates: { CNY: 7.2 } } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { getFxRates } = await loadFxSource();

    const [a, b] = await Promise.all([getFxRates(false), getFxRates(false)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
});
