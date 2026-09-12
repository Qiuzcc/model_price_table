/**
 * 用户偏好的 localStorage 持久化：
 * - 对比列表中已选模型的 sid；
 * - 对比表格的列可见性；
 * - 价格展示币种。
 * 仅存轻量小数据，大体积数据集走 IndexedDB（lib/cache.ts）。
 */

import type { DisplayCurrency } from "./domain/types";

const SELECTED_SIDS_KEY = "mpt:selected-sids";
const VISIBLE_COLUMNS_KEY = "mpt:visible-columns";
const VISIBLE_COLUMNS_VERSION_KEY = "mpt:visible-columns-version";
const DISPLAY_CURRENCY_KEY = "mpt:display-currency";

/** 列集合结构版本：v1 无性能列；v2 新增「输出速度」「首 Token 延迟」 */
export const VISIBLE_COLUMNS_VERSION = 2;

function readJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式等场景写入失败时忽略
  }
}

function readStringArray(key: string): string[] | null {
  const value = readJson(key);
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
}

export function loadSelectedSids(): string[] | null {
  return readStringArray(SELECTED_SIDS_KEY);
}

export function saveSelectedSids(sids: string[]): void {
  writeJson(SELECTED_SIDS_KEY, sids);
}

export function loadVisibleColumns(): string[] | null {
  return readStringArray(VISIBLE_COLUMNS_KEY);
}

/** 旧版本（未写入过版本号）按 v1 处理，触发一次新列迁移 */
export function loadVisibleColumnsVersion(): number {
  const value = readJson(VISIBLE_COLUMNS_VERSION_KEY);
  return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

export function saveVisibleColumns(keys: string[]): void {
  writeJson(VISIBLE_COLUMNS_KEY, keys);
}

export function saveVisibleColumnsVersion(version: number): void {
  writeJson(VISIBLE_COLUMNS_VERSION_KEY, version);
}

/** 价格展示币种偏好（native | CNY | USD），非法值返回 null */
export function loadDisplayCurrency(): DisplayCurrency | null {
  const value = readJson(DISPLAY_CURRENCY_KEY);
  return value === "native" || value === "CNY" || value === "USD"
    ? value
    : null;
}

export function saveDisplayCurrency(value: DisplayCurrency): void {
  writeJson(DISPLAY_CURRENCY_KEY, value);
}
