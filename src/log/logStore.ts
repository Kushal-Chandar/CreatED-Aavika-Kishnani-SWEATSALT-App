const DB_NAME = "sweatsalt-log";
const STORE_NAME = "readings";
const DB_VERSION = 1;
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export interface LogEntry {
  source: string;
  value: number;
  ts: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("ts", "ts");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function appendEntry(entry: LogEntry): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add(entry);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      resolve();
    };
  });
}

export async function pruneOldEntries(now: number = Date.now()): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const cutoff = now - RETENTION_MS;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const index = tx.objectStore(STORE_NAME).index("ts");
    const range = IDBKeyRange.upperBound(cutoff);
    const cursorReq = index.openCursor(range);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      resolve();
    };
  });
}

export async function queryEntries(): Promise<LogEntry[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      db.close();
      resolve(req.result as LogEntry[]);
    };
    req.onerror = () => {
      db.close();
      resolve([]);
    };
  });
}
