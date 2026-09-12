import { NextResponse } from "next/server";
import { getPricingSnapshot } from "@/lib/server/pricing-source";
import { PRICING_SOURCES } from "@/lib/server/sources/registry";

export const dynamic = "force-dynamic";

/**
 * GET /api/pricing
 * 服务端代理价格数据（多源回退 + 磁盘缓存 6 小时），返回领域模型 PricingCatalog，
 * 数据源适配细节收敛在 lib/server/sources/。规避上游无 CORS 的限制。
 * - ?force=1 强制绕过服务端缓存重新拉取（手动刷新用）
 * - ?source=<id> 强制使用指定数据源（容灾演练 / 排查用，不写缓存），id 见 sources/registry.ts
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const force = params.get("force") === "1";
  const source = params.get("source") ?? undefined;

  if (source && !PRICING_SOURCES.some((item) => item.id === source)) {
    return NextResponse.json(
      {
        error: `未知数据源：${source}`,
        sources: PRICING_SOURCES.map((item) => item.id),
      },
      { status: 400 },
    );
  }

  try {
    const snapshot = await getPricingSnapshot(force, source);
    return NextResponse.json(snapshot.catalog, {
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
