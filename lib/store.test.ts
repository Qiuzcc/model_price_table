import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VISIBLE_COLUMNS_VERSION,
  loadDisplayCurrency,
  loadSelectedSids,
  loadVisibleColumns,
  loadVisibleColumnsVersion,
  saveDisplayCurrency,
  saveSelectedSids,
  saveVisibleColumns,
  saveVisibleColumnsVersion,
} from "@/lib/store";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("已选模型 sid", () => {
  it("无缓存时返回 null", () => {
    expect(loadSelectedSids()).toBeNull();
  });

  it("保存后可读取回来", () => {
    saveSelectedSids(["acme/alpha", "gadget/gamma"]);
    expect(loadSelectedSids()).toEqual(["acme/alpha", "gadget/gamma"]);
  });

  it("过滤数组中的非字符串项", () => {
    window.localStorage.setItem(
      "mpt:selected-sids",
      JSON.stringify(["a", 1, null, "b"]),
    );
    expect(loadSelectedSids()).toEqual(["a", "b"]);
  });

  it("非数组或坏 JSON 返回 null", () => {
    window.localStorage.setItem("mpt:selected-sids", JSON.stringify({ a: 1 }));
    expect(loadSelectedSids()).toBeNull();

    window.localStorage.setItem("mpt:selected-sids", "{bad json");
    expect(loadSelectedSids()).toBeNull();
  });
});

describe("列可见性", () => {
  it("无缓存时返回 null", () => {
    expect(loadVisibleColumns()).toBeNull();
  });

  it("保存后可读取回来", () => {
    saveVisibleColumns(["inputPrice", "outputPrice"]);
    expect(loadVisibleColumns()).toEqual(["inputPrice", "outputPrice"]);
  });

  it("版本号未写入时按 v1 处理（默认 1）", () => {
    expect(loadVisibleColumnsVersion()).toBe(1);
  });

  it("版本号保存后可读取，非法值回退为 1", () => {
    saveVisibleColumnsVersion(VISIBLE_COLUMNS_VERSION);
    expect(loadVisibleColumnsVersion()).toBe(VISIBLE_COLUMNS_VERSION);

    window.localStorage.setItem(
      "mpt:visible-columns-version",
      JSON.stringify("2"),
    );
    expect(loadVisibleColumnsVersion()).toBe(1);

    window.localStorage.setItem(
      "mpt:visible-columns-version",
      JSON.stringify(Number.NaN),
    );
    expect(loadVisibleColumnsVersion()).toBe(1);
  });
});

describe("价格展示币种", () => {
  it("无缓存返回 null，合法值可往返", () => {
    expect(loadDisplayCurrency()).toBeNull();

    saveDisplayCurrency("CNY");
    expect(loadDisplayCurrency()).toBe("CNY");

    saveDisplayCurrency("USD");
    expect(loadDisplayCurrency()).toBe("USD");

    saveDisplayCurrency("native");
    expect(loadDisplayCurrency()).toBe("native");
  });

  it("非法值返回 null", () => {
    window.localStorage.setItem("mpt:display-currency", JSON.stringify("JPY"));
    expect(loadDisplayCurrency()).toBeNull();
  });
});

describe("写入异常容错", () => {
  it("localStorage 写入失败时静默忽略，不抛异常", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });

    expect(() => saveSelectedSids(["a"])).not.toThrow();
    expect(() => saveVisibleColumns(["inputPrice"])).not.toThrow();
    expect(() => saveVisibleColumnsVersion(2)).not.toThrow();
    expect(() => saveDisplayCurrency("CNY")).not.toThrow();
    expect(setItem).toHaveBeenCalled();
  });

  it("localStorage 读取失败时返回 null", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("security error");
    });
    expect(loadSelectedSids()).toBeNull();
    expect(loadVisibleColumns()).toBeNull();
    expect(loadDisplayCurrency()).toBeNull();
  });
});
