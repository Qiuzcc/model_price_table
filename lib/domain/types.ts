/**
 * 领域模型：与具体数据源无关的抽象数据结构。
 *
 * 展示层与业务逻辑只依赖本文件的类型；各上游数据源在 `lib/server/sources/`
 * 中负责把自身原始数据映射到这里的结构。替换 / 新增数据源时，只需实现新的
 * 适配器并注册，展示层无需改动。
 */

/** 价格与规格数据集（当前由 LLMRates.ai 适配而来） */
export interface PricingCatalog {
  meta: CatalogMeta;
  providers: Provider[];
  models: Model[];
}

export interface CatalogMeta {
  name: string;
  publisher: string;
  license: string;
  datasetUrl: string;
  repoUrl: string;
  note: string;
  modelCount: number;
  providerCount: number;
  priceRowCount: number;
}

/** 一个模型供应商（厂商 / 聚合平台 / 云平台） */
export interface Provider {
  slug: string;
  name: string;
  nameLocal: string | null;
  /** direct 模型原厂 | aggregator 聚合平台 | cloud 云平台 | coding_tool 编程工具 */
  type: string;
  modelCount: number;
}

/** 模型所属供应商的轻量引用（嵌入在模型上） */
export interface ProviderRef {
  name: string;
  slug: string;
  type: string;
}

export interface Model {
  /** 稳定 ID，用于跨数据源标识同一个「供应商 + 模型」组合 */
  sid: string;
  name: string;
  slug: string;
  family: string | null;
  /** general | embedding | image | video | tts | ... */
  modelType: string | null;
  contextWindow: number | null;
  maxOutput: number | null;
  /** 模态：text | image | video | audio | ... */
  modalities: string[];
  supportsTools: boolean;
  supportsBatch: boolean;
  supportsCaching: boolean;
  supportsStreaming: boolean;
  releaseDate: string | null;
  knowledgeCutoff: string | null;
  deprecatedAt: string | null;
  provider: ProviderRef;
  pricing: ModelPricing[];
}

/**
 * 模型的一条价格记录：价格均为「每 1M tokens」且携带原生币种。
 * 同一模型可能有多条（不同档位 / 区域 / token 分层）。
 */
export interface ModelPricing {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachedInputPerMillion: number | null;
  cachedWritePerMillion: number | null;
  thinkingOutputPerMillion: number | null;
  /** USD | CNY 等原生币种 */
  currency: string | null;
  /** standard | batch | fast | priority | off_peak | flex */
  tier: string | null;
  region: string | null;
  sourceUrl: string | null;
}

/**
 * 模型性能指标（模型级、跨供应商实测中位数）。
 * 当前数据来源：Artificial Analysis。
 */
export interface PerformanceMetrics {
  /** 连续输出速度（median_output_tokens_per_second，tokens/s） */
  outputTokensPerSecond: number | null;
  /** 首 Token 延迟（median_time_to_first_token_seconds，秒） */
  timeToFirstTokenSeconds: number | null;
  /** 命中的上游性能数据模型 slug，便于溯源核对 */
  sourceModelSlug: string;
}

export type PerformanceSource =
  | "artificial_analysis"
  | "memory-cache"
  | "disabled"
  | "unavailable";

/** /api/performance 响应体：catalog 模型 sid → 性能指标 */
export interface PerformancePayload {
  /** 上游性能数据构建时间（毫秒时间戳），无可用数据时为 0 */
  generatedAt: number;
  source: PerformanceSource;
  /** 成功匹配到性能指标的模型数 */
  matchedCount: number;
  /** catalog 数据集模型总数 */
  totalModels: number;
  metrics: Record<string, PerformanceMetrics>;
}

/** 对比表格的价格展示币种：native = 原生币种（不换算）| CNY 人民币 | USD 美元 */
export type DisplayCurrency = "native" | "CNY" | "USD";

/** 美元基准汇率表：rates[X] = 1 USD 可兑换的 X 数量（含 USD: 1） */
export interface FxRates {
  base: "USD";
  rates: Record<string, number>;
  /** 汇率发布日（ISO 日期），来源未提供时为 null */
  asOf: string | null;
  fetchedAt: number;
  /** frankfurter（ECB 参考汇率）| open-er-api */
  source: string;
}
