import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  PerformanceMetrics,
  PerformancePayload,
  PricingCatalog,
} from "@/lib/domain/types";
import { buildAaIndex, matchModelToAa, type AaModel } from "./aa-matching";
import { getPricingSnapshot } from "./pricing-source";

/**
 * 服务端数据源：Artificial Analysis 免费 API（模型级性能指标：输出速度 / 首 Token 延迟）。
 *
 * - 仅服务端调用（API Key 不得出现在客户端，AA 条款要求），并做长缓存：
 *   数据每日更新，磁盘缓存 12 小时（服务重启后可快速恢复），手动刷新最短间隔 1 小时，
 *   远低于免费层 1,000 请求/日的限额。
 * - 指标按 llmrates 模型 sid 建索引返回，客户端直接合并进对比表格。
 * - 未配置 ARTIFICIAL_ANALYSIS_API_KEY 或上游异常时返回空映射，页面降级显示 "—"。
 */

const AA_API_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";

export const PERFORMANCE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** 手动强制刷新的最短间隔（保护免费额度） */
const MIN_FORCE_INTERVAL_MS = 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 20_000;

/** 磁盘缓存结构版本：字段结构变更时递增即可让旧缓存自动失效 */
const CACHE_SCHEMA_VERSION = 1;

const DISK_CACHE_PATH = path.join(
  process.cwd(),
  ".cache",
  "performance-data.json",
);

/**
 * 磁盘缓存的进程内镜像：文件仅在首次需要时读取一次，之后随写入同步更新。
 * 读取以单飞 Promise 承载：并发请求共享同一次读取，避免先到请求读取尚未完成时，
 * 后到请求把「镜像尚未就绪」误判为「无缓存」而直连上游。
 */
let diskCache: { payload: PerformancePayload; fetchedAt: number } | null = null;
let diskCacheLoad: Promise<{
  payload: PerformancePayload;
  fetchedAt: number;
} | null> | null = null;
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

/** 读取磁盘缓存（文件仅首次读取，之后走进程内镜像；不存在 / 损坏 / 版本不符视为无缓存） */
function loadDiskCache(): Promise<{
  payload: PerformancePayload;
  fetchedAt: number;
} | null> {
  // 镜像已就绪（含上游刷新后的新写入）：直接命中
  if (diskCache) return Promise.resolve(diskCache);

  if (!diskCacheLoad) {
    diskCacheLoad = (async () => {
      try {
        const raw = await readFile(DISK_CACHE_PATH, "utf8");
        const parsed = JSON.parse(raw) as {
          version?: number;
          payload?: PerformancePayload;
          fetchedAt?: number;
        } | null;
        if (
          parsed &&
          parsed.version === CACHE_SCHEMA_VERSION &&
          parsed.payload &&
          typeof parsed.fetchedAt === "number" &&
          diskCache === null // 读取期间若已写入更新的镜像，以新镜像为准
        ) {
          diskCache = { payload: parsed.payload, fetchedAt: parsed.fetchedAt };
        }
      } catch {
        // 忽略：文件不存在或损坏时视为无磁盘缓存
      }
      return diskCache;
    })();
  }
  return diskCacheLoad;
}

/** 原子写入磁盘缓存（先写临时文件再 rename，避免读到半截内容）；失败静默降级 */
async function persistToDisk(cached: {
  payload: PerformancePayload;
  fetchedAt: number;
}): Promise<void> {
  diskCache = cached;
  try {
    await mkdir(path.dirname(DISK_CACHE_PATH), { recursive: true });
    const tmpPath = `${DISK_CACHE_PATH}.tmp`;
    const toPersist = {
      version: CACHE_SCHEMA_VERSION,
      payload: cached.payload,
      fetchedAt: cached.fetchedAt,
    };
    await writeFile(tmpPath, JSON.stringify(toPersist), "utf8");
    await rename(tmpPath, DISK_CACHE_PATH);
  } catch {
    // 忽略：只读文件系统、磁盘满等场景不阻断主流程
  }
}

function buildPayload(
  catalog: PricingCatalog,
  aaModels: AaModel[],
): PerformancePayload {
  const index = buildAaIndex(aaModels);
  const metrics: Record<string, PerformanceMetrics> = {};
  const unmatched: string[] = [];

  for (const model of catalog.models) {
    const match = matchModelToAa(model, index);
    if (!match) {
      unmatched.push(`${model.provider.slug}/${model.slug}`);
      continue;
    }
    metrics[model.sid] = {
      outputTokensPerSecond: match.model.outputTokensPerSecond,
      timeToFirstTokenSeconds: match.model.timeToFirstTokenSeconds,
      sourceModelSlug: match.model.slug,
    };
  }

  const matchedCount = Object.keys(metrics).length;
  console.info(
    `[performance] AA 模型 ${aaModels.length} 个，匹配 ${matchedCount}/${catalog.models.length}` +
      (unmatched.length > 0
        ? `；未匹配示例：${unmatched.slice(0, 20).join(", ")}`
        : ""),
  );

  return {
    generatedAt: Date.now(),
    source: "artificial_analysis",
    matchedCount,
    totalModels: catalog.models.length,
    metrics,
  };
}

/**
 * 获取按 sid 索引的性能映射：
 * 1. 内存缓存命中且未过期（12 小时）→ 直接返回；
 * 2. 磁盘缓存命中且未过期 → 恢复至内存缓存并返回；
 * 3. 强制刷新时，距上次拉取不足 1 小时 → 仍返回缓存（保护免费额度）；
 * 4. 拉取 AA + llmrates 快照（复用其缓存）并匹配；失败时返回旧缓存或空映射。
 */
export async function getPerformancePayload(
  force: boolean,
): Promise<PerformancePayload> {
  const apiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  if (!apiKey) return emptyPayload("disabled");

  const now = Date.now();

  // 1. 检查内存缓存
  if (memoryCache && now - memoryCache.fetchedAt < PERFORMANCE_CACHE_TTL_MS) {
    if (!force || now - memoryCache.fetchedAt < MIN_FORCE_INTERVAL_MS) {
      return { ...memoryCache.payload, source: "memory-cache" };
    }
  }

  // 2. 检查磁盘缓存
  if (!force) {
    const disk = await loadDiskCache();
    if (disk && now - disk.fetchedAt < PERFORMANCE_CACHE_TTL_MS) {
      memoryCache = disk;
      return { ...disk.payload, source: "disk-cache" };
    }
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const [snapshot, aaModels] = await Promise.all([
        getPricingSnapshot(false),
        fetchAaModels(apiKey),
      ]);
      const payload = buildPayload(snapshot.catalog, aaModels);
      const cached = { payload, fetchedAt: Date.now() };
      memoryCache = cached;
      await persistToDisk(cached);
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
