import type {
  CatalogMeta,
  Model,
  ModelPricing,
  Provider,
  PricingCatalog,
} from "@/lib/domain/types";
import { isRecord, toNumber, toText } from "./shared";
import type { PricingSource } from "./types";

/**
 * LLMRates.ai 开放数据集适配器（https://www.llmrates.ai/api/dataset）。
 *
 * 上游数据集字段繁多（图片 / 音频 / 视频价格、token 分层等），适配时只保留
 * 领域模型需要的字段，其余统一裁剪：既缩小缓存体积，也隔离上游结构变化。
 * 主源为动态接口，GitHub 静态镜像与其同构，共用本适配器。
 */

const LLMRATES_API_URL = "https://www.llmrates.ai/api/dataset";
const LLMRATES_GITHUB_URL =
  "https://raw.githubusercontent.com/llmrates/llm-pricing-dataset/main/data/dataset.json";

/** 主源：动态接口 TTFB 波动大（实测 7~10s+），收紧超时尽快切换兜底源 */
export const llmratesSource: PricingSource = createLlmratesSource({
  id: "llmrates",
  url: LLMRATES_API_URL,
  timeoutMs: 10_000,
});

/** 兜底源：同一数据集的 GitHub 静态镜像 */
export const llmratesGithubSource: PricingSource = createLlmratesSource({
  id: "github",
  url: LLMRATES_GITHUB_URL,
  timeoutMs: 20_000,
});

interface LlmratesSourceOptions {
  id: string;
  url: string;
  timeoutMs: number;
}

function createLlmratesSource({
  id,
  url,
  timeoutMs,
}: LlmratesSourceOptions): PricingSource {
  return {
    id,
    async fetchCatalog() {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const catalog = toCatalog(await response.json());
      if (!catalog) throw new Error("响应结构异常");
      return catalog;
    },
  };
}

/** 把上游数据集映射为领域模型；providers / models 均为非空数组才视为有效 */
function toCatalog(raw: unknown): PricingCatalog | null {
  if (
    !isRecord(raw) ||
    !Array.isArray(raw.providers) ||
    !Array.isArray(raw.models)
  ) {
    return null;
  }

  const providers = raw.providers
    .map(mapProvider)
    .filter((provider): provider is Provider => provider !== null);
  const models = raw.models
    .map(mapModel)
    .filter((model): model is Model => model !== null);

  if (providers.length === 0 || models.length === 0) return null;

  return { meta: mapMeta(raw.meta, providers, models), providers, models };
}

function mapMeta(
  raw: unknown,
  providers: Provider[],
  models: Model[],
): CatalogMeta {
  const meta = isRecord(raw) ? raw : {};
  return {
    name: toText(meta.name) ?? "",
    publisher: toText(meta.publisher) ?? "",
    license: toText(meta.license) ?? "",
    datasetUrl: toText(meta.datasetUrl) ?? "",
    repoUrl: toText(meta.repoUrl) ?? "",
    note: toText(meta.note) ?? "",
    modelCount: toNumber(meta.modelCount) ?? models.length,
    providerCount: toNumber(meta.providerCount) ?? providers.length,
    priceRowCount:
      toNumber(meta.priceRowCount) ??
      models.reduce((sum, model) => sum + model.pricing.length, 0),
  };
}

function mapProvider(raw: unknown): Provider | null {
  if (!isRecord(raw)) return null;
  const slug = toText(raw.slug);
  const name = toText(raw.name);
  if (!slug || !name) return null;

  return {
    slug,
    name,
    nameLocal: toText(raw.nameLocal),
    type: toText(raw.providerType) ?? "unknown",
    modelCount: toNumber(raw.modelCount) ?? 0,
  };
}

function mapModel(raw: unknown): Model | null {
  if (!isRecord(raw)) return null;
  const sid = toText(raw.sid);
  const name = toText(raw.name);
  const slug = toText(raw.slug);
  if (!sid || !name || !slug) return null;

  const provider = isRecord(raw.provider) ? raw.provider : {};

  return {
    sid,
    name,
    slug,
    family: toText(raw.family),
    modelType: toText(raw.modelType),
    contextWindow: toNumber(raw.contextWindow),
    maxOutput: toNumber(raw.maxOutput),
    modalities: Array.isArray(raw.modalities)
      ? raw.modalities.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    supportsTools: raw.supportsTools === true,
    supportsBatch: raw.supportsBatch === true,
    supportsCaching: raw.supportsCaching === true,
    supportsStreaming: raw.supportsStreaming === true,
    releaseDate: toText(raw.releaseDate),
    knowledgeCutoff: toText(raw.knowledgeCutoff),
    deprecatedAt: toText(raw.deprecatedAt),
    provider: {
      name: toText(provider.name) ?? "",
      slug: toText(provider.slug) ?? "",
      type: toText(provider.providerType) ?? "unknown",
    },
    pricing: Array.isArray(raw.prices)
      ? raw.prices.filter(isRecord).map(mapPricing)
      : [],
  };
}

function mapPricing(raw: Record<string, unknown>): ModelPricing {
  return {
    inputPerMillion: toNumber(raw.inputPricePerMillion),
    outputPerMillion: toNumber(raw.outputPricePerMillion),
    cachedInputPerMillion: toNumber(raw.cachedInputPricePerMillion),
    cachedWritePerMillion: toNumber(raw.cachedWritePricePerMillion),
    thinkingOutputPerMillion: toNumber(raw.thinkingOutputPricePerMillion),
    currency: toText(raw.priceUnit),
    tier: toText(raw.processingTier),
    region: toText(raw.region),
    sourceUrl: toText(raw.sourceUrl),
  };
}
