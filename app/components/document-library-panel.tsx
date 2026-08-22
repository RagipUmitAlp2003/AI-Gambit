"use client";

import { useEffect, useRef, useState } from "react";
import FileBadge from "./file-badge";
import {
  DOCUMENT_TYPE_LABELS,
  addLibraryDocument,
  deleteLibraryDocument,
  listLibraryDocuments,
  type LibraryDocument,
  type LibraryDocumentType,
} from "../lib/document-library";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Görevli belge havuzu: hazır test belgelerinin yanına görevlinin kendi
 * şartname/kılavuz/kriter dokümanlarını ekleyip yönetebildiği panel.
 * Belgeler bu cihazda (tarayıcı deposunda) saklanır.
 */
export default function DocumentLibraryPanel({
  selectedFileName,
  onSelect,
}: {
  selectedFileName: string | null;
  onSelect: (file: File) => void;
}) {
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<LibraryDocumentType>("sartname");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listLibraryDocuments().then(setDocuments);
  }, []);

  async function add() {
    if (!pendingFile) return;
    await addLibraryDocument({ title, docType, file: pendingFile });
    setDocuments(await listLibraryDocuments());
    setTitle("");
    setPendingFile(null);
    setFormOpen(false);
    setNotice("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function remove(id: string) {
    await deleteLibraryDocument(id);
    setDocuments(await listLibraryDocuments());
    setConfirmingId(null);
  }

  function openDocument(item: LibraryDocument) {
    const url = URL.createObjectURL(item.file);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function isPdf(item: LibraryDocument) {
    return item.mimeType === "application/pdf" || item.fileName.toLocaleLowerCase("tr-TR").endsWith(".pdf");
  }

  return (
    <section className="library-panel" aria-labelledby="library-panel-title">
      <div className="sample-library-heading">
        <div>
          <h2 id="library-panel-title">Görevli belge havuzu</h2>
          <p>Şartname, kılavuz ve ek kriter dokümanlarını buradan ekleyip yönetin.</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => setFormOpen((current) => !current)}>
          {formOpen ? "Vazgeç" : "+ Yeni belge ekle"}
        </button>
      </div>

      {formOpen ? (
        <form
          className="library-form"
          onSubmit={(event) => { event.preventDefault(); add(); }}
        >
          <div className="form-grid three-col">
            <label className="field">
              <span className="field-label">Belge dosyası</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.png,.jpg,.jpeg"
                onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null;
                  setPendingFile(selected);
                  setNotice(selected && selected.size > 18 * 1024 * 1024 ? "18 MB üzerindeki belgeler analizde kullanılamaz; yalnızca havuzda saklanır." : "");
                }}
              />
            </label>
            <label className="field">
              <span className="field-label">Belge başlığı</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Örn. 2026 İDA Şartnamesi" />
            </label>
            <label className="field">
              <span className="field-label">Belge türü</span>
              <select value={docType} onChange={(event) => setDocType(event.target.value as LibraryDocumentType)}>
                {(Object.keys(DOCUMENT_TYPE_LABELS) as LibraryDocumentType[]).map((key) => (
                  <option key={key} value={key}>{DOCUMENT_TYPE_LABELS[key]}</option>
                ))}
              </select>
            </label>
          </div>
          {notice ? <p className="library-notice">{notice}</p> : null}
          <div className="library-form-actions">
            <span className="save-note">Belgeler bu cihazdaki havuzda saklanır.</span>
            <button type="submit" className="primary-button" disabled={!pendingFile}>Havuza ekle</button>
          </div>
        </form>
      ) : null}

      {documents.length ? (
        <div className="sample-document-list">
          {documents.map((item) => (
            <article key={item.id} className={selectedFileName === item.fileName ? "selected" : ""}>
              <FileBadge fileName={item.fileName} mimeType={item.mimeType} size="sm" />
              <div className="sample-copy">
                <span>{DOCUMENT_TYPE_LABELS[item.docType]} · {formatBytes(item.size)}</span>
                <h3>{item.title}</h3>
                <p>{item.fileName}</p>
              </div>
              <div className="sample-actions">
                <a href="#library-panel-title" onClick={(event) => { event.preventDefault(); openDocument(item); }}>Belgeyi aç</a>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!isPdf(item) || selectedFileName === item.fileName}
                  title={isPdf(item) ? undefined : "Analiz için yalnızca PDF belgeler seçilebilir."}
                  onClick={() => onSelect(new File([item.file], item.fileName, { type: item.mimeType || "application/pdf" }))}
                >
                  {selectedFileName === item.fileName ? "Seçildi" : "Bu belgeyi seç"}
                </button>
                {confirmingId === item.id ? (
                  <span className="delete-confirm">
                    <button type="button" className="danger-button" onClick={() => remove(item.id)}>Sil</button>
                    <button type="button" className="text-button" onClick={() => setConfirmingId(null)}>Vazgeç</button>
                  </span>
                ) : (
                  <button type="button" className="text-button danger-text" onClick={() => setConfirmingId(item.id)}>Sil</button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="library-empty">Henüz görevli tarafından eklenmiş belge yok. Havuza eklenen belgeler burada listelenir ve analiz için seçilebilir.</p>
      )}
    </section>
  );
}
