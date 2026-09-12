import { llmratesGithubSource, llmratesSource } from "./llmrates";
import { modelsDevSource } from "./models-dev";
import { openrouterSource } from "./openrouter";
import type { PricingSource } from "./types";

/**
 * 价格数据源注册表：按优先级排列（主源 → 同源镜像 → 独立备源）。
 *
 * - llmrates API 与 GitHub 镜像为同一数据集，用于防「单一端点故障」；
 * - models.dev / OpenRouter 为独立第三方源，用于防「llmrates 整体不可用」的容灾；
 * - 编排层（lib/server/pricing-source.ts）逐个尝试，直到某个源成功；
 * - 接入新数据源：实现 PricingSource 适配器并追加到这里即可。
 */
export const PRICING_SOURCES: PricingSource[] = [
  llmratesSource,
  llmratesGithubSource,
  modelsDevSource,
  openrouterSource,
];
