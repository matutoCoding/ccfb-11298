// IndexedDB 持久层：订单元数据 + 结图/高度场大数组 blob
import type { HeightField, OrderMeta } from './types';

const DB_NAME = 'rug-studio';
const DB_VERSION = 1;
const STORE_META = 'orders';
const STORE_BLOB = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_BLOB)) db.createObjectStore(STORE_BLOB);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function saveOrder(meta: OrderMeta): Promise<void> {
  await tx(STORE_META, 'readwrite', (s) => s.put(meta));
}

export async function loadAllOrders(): Promise<OrderMeta[]> {
  const all = await tx(STORE_META, 'readonly', (s) => s.getAll());
  return (all as OrderMeta[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteOrder(id: string): Promise<void> {
  await tx(STORE_META, 'readwrite', (s) => s.delete(id));
  await safeRemoveBlob(`${id}:knots`);
  await safeRemoveBlob(`${id}:heights`);
}

async function safeRemoveBlob(key: string) {
  try {
    await tx(STORE_BLOB, 'readwrite', (s) => s.delete(key));
  } catch {
    /* 忽略缺失 blob */
  }
}

export interface KnotBlob {
  cols: number;
  rows: number;
  paletteIds: string[];
  knots: Uint16Array;
  jagged: Uint8Array;
}

export async function saveKnots(orderId: string, blob: KnotBlob): Promise<void> {
  await tx(STORE_BLOB, 'readwrite', (s) =>
    s.put({ cols: blob.cols, rows: blob.rows, paletteIds: blob.paletteIds,
      knots: blob.knots.buffer, jagged: blob.jagged.buffer }, `${orderId}:knots`),
  );
}

export async function loadKnots(orderId: string): Promise<KnotBlob | null> {
  const raw = await tx(STORE_BLOB, 'readonly', (s) => s.get(`${orderId}:knots`));
  if (!raw) return null;
  const r = raw as { cols: number; rows: number; paletteIds: string[]; knots: ArrayBuffer; jagged: ArrayBuffer };
  return {
    cols: r.cols, rows: r.rows, paletteIds: r.paletteIds,
    knots: new Uint16Array(r.knots), jagged: new Uint8Array(r.jagged),
  };
}

export async function saveHeights(orderId: string, hf: HeightField): Promise<void> {
  await tx(STORE_BLOB, 'readwrite', (s) =>
    s.put({ cols: hf.cols, rows: hf.rows, heights: hf.heights.buffer }, `${orderId}:heights`),
  );
}

export async function loadHeights(orderId: string): Promise<HeightField | null> {
  const raw = await tx(STORE_BLOB, 'readonly', (s) => s.get(`${orderId}:heights`));
  if (!raw) return null;
  const r = raw as { cols: number; rows: number; heights: ArrayBuffer };
  return { cols: r.cols, rows: r.rows, heights: new Float32Array(r.heights) };
}

/** 全局设置走 localStorage（数据量小） */
const SETTINGS_KEY = 'rug-studio-settings';
export function loadSettings<T>(fallback: T): T {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
export function saveSettings<T>(value: T): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
}
