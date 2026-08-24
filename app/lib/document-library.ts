import { LIBRARY_STORE_NAME, openDraftDatabase } from "./draft-store";

export const DOCUMENT_TYPE_LABELS = {
  sartname: "Yarışma şartnamesi",
  kilavuz: "Değerlendirme kılavuzu",
  resmi_belge: "Resmî değerlendirme belgesi",
  ek_kriter: "Ek kriter dokümanı",
  teknik: "Teknik gereksinimler",
  ornek: "Örnek değerlendirme dokümanı",
  ornek_rapor: "Örnek yarışmacı raporu",
  referans: "Diğer referans belgesi",
} as const;

/**
 * Belge türünün hangi süreçte kaynak olarak kullanılabileceği.
 * "kriter": Kriter Atölyesi'nde profil çıkarımının kaynağı.
 * "rapor":  Değerlendirme Atölyesi'nde değerlendirilecek katılımcı raporu.
 */
export const DOCUMENT_TYPE_USAGE: Record<LibraryDocumentType, "kriter" | "rapor"> = {
  sartname: "kriter",
  kilavuz: "kriter",
  resmi_belge: "kriter",
  ek_kriter: "kriter",
  teknik: "kriter",
  ornek: "kriter",
  ornek_rapor: "rapor",
  referans: "kriter",
};

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

/**
 * Belge havuzu depolama sözleşmesi.
 *
 * UI ve iş mantığı YALNIZCA bu arayüzü kullanır; hangi deponun kullanıldığını
 * bilmez. Bugün tarayıcı içi IndexedDB uygulaması etkindir. Ekip ortak havuzu
 * gerektiğinde aynı arayüzü uygulayan bir sunucu deposu yazılıp
 * `setDocumentRepository()` ile takılması yeterlidir; çağıran kod değişmez.
 */
export type DocumentRepository = {
  list(): Promise<LibraryDocument[]>;
  add(input: { title: string; docType: LibraryDocumentType; file: File }): Promise<LibraryDocument>;
  remove(id: string): Promise<void>;
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

/** Tarayıcı içi (bu cihaza özel) depo uygulaması. */
export const indexedDbDocumentRepository: DocumentRepository = {
  async list() {
    try {
      const items = await transaction<LibraryDocument[]>("readonly", (store) => store.getAll() as IDBRequest<LibraryDocument[]>);
      return (items ?? [])
        .filter((item) => item.file instanceof File)
        .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    } catch {
      return [];
    }
  },

  async add(input) {
    const entry: LibraryDocument = {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
  },

  async remove(id) {
    await transaction("readwrite", (store) => { store.delete(id); });
  },
};

let activeRepository: DocumentRepository = indexedDbDocumentRepository;

/** Depoyu değiştirir (ör. ileride sunucu havuzu). Çağıran kod aynı kalır. */
export function setDocumentRepository(repository: DocumentRepository) {
  activeRepository = repository;
}

export function listLibraryDocuments(): Promise<LibraryDocument[]> {
  return activeRepository.list();
}

export function addLibraryDocument(input: {
  title: string;
  docType: LibraryDocumentType;
  file: File;
}): Promise<LibraryDocument> {
  return activeRepository.add(input);
}

export function deleteLibraryDocument(id: string): Promise<void> {
  return activeRepository.remove(id);
}
