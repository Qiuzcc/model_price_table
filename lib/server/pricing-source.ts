import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PricingCatalog } from "@/lib/domain/types";
import { PRICING_SOURCES } from "./sources/registry";

/**
 * 价格数据编排层：多源回退 + 磁盘缓存。
 *
 * - 数据源适配器在 `lib/server/sources/` 中注册（按优先级排列），本层逐个尝试，
 *   任一成功即采用对应适配器映射出的领域模型；
 * - 数据集体积较大（数 MB），超过 Next.js FetchCache 单条 2MB 上限，
 *   因此使用磁盘缓存（6 小时 TTL，写入 .cache/pricing-catalog.json），全站共享，
 *   文件在进程内保留镜像，每个进程仅实际读取一次；
 * - 未过期直接使用，过期或强制刷新时才请求上游；上游全部失败时降级返回过期缓存（stale）；
 * - sourceId 指定时跳过缓存与优先级，直接用指定源实时拉取（容灾演练 / 排查用，不写缓存）。
 */

/** 磁盘缓存 TTL：6 小时 */
export const DISK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** 磁盘缓存结构版本：领域模型结构变更时递增即可让旧缓存自动失效 */
const CACHE_SCHEMA_VERSION = 1;

const DISK_CACHE_PATH = path.join(
  process.cwd(),
  ".cache",
  "pricing-catalog.json",
);

export interface PricingSnapshot {
  catalog: PricingCatalog;
  /** 上游数据的抓取时间（毫秒时间戳） */
  fetchedAt: number;
  /** 命中数据源的适配器 id，如 llmrates / github */
  source: string;
  /** 是否命中服务端磁盘缓存（含进程内镜像） */
  fromDiskCache: boolean;
  /** 上游刷新失败，返回的是过期缓存 */
  stale: boolean;
}

type CachedSnapshot = {
  version: number;
  catalog: PricingCatalog;
  fetchedAt: number;
  source: string;
};

/** 磁盘缓存的进程内镜像：文件仅在首次需要时读取一次，之后随写入同步更新 */
let diskCache: CachedSnapshot | null = null;
let diskCacheLoaded = false;
let inflight: Promise<PricingSnapshot> | null = null;

function isPricingCatalog(value: unknown): value is PricingCatalog {
  if (value == null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.models) && Array.isArray(record.providers);
}

/** 逐个尝试注册的数据源，任一成功即返回；全部失败时聚合各源原因抛错 */
async function fetchFromUpstream(): Promise<CachedSnapshot> {
  const errors: string[] = [];

  for (const source of PRICING_SOURCES) {
    try {
      const catalog = await source.fetchCatalog();
      return {
        version: CACHE_SCHEMA_VERSION,
        catalog,
        fetchedAt: Date.now(),
        source: source.id,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "网络错误";
      errors.push(`${source.id}: ${reason}`);
    }
  }

  throw new Error(`所有上游数据源均不可用（${errors.join("；")}）`);
}

/** 读取磁盘缓存（文件仅首次读取，之后走进程内镜像；不存在 / 损坏 / 版本不符视为无缓存） */
async function loadDiskCache(): Promise<CachedSnapshot | null> {
  if (diskCacheLoaded) return diskCache;
  diskCacheLoaded = true;
  try {
    const raw = await readFile(DISK_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CachedSnapshot> | null;
    if (
      parsed &&
      parsed.version === CACHE_SCHEMA_VERSION &&
      isPricingCatalog(parsed.catalog) &&
      typeof parsed.fetchedAt === "number" &&
      typeof parsed.source === "string"
    ) {
      diskCache = {
        version: parsed.version,
        catalog: parsed.catalog,
        fetchedAt: parsed.fetchedAt,
        source: parsed.source,
      };
    }
  } catch {
    // 忽略：文件不存在或损坏时视为无磁盘缓存
  }
  return diskCache;
}

/** 原子写入磁盘缓存（先写临时文件再 rename，避免读到半截内容）；失败静默降级 */
async function persistToDisk(snapshot: CachedSnapshot): Promise<void> {
  diskCache = snapshot;
  diskCacheLoaded = true;
  try {
    await mkdir(path.dirname(DISK_CACHE_PATH), { recursive: true });
    const tmpPath = `${DISK_CACHE_PATH}.tmp`;
    await writeFile(tmpPath, JSON.stringify(snapshot), "utf8");
    await rename(tmpPath, DISK_CACHE_PATH);
  } catch {
    // 忽略：只读文件系统、磁盘满等场景不阻断主流程
  }
}

export async function getPricingSnapshot(
  force: boolean,
  sourceId?: string,
): Promise<PricingSnapshot> {
  // 指定数据源：容灾演练 / 排查用，每次实时拉取且不读写磁盘缓存
  if (sourceId) {
    const source = PRICING_SOURCES.find((item) => item.id === sourceId);
    if (!source) throw new Error(`未知数据源：${sourceId}`);

    const catalog = await source.fetchCatalog();
    return {
      catalog,
      fetchedAt: Date.now(),
      source: source.id,
      fromDiskCache: false,
      stale: false,
    };
  }

  const now = Date.now();

  if (!force) {
    // 磁盘缓存（6 小时内）未过期：直接使用
    const disk = await loadDiskCache();
    if (disk && now - disk.fetchedAt < DISK_CACHE_TTL_MS) {
      return { ...disk, fromDiskCache: true, stale: false };
    }
  }

  // 缓存未命中/已过期（或 force 强制刷新）：请求上游
  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    try {
      const fresh = await fetchFromUpstream();
      await persistToDisk(fresh);
      return { ...fresh, fromDiskCache: false, stale: false };
    } catch (error) {
      // 刷新失败但存在旧缓存：降级返回旧数据并标记 stale
      const disk = await loadDiskCache();
      if (disk) {
        return { ...disk, fromDiskCache: true, stale: true };
      }
      throw error;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
