import type {
  CatalogMeta,
  Model,
  ModelPricing,
  Provider,
  ProviderRef,
  PricingCatalog,
} from "@/lib/domain/types";
import {
  inferModelType,
  isRecord,
  toNumber,
  toText,
  toTextArray,
  mergeModalities,
} from "./shared";
import type { PricingSource } from "./types";

/**
 * models.dev 开放数据库适配器（https://models.dev/api.json，独立第三方备源）。
 *
 * 结构调整：{ [providerId]: { id, name, doc?, models: { [modelId]: {...} } } }
 * 价格单位为 USD / 每 1M tokens（与领域模型一致，见其官方 schema）。
 * 降级映射：supportsBatch / supportsStreaming 无对应字段（置 false，UI 显示 —）；
 * modelType 按模型 ID 启发式推断；deprecated 状态无日期，不写入 deprecatedAt。
 */
const MODELS_DEV_API_URL = "https://models.dev/api.json";

const FETCH_TIMEOUT_MS = 20_000;

export const modelsDevSource: PricingSource = {
  id: "modelsdev",
  async fetchCatalog() {
    const response = await fetch(MODELS_DEV_API_URL, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const catalog = toCatalog(await response.json());
    if (!catalog) throw new Error("响应结构异常");
    return catalog;
  },
};

function toCatalog(raw: unknown): PricingCatalog | null {
  if (!isRecord(raw)) return null;

  const providers: Provider[] = [];
  const models: Model[] = [];

  for (const [providerId, rawProvider] of Object.entries(raw)) {
    if (!isRecord(rawProvider)) continue;
    const providerName = toText(rawProvider.name) ?? providerId;
    const providerRef: ProviderRef = {
      name: providerName,
      slug: providerId,
      type: "unknown",
    };
    const providerDoc = toText(rawProvider.doc);
    const rawModels = isRecord(rawProvider.models) ? rawProvider.models : {};

    let modelCount = 0;
    for (const [modelId, rawModel] of Object.entries(rawModels)) {
      if (!isRecord(rawModel)) continue;
      const model = mapModel(modelId, rawModel, providerRef, providerDoc);
      if (!model) continue;
      modelCount++;
      models.push(model);
    }
    if (modelCount === 0) continue;

    providers.push({
      slug: providerId,
      name: providerName,
      nameLocal: null,
      type: "unknown",
      modelCount,
    });
  }

  if (providers.length === 0 || models.length === 0) return null;

  return { meta: buildMeta(providers, models), providers, models };
}

function mapModel(
  modelId: string,
  raw: Record<string, unknown>,
  provider: ProviderRef,
  providerDoc: string | null,
): Model | null {
  const limit = isRecord(raw.limit) ? raw.limit : {};
  const cost = isRecord(raw.cost) ? raw.cost : null;
  const modalities = isRecord(raw.modalities) ? raw.modalities : {};

  return {
    sid: `modelsdev:${provider.slug}/${modelId}`,
    name: toText(raw.name) ?? modelId,
    slug: modelId,
    family: toText(raw.family),
    modelType: inferModelType(modelId),
    contextWindow: toNumber(limit.context),
    maxOutput: toNumber(limit.output),
    modalities: mergeModalities(
      toTextArray(modalities.input),
      toTextArray(modalities.output),
    ),
    supportsTools: raw.tool_call === true,
    supportsBatch: false,
    supportsCaching:
      hasPositive(cost?.cache_read) || hasPositive(cost?.cache_write),
    supportsStreaming: false,
    releaseDate: toText(raw.release_date),
    knowledgeCutoff: toText(raw.knowledge),
    deprecatedAt: null,
    provider,
    pricing: cost ? mapPricing(cost, providerDoc) : [],
  };
}

function hasPositive(value: unknown): boolean {
  const number = toNumber(value);
  return number != null && number > 0;
}

function mapPricing(
  cost: Record<string, unknown>,
  providerDoc: string | null,
): ModelPricing[] {
  const row: ModelPricing = {
    inputPerMillion: toNumber(cost.input),
    outputPerMillion: toNumber(cost.output),
    cachedInputPerMillion: toNumber(cost.cache_read),
    cachedWritePerMillion: toNumber(cost.cache_write),
    thinkingOutputPerMillion: toNumber(cost.reasoning),
    currency: "USD",
    tier: "standard",
    region: null,
    sourceUrl: providerDoc,
  };

  const hasAnyPrice =
    row.inputPerMillion != null ||
    row.outputPerMillion != null ||
    row.cachedInputPerMillion != null ||
    row.cachedWritePerMillion != null ||
    row.thinkingOutputPerMillion != null;
  return hasAnyPrice ? [row] : [];
}

function buildMeta(providers: Provider[], models: Model[]): CatalogMeta {
  return {
    name: "models.dev open database",
    publisher: "models.dev（SST / opencode 社区）",
    license: "未声明（见仓库）",
    datasetUrl: "https://models.dev",
    repoUrl: "https://github.com/anomalyco/models.dev",
    note: "Independent fallback adapted from models.dev; prices in USD per 1M tokens.",
    modelCount: models.length,
    providerCount: providers.length,
    priceRowCount: models.reduce((sum, model) => sum + model.pricing.length, 0),
  };
}
