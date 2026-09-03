import type { AnalysisResult, Criterion, ProfileExport, SetupData, Step, UnselectedBlocksReview } from "./types";

// v2: dört aşamalı, puansız kriter modeli. Eski v1 taslakları okunmaz;
// kaynak PDF IndexedDB'de korunur ve belge yeni prensiple yeniden analiz edilir.
const SNAPSHOT_KEY_PREFIX = "kriter-atolyesi:draft-v3:";
const PREVIOUS_SNAPSHOT_KEY = "kriter-atolyesi:draft-v2";
const LEGACY_SNAPSHOT_KEYS = ["kriter-atolyesi:draft-v1"];
const DB_NAME = "kriter-atolyesi";
const DB_VERSION = 3;
const STORE_NAME = "draft-files";
export const LIBRARY_STORE_NAME = "library-documents";
export const REPORT_POOL_STORE_NAME = "report-pool";
const FILE_KEY_PREFIX = "source-document:";
const PREVIOUS_FILE_KEY = "source-document";
const TEMPLATE_FILE_KEY = "report-template";
const UNSELECTED_REVIEW_KEY_PREFIX = "unselected-review:";

export type DraftSnapshot = {
  step: Step;
  setup: SetupData;
  result: AnalysisResult | null;
  criteria: Criterion[];
  profile: ProfileExport | null;
};

function safeScope(scope: string): string {
  return encodeURIComponent(scope.trim() || "workspace").slice(0, 240);
}

function snapshotKey(scope: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${safeScope(scope)}`;
}

function fileKey(scope: string): string {
  return `${FILE_KEY_PREFIX}${safeScope(scope)}`;
}

function unselectedReviewKey(scope: string): string {
  return `${UNSELECTED_REVIEW_KEY_PREFIX}${safeScope(scope)}`;
}

export function loadDraftSnapshot(scope = "workspace"): DraftSnapshot | null {
  try {
    for (const key of LEGACY_SNAPSHOT_KEYS) localStorage.removeItem(key);
    const scopedKey = snapshotKey(scope);
    let stored = localStorage.getItem(scopedKey);
    if (!stored && scope === "workspace") {
      stored = localStorage.getItem(PREVIOUS_SNAPSHOT_KEY);
      if (stored) {
        localStorage.setItem(scopedKey, stored);
        localStorage.removeItem(PREVIOUS_SNAPSHOT_KEY);
      }
    }
    if (!stored) return null;
    const snapshot = JSON.parse(stored) as DraftSnapshot;
    // Yalnızca dört aşamalı modelde üretilmiş kriterler geri yüklenir.
    const valid = Array.isArray(snapshot.criteria)
      && snapshot.criteria.every((item) => typeof item?.stage === "string" && typeof item?.required === "boolean");
    return valid ? snapshot : null;
  } catch {
    return null;
  }
}

export function saveDraftSnapshot(snapshot: DraftSnapshot, scope = "workspace") {
  try {
    localStorage.setItem(snapshotKey(scope), JSON.stringify(snapshot));
    return true;
  } catch {
    // Depolama kapalı/dolu olduğunda React efektini düşürme. Kaynak PDF ayrıca
    // IndexedDB'de tutulur; kullanıcı mevcut oturumda çalışmaya devam edebilir.
    return false;
  }
}

export function clearDraftSnapshot(scope = "workspace") {
  localStorage.removeItem(snapshotKey(scope));
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

export async function loadDraftFile(scope = "workspace"): Promise<File | null> {
  const scoped = await loadStoredDraftFile(fileKey(scope));
  if (scoped || scope !== "workspace") return scoped;
  const previous = await loadStoredDraftFile(PREVIOUS_FILE_KEY);
  if (previous) {
    await saveStoredDraftFile(fileKey(scope), previous);
    await saveStoredDraftFile(PREVIOUS_FILE_KEY, null);
  }
  return previous;
}

async function loadStoredDraftFile(key: string): Promise<File | null> {
  try {
    const database = await openDraftDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result instanceof File ? request.result : null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
  } catch {
    return null;
  }
}

export async function saveDraftFile(file: File | null, scope = "workspace") {
  return saveStoredDraftFile(fileKey(scope), file);
}

/**
 * Ayrı rapor şablonu yükleme alanı kaldırıldı (Yarışma Yöneticisi yalnızca
 * şartname yükler). Eski sürümde saklanmış şablon PDF'i tarayıcıda kalmasın
 * diye bir kez silinir; kayıt yoksa işlem sessizce geçer.
 */
export async function clearLegacyTemplateFile() {
  return saveStoredDraftFile(TEMPLATE_FILE_KEY, null);
}

async function saveStoredDraftFile(key: string, file: File | null) {
  const database = await openDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    if (file) store.put(file, key);
    else store.delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => database.close());
}

/**
 * Seçilmeyen blok incelemesi localStorage anlık görüntüsüne DEĞİL IndexedDB'ye
 * yazılır: anlık görüntü her kriter tuşlamasında eşzamanlı JSON.stringify ile
 * kaydedilir; yüzlerce blok metnini oraya gömmek hem tuşlama başına takılma
 * hem kota aşımı (ve sessiz catch'te BÜTÜN taslağın düşmesi) riskidir. Mevcut
 * `draft-files` deposu aynı sürümle kullanılır; yeni bir anahtar öneki dışında
 * veri tabanı yükseltmesi gerekmez.
 */
export async function saveUnselectedReview(review: UnselectedBlocksReview | null, scope = "workspace") {
  const database = await openDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    if (review) store.put(review, unselectedReviewKey(scope));
    else store.delete(unselectedReviewKey(scope));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => database.close());
}

export async function loadUnselectedReview(scope = "workspace"): Promise<UnselectedBlocksReview | null> {
  try {
    const database = await openDraftDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(unselectedReviewKey(scope));
      request.onsuccess = () => {
        // Şekil doğrulanır; yabancı ya da bozuk kayıt sessizce yok sayılır ve
        // arayüz sayılarla birlikte "yeniden analiz edin" notunu gösterir.
        const stored = request.result as Partial<UnselectedBlocksReview> | undefined;
        resolve(
          stored && typeof stored.totalCount === "number" && Array.isArray(stored.blocks)
            ? stored as UnselectedBlocksReview
            : null,
        );
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
  } catch {
    return null;
  }
}
