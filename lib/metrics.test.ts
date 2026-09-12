import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  DEFAULT_VISIBLE_COLUMNS,
  MAX_COMPARE_MODELS,
  PERFORMANCE_COLUMN_KEYS,
  convertCurrency,
  currencySymbol,
  formatDate,
  formatDateTime,
  formatLatency,
  formatPrice,
  formatSpeed,
  formatTokens,
  getColumn,
  modalityLabel,
  pickHeadlinePricing,
  toModelRow,
} from "@/lib/metrics";
import type { Model, ModelPricing } from "@/lib/domain/types";

function makePricing(overrides: Partial<ModelPricing> = {}): ModelPricing {
  return {
    inputPerMillion: null,
    outputPerMillion: null,
    cachedInputPerMillion: null,
    cachedWritePerMillion: null,
    thinkingOutputPerMillion: null,
    currency: "USD",
    tier: "standard",
    region: null,
    sourceUrl: null,
    ...overrides,
  };
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    sid: "acme/alpha",
    name: "Alpha",
    slug: "alpha",
    family: null,
    modelType: "general",
    contextWindow: 128_000,
    maxOutput: 16_384,
    modalities: ["text"],
    supportsTools: true,
    supportsBatch: false,
    supportsCaching: true,
    supportsStreaming: true,
    releaseDate: "2026-01-01",
    knowledgeCutoff: null,
    deprecatedAt: null,
    provider: { name: "Acme", slug: "acme", type: "direct" },
    pricing: [makePricing()],
    ...overrides,
  };
}

describe("pickHeadlinePricing", () => {
  it("价格行为空时返回 null", () => {
    expect(pickHeadlinePricing(makeModel({ pricing: [] }))).toBeNull();
  });

  it("优先选择 standard 档且无区域限定的行", () => {
    const regional = makePricing({
      tier: "standard",
      region: "cn",
      inputPerMillion: 9,
    });
    const standard = makePricing({
      tier: "standard",
      region: null,
      inputPerMillion: 1,
    });
    const batch = makePricing({ tier: "batch", inputPerMillion: 0.5 });
    expect(
      pickHeadlinePricing(makeModel({ pricing: [batch, regional, standard] })),
    ).toBe(standard);
  });

  it("standard 行都带区域限定时取首个 standard 行", () => {
    const first = makePricing({ tier: "standard", region: "cn" });
    const second = makePricing({ tier: "standard", region: "global" });
    const batch = makePricing({ tier: "batch" });
    expect(
      pickHeadlinePricing(makeModel({ pricing: [batch, first, second] })),
    ).toBe(first);
  });

  it("没有 standard 行时回退到首行", () => {
    const batch = makePricing({ tier: "batch" });
    const flex = makePricing({ tier: "flex" });
    expect(pickHeadlinePricing(makeModel({ pricing: [batch, flex] }))).toBe(
      batch,
    );
  });

  it("tier 为 null 的行不会被当作 standard", () => {
    const noTier = makePricing({ tier: null });
    const batch = makePricing({ tier: "batch" });
    expect(pickHeadlinePricing(makeModel({ pricing: [batch, noTier] }))).toBe(
      batch,
    );
  });
});

describe("toModelRow", () => {
  it("提取头部价格，性能默认 null", () => {
    const model = makeModel();
    const row = toModelRow(model);
    expect(row.model).toBe(model);
    expect(row.pricing).toBe(model.pricing[0]);
    expect(row.performance).toBeNull();
  });

  it("合并传入的性能指标", () => {
    const performance = {
      outputTokensPerSecond: 100,
      timeToFirstTokenSeconds: 1,
      sourceModelSlug: "alpha",
    };
    expect(toModelRow(makeModel(), performance).performance).toBe(performance);
  });
});

describe("formatPrice", () => {
  it("缺失或非法数值显示 —", () => {
    expect(formatPrice(null, "USD")).toBe("—");
    expect(formatPrice(undefined, "USD")).toBe("—");
    expect(formatPrice(Number.NaN, "USD")).toBe("—");
    expect(formatPrice(Number.POSITIVE_INFINITY, "USD")).toBe("—");
  });

  it("按币种补符号，未知币种保留代码加空格", () => {
    expect(formatPrice(1.5, "USD")).toBe("$1.5");
    expect(formatPrice(7, "CNY")).toBe("¥7");
    expect(formatPrice(0.9, "EUR")).toBe("€0.9");
    expect(formatPrice(1.5, "GBP")).toBe("GBP 1.5");
  });

  it("币种缺失时只输出数值", () => {
    expect(formatPrice(2, null)).toBe("2");
    expect(formatPrice(2, undefined)).toBe("2");
  });

  it("按数值量级保留有效小数位并去除尾零", () => {
    expect(formatPrice(2, "USD")).toBe("$2");
    expect(formatPrice(1.999, "USD")).toBe("$2");
    expect(formatPrice(0.01234, "USD")).toBe("$0.0123");
    expect(formatPrice(0.0001234, "USD")).toBe("$0.000123");
  });
});

describe("currencySymbol", () => {
  it("已知币种返回符号，未知返回代码，空值返回空串", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("CNY")).toBe("¥");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("GBP")).toBe("GBP");
    expect(currencySymbol(null)).toBe("");
    expect(currencySymbol(undefined)).toBe("");
  });
});

describe("convertCurrency", () => {
  const rates = { USD: 1, CNY: 7.2, EUR: 0.9 };

  it("同币种直接返回原值", () => {
    expect(convertCurrency(5, "USD", "USD", rates)).toBe(5);
  });

  it("USD 为基准币种，换算为其它币种", () => {
    expect(convertCurrency(1, "USD", "CNY", rates)).toBeCloseTo(7.2);
    expect(convertCurrency(2, "USD", "EUR", rates)).toBeCloseTo(1.8);
  });

  it("非 USD 币种换算回 USD", () => {
    expect(convertCurrency(7.2, "CNY", "USD", rates)).toBeCloseTo(1);
  });

  it("两个非 USD 币种之间通过基准币种换算", () => {
    expect(convertCurrency(72, "CNY", "EUR", rates)).toBeCloseTo(9);
  });

  it("汇率缺失或非法时返回 null", () => {
    expect(convertCurrency(1, "USD", "JPY", rates)).toBeNull();
    expect(convertCurrency(1, "JPY", "USD", rates)).toBeNull();
    expect(convertCurrency(1, "USD", "CNY", { USD: 1, CNY: 0 })).toBeNull();
    expect(convertCurrency(1, "USD", "CNY", { USD: 1, CNY: -1 })).toBeNull();
  });

  it("非有限数值返回 null", () => {
    expect(convertCurrency(Number.NaN, "USD", "CNY", rates)).toBeNull();
  });
});

describe("formatTokens", () => {
  it("缺失值显示 —", () => {
    expect(formatTokens(null)).toBe("—");
    expect(formatTokens(undefined)).toBe("—");
    expect(formatTokens(Number.NaN)).toBe("—");
  });

  it("小于 1000 原样输出", () => {
    expect(formatTokens(999)).toBe("999");
  });

  it("千级用 K，百万级用 M，并去除尾零", () => {
    expect(formatTokens(1000)).toBe("1K");
    expect(formatTokens(16_384)).toBe("16.4K");
    expect(formatTokens(256_000)).toBe("256K");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });
});

describe("formatSpeed", () => {
  it("保留一位小数，缺失值显示 —", () => {
    expect(formatSpeed(153.831)).toBe("153.8");
    expect(formatSpeed(0)).toBe("0.0");
    expect(formatSpeed(null)).toBe("—");
    expect(formatSpeed(Number.NaN)).toBe("—");
  });
});

describe("formatLatency", () => {
  it("小于 1 秒用毫秒，大于等于 1 秒用秒", () => {
    expect(formatLatency(0.85)).toBe("850 ms");
    expect(formatLatency(0.0005)).toBe("1 ms");
    expect(formatLatency(14.939)).toBe("14.9 s");
    expect(formatLatency(1)).toBe("1.0 s");
  });

  it("缺失值显示 —", () => {
    expect(formatLatency(null)).toBe("—");
    expect(formatLatency(undefined)).toBe("—");
  });
});

describe("formatDate / formatDateTime", () => {
  it("ISO 时间截取日期部分，缺失显示 —", () => {
    expect(formatDate("2026-01-02T03:04:05Z")).toBe("2026-01-02");
    expect(formatDate("2026-01-02")).toBe("2026-01-02");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  it("时间戳按本地时间格式化为 YYYY-MM-DD HH:mm", () => {
    const timestamp = new Date(2026, 8, 13, 9, 5).getTime();
    expect(formatDateTime(timestamp)).toBe("2026-09-13 09:05");
  });
});

describe("modalityLabel", () => {
  it("已知模态返回中文标签，未知原样返回", () => {
    expect(modalityLabel("text")).toBe("文本");
    expect(modalityLabel("embedding")).toBe("向量");
    expect(modalityLabel("unknown-modality")).toBe("unknown-modality");
  });
});

describe("列定义", () => {
  it("列 key 不重复", () => {
    const keys = COLUMNS.map((column) => column.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("getColumn 能查到已定义列，未定义返回 undefined", () => {
    expect(getColumn("inputPrice")?.label).toBe("输入价格");
    expect(getColumn("not-a-column")).toBeUndefined();
  });

  it("默认可见列与列定义中的 defaultVisible 保持一致", () => {
    expect(DEFAULT_VISIBLE_COLUMNS).toEqual(
      COLUMNS.filter((column) => column.defaultVisible).map(
        (column) => column.key,
      ),
    );
    expect(DEFAULT_VISIBLE_COLUMNS).toContain("inputPrice");
    expect(DEFAULT_VISIBLE_COLUMNS).not.toContain("releaseDate");
  });

  it("性能列 key 均在列定义中", () => {
    for (const key of PERFORMANCE_COLUMN_KEYS) {
      expect(getColumn(key)).toBeDefined();
    }
  });

  it("价格列取值来自头部价格", () => {
    const row = toModelRow(
      makeModel({
        pricing: [makePricing({ inputPerMillion: 3, outputPerMillion: 12 })],
      }),
    );
    const inputColumn = getColumn("inputPrice");
    const outputColumn = getColumn("outputPrice");
    expect(inputColumn?.get(row)).toBe(3);
    expect(outputColumn?.get(row)).toBe(12);
  });

  it("无价格行时价格列取值为 null", () => {
    const row = toModelRow(makeModel({ pricing: [] }));
    expect(getColumn("inputPrice")?.get(row)).toBeNull();
  });

  it("对比数量上限为 30", () => {
    expect(MAX_COMPARE_MODELS).toBe(30);
  });
});
