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
  mergeModalities,
  toFloat,
  toNumber,
  toText,
  toTextArray,
} from "./shared";
import type { PricingSource } from "./types";

/**
 * OpenRouter 适配器（https://openrouter.ai/api/v1/models，公开、无需 Key，独立第三方备源）。
 *
 * 结构调整：{ data: [ { id: "vendor/model", pricing: { prompt, completion, ... } } ] }；
 * 定价为「每 token 美元」的字符串，换算为每 1M tokens 后进入领域模型。
 * 全部模型归属 OpenRouter 单一聚合平台（providerType = aggregator）。
 * 降级映射：supportsBatch / supportsStreaming 无对应字段；负定价（动态定价标记）视为缺失。
 */
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/models";

const FETCH_TIMEOUT_MS = 20_000;

const PROVIDER_REF: ProviderRef = {
  name: "OpenRouter",
  slug: "openrouter",
  type: "aggregator",
};

export const openrouterSource: PricingSource = {
  id: "openrouter",
  async fetchCatalog() {
    const response = await fetch(OPENROUTER_API_URL, {
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
  if (!isRecord(raw) || !Array.isArray(raw.data)) return null;

  const models = raw.data
    .map(mapModel)
    .filter((model): model is Model => model !== null);
  if (models.length === 0) return null;

  const providers: Provider[] = [
    {
      slug: PROVIDER_REF.slug,
      name: PROVIDER_REF.name,
      nameLocal: null,
      type: PROVIDER_REF.type,
      modelCount: models.length,
    },
  ];

  return { meta: buildMeta(providers, models), providers, models };
}

function mapModel(raw: unknown): Model | null {
  if (!isRecord(raw)) return null;
  const id = toText(raw.id);
  const name = toText(raw.name);
  if (!id || !name) return null;

  const architecture = isRecord(raw.architecture) ? raw.architecture : {};
  const topProvider = isRecord(raw.top_provider) ? raw.top_provider : {};
  const pricing = isRecord(raw.pricing) ? raw.pricing : null;
  const parameters = toTextArray(raw.supported_parameters);
  const cachedRead = perMillion(pricing?.input_cache_read);

  return {
    sid: `openrouter:${id}`,
    name,
    slug: id,
    family: null,
    modelType: inferModelType(id),
    contextWindow: toNumber(raw.context_length),
    maxOutput: toNumber(topProvider.max_completion_tokens),
    modalities: mergeModalities(
      toTextArray(architecture.input_modalities),
      toTextArray(architecture.output_modalities),
    ),
    supportsTools: parameters.includes("tools"),
    supportsBatch: false,
    supportsCaching: cachedRead != null && cachedRead > 0,
    supportsStreaming: false,
    releaseDate: toIsoDate(raw.created),
    knowledgeCutoff: toText(raw.knowledge_cutoff),
    deprecatedAt: toText(raw.expiration_date),
    provider: PROVIDER_REF,
    pricing: mapPricing(id, pricing),
  };
}

/** OpenRouter 定价为每 token 美元（字符串）；换算为每 1M，负值（动态定价标记）视为缺失 */
function perMillion(value: unknown): number | null {
  const number = toFloat(value);
  if (number == null || number < 0) return null;
  return number * 1_000_000;
}

/** Unix 秒级时间戳 → ISO 字符串（日期列展示用） */
function toIsoDate(value: unknown): string | null {
  const seconds = toNumber(value);
  if (seconds == null || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapPricing(
  modelId: string,
  pricing: Record<string, unknown> | null,
): ModelPricing[] {
  if (!pricing) return [];

  const row: ModelPricing = {
    inputPerMillion: perMillion(pricing.prompt),
    outputPerMillion: perMillion(pricing.completion),
    cachedInputPerMillion: perMillion(pricing.input_cache_read),
    cachedWritePerMillion: perMillion(pricing.input_cache_write),
    thinkingOutputPerMillion: perMillion(pricing.internal_reasoning),
    currency: "USD",
    tier: "standard",
    region: null,
    sourceUrl: `https://openrouter.ai/${modelId}`,
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
    name: "OpenRouter models API",
    publisher: "OpenRouter",
    license: "以 OpenRouter 服务条款为准",
    datasetUrl: "https://openrouter.ai/docs/guides/overview/models",
    repoUrl: "https://openrouter.ai",
    note: "Independent fallback adapted from the OpenRouter public models API; prices in USD per 1M tokens.",
    modelCount: models.length,
    providerCount: providers.length,
    priceRowCount: models.reduce((sum, model) => sum + model.pricing.length, 0),
  };
}
