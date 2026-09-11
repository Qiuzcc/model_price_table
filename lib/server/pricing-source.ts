import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PricingDataset } from "@/lib/types";

/**
 * 服务端数据源：主源为 llmrates.ai 公开数据集接口，兜底为同结构的 GitHub 开放数据集。
 *
 * 注意：数据集约 3.2MB，超过 Next.js FetchCache 单条 2MB 上限，
 * 因此使用磁盘缓存（6 小时 TTL，写入 .cache/pricing-dataset.json），全站共享，
 * 避免每次请求都打上游；文件在进程内保留镜像，每个进程仅实际读取一次。
 * 未过期直接使用，过期或强制刷新时才请求上游；上游失败时降级返回过期缓存（stale）。
 */

const SOURCES = [
  {
    url: "https://www.llmrates.ai/api/dataset",
    source: "llmrates",
    // 主源为动态生成端点，TTFB 波动大（实测 7~10s+），收紧超时尽快切换兜底源
    timeoutMs: 10_000,
  },
  {
    url: "https://raw.githubusercontent.com/llmrates/llm-pricing-dataset/main/data/dataset.json",
    source: "github",
    timeoutMs: 20_000,
  },
] as const;

/** 磁盘缓存 TTL：6 小时 */
export const DISK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const DISK_CACHE_PATH = path.join(
  process.cwd(),
  ".cache",
  "pricing-dataset.json",
);

export interface PricingSnapshot {
  dataset: PricingDataset;
  /** 上游数据的抓取时间（毫秒时间戳） */
  fetchedAt: number;
  /** llmrates | github */
  source: string;
  /** 是否命中服务端磁盘缓存（含进程内镜像） */
  fromDiskCache: boolean;
  /** 上游刷新失败，返回的是过期缓存 */
  stale: boolean;
}

type CachedSnapshot = Omit<PricingSnapshot, "fromDiskCache" | "stale">;

/** 磁盘缓存的进程内镜像：文件仅在首次需要时读取一次，之后随写入同步更新 */
let diskCache: CachedSnapshot | null = null;
let diskCacheLoaded = false;
let inflight: Promise<PricingSnapshot> | null = null;

function isPricingDataset(value: unknown): value is PricingDataset {
  if (value == null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.models) && Array.isArray(record.providers);
}

async function fetchFromUpstream(): Promise<CachedSnapshot> {
  const errors: string[] = [];

  for (const { url, source, timeoutMs } of SOURCES) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        errors.push(`${source}: HTTP ${response.status}`);
        continue;
      }
      const data: unknown = await response.json();
      if (!isPricingDataset(data)) {
        errors.push(`${source}: 响应结构异常`);
        continue;
      }
      return { dataset: data, fetchedAt: Date.now(), source };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "网络错误";
      errors.push(`${source}: ${reason}`);
    }
  }

  throw new Error(`所有上游数据源均不可用（${errors.join("；")}）`);
}

/** 读取磁盘缓存（文件仅首次读取，之后走进程内镜像；不存在或损坏视为无缓存） */
async function loadDiskCache(): Promise<CachedSnapshot | null> {
  if (diskCacheLoaded) return diskCache;
  diskCacheLoaded = true;
  try {
    const raw = await readFile(DISK_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CachedSnapshot> | null;
    if (
      parsed &&
      isPricingDataset(parsed.dataset) &&
      typeof parsed.fetchedAt === "number" &&
      typeof parsed.source === "string"
    ) {
      diskCache = {
        dataset: parsed.dataset,
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
): Promise<PricingSnapshot> {
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
