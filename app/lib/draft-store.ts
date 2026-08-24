import type { AnalysisResult, Criterion, ProfileExport, SetupData, Step } from "./types";

const SNAPSHOT_KEY = "kriter-atolyesi:draft-v1";
const DB_NAME = "kriter-atolyesi";
const DB_VERSION = 3;
const STORE_NAME = "draft-files";
export const LIBRARY_STORE_NAME = "library-documents";
export const REPORT_POOL_STORE_NAME = "report-pool";
const FILE_KEY = "source-document";

export type DraftSnapshot = {
  step: Step;
  setup: SetupData;
  result: AnalysisResult | null;
  criteria: Criterion[];
  profile: ProfileExport | null;
  /** Değerlendirmeye dahil edilen puan gruplarının kimlikleri; eski taslaklarda bulunmaz. */
  includedGroupIds?: string[];
  /** @deprecated İsim tabanlı kapsam; eski taslakları okuyup kimliğe göç ettirmek için. */
  includedGroups?: string[];
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
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    // Depolama kapalı/dolu olduğunda React efektini düşürme. Kaynak PDF ayrıca
    // IndexedDB'de tutulur; kullanıcı mevcut oturumda çalışmaya devam edebilir.
    return false;
  }
}

export function clearDraftSnapshot() {
  localStorage.removeItem(SNAPSHOT_KEY);
}

export function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(LIBRARY_STORE_NAME)) {
        request.result.createObjectStore(LIBRARY_STORE_NAME, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(REPORT_POOL_STORE_NAME)) {
        request.result.createObjectStore(REPORT_POOL_STORE_NAME, { keyPath: "id" });
      }
    };
    // Başka bir sekme eski sürümü açık tutuyorsa yükseltme bloke olur; sessizce beklemek yerine bildirilir.
    request.onblocked = () => reject(new Error(
      "Tarayıcı deposu güncellenemedi. Uygulamanın açık olduğu diğer sekmeleri kapatıp sayfayı yenileyin.",
    ));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
