import { describe, expect, it } from "vitest";
import {
  buildAaIndex,
  matchModelToAa,
  normalizeToken,
  type AaModel,
} from "@/lib/server/aa-matching";
import type { Model } from "@/lib/domain/types";

function makeAaModel(overrides: Partial<AaModel> = {}): AaModel {
  return {
    id: "aa-1",
    name: "Model",
    slug: "model",
    creatorSlug: "creator",
    creatorName: "Creator",
    outputTokensPerSecond: 100,
    timeToFirstTokenSeconds: 1,
    ...overrides,
  };
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    sid: "provider/model",
    name: "Model",
    slug: "model",
    family: null,
    modelType: null,
    contextWindow: null,
    maxOutput: null,
    modalities: [],
    supportsTools: false,
    supportsBatch: false,
    supportsCaching: false,
    supportsStreaming: false,
    releaseDate: null,
    knowledgeCutoff: null,
    deprecatedAt: null,
    provider: { name: "Provider", slug: "provider", type: "direct" },
    pricing: [],
    ...overrides,
  };
}

describe("normalizeToken", () => {
  it("小写并将非字母数字折叠为 -", () => {
    expect(normalizeToken("GPT-4.5 Turbo")).toBe("gpt-4-5-turbo");
    expect(normalizeToken("  Hello__World  ")).toBe("hello-world");
    expect(normalizeToken("a/b")).toBe("a-b");
  });

  it("数字点号与连字符写法归一相等", () => {
    expect(normalizeToken("3.5")).toBe(normalizeToken("3-5"));
  });

  it("纯符号输入归一为空串", () => {
    expect(normalizeToken("---")).toBe("");
    expect(normalizeToken("")).toBe("");
  });
});

describe("buildAaIndex", () => {
  it("按归一化 slug / name / creator 建立索引", () => {
    const index = buildAaIndex([
      makeAaModel({
        id: "1",
        slug: "gpt-4o",
        name: "GPT-4o",
        creatorSlug: "openai",
      }),
      makeAaModel({
        id: "2",
        slug: "claude-3-5",
        name: "Claude 3.5",
        creatorSlug: "anthropic",
      }),
    ]);

    expect(index.bySlug.get("gpt-4o")?.id).toBe("1");
    expect(index.byName.get("claude-3-5")?.id).toBe("2");
    expect(index.byCreator.get("openai")).toHaveLength(1);
    expect(index.byCreatorAndSlug.get("anthropic:claude-3-5")?.id).toBe("2");
  });

  it("重复 slug 仅保留首个模型", () => {
    const index = buildAaIndex([
      makeAaModel({ id: "first", slug: "shared-slug" }),
      makeAaModel({ id: "second", slug: "shared-slug" }),
    ]);
    expect(index.bySlug.get("shared-slug")?.id).toBe("first");
  });

  it("creatorSlug 缺失时用 creatorName 归一化", () => {
    const index = buildAaIndex([
      makeAaModel({ creatorSlug: "", creatorName: "Mistral AI" }),
    ]);
    expect(index.byCreator.has("mistral-ai")).toBe(true);
  });
});

describe("matchModelToAa", () => {
  it("归一化 slug 精确匹配", () => {
    const index = buildAaIndex([
      makeAaModel({ slug: "gpt-4o", name: "GPT-4o", creatorSlug: "openai" }),
    ]);
    const match = matchModelToAa(
      makeModel({ slug: "GPT.4o", name: "GPT 4o" }),
      index,
    );
    expect(match?.method).toBe("slug");
    expect(match?.model.slug).toBe("gpt-4o");
  });

  it("聚合平台复用原厂 slug 时跨 creator 命中", () => {
    const index = buildAaIndex([
      makeAaModel({ slug: "gpt-4o", name: "GPT-4o", creatorSlug: "openai" }),
    ]);
    const match = matchModelToAa(
      makeModel({
        slug: "gpt-4o",
        name: "Azure GPT-4o",
        provider: { name: "Azure", slug: "azure", type: "cloud" },
      }),
      index,
    );
    expect(match?.method).toBe("slug");
  });

  it("slug 对不上时按归一化 name 匹配", () => {
    const index = buildAaIndex([
      makeAaModel({
        slug: "claude-35-sonnet",
        name: "Claude 3.5 Sonnet",
        creatorSlug: "anthropic",
      }),
    ]);
    const match = matchModelToAa(
      makeModel({
        slug: "claude-3-5-sonnet-special",
        name: "Claude 3.5 Sonnet",
      }),
      index,
    );
    expect(match?.method).toBe("name");
  });

  it("org/model 形式按斜杠后缀匹配", () => {
    const index = buildAaIndex([
      makeAaModel({
        slug: "minimax-m3",
        name: "MiniMax-M3",
        creatorSlug: "minimax",
      }),
    ]);
    const match = matchModelToAa(
      makeModel({ slug: "minimaxai/minimax-m3", name: "" }),
      index,
    );
    expect(match?.method).toBe("suffix");
  });

  it("供应商别名表生效：X.AI 归入 xai 的 creator 池后走 fuzzy", () => {
    const index = buildAaIndex([
      makeAaModel({
        slug: "grok-beta-vis-v2",
        name: "Grok Beta Vis v2",
        creatorSlug: "xai",
      }),
    ]);

    const aliased = matchModelToAa(
      makeModel({
        slug: "grok-beta-vis",
        name: "Grok Beta Vis",
        provider: { name: "X.AI", slug: "x-ai", type: "direct" },
      }),
      index,
    );
    expect(aliased?.method).toBe("fuzzy");
    expect(aliased?.model.slug).toBe("grok-beta-vis-v2");

    // 无别名时 creator 池不存在，全局池阈值更严（0.85），同样相似度不命中
    const notAliased = matchModelToAa(
      makeModel({
        slug: "grok-beta-vis",
        name: "Grok Beta Vis",
        provider: { name: "XAI Corp", slug: "xai-corp", type: "direct" },
      }),
      index,
    );
    expect(notAliased).toBeNull();
  });

  it("无 creator 池时使用更严的全局阈值（0.85）", () => {
    const index = buildAaIndex([
      makeAaModel({
        slug: "nova-pro-15-ultra-x-2026-edition",
        name: "Nova Pro 1.5 Ultra X",
        creatorSlug: "othercorp",
      }),
    ]);
    const match = matchModelToAa(
      makeModel({ slug: "nova-pro-1-5-ultra-x-2026", name: "UniqueNova" }),
      index,
    );
    expect(match?.method).toBe("fuzzy");
  });

  it("相似度过低时不匹配", () => {
    const index = buildAaIndex([
      makeAaModel({ slug: "gpt-4o", name: "GPT-4o", creatorSlug: "openai" }),
    ]);
    const match = matchModelToAa(
      makeModel({ slug: "zzz", name: "Zzz" }),
      index,
    );
    expect(match).toBeNull();
  });

  it("slug 与 name 均为空时不匹配", () => {
    const index = buildAaIndex([
      makeAaModel({ slug: "gpt-4o", name: "GPT-4o", creatorSlug: "provider" }),
    ]);
    const match = matchModelToAa(makeModel({ slug: "", name: "" }), index);
    expect(match).toBeNull();
  });
});
