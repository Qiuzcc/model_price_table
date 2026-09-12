import type { PricingCatalog } from "@/lib/domain/types";

/**
 * 上游数据源适配器契约。
 *
 * 适配器负责「抓取上游 → 校验 → 映射为领域模型」，并自行控制请求超时；
 * 失败时直接抛错，由编排层（lib/server/pricing-source.ts）回退到下一个源。
 * 接入新数据源：实现本接口并注册到 registry.ts，其余链路（缓存 / API / UI）无需改动。
 */
export interface PricingSource {
  /** 源标识：透出为响应头 X-Data-Source 与快照 / 缓存的 source 字段 */
  id: string;
  /** 拉取上游数据并转换为领域 PricingCatalog */
  fetchCatalog(): Promise<PricingCatalog>;
}
