import { REPORT_POOL_STORE_NAME, openDraftDatabase } from "./draft-store";
import type { ReportRecord } from "./types";

/**
 * Değerlendirme havuzu: katılımcı raporu kayıtları PDF dosyalarıyla birlikte
 * IndexedDB'de tutulur. Bu depo cihaza özeldir; çok kullanıcılı paylaşım
 * sonraki sürümün kapsamındadır.
 */
export type StoredReport = ReportRecord & {
  file: File;
  /** D1/R2 başvuru havuzundan geldiyse sunucu kaydının kimliği. */
  sourceApplicationId?: string;
  /** Analiz sırasında çıkarılan sayfa metinleri; havuz içi benzerlik kontrolünde kullanılır. */
  pagesText?: string[];
};

function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openDraftDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const tx = database.transaction(REPORT_POOL_STORE_NAME, mode);
    const request = run(tx.objectStore(REPORT_POOL_STORE_NAME));
    let value: T | undefined;
    if (request) request.onsuccess = () => { value = request.result; };
    tx.oncomplete = () => { database.close(); resolve(value as T); };
    tx.onerror = () => { database.close(); reject(tx.error); };
  }));
}

export async function listReports(): Promise<StoredReport[]> {
  const items = await transaction<StoredReport[]>("readonly", (store) => store.getAll() as IDBRequest<StoredReport[]>);
  return (items ?? [])
    .filter((item) => item.file instanceof File)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function saveReport(entry: StoredReport): Promise<void> {
  await transaction("readwrite", (store) => { store.put(entry); });
}

export async function deleteReport(id: string): Promise<void> {
  await transaction("readwrite", (store) => { store.delete(id); });
}

export function createReportId(): string {
  return `rapor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
