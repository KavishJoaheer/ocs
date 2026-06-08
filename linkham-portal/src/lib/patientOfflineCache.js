const DB_NAME = "ocs-patient-offline-cache";
const DB_VERSION = 1;
const STORE_NAME = "directory";
const RECORD_ID = "doctor-directory";
const CRYPTO_KEY_STORAGE = "ocs_patient_cache_crypto_key";

function supportsIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function supportsWebCrypto() {
  return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}

function getKeyStore() {
  if (typeof window === "undefined") {
    return null;
  }

  if (window.localStorage) {
    return window.localStorage;
  }

  return window.sessionStorage || null;
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function getOrCreateCryptoKey() {
  if (!supportsWebCrypto()) {
    return null;
  }

  const keyStore = getKeyStore();
  if (!keyStore) {
    return null;
  }

  let encodedKey = keyStore.getItem(CRYPTO_KEY_STORAGE);

  // Migrate a legacy key that used to live in sessionStorage so encrypted caches
  // written by older builds remain decryptable after the PWA cold-starts.
  if (!encodedKey && typeof window !== "undefined" && window.sessionStorage) {
    const legacyKey = window.sessionStorage.getItem(CRYPTO_KEY_STORAGE);
    if (legacyKey) {
      encodedKey = legacyKey;
      try {
        keyStore.setItem(CRYPTO_KEY_STORAGE, legacyKey);
        window.sessionStorage.removeItem(CRYPTO_KEY_STORAGE);
      } catch {
        // Best-effort migration only.
      }
    }
  }

  if (!encodedKey) {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    encodedKey = bytesToBase64(keyBytes);
    keyStore.setItem(CRYPTO_KEY_STORAGE, encodedKey);
  }

  const rawKey = base64ToBytes(encodedKey);
  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptPayload(payload) {
  const key = await getOrCreateCryptoKey();

  if (!key) {
    return {
      encrypted: false,
      payload,
    };
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  return {
    encrypted: true,
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(cipher)),
  };
}

async function decryptPayload(record) {
  if (!record?.encrypted) {
    return record?.payload || null;
  }

  const key = await getOrCreateCryptoKey();
  if (!key) {
    return null;
  }

  try {
    const iv = base64ToBytes(record.iv);
    const cipher = base64ToBytes(record.cipher);
    const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    const decoded = new TextDecoder().decode(plainBuffer);
    return JSON.parse(decoded);
  } catch (error) {
    console.warn("Patient offline cache decryption failed (key rotated or storage corrupted):", error?.message || error);
    return null;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open patient offline cache."));
  });
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
      reject(transaction.error || new Error("Patient offline cache transaction failed."));
    };

    Promise.resolve(callback(store))
      .then(resolve)
      .catch(reject);
  });
}

export async function savePatientDirectoryCache(userId, payload) {
  const wrapped = await encryptPayload(payload);
  const record = {
    id: RECORD_ID,
    userId: Number(userId || 0),
    ...wrapped,
    synced_at: payload?.synced_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (supportsIndexedDb()) {
    await withStore("readwrite", (store) => {
      store.put(record);
    });
    return record;
  }

  sessionStorage.setItem(`${RECORD_ID}:${userId}`, JSON.stringify(record));
  return record;
}

export async function getPatientDirectoryCache(userId) {
  let record = null;

  try {
    if (supportsIndexedDb()) {
      record = await withStore("readonly", (store) =>
        new Promise((resolve, reject) => {
          const request = store.get(RECORD_ID);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        }),
      );
    } else if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(`${RECORD_ID}:${userId}`);
      record = raw ? JSON.parse(raw) : null;
    }
  } catch (error) {
    console.warn("Patient offline cache read failed:", error?.message || error);
    return null;
  }

  if (!record || Number(record.userId) !== Number(userId)) {
    return null;
  }

  const payload = await decryptPayload(record);
  if (!payload) {
    return null;
  }

  return {
    ...payload,
    synced_at: payload.synced_at || record.synced_at || record.updated_at,
  };
}

export async function clearPatientOfflineCache() {
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.removeItem(CRYPTO_KEY_STORAGE);
      window.sessionStorage?.removeItem(CRYPTO_KEY_STORAGE);
    }
  } catch {
    // Best-effort key clearing only.
  }

  if (supportsIndexedDb()) {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
    return;
  }

  if (typeof sessionStorage !== "undefined") {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith(`${RECORD_ID}:`))
      .forEach((key) => sessionStorage.removeItem(key));
  }
}
