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
  if (bytes === 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Havuza kabul edilen uzantılar. Tarayıcı `accept` ipucunu atlayabildiği için ayrıca doğrulanır. */
const ALLOWED_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "txt", "png", "jpg", "jpeg"];
const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((extension) => `.${extension}`).join(",");
/** Analizde doğrudan aktarılabilen üst sınır; üzerindeki belgeler yalnızca havuzda saklanır. */
const ANALYZABLE_LIMIT_BYTES = 18 * 1024 * 1024;
/** Tek seferde eklenebilecek belge sayısı. */
const MAX_BATCH = 20;

type PendingFile = {
  key: string;
  file: File;
  title: string;
  /** Boşsa dosya eklenebilir; doluysa reddedilme gerekçesi. */
  error: string;
  /** Eklenebilir ama dikkat çekilmesi gereken durum (ör. boyut). */
  warning: string;
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function titleFromName(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).trim();
}

function describe(file: File): { error: string; warning: string } {
  const extension = extensionOf(file.name);
  if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
    return { error: `Desteklenmeyen dosya türü (.${extension || "uzantısız"}).`, warning: "" };
  }
  if (file.size === 0) {
    return { error: "Dosya boş görünüyor.", warning: "" };
  }
  if (file.size > ANALYZABLE_LIMIT_BYTES) {
    return { error: "", warning: "18 MB üzerinde; analizde kullanılamaz, yalnızca havuzda saklanır." };
  }
  return { error: "", warning: "" };
}

/**
 * Görevli belge havuzu: hazır test belgelerinin yanına görevlinin kendi
 * şartname/kılavuz/kriter dokümanlarını ekleyip yönetebildiği panel.
 * Birden fazla dosya aynı anda seçilebilir; her dosya ayrı kayıt olur ve
 * kendi başlığıyla saklanır. Belgeler bu cihazda (tarayıcı deposunda) tutulur.
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
  const [docType, setDocType] = useState<LibraryDocumentType>("sartname");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listLibraryDocuments().then(setDocuments);
  }, []);

  const addable = pending.filter((item) => !item.error);

  function choose(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    const accepted = files.slice(0, MAX_BATCH);
    const overflow = files.length - accepted.length;

    setPending(
      accepted.map((file, index) => {
        const { error, warning } = describe(file);
        return {
          key: `${file.name}-${file.size}-${file.lastModified}-${index}`,
          file,
          title: titleFromName(file.name),
          error,
          warning,
        };
      }),
    );

    const rejected = accepted.filter((file) => describe(file).error).length;
    setNotice(
      [
        overflow > 0 ? `Tek seferde en fazla ${MAX_BATCH} belge eklenir; ${overflow} dosya alınmadı.` : "",
        rejected > 0 ? `${rejected} dosya desteklenmeyen türde ve eklenmeyecek.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  function patchPending(key: string, title: string) {
    setPending((current) => current.map((item) => (item.key === key ? { ...item, title } : item)));
  }

  function dropPending(key: string) {
    setPending((current) => current.filter((item) => item.key !== key));
  }

  function resetForm() {
    setPending([]);
    setNotice("");
    setFormOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function add() {
    if (addable.length === 0 || saving) return;
    setSaving(true);
    const failed: string[] = [];

    // Her belge ayrı kayıt; biri başarısız olsa da diğerleri eklenir.
    for (const item of addable) {
      try {
        await addLibraryDocument({ title: item.title, docType, file: item.file });
      } catch (error) {
        console.error("[belge havuzu] eklenemedi", item.file.name, error);
        failed.push(item.file.name);
      }
    }

    setDocuments(await listLibraryDocuments());
    setSaving(false);

    if (failed.length) {
      setPending((current) => current.filter((item) => failed.includes(item.file.name)));
      setNotice(`${failed.length} belge eklenemedi: ${failed.join(", ")}. Yeniden deneyebilirsiniz.`);
      return;
    }
    resetForm();
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
          <p>Şartname, kılavuz ve ek kriter dokümanlarını buradan ekleyip yönetin. Birden fazla belge seçebilirsiniz.</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => (formOpen ? resetForm() : setFormOpen(true))}
        >
          {formOpen ? "Vazgeç" : "+ Yeni belge ekle"}
        </button>
      </div>

      {formOpen ? (
        <form
          className="library-form"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <div className="form-grid two-col">
            <label className="field">
              <span className="field-label">Belge dosyaları</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT_ATTRIBUTE}
                onChange={(event) => choose(event.target.files)}
              />
              <span className="field-hint">Ctrl/Shift ile birden fazla dosya seçebilirsiniz.</span>
            </label>
            <label className="field">
              <span className="field-label">Belge türü</span>
              <select value={docType} onChange={(event) => setDocType(event.target.value as LibraryDocumentType)}>
                {(Object.keys(DOCUMENT_TYPE_LABELS) as LibraryDocumentType[]).map((key) => (
                  <option key={key} value={key}>
                    {DOCUMENT_TYPE_LABELS[key]}
                  </option>
                ))}
              </select>
              <span className="field-hint">Seçilen tür bu partideki tüm belgelere uygulanır.</span>
            </label>
          </div>

          {pending.length ? (
            <ul className="pending-list">
              {pending.map((item) => (
                <li key={item.key} className={item.error ? "rejected" : ""}>
                  <FileBadge fileName={item.file.name} mimeType={item.file.type} size="sm" />
                  <div>
                    <input
                      value={item.title}
                      onChange={(event) => patchPending(item.key, event.target.value)}
                      placeholder={item.file.name}
                      aria-label={`${item.file.name} başlığı`}
                      disabled={Boolean(item.error)}
                    />
                    <small>
                      {item.file.name} · {formatBytes(item.file.size)}
                    </small>
                    {item.error ? <small className="pending-error">{item.error}</small> : null}
                    {item.warning ? <small className="pending-warning">{item.warning}</small> : null}
                  </div>
                  <button type="button" className="text-button" onClick={() => dropPending(item.key)}>
                    Çıkar
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {notice ? <p className="library-notice">{notice}</p> : null}
          <div className="library-form-actions">
            <span className="save-note">
              {addable.length
                ? `${addable.length} belge eklenecek. Belgeler bu cihazdaki havuzda saklanır.`
                : "Belgeler bu cihazdaki havuzda saklanır."}
            </span>
            <button type="submit" className="primary-button" disabled={!addable.length || saving}>
              {saving ? "Ekleniyor…" : addable.length > 1 ? `${addable.length} belgeyi havuza ekle` : "Havuza ekle"}
            </button>
          </div>
        </form>
      ) : null}

      {documents.length ? (
        <div className="sample-document-list">
          {documents.map((item) => (
            <article key={item.id} className={selectedFileName === item.fileName ? "selected" : ""}>
              <FileBadge fileName={item.fileName} mimeType={item.mimeType} size="sm" />
              <div className="sample-copy">
                <span>
                  {DOCUMENT_TYPE_LABELS[item.docType]} · {formatBytes(item.size)}
                </span>
                <h3>{item.title}</h3>
                <p>{item.fileName}</p>
              </div>
              <div className="sample-actions">
                <a
                  href="#library-panel-title"
                  onClick={(event) => {
                    event.preventDefault();
                    openDocument(item);
                  }}
                >
                  Belgeyi aç
                </a>
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
                    <button type="button" className="danger-button" onClick={() => remove(item.id)}>
                      Sil
                    </button>
                    <button type="button" className="text-button" onClick={() => setConfirmingId(null)}>
                      Vazgeç
                    </button>
                  </span>
                ) : (
                  <button type="button" className="text-button danger-text" onClick={() => setConfirmingId(item.id)}>
                    Sil
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="library-empty">
          Henüz görevli tarafından eklenmiş belge yok. Havuza eklenen belgeler burada listelenir ve analiz için
          seçilebilir.
        </p>
      )}
    </section>
  );
}
