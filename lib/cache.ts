/**
 * IndexedDB 轻量缓存封装。
 * 数据集约 3.2MB，超出 localStorage 容量上限，因此统一走 IndexedDB。
 * 任何异常（隐私模式、配额不足等）都不阻断主流程，仅退化为「无缓存」。
 */

const DB_NAME = "model-price-cache";
const STORE_NAME = "kv";
const DB_VERSION = 1;

export interface CacheEnvelope<T> {
  fetchedAt: number;
  data: T;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // 其他标签页触发版本升级时主动关闭连接，避免阻塞
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("无法打开 IndexedDB"));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });

  return dbPromise;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = executor(tx.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB 操作失败"));
      }),
  );
}

export async function readCache<T>(key: string): Promise<CacheEnvelope<T> | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const value = await runTransaction<CacheEnvelope<T> | undefined>("readonly", (store) => store.get(key));
    if (!value || typeof value !== "object" || typeof value.fetchedAt !== "number") return null;
    return value;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, data: T, fetchedAt = Date.now()): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const envelope: CacheEnvelope<T> = { fetchedAt, data };
    await runTransaction("readwrite", (store) => store.put(envelope, key));
  } catch {
    // 写入失败（如配额不足）时静默降级
  }
}

export async function removeCache(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await runTransaction("readwrite", (store) => store.delete(key));
  } catch {
    // 忽略
  }
}
