const DB_NAME = "ocs-offline-queue";
const DB_VERSION = 1;
const STORE_NAME = "mutations";
const LOCAL_STORAGE_KEY = "ocs_offline_queue_v1";

function supportsIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open offline queue database."));
  });
}

function readLocalStorageQueue() {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalStorageQueue(entries) {
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entries));
}

async function withStore(mode, callback) {
  if (!supportsIndexedDb()) {
    return callback(null);
  }

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);

    let value;
    let callbackDone = false;
    let committed = false;
    const finish = () => { if (callbackDone && committed) resolve(value); };
    transaction.oncomplete = () => {
      committed = true;
      db.close();
      finish();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Offline queue transaction failed."));
    };

    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Offline queue transaction was aborted."));
    };
    Promise.resolve().then(() => callback(store))
      .then(result => { value = result; callbackDone = true; finish(); })
      .catch(error => { transaction.abort(); reject(error); });
  });
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

function matchesUserScope(entry, userId) {
  if (userId == null) {
    return true;
  }
  const entryUserId = entry?.userId;
  // Legacy entries (no userId) are treated as orphaned — they belong to a
  // previous session and should not leak across user switches.
  return entryUserId != null && Number(entryUserId) === Number(userId);
}

export async function enqueueOfflineMutation(entry) {
  const record = {
    ...entry,
    id: entry.id || crypto.randomUUID(),
    timestamp: entry.timestamp || new Date().toISOString(),
    userId: entry.userId != null ? Number(entry.userId) : null,
  };

  if (supportsIndexedDb()) {
    await withStore("readwrite", (store) => {
      store.put(record);
    });
    return record;
  }

  const entries = readLocalStorageQueue();
  const existing = entries.findIndex(entry => entry.id === record.id);
  if (existing >= 0) entries[existing] = record;
  else entries.push(record);
  writeLocalStorageQueue(entries);
  return record;
}

export async function listOfflineMutations({ userId = null } = {}) {
  let entries;
  if (supportsIndexedDb()) {
    entries = await withStore("readonly", (store) =>
      new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      }),
    );
  } else {
    entries = readLocalStorageQueue();
  }

  const scoped = userId == null ? entries : entries.filter((entry) => matchesUserScope(entry, userId));
  return sortEntries(scoped);
}

export async function removeOfflineMutation(id) {
  if (!id) {
    return;
  }

  if (supportsIndexedDb()) {
    await withStore("readwrite", (store) => {
      store.delete(id);
    });
    return;
  }

  writeLocalStorageQueue(readLocalStorageQueue().filter((entry) => entry.id !== id));
}

export async function countOfflineMutations({ userId = null } = {}) {
  const entries = await listOfflineMutations({ userId });
  return entries.length;
}

export async function clearOfflineMutationsForUser(userId) {
  if (userId == null) return 0;
  const targetId = Number(userId);

  if (supportsIndexedDb()) {
    const removed = await withStore("readwrite", (store) =>
      new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
          const all = request.result || [];
          let count = 0;
          for (const entry of all) {
            if (entry?.userId != null && Number(entry.userId) === targetId) {
              store.delete(entry.id);
              count += 1;
            }
          }
          resolve(count);
        };
        request.onerror = () => reject(request.error);
      }),
    );
    return removed;
  }

  const entries = readLocalStorageQueue();
  const kept = entries.filter((entry) => !(entry?.userId != null && Number(entry.userId) === targetId));
  writeLocalStorageQueue(kept);
  return entries.length - kept.length;
}
