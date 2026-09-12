import { expect, type Page } from "@playwright/test";
import type {
  FxRates,
  PerformancePayload,
  PricingCatalog,
} from "../lib/domain/types";

/**
 * E2E 对外部数据源全部 mock：固定数据集保证断言确定，
 * 不依赖 LLMRates / Artificial Analysis / 汇率上游的网络与波动。
 */

/** 确定性价格数据集：4 个模型、2 个供应商、USD 与 CNY 混合 */
export const testCatalog: PricingCatalog = {
  meta: {
    name: "e2e",
    publisher: "e2e",
    license: "CC BY 4.0",
    datasetUrl: "",
    repoUrl: "",
    note: "",
    modelCount: 4,
    providerCount: 2,
    priceRowCount: 4,
  },
  providers: [
    {
      slug: "acme",
      name: "Acme AI",
      nameLocal: "艾克米",
      type: "direct",
      modelCount: 2,
    },
    {
      slug: "gadget",
      name: "Gadget Cloud",
      nameLocal: null,
      type: "aggregator",
      modelCount: 2,
    },
  ],
  models: [
    {
      sid: "acme/alpha-1",
      name: "Alpha 1",
      slug: "alpha-1",
      family: "alpha",
      modelType: "general",
      contextWindow: 128_000,
      maxOutput: 16_384,
      modalities: ["text", "image"],
      supportsTools: true,
      supportsBatch: false,
      supportsCaching: true,
      supportsStreaming: true,
      releaseDate: "2026-01-01",
      knowledgeCutoff: null,
      deprecatedAt: null,
      provider: { name: "Acme AI", slug: "acme", type: "direct" },
      pricing: [
        {
          inputPerMillion: 1,
          outputPerMillion: 4,
          cachedInputPerMillion: 0.5,
          cachedWritePerMillion: null,
          thinkingOutputPerMillion: null,
          currency: "USD",
          tier: "standard",
          region: null,
          sourceUrl: "https://example.com/alpha-1",
        },
      ],
    },
    {
      sid: "acme/beta-mini",
      name: "Beta Mini",
      slug: "beta-mini",
      family: "beta",
      modelType: "general",
      contextWindow: 64_000,
      maxOutput: 8_192,
      modalities: ["text"],
      supportsTools: true,
      supportsBatch: true,
      supportsCaching: false,
      supportsStreaming: true,
      releaseDate: "2025-06-01",
      knowledgeCutoff: null,
      deprecatedAt: "2026-06-01",
      provider: { name: "Acme AI", slug: "acme", type: "direct" },
      pricing: [
        {
          inputPerMillion: 7,
          outputPerMillion: 21,
          cachedInputPerMillion: 3.5,
          cachedWritePerMillion: null,
          thinkingOutputPerMillion: null,
          currency: "CNY",
          tier: "standard",
          region: null,
          sourceUrl: null,
        },
      ],
    },
    {
      sid: "gadget/gamma-pro",
      name: "Gamma Pro",
      slug: "gamma-pro",
      family: "gamma",
      modelType: "general",
      contextWindow: 256_000,
      maxOutput: 32_768,
      modalities: ["text"],
      supportsTools: true,
      supportsBatch: false,
      supportsCaching: true,
      supportsStreaming: true,
      releaseDate: "2026-03-01",
      knowledgeCutoff: null,
      deprecatedAt: null,
      provider: { name: "Gadget Cloud", slug: "gadget", type: "aggregator" },
      pricing: [
        {
          inputPerMillion: 0.5,
          outputPerMillion: 2,
          cachedInputPerMillion: null,
          cachedWritePerMillion: null,
          thinkingOutputPerMillion: null,
          currency: "USD",
          tier: "standard",
          region: null,
          sourceUrl: null,
        },
      ],
    },
    {
      sid: "gadget/delta-ultra",
      name: "Delta Ultra",
      slug: "delta-ultra",
      family: "delta",
      modelType: "general",
      contextWindow: 512_000,
      maxOutput: 64_000,
      modalities: ["text", "image"],
      supportsTools: true,
      supportsBatch: false,
      supportsCaching: true,
      supportsStreaming: true,
      releaseDate: "2025-12-01",
      knowledgeCutoff: null,
      deprecatedAt: null,
      provider: { name: "Gadget Cloud", slug: "gadget", type: "aggregator" },
      pricing: [
        {
          inputPerMillion: 10,
          outputPerMillion: 40,
          cachedInputPerMillion: 5,
          cachedWritePerMillion: null,
          thinkingOutputPerMillion: null,
          currency: "USD",
          tier: "standard",
          region: null,
          sourceUrl: null,
        },
      ],
    },
  ],
};

export const testPerformance: PerformancePayload = {
  generatedAt: 1_789_000_000_000,
  source: "artificial_analysis",
  matchedCount: 2,
  totalModels: 4,
  metrics: {
    "acme/alpha-1": {
      outputTokensPerSecond: 120.5,
      timeToFirstTokenSeconds: 0.42,
      sourceModelSlug: "alpha-1",
    },
    "gadget/gamma-pro": {
      outputTokensPerSecond: 80,
      timeToFirstTokenSeconds: 1.2,
      sourceModelSlug: "gamma-pro",
    },
  },
};

export const testFx: FxRates = {
  base: "USD",
  rates: { USD: 1, CNY: 7.2 },
  asOf: "2026-09-12",
  fetchedAt: 1_789_000_000_000,
  source: "frankfurter",
};

export interface MockApiHandle {
  /** /api/pricing 的请求 URL 记录（用于断言 force 参数） */
  pricingUrls: string[];
  /** 动态切换价格接口是否返回 502（重试场景用） */
  setFailPricing(value: boolean): void;
}

/** 拦截页面请求的 /api/pricing、/api/performance、/api/fx 并返回固定数据 */
export async function mockApis(
  page: Page,
  options: { failPricing?: boolean } = {},
): Promise<MockApiHandle> {
  const pricingUrls: string[] = [];
  let failPricing = options.failPricing ?? false;

  await page.route(/\/api\/pricing(\?|$)/, async (route) => {
    pricingUrls.push(route.request().url());
    if (failPricing) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "上游数据源暂时不可用" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "X-Data-Source": "llmrates",
        "X-Fetched-At": "2026-09-13T02:00:00.000Z",
        "X-Cache-Hit": "0",
        "X-Stale": "0",
      },
      body: JSON.stringify(testCatalog),
    });
  });

  await page.route(/\/api\/performance(\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(testPerformance),
    }),
  );

  await page.route(/\/api\/fx(\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(testFx),
    }),
  );

  return {
    pricingUrls,
    setFailPricing(value: boolean) {
      failPricing = value;
    },
  };
}

/** 打开首页并等待数据加载完成（筛选区统计文本出现） */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByText(/数据集共/)).toBeVisible();
}

/** 打开「具体模型」下拉并勾选指定模型（按传入顺序），随后关闭下拉 */
export async function selectModels(page: Page, names: string[]): Promise<void> {
  await page.getByRole("button", { name: "具体模型" }).click();
  for (const name of names) {
    await page.getByRole("checkbox", { name }).click();
  }
  await page.keyboard.press("Escape");
}

/** 打开「模型供应商」下拉并勾选指定供应商，随后关闭下拉 */
export async function selectProvider(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "模型供应商" }).click();
  await page.getByRole("checkbox", { name }).click();
  await page.keyboard.press("Escape");
}

/** 对比表格第一行数据行 */
export function firstDataRow(page: Page) {
  return page.locator("tbody tr").first();
}
