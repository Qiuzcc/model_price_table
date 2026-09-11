/**
 * LLMRates.ai 开放数据集（https://www.llmrates.ai/api/dataset）类型定义。
 * 字段以实际响应为准，价格均为「每 1M tokens」且携带原生币种（priceUnit）。
 */

export interface ProviderInfo {
  id: number;
  slug: string;
  name: string;
  nameLocal: string | null;
  website: string | null;
  pricingUrl: string | null;
  /** direct | aggregator | cloud | coding_tool */
  providerType: string;
  providerTypes: string[];
  description: string | null;
  modelCount: number;
}

export interface PriceRow {
  inputPricePerMillion: number | null;
  cachedInputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  thinkingOutputPricePerMillion: number | null;
  cachedWritePricePerMillion: number | null;
  imagePrice: number | null;
  imagePricePerMillion: number | null;
  characterPricePerMillion: number | null;
  audioPricePerHour: number | null;
  audioPricePerMillion: number | null;
  videoPrice: number | null;
  videoPricePerSecond: number | null;
  videoPricePerMillion: number | null;
  trackPrice: number | null;
  pagePrice: number | null;
  searchPricePerThousand: number | null;
  /** standard | batch | fast | priority | off_peak | flex */
  processingTier: string;
  tokenTierMin: number | null;
  tokenTierMax: number | null;
  tierLabel: string | null;
  /** USD | CNY 等原生币种 */
  priceUnit: string;
  freeTier: unknown;
  region: string | null;
  sourceUrl: string | null;
  effectiveDate?: string | null;
  verifiedAt?: string | null;
}

export interface ModelProviderRef {
  name: string;
  slug: string;
  providerType: string;
  providerTypes: string[];
}

export interface ModelInfo {
  id: number;
  /** 稳定 ID，用于跨数据源标识同一个「供应商 + 模型」组合 */
  sid: string;
  name: string;
  slug: string;
  family: string | null;
  /** general | embedding | image | video | tts | ... */
  modelType: string | null;
  contextWindow: number | null;
  maxOutput: number | null;
  supportsTools: boolean;
  supportsBatch: boolean;
  supportsCaching: boolean;
  supportsStreaming: boolean;
  releaseDate: string | null;
  knowledgeCutoff: string | null;
  deprecatedAt: string | null;
  provider: ModelProviderRef;
  modalities: string[];
  prices: PriceRow[];
}

export interface DatasetMeta {
  name: string;
  publisher: string;
  source: string;
  datasetUrl: string;
  repoUrl: string;
  license: string;
  note: string;
  modelCount: number;
  providerCount: number;
  priceRowCount: number;
  [key: string]: unknown;
}

export interface PricingDataset {
  meta: DatasetMeta;
  providers: ProviderInfo[];
  models: ModelInfo[];
}

/**
 * Artificial Analysis 免费 API 提供的模型性能指标（模型级、跨供应商实测中位数）。
 * 数据来源：https://artificialanalysis.ai/api/v2/data/llms/models
 */
export interface PerformanceMetrics {
  /** 连续输出速度（median_output_tokens_per_second，tokens/s） */
  outputTokensPerSecond: number | null;
  /** 首 Token 延迟（median_time_to_first_token_seconds，秒） */
  timeToFirstTokenSeconds: number | null;
  /** 命中的 AA 模型 slug，便于溯源核对 */
  aaModelSlug: string;
}

export type PerformanceSource =
  | "artificial_analysis"
  | "memory-cache"
  | "disabled"
  | "unavailable";

/** /api/performance 响应体：llmrates 模型 sid → 性能指标 */
export interface PerformancePayload {
  /** AA 数据构建时间（毫秒时间戳），无可用数据时为 0 */
  generatedAt: number;
  source: PerformanceSource;
  /** 成功匹配到性能指标的模型数 */
  matchedCount: number;
  /** llmrates 数据集模型总数 */
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
