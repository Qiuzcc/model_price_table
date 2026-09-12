/** 数据源适配器共享的解析与映射工具 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function toText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 宽松数值解析：兼容字符串形式的数字（如 OpenRouter 的定价字段） */
export function toFloat(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toTextArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** 合并输入 / 输出模态为去重列表 */
export function mergeModalities(input: string[], output: string[]): string[] {
  return [...new Set([...input, ...output])];
}

/** 按模型 ID 启发式推断类型（备份源无结构化类型字段时的降级手段），识别不出返回 null */
export function inferModelType(id: string): string | null {
  if (/rerank/i.test(id)) return "rerank";
  if (/embed/i.test(id)) return "embedding";
  return null;
}
