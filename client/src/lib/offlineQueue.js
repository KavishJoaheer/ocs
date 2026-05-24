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

    transaction.oncomplete = () => {
      db.close();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Offline queue transaction failed."));
    };

    Promise.resolve(callback(store))
      .then(resolve)
      .catch(reject);
  });
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

export async function enqueueOfflineMutation(entry) {
  const record = {
    ...entry,
    id: entry.id || crypto.randomUUID(),
    timestamp: entry.timestamp || new Date().toISOString(),
  };

  if (supportsIndexedDb()) {
    await withStore("readwrite", (store) => {
      store.put(record);
    });
    return record;
  }

  const entries = readLocalStorageQueue();
  entries.push(record);
  writeLocalStorageQueue(entries);
  return record;
}

export async function listOfflineMutations() {
  if (supportsIndexedDb()) {
    const entries = await withStore("readonly", (store) =>
      new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      }),
    );
    return sortEntries(entries);
  }

  return sortEntries(readLocalStorageQueue());
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

export async function countOfflineMutations() {
  const entries = await listOfflineMutations();
  return entries.length;
}
