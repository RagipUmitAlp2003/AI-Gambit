import type { AnalysisResult, Criterion, ProfileExport, SetupData, Step } from "./types";

const SNAPSHOT_KEY = "kriter-atolyesi:draft-v1";
const DB_NAME = "kriter-atolyesi";
const STORE_NAME = "draft-files";
export const LIBRARY_STORE_NAME = "library-documents";
const FILE_KEY = "source-document";

/** Bu uygulamanın ihtiyaç duyduğu depolar ve anahtar biçimleri. */
const REQUIRED_STORES: Array<{ name: string; options?: IDBObjectStoreParameters }> = [
  { name: STORE_NAME },
  { name: LIBRARY_STORE_NAME, options: { keyPath: "id" } },
];

export type DraftSnapshot = {
  step: Step;
  setup: SetupData;
  result: AnalysisResult | null;
  criteria: Criterion[];
  profile: ProfileExport | null;
};

export function loadDraftSnapshot(): DraftSnapshot | null {
  try {
    const stored = localStorage.getItem(SNAPSHOT_KEY);
    return stored ? JSON.parse(stored) as DraftSnapshot : null;
  } catch {
    return null;
  }
}

export function saveDraftSnapshot(snapshot: DraftSnapshot) {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function clearDraftSnapshot() {
  localStorage.removeItem(SNAPSHOT_KEY);
}

function rawOpen(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => {
      for (const store of REQUIRED_STORES) {
        if (!request.result.objectStoreNames.contains(store.name)) {
          request.result.createObjectStore(store.name, store.options);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Veri tabanı başka bir sekme tarafından kilitli."));
  });
}

/**
 * Veri tabanını sabit bir sürüm numarası istemeden açar.
 *
 * Sabit sürümle açmak, tarayıcıdaki kayıt daha yeni bir sürümdeyse
 * (ör. başka bir dal ya da sürüm ek depo oluşturmuşsa) `VersionError`
 * verir ve belge havuzu sessizce çalışmaz hâle gelir. Bunun yerine mevcut
 * sürüm okunur; eksik depo varsa sürüm bir artırılarak yalnızca eksikler
 * oluşturulur. Böylece hem eski hem yeni kayıtlarla uyum korunur.
 */
export async function openDraftDatabase(): Promise<IDBDatabase> {
  const database = await rawOpen();
  const missing = REQUIRED_STORES.filter((store) => !database.objectStoreNames.contains(store.name));
  if (missing.length === 0) return database;

  const nextVersion = database.version + 1;
  database.close();
  return rawOpen(nextVersion);
}

export async function loadDraftFile(): Promise<File | null> {
  try {
    const database = await openDraftDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(FILE_KEY);
      request.onsuccess = () => resolve(request.result instanceof File ? request.result : null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
  } catch {
    return null;
  }
}

export async function saveDraftFile(file: File | null) {
  const database = await openDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    if (file) store.put(file, FILE_KEY);
    else store.delete(FILE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => database.close());
}
