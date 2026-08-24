import { LIBRARY_STORE_NAME, openDraftDatabase } from "./draft-store";

export const DOCUMENT_TYPE_LABELS = {
  sartname: "Yarışma şartnamesi",
  kilavuz: "Değerlendirme kılavuzu",
  resmi_belge: "Resmî değerlendirme belgesi",
  ek_kriter: "Ek kriter dokümanı",
  teknik: "Teknik gereksinimler",
  ornek: "Örnek değerlendirme dokümanı",
} as const;

export type LibraryDocumentType = keyof typeof DOCUMENT_TYPE_LABELS;

export type LibraryDocument = {
  id: string;
  title: string;
  docType: LibraryDocumentType;
  fileName: string;
  mimeType: string;
  size: number;
  addedAt: string;
  file: File;
};

function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openDraftDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const tx = database.transaction(LIBRARY_STORE_NAME, mode);
    const request = run(tx.objectStore(LIBRARY_STORE_NAME));
    let value: T | undefined;
    if (request) request.onsuccess = () => { value = request.result; };
    tx.oncomplete = () => { database.close(); resolve(value as T); };
    tx.onerror = () => { database.close(); reject(tx.error); };
  }));
}

export async function listLibraryDocuments(): Promise<LibraryDocument[]> {
  try {
    const items = await transaction<LibraryDocument[]>("readonly", (store) => store.getAll() as IDBRequest<LibraryDocument[]>);
    return (items ?? [])
      .filter((item) => item.file instanceof File)
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  } catch (error) {
    // Depo açılamadıysa liste boş görünür; sebebi konsolda kalsın.
    console.error("[belge havuzu] liste okunamadı", error);
    return [];
  }
}

export async function addLibraryDocument(input: {
  title: string;
  docType: LibraryDocumentType;
  file: File;
}): Promise<LibraryDocument> {
  const entry: LibraryDocument = {
    // Toplu eklemede aynı milisaniyede birden fazla kayıt oluşabilir; çakışma
    // olmaması için mümkünse UUID kullanılır.
    id: `doc-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`,
    title: input.title.trim() || input.file.name,
    docType: input.docType,
    fileName: input.file.name,
    mimeType: input.file.type,
    size: input.file.size,
    addedAt: new Date().toISOString(),
    file: input.file,
  };
  await transaction("readwrite", (store) => { store.put(entry); });
  return entry;
}

export async function deleteLibraryDocument(id: string): Promise<void> {
  await transaction("readwrite", (store) => { store.delete(id); });
}
