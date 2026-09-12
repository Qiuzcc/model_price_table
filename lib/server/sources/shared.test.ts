import { describe, expect, it } from "vitest";
import {
  inferModelType,
  isRecord,
  mergeModalities,
  toFloat,
  toNumber,
  toText,
  toTextArray,
} from "@/lib/server/sources/shared";

describe("isRecord", () => {
  it("非 null 对象（含数组）为 true", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(true);
  });

  it("null 与原始值为 false", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord("a")).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe("toText", () => {
  it("非空字符串返回原值", () => {
    expect(toText("gpt-4o")).toBe("gpt-4o");
  });

  it("空字符串与非字符串返回 null", () => {
    expect(toText("")).toBeNull();
    expect(toText(123)).toBeNull();
    expect(toText(null)).toBeNull();
    expect(toText(undefined)).toBeNull();
  });
});

describe("toNumber", () => {
  it("有限数字返回原值（含 0 与负数）", () => {
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-1.5)).toBe(-1.5);
  });

  it("NaN / Infinity / 非数字类型返回 null", () => {
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toNumber("1.5")).toBeNull();
    expect(toNumber(null)).toBeNull();
  });
});

describe("toFloat", () => {
  it("兼容字符串形式的数字（如 OpenRouter 定价字段）", () => {
    expect(toFloat("0.5")).toBe(0.5);
    expect(toFloat("0")).toBe(0);
    expect(toFloat(3)).toBe(3);
  });

  it("无法解析的字符串或非法值返回 null", () => {
    expect(toFloat("abc")).toBeNull();
    expect(toFloat("")).toBeNull();
    expect(toFloat(Number.NaN)).toBeNull();
    expect(toFloat(null)).toBeNull();
    expect(toFloat({})).toBeNull();
  });
});

describe("toTextArray", () => {
  it("仅保留字符串项", () => {
    expect(toTextArray(["text", 1, null, "image"])).toEqual(["text", "image"]);
  });

  it("非数组返回空数组", () => {
    expect(toTextArray("text")).toEqual([]);
    expect(toTextArray(null)).toEqual([]);
  });
});

describe("mergeModalities", () => {
  it("合并且去重", () => {
    expect(mergeModalities(["text", "image"], ["image", "audio"])).toEqual([
      "text",
      "image",
      "audio",
    ]);
  });

  it("空输入返回空数组", () => {
    expect(mergeModalities([], [])).toEqual([]);
  });
});

describe("inferModelType", () => {
  it("按 ID 关键词推断 rerank / embedding", () => {
    expect(inferModelType("bge-rerank-v2")).toBe("rerank");
    expect(inferModelType("text-embedding-3-small")).toBe("embedding");
  });

  it("大小写不敏感", () => {
    expect(inferModelType("BGE-Embed")).toBe("embedding");
    expect(inferModelType("RERANK-1")).toBe("rerank");
  });

  it("识别不出返回 null", () => {
    expect(inferModelType("gpt-4o")).toBeNull();
    expect(inferModelType("")).toBeNull();
  });
});
