import { NextResponse } from "next/server";
import { getPerformancePayload } from "@/lib/server/performance-source";

export const dynamic = "force-dynamic";

/**
 * GET /api/performance
 * 服务端代理 Artificial Analysis 免费 API，返回「llmrates 模型 sid → 性能指标」映射
 * （输出速度 / 首 Token 延迟，模型级跨供应商中位数）。
 * 未配置 ARTIFICIAL_ANALYSIS_API_KEY 时返回空映射（source=disabled），页面降级显示 "—"。
 * ?force=1 尝试绕过服务端缓存（距上次拉取不足 1 小时仍走缓存，保护免费层额度）。
 */
export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    const payload = await getPerformancePayload(force);
    return NextResponse.json(payload, {
      headers: {
        "X-Perf-Source": payload.source,
        "X-Perf-Matched": `${payload.matchedCount}/${payload.totalModels}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "性能数据暂不可用";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
