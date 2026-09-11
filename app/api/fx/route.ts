import { NextResponse } from "next/server";
import { getFxRates } from "@/lib/server/fx-source";

export const dynamic = "force-dynamic";

/**
 * GET /api/fx
 * 服务端代理免费汇率接口（USD 基准），供前端价格展示币种换算使用（12 小时缓存）。
 * ?force=1 绕过服务端缓存。
 */
export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    const fx = await getFxRates(force);
    return NextResponse.json(fx, {
      headers: {
        "X-Fx-Source": fx.source,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "汇率数据暂不可用";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
