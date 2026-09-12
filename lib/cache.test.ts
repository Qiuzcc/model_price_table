import { afterEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { readCache, removeCache, writeCache } from "@/lib/cache";

const DB_NAME = "model-price-cache";
const STORE_NAME = "kv";

/** 绕过封装直接向底层写入原始值（用于模拟非法缓存数据） */
function putRaw(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("缓存读写", () => {
  it("写入后读取返回含时间戳的缓存包", async () => {
    const fetchedAt = 1_800_000_000_000;
    await writeCache("test-roundtrip", { hello: "world" }, fetchedAt);

    const envelope = await readCache<{ hello: string }>("test-roundtrip");
    expect(envelope).toEqual({ fetchedAt, data: { hello: "world" } });
  });

  it("未命中返回 null", async () => {
    await expect(readCache("test-missing-key")).resolves.toBeNull();
  });

  it("同 key 重复写入时覆盖旧值", async () => {
    await writeCache("test-overwrite", { version: 1 }, 1);
    await writeCache("test-overwrite", { version: 2 }, 2);

    const envelope = await readCache<{ version: number }>("test-overwrite");
    expect(envelope).toEqual({ fetchedAt: 2, data: { version: 2 } });
  });

  it("删除后读取返回 null", async () => {
    await writeCache("test-remove", { a: 1 });
    await removeCache("test-remove");
    await expect(readCache("test-remove")).resolves.toBeNull();
  });

  it("删除不存在的 key 不报错", async () => {
    await expect(removeCache("test-remove-missing")).resolves.toBeUndefined();
  });
});

describe("非法缓存数据防护", () => {
  it("原始值不是对象时返回 null", async () => {
    await putRaw("test-raw-string", "not-an-envelope");
    await expect(readCache("test-raw-string")).resolves.toBeNull();
  });

  it("缺少 fetchedAt 字段时返回 null", async () => {
    await putRaw("test-raw-no-fetchedat", { data: { a: 1 } });
    await expect(readCache("test-raw-no-fetchedat")).resolves.toBeNull();
  });

  it("fetchedAt 非数字时返回 null", async () => {
    await putRaw("test-raw-bad-fetchedat", {
      fetchedAt: "yesterday",
      data: {},
    });
    await expect(readCache("test-raw-bad-fetchedat")).resolves.toBeNull();
  });
});

describe("IndexedDB 不可用时的降级", () => {
  it("读写删均静默降级，不影响主流程", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await expect(readCache("test-no-idb")).resolves.toBeNull();
    await expect(writeCache("test-no-idb", { a: 1 })).resolves.toBeUndefined();
    await expect(removeCache("test-no-idb")).resolves.toBeUndefined();
  });
});
