import { llmratesGithubSource, llmratesSource } from "./llmrates";
import type { PricingSource } from "./types";

/**
 * 价格数据源注册表：按优先级排列。
 * 编排层（lib/server/pricing-source.ts）逐个尝试，直到某个源成功；
 * 接入新数据源时实现 PricingSource 适配器并追加到这里即可。
 */
export const PRICING_SOURCES: PricingSource[] = [
  llmratesSource,
  llmratesGithubSource,
];
