const DB_NAME = "matchops-db";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("state")) {
        db.createObjectStore("state");
      }
      if (!db.objectStoreNames.contains("reviews")) {
        db.createObjectStore("reviews", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("snapshots")) {
        db.createObjectStore("snapshots", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, store: string, value: unknown, key?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    const req = key !== undefined ? s.put(value, key) : s.put(value);
    tx.oncomplete = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export interface PnmState {
  id: string;
  name: string;
  idNumber: string;
  matchedWith?: string | null;
  secondMatch?: string | null;
}

export interface RoundState {
  id: string;
  name: string;
  sortOrder: number;
  pnms: PnmState[];
}

export interface DayState {
  id: string;
  name: string;
  rounds: RoundState[];
}

export interface FullState {
  days: DayState[];
  actives: { id: string; name: string }[];
  activeDayId: string;
  activeRoundId: string;
  chainLengthLimit: number;
  commentActiveOverrides?: Record<string, string[]>;
}

export interface StoredReview {
  id: string;
  pnmId: string;
  activeId: string;
  activeName: string;
  pnmName: string;
  stars: number;
  note: string;
  updatedAt: string;
}

export interface SnapshotMeta {
  id: string;
  label: string;
  createdAt: string;
}

export interface StoredSnapshot extends SnapshotMeta {
  payload: object;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function getDb() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

export async function loadState(): Promise<FullState | null> {
  const db = await getDb();
  const state = await idbGet<FullState>(db, "state", "main");
  return state ?? null;
}

export async function saveState(state: FullState): Promise<void> {
  const db = await getDb();
  await idbPut(db, "state", state, "main");
}

export async function loadReviews(): Promise<StoredReview[]> {
  const db = await getDb();
  return idbGetAll<StoredReview>(db, "reviews");
}

export async function upsertReview(data: Omit<StoredReview, "updatedAt">): Promise<StoredReview> {
  const db = await getDb();
  const review: StoredReview = { ...data, updatedAt: new Date().toISOString() };
  await idbPut(db, "reviews", review);
  return review;
}

export async function deleteReviewById(id: string): Promise<void> {
  const db = await getDb();
  await idbDelete(db, "reviews", id);
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const db = await getDb();
  const all = await idbGetAll<StoredSnapshot>(db, "snapshots");
  return all
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(({ id, label, createdAt }) => ({ id, label, createdAt }));
}

export async function createSnapshot(id: string, label: string, payload: object): Promise<SnapshotMeta> {
  const db = await getDb();
  const snap: StoredSnapshot = { id, label, createdAt: new Date().toISOString(), payload };
  await idbPut(db, "snapshots", snap);
  return { id, label, createdAt: snap.createdAt };
}

export async function getSnapshotPayload(id: string): Promise<object | null> {
  const db = await getDb();
  const snap = await idbGet<StoredSnapshot>(db, "snapshots", id);
  return snap ? snap.payload : null;
}

export async function deleteSnapshotById(id: string): Promise<void> {
  const db = await getDb();
  await idbDelete(db, "snapshots", id);
}

export async function exportFullBackup(): Promise<void> {
  const db = await getDb();
  const [state, reviews, snapshots] = await Promise.all([
    idbGet<FullState>(db, "state", "main"),
    idbGetAll<StoredReview>(db, "reviews"),
    idbGetAll<StoredSnapshot>(db, "snapshots"),
  ]);
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    state: state ?? null,
    reviews,
    snapshots,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `matchops-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importFullBackup(file: File): Promise<void> {
  const text = await file.text();
  const backup = JSON.parse(text);
  if (!backup || typeof backup !== "object") throw new Error("Invalid backup file");
  const db = await getDb();
  if (backup.state) {
    await idbPut(db, "state", backup.state, "main");
  }
  if (Array.isArray(backup.reviews)) {
    for (const r of backup.reviews) await idbPut(db, "reviews", r);
  }
  if (Array.isArray(backup.snapshots)) {
    for (const s of backup.snapshots) await idbPut(db, "snapshots", s);
  }
}
