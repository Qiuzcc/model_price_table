import { NextResponse } from "next/server";
import { getPricingSnapshot } from "@/lib/server/pricing-source";

export const dynamic = "force-dynamic";

/**
 * GET /api/pricing
 * 服务端代理 LLMRates.ai 数据集（磁盘缓存 6 小时 + GitHub 兜底源），规避上游无 CORS 的限制。
 * ?force=1 强制绕过服务端缓存重新拉取（手动刷新用）。
 */
export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    const snapshot = await getPricingSnapshot(force);
    return NextResponse.json(snapshot.dataset, {
      headers: {
        "X-Data-Source": snapshot.source,
        "X-Fetched-At": new Date(snapshot.fetchedAt).toISOString(),
        "X-Cache-Hit": snapshot.fromDiskCache ? "1" : "0",
        "X-Stale": snapshot.stale ? "1" : "0",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "上游数据源暂时不可用";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
