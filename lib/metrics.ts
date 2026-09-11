import type { ModelInfo, PerformanceMetrics, PriceRow } from "./types";

/** 对比列表允许的最大模型数量 */
export const MAX_COMPARE_MODELS = 30;

/** 性能列 key（列集合 v2 新增，用于旧版本列设置的一次性迁移） */
export const PERFORMANCE_COLUMN_KEYS = ["outputSpeed", "ttft"];

/** 表格行数据：模型 + 提取出的头部价格 + 性能指标 */
export interface ModelRow {
  model: ModelInfo;
  /** 标准档（standard）头部价格，取不到时为 null */
  headline: PriceRow | null;
  /** Artificial Analysis 性能指标（未匹配时为 null） */
  performance: PerformanceMetrics | null;
}

/**
 * 从模型的多行价格中提取「头部价格」：
 * 优先 standard 档且无区域限定的行 → 首个 standard 行 → 首行。
 */
export function pickHeadlinePrice(model: ModelInfo): PriceRow | null {
  const rows = model.prices ?? [];
  if (rows.length === 0) return null;
  const standard = rows.filter((row) => row.processingTier === "standard");
  const pool = standard.length > 0 ? standard : rows;
  return pool.find((row) => row.region == null) ?? pool[0];
}

export function toModelRow(
  model: ModelInfo,
  performance: PerformanceMetrics | null = null,
): ModelRow {
  return { model, headline: pickHeadlinePrice(model), performance };
}

function formatNumber(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return trimZeros(value.toFixed(digits));
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  CNY: "¥",
  EUR: "€",
};

/** 按原生币种格式化价格，缺失返回 — */
export function formatPrice(
  value: number | null | undefined,
  unit: string | null | undefined,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const symbol = unit ? (CURRENCY_SYMBOLS[unit] ?? `${unit} `) : "";
  return `${symbol}${formatNumber(value)}`;
}

/** 输出价格单位符号（用于表头说明），如 $ / ¥ */
export function currencySymbol(unit: string | null | undefined): string {
  if (!unit) return "";
  return CURRENCY_SYMBOLS[unit] ?? unit;
}

/**
 * 把价格从原生币种换算到目标币种（rates 为 USD 基准：rates[X] = 1 USD 对应的 X 数量）。
 * 币种或汇率缺失时返回 null（调用方保持原生展示）。
 */
export function convertCurrency(
  value: number,
  fromUnit: string,
  toUnit: string,
  rates: Record<string, number>,
): number | null {
  if (!Number.isFinite(value)) return null;
  if (fromUnit === toUnit) return value;
  const fromRate = fromUnit === "USD" ? 1 : rates[fromUnit];
  const toRate = toUnit === "USD" ? 1 : rates[toUnit];
  if (!fromRate || !toRate || fromRate <= 0 || toRate <= 0) return null;
  return (value / fromRate) * toRate;
}

function trimZeros(text: string): string {
  return text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** 256000 → 256K，1000000 → 1M，16384 → 16.4K */
export function formatTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000)
    return `${trimZeros((value / 1_000_000).toFixed(2))}M`;
  if (value >= 1_000) return `${trimZeros((value / 1_000).toFixed(1))}K`;
  return String(value);
}

/** 输出速度：153.831 → "153.8"（单位见列头 hint） */
export function formatSpeed(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

/** 首 Token 延迟：14.939 → "14.9 s"；0.85 → "850 ms" */
export function formatLatency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 1) return `${Math.round(value * 1000)} ms`;
  return `${value.toFixed(1)} s`;
}

/** ISO 时间 → YYYY-MM-DD */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

/** 本地时间展示（用于「数据更新于」） */
export function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const MODALITY_LABELS: Record<string, string> = {
  text: "文本",
  image: "图像",
  video: "视频",
  audio: "音频",
  speech: "语音",
  embedding: "向量",
  rerank: "重排",
  music: "音乐",
  transcription: "转录",
  ocr: "OCR",
};

export const MODEL_TYPE_LABELS: Record<string, string> = {
  general: "通用",
  embedding: "向量",
  image: "图像",
  video: "视频",
  rerank: "重排",
  tts: "语音合成",
  music: "音乐",
  transcription: "转录",
  ocr: "OCR",
};

export const PROVIDER_TYPE_LABELS: Record<string, string> = {
  direct: "模型原厂",
  aggregator: "聚合平台",
  cloud: "云平台",
  coding_tool: "编程工具",
};

export function modalityLabel(value: string): string {
  return MODALITY_LABELS[value] ?? value;
}

export type ColumnKind =
  | "price"
  | "tokens"
  | "boolean"
  | "text"
  | "chips"
  | "date"
  | "link"
  | "modelType"
  | "speed"
  | "latency";

export interface MetricColumn {
  key: string;
  label: string;
  /** 表头辅助说明 */
  hint?: string;
  defaultVisible: boolean;
  kind: ColumnKind;
  /** 点击表头可排序（需为数值列） */
  sortable?: boolean;
  /** 参与列内「最低 / 最高」极值标签计算（价格列） */
  highlightExtremes?: boolean;
  get: (
    row: ModelRow,
  ) => string | number | boolean | string[] | null | undefined;
}

/**
 * 对比表格的指标列定义（列 = 指标，行 = 模型）。
 * 价格类列取「标准档、原生币种」值。
 */
export const COLUMNS: MetricColumn[] = [
  {
    key: "inputPrice",
    label: "输入价格",
    hint: "每 1M tokens",
    defaultVisible: true,
    kind: "price",
    sortable: true,
    highlightExtremes: true,
    get: (row) => row.headline?.inputPricePerMillion ?? null,
  },
  {
    key: "outputPrice",
    label: "输出价格",
    hint: "每 1M tokens",
    defaultVisible: true,
    kind: "price",
    sortable: true,
    highlightExtremes: true,
    get: (row) => row.headline?.outputPricePerMillion ?? null,
  },
  {
    key: "cachedInputPrice",
    label: "缓存输入价格",
    hint: "每 1M tokens",
    defaultVisible: true,
    kind: "price",
    sortable: true,
    highlightExtremes: true,
    get: (row) => row.headline?.cachedInputPricePerMillion ?? null,
  },
  {
    key: "outputSpeed",
    label: "输出速度",
    hint: "tokens/s（AA 中位数）",
    defaultVisible: true,
    kind: "speed",
    sortable: true,
    get: (row) => row.performance?.outputTokensPerSecond ?? null,
  },
  {
    key: "ttft",
    label: "首 Token 延迟",
    hint: "秒（AA 中位数）",
    defaultVisible: true,
    kind: "latency",
    sortable: true,
    get: (row) => row.performance?.timeToFirstTokenSeconds ?? null,
  },
  {
    key: "contextWindow",
    label: "上下文窗口",
    hint: "tokens",
    defaultVisible: true,
    kind: "tokens",
    get: (row) => row.model.contextWindow,
  },
  {
    key: "maxOutput",
    label: "最大输出",
    hint: "tokens",
    defaultVisible: true,
    kind: "tokens",
    get: (row) => row.model.maxOutput,
  },
  {
    key: "supportsTools",
    label: "工具调用",
    defaultVisible: true,
    kind: "boolean",
    get: (row) => row.model.supportsTools,
  },
  {
    key: "supportsBatch",
    label: "批处理",
    defaultVisible: true,
    kind: "boolean",
    get: (row) => row.model.supportsBatch,
  },
  {
    key: "supportsCaching",
    label: "提示缓存",
    defaultVisible: true,
    kind: "boolean",
    get: (row) => row.model.supportsCaching,
  },
  {
    key: "modalities",
    label: "模态",
    defaultVisible: true,
    kind: "chips",
    get: (row) => row.model.modalities,
  },
  {
    key: "family",
    label: "模型家族",
    defaultVisible: false,
    kind: "text",
    get: (row) => row.model.family,
  },
  {
    key: "modelType",
    label: "模型类型",
    defaultVisible: false,
    kind: "modelType",
    get: (row) => row.model.modelType,
  },
  {
    key: "supportsStreaming",
    label: "流式输出",
    defaultVisible: false,
    kind: "boolean",
    get: (row) => row.model.supportsStreaming,
  },
  {
    key: "releaseDate",
    label: "发布时间",
    defaultVisible: false,
    kind: "date",
    get: (row) => row.model.releaseDate,
  },
  {
    key: "knowledgeCutoff",
    label: "知识截止",
    defaultVisible: false,
    kind: "date",
    get: (row) => row.model.knowledgeCutoff,
  },
  {
    key: "thinkingOutputPrice",
    label: "推理输出价格",
    hint: "每 1M tokens",
    defaultVisible: false,
    kind: "price",
    get: (row) => row.headline?.thinkingOutputPricePerMillion ?? null,
  },
  {
    key: "deprecatedAt",
    label: "弃用时间",
    defaultVisible: false,
    kind: "date",
    get: (row) => row.model.deprecatedAt,
  },
  {
    key: "sourceUrl",
    label: "价格来源",
    defaultVisible: false,
    kind: "link",
    get: (row) => row.headline?.sourceUrl ?? null,
  },
];

export const DEFAULT_VISIBLE_COLUMNS = COLUMNS.filter(
  (c) => c.defaultVisible,
).map((c) => c.key);

export function getColumn(key: string): MetricColumn | undefined {
  return COLUMNS.find((c) => c.key === key);
}
