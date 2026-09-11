import type { ModelInfo } from "@/lib/types";

/**
 * llmrates 模型 ↔ Artificial Analysis 模型匹配。
 *
 * 两侧标识体系不同：llmrates 为「平台（provider）+ slug/name」，AA 为「原厂（creator）+ slug/name」，
 * 且平台侧的聚合/云平台在 AA 中没有对应维度。因此采用分级匹配：
 * 别名表 → 归一化 slug/name 精确匹配 → 同 creator 匹配 → token 相似度兜底。
 */

/** AA 模型（从上游响应中抽取出的最小字段集） */
export interface AaModel {
  id: string;
  name: string;
  slug: string;
  creatorSlug: string;
  creatorName: string;
  outputTokensPerSecond: number | null;
  timeToFirstTokenSeconds: number | null;
}

export type MatchMethod =
  | "alias"
  | "slug"
  | "name"
  | "suffix"
  | "creator-slug"
  | "creator-name"
  | "fuzzy";

export interface AaMatch {
  model: AaModel;
  method: MatchMethod;
}

/**
 * 别名表：llmrates `provider.slug/model.slug` → AA 模型 slug。
 * 仅登记归一化后仍对不齐的组合；初始留空，避免错误硬编码（错误映射比未匹配更糟）。
 * 服务端日志会输出未匹配示例，据此迭代补充。
 */
const AA_ALIASES: Record<string, string> = {
  // "deepseek/deepseek-chat": "deepseek-v3",
};

/** llmrates 供应商（归一化后）→ AA creator slug，仅登记两侧命名不一致的组合 */
const AA_CREATOR_ALIASES: Record<string, string> = {
  "google-deepmind": "google",
  "google-ai-studio": "google",
  "anthropic-ai": "anthropic",
  "meta-ai": "meta",
  "mistral-ai": "mistral",
  "x-ai": "xai",
  "alibaba-cloud": "alibaba",
  aws: "amazon",
  "amazon-aws": "amazon",
  "amazon-bedrock": "amazon",
  azure: "microsoft",
  "microsoft-azure": "microsoft",
};

export interface AaIndex {
  bySlug: Map<string, AaModel>;
  byName: Map<string, AaModel>;
  byCreatorAndSlug: Map<string, AaModel>;
  byCreatorAndName: Map<string, AaModel>;
  byCreator: Map<string, AaModel[]>;
}

/** 小写 + 非字母数字折叠为 "-"（使 3.5 与 3-5 等写法归一相等） */
export function normalizeToken(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tokenize(normalized: string): Set<string> {
  return new Set(normalized.split("-").filter(Boolean));
}

/** token 集合 Jaccard 相似度 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function buildAaIndex(models: AaModel[]): AaIndex {
  const index: AaIndex = {
    bySlug: new Map(),
    byName: new Map(),
    byCreatorAndSlug: new Map(),
    byCreatorAndName: new Map(),
    byCreator: new Map(),
  };

  for (const model of models) {
    const slug = normalizeToken(model.slug);
    const name = normalizeToken(model.name);
    const creator = normalizeToken(model.creatorSlug || model.creatorName);

    if (slug && !index.bySlug.has(slug)) index.bySlug.set(slug, model);
    if (name && !index.byName.has(name)) index.byName.set(name, model);

    if (creator) {
      const list = index.byCreator.get(creator) ?? [];
      list.push(model);
      index.byCreator.set(creator, list);
      if (slug && !index.byCreatorAndSlug.has(`${creator}:${slug}`)) {
        index.byCreatorAndSlug.set(`${creator}:${slug}`, model);
      }
      if (name && !index.byCreatorAndName.has(`${creator}:${name}`)) {
        index.byCreatorAndName.set(`${creator}:${name}`, model);
      }
    }
  }

  return index;
}

function resolveCreatorKey(model: ModelInfo): string {
  const fromName = normalizeToken(model.provider.name);
  const fromSlug = normalizeToken(model.provider.slug);
  const aliased = AA_CREATOR_ALIASES[fromName] ?? AA_CREATOR_ALIASES[fromSlug];
  if (aliased) return aliased;
  return fromName || fromSlug;
}

export function matchModelToAa(
  model: ModelInfo,
  index: AaIndex,
): AaMatch | null {
  // 1. 别名表
  const aliasSlug = AA_ALIASES[`${model.provider.slug}/${model.slug}`];
  if (aliasSlug) {
    const target = index.bySlug.get(normalizeToken(aliasSlug));
    if (target) return { model: target, method: "alias" };
  }

  const slug = normalizeToken(model.slug);
  const name = normalizeToken(model.name);

  // 2. 归一化 slug / name 精确匹配
  if (slug) {
    const hit = index.bySlug.get(slug);
    if (hit) return { model: hit, method: "slug" };
  }
  if (name) {
    const hit = index.byName.get(name);
    if (hit) return { model: hit, method: "name" };
  }

  // 3. 聚合平台常见的 "org/model" 命名（如 MiniMaxAI/MiniMax-M3）：对 "/" 后缀部分再做一次精确匹配
  for (const raw of [model.slug, model.name]) {
    const slash = raw.lastIndexOf("/");
    if (slash === -1 || slash === raw.length - 1) continue;
    const suffix = normalizeToken(raw.slice(slash + 1));
    if (!suffix) continue;
    const hit = index.bySlug.get(suffix) ?? index.byName.get(suffix);
    if (hit) return { model: hit, method: "suffix" };
  }

  // 4. 同 creator 下匹配
  const creator = resolveCreatorKey(model);
  if (creator) {
    if (slug) {
      const hit = index.byCreatorAndSlug.get(`${creator}:${slug}`);
      if (hit) return { model: hit, method: "creator-slug" };
    }
    if (name) {
      const hit = index.byCreatorAndName.get(`${creator}:${name}`);
      if (hit) return { model: hit, method: "creator-name" };
    }
  }

  // 5. token 相似度兜底：同 creator 池阈值 0.7；全局池更严（0.85）以免跨厂误配
  const candidates = creator ? index.byCreator.get(creator) : undefined;
  const pool = candidates ?? [...index.bySlug.values()];
  const threshold = candidates ? 0.7 : 0.85;
  const slugTokens = tokenize(slug);
  const nameTokens = tokenize(name);
  if (slugTokens.size === 0 && nameTokens.size === 0) return null;

  let best: AaModel | null = null;
  let bestScore = 0;
  for (const candidate of pool) {
    const candidateSlugTokens = tokenize(normalizeToken(candidate.slug));
    const candidateNameTokens = tokenize(normalizeToken(candidate.name));
    const score = Math.max(
      jaccard(slugTokens, candidateSlugTokens),
      jaccard(nameTokens, candidateNameTokens),
      jaccard(slugTokens, candidateNameTokens),
      jaccard(nameTokens, candidateSlugTokens),
    );
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (best && bestScore >= threshold) return { model: best, method: "fuzzy" };
  return null;
}
