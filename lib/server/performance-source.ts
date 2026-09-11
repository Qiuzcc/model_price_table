import type {
  PerformanceMetrics,
  PerformancePayload,
  PricingDataset,
} from "@/lib/types";
import { buildAaIndex, matchModelToAa, type AaModel } from "./aa-matching";
import { getPricingSnapshot } from "./pricing-source";

/**
 * 服务端数据源：Artificial Analysis 免费 API（模型级性能指标：输出速度 / 首 Token 延迟）。
 *
 * - 仅服务端调用（API Key 不得出现在客户端，AA 条款要求），并做长缓存：
 *   数据每日更新，内存缓存 12 小时，手动刷新最短间隔 1 小时，
 *   远低于免费层 1,000 请求/日的限额。
 * - 指标按 llmrates 模型 sid 建索引返回，客户端直接合并进对比表格。
 * - 未配置 ARTIFICIAL_ANALYSIS_API_KEY 或上游异常时返回空映射，页面降级显示 "—"。
 */

const AA_API_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";

export const PERFORMANCE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** 手动强制刷新的最短间隔（保护免费额度） */
const MIN_FORCE_INTERVAL_MS = 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 20_000;

let memoryCache: { payload: PerformancePayload; fetchedAt: number } | null =
  null;
let inflight: Promise<PerformancePayload> | null = null;

function emptyPayload(
  source: PerformancePayload["source"],
): PerformancePayload {
  return {
    generatedAt: 0,
    source,
    matchedCount: 0,
    totalModels: 0,
    metrics: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** AA 对无有效实时测量的模型会返回字面上的 0，一律视为缺失 */
function toPositiveNumber(value: unknown): number | null {
  const number = toNumber(value);
  return number != null && number > 0 ? number : null;
}

/** 宽容解析上游响应，兼容两代免费端点的字段布局（指标在顶层或 performance 对象内） */
function parseAaModels(payload: unknown): AaModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];

  const models: AaModel[] = [];
  for (const raw of payload.data) {
    if (!isRecord(raw)) continue;
    const slug = toText(raw.slug);
    const name = toText(raw.name);
    if (!slug || !name) continue;

    const creator = isRecord(raw.model_creator) ? raw.model_creator : null;
    const performance = isRecord(raw.performance) ? raw.performance : null;
    const outputTokensPerSecond =
      toPositiveNumber(raw.median_output_tokens_per_second) ??
      toPositiveNumber(performance?.median_output_tokens_per_second);
    const timeToFirstTokenSeconds =
      toPositiveNumber(raw.median_time_to_first_token_seconds) ??
      toPositiveNumber(performance?.median_time_to_first_token_seconds);

    // 无有效性能数据的条目不参与匹配（避免占用 llmrates 侧的匹配机会）
    if (outputTokensPerSecond == null && timeToFirstTokenSeconds == null)
      continue;

    models.push({
      id: toText(raw.id) ?? slug,
      name,
      slug,
      creatorSlug: creator ? (toText(creator.slug) ?? "") : "",
      creatorName: creator ? (toText(creator.name) ?? "") : "",
      outputTokensPerSecond,
      timeToFirstTokenSeconds,
    });
  }
  return models;
}

async function fetchAaModels(apiKey: string): Promise<AaModel[]> {
  const response = await fetch(AA_API_URL, {
    cache: "no-store",
    headers: { accept: "application/json", "x-api-key": apiKey },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`AA 响应 HTTP ${response.status}`);
  return parseAaModels(await response.json());
}

function buildPayload(
  dataset: PricingDataset,
  aaModels: AaModel[],
): PerformancePayload {
  const index = buildAaIndex(aaModels);
  const metrics: Record<string, PerformanceMetrics> = {};
  const unmatched: string[] = [];

  for (const model of dataset.models) {
    const match = matchModelToAa(model, index);
    if (!match) {
      unmatched.push(`${model.provider.slug}/${model.slug}`);
      continue;
    }
    metrics[model.sid] = {
      outputTokensPerSecond: match.model.outputTokensPerSecond,
      timeToFirstTokenSeconds: match.model.timeToFirstTokenSeconds,
      aaModelSlug: match.model.slug,
    };
  }

  const matchedCount = Object.keys(metrics).length;
  console.info(
    `[performance] AA 模型 ${aaModels.length} 个，匹配 ${matchedCount}/${dataset.models.length}` +
      (unmatched.length > 0
        ? `；未匹配示例：${unmatched.slice(0, 20).join(", ")}`
        : ""),
  );

  return {
    generatedAt: Date.now(),
    source: "artificial_analysis",
    matchedCount,
    totalModels: dataset.models.length,
    metrics,
  };
}

/**
 * 获取按 sid 索引的性能映射：
 * 1. 服务端缓存命中且未过期（12 小时）→ 直接返回；
 * 2. 强制刷新时，距上次拉取不足 1 小时 → 仍返回缓存（保护免费额度）；
 * 3. 拉取 AA + llmrates 快照（复用其缓存）并匹配；失败时返回旧缓存或空映射。
 */
export async function getPerformancePayload(
  force: boolean,
): Promise<PerformancePayload> {
  const apiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  if (!apiKey) return emptyPayload("disabled");

  const now = Date.now();
  const cached = memoryCache;
  const withinTtl = cached
    ? now - cached.fetchedAt < PERFORMANCE_CACHE_TTL_MS
    : false;
  const withinForceThrottle = cached
    ? now - cached.fetchedAt < MIN_FORCE_INTERVAL_MS
    : false;

  if (cached && withinTtl && (!force || withinForceThrottle)) {
    return { ...cached.payload, source: "memory-cache" };
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const [snapshot, aaModels] = await Promise.all([
        getPricingSnapshot(false),
        fetchAaModels(apiKey),
      ]);
      const payload = buildPayload(snapshot.dataset, aaModels);
      memoryCache = { payload, fetchedAt: Date.now() };
      return payload;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "网络错误";
      console.warn(`[performance] 性能数据拉取失败：${reason}`);
      if (memoryCache)
        return { ...memoryCache.payload, source: "memory-cache" };
      return emptyPayload("unavailable");
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
