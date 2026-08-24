"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import FileBadge from "./file-badge";
import { fold } from "../lib/competitions";
import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPE_USAGE,
  addLibraryDocument,
  deleteLibraryDocument,
  listLibraryDocuments,
  type LibraryDocument,
  type LibraryDocumentType,
} from "../lib/document-library";
import { SAMPLE_DOCUMENTS, type SampleDocument } from "../lib/sample-documents";
import type { SetupData } from "../lib/types";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isPdfLike(fileName: string, mimeType?: string) {
  return mimeType === "application/pdf" || fileName.toLocaleLowerCase("tr-TR").endsWith(".pdf");
}

/**
 * Belge havuzu penceresi. Uygulamayla gelen hazır test belgeleri ile
 * görevlinin kendi eklediği şartname/kılavuz/örnek rapor dosyalarını tek
 * yerde toplar; kod değişikliği olmadan test veri havuzunu büyütmeyi sağlar.
 *
 * `usage` hangi sürecin havuzu açtığını söyler: Kriter Atölyesi kaynak
 * belgeleri, Değerlendirme Atölyesi ise örnek yarışmacı raporlarını görür.
 */
type LibraryModalProps = {
  usage: "kriter" | "rapor";
  selectedFileName: string | null;
  onClose: () => void;
  onSelect: (file: File) => void;
  /** Yalnızca Kriter Atölyesi'nde: hazır belge seçilince başlangıç ayarları da uygulanır. */
  onSelectSample?: (file: File, setup: Partial<SetupData>) => void;
};

export default function DocumentLibraryModal({ open, ...props }: LibraryModalProps & { open: boolean }) {
  // Pencere yalnızca açıkken monte edilir: her açılış temiz durumla başlar.
  return open ? <LibraryDialog {...props} /> : null;
}

function LibraryDialog({
  usage,
  selectedFileName,
  onClose,
  onSelect,
  onSelectSample,
}: LibraryModalProps) {
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<LibraryDocumentType>(usage === "rapor" ? "ornek_rapor" : "sartname");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    listLibraryDocuments()
      .then((items) => { if (alive) { setDocuments(items); setLoading(false); } })
      .catch(() => { if (alive) { setError("Belge havuzu okunamadı."); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  // Esc ile kapanır ve açılışta odak pencereye taşınır.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const normalized = fold(query.trim());

  // Hazır belgeler yalnızca kriter kaynağı olarak anlamlıdır.
  const visibleSamples = useMemo(() => {
    const samples = usage === "kriter" ? SAMPLE_DOCUMENTS : [];
    if (!normalized) return samples;
    return samples.filter((item) => fold(`${item.title} ${item.name} ${item.description}`).includes(normalized));
  }, [normalized, usage]);

  const visibleDocuments = useMemo(() => {
    const matchesUsage = documents.filter((item) => DOCUMENT_TYPE_USAGE[item.docType] === usage);
    if (!normalized) return matchesUsage;
    return matchesUsage.filter((item) => fold(`${item.title} ${item.fileName} ${DOCUMENT_TYPE_LABELS[item.docType]}`).includes(normalized));
  }, [documents, normalized, usage]);

  /** Havuzdaki belge sayısı: bu süreçte kullanılabilir olanlar. */
  const otherUsageCount = documents.length - documents.filter((item) => DOCUMENT_TYPE_USAGE[item.docType] === usage).length;

  async function add() {
    if (!pendingFile || busy) return;
    setBusy(true);
    setError("");
    try {
      await addLibraryDocument({ title, docType, file: pendingFile });
      setDocuments(await listLibraryDocuments());
      setTitle("");
      setPendingFile(null);
      setFormOpen(false);
      setNotice("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setError("Belge havuza eklenemedi. Tarayıcı depolaması dolu veya kapalı olabilir.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      await deleteLibraryDocument(id);
      setDocuments(await listLibraryDocuments());
      setConfirmingId(null);
    } catch {
      setError("Belge silinemedi.");
    } finally {
      setBusy(false);
    }
  }

  function openDocument(file: File) {
    const url = URL.createObjectURL(file);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function pickSample(sample: SampleDocument) {
    setError("");
    try {
      const response = await fetch(sample.path);
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const file = new File([blob], sample.name, { type: "application/pdf" });
      if (onSelectSample) onSelectSample(file, sample.setup);
      else onSelect(file);
      onClose();
    } catch {
      setError("Hazır belge yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.");
    }
  }

  function pickDocument(item: LibraryDocument) {
    onSelect(new File([item.file], item.fileName, { type: item.mimeType || "application/pdf" }));
    onClose();
  }

  const totalVisible = visibleSamples.length + visibleDocuments.length;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="library-modal-title" ref={dialogRef}>
        <header className="modal-head">
          <div>
            <span className="section-kicker">Test ve değerlendirme kaynakları</span>
            <h2 id="library-modal-title">Belge havuzu</h2>
            <p>
              {usage === "kriter"
                ? "Hazır test belgeleri ile kendi şartname, kılavuz ve referans dokümanlarınız. Seçtiğiniz belge kaynak belge olarak kullanılır."
                : "Havuza eklenmiş örnek yarışmacı raporları. Seçtiğiniz rapor değerlendirme havuzuna alınır."}
            </p>
          </div>
          <button type="button" className="modal-close" ref={closeRef} onClick={onClose} aria-label="Belge havuzunu kapat">×</button>
        </header>

        <div className="modal-toolbar">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Belge ara"
              aria-label="Belge havuzunda ara"
            />
          </label>
          <button type="button" className="secondary-button" onClick={() => { setFormOpen((current) => !current); setError(""); }}>
            {formOpen ? "Vazgeç" : "+ Yeni belge ekle"}
          </button>
        </div>

        {formOpen ? (
          <form className="library-form" onSubmit={(event) => { event.preventDefault(); add(); }}>
            <div className="form-grid three-col">
              <label className="field">
                <span className="field-label">Belge dosyası</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.png,.jpg,.jpeg"
                  onChange={(event) => {
                    const selected = event.target.files?.[0] ?? null;
                    setPendingFile(selected);
                    setNotice(selected && selected.size > 18 * 1024 * 1024
                      ? "18 MB üzerindeki belgeler analizde kullanılamaz; yalnızca havuzda saklanır."
                      : "");
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
              <span className="save-note">Belgeler bu cihazdaki havuzda saklanır; kod değişikliği gerekmez.</span>
              <button type="submit" className="primary-button" disabled={!pendingFile || busy}>
                {busy ? "Ekleniyor…" : "Havuza ekle"}
              </button>
            </div>
          </form>
        ) : null}

        {error ? <div className="inline-error modal-inline-error" role="alert"><strong>İşlem tamamlanamadı.</strong><span>{error}</span></div> : null}

        <div className="modal-body">
          {visibleSamples.length ? (
            <section aria-labelledby="library-samples-title">
              <div className="modal-group-head">
                <h3 id="library-samples-title">Hazır test belgeleri</h3>
                <span>{visibleSamples.length} belge · salt okunur</span>
              </div>
              <div className="sample-document-list">
                {visibleSamples.map((sample) => (
                  <article key={sample.path} className={selectedFileName === sample.name ? "selected" : ""}>
                    <FileBadge fileName={sample.name} mimeType="application/pdf" size="sm" />
                    <div className="sample-copy">
                      <span>{sample.source} · {sample.pages} sayfa</span>
                      <h3>{sample.title}</h3>
                      <p>{sample.description}</p>
                    </div>
                    <div className="sample-actions">
                      <a href={sample.path} target="_blank" rel="noreferrer">Belgeyi aç</a>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={selectedFileName === sample.name}
                        onClick={() => pickSample(sample)}
                      >
                        {selectedFileName === sample.name ? "Seçildi" : "Bu belgeyi seç"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="library-own-title">
            <div className="modal-group-head">
              <h3 id="library-own-title">Görevli belgeleri</h3>
              <span>{visibleDocuments.length} belge</span>
            </div>
            {loading ? (
              <p className="library-empty">Havuz okunuyor…</p>
            ) : visibleDocuments.length ? (
              <div className="sample-document-list">
                {visibleDocuments.map((item) => {
                  const selectable = isPdfLike(item.fileName, item.mimeType);
                  return (
                    <article key={item.id} className={selectedFileName === item.fileName ? "selected" : ""}>
                      <FileBadge fileName={item.fileName} mimeType={item.mimeType} size="sm" />
                      <div className="sample-copy">
                        <span>{DOCUMENT_TYPE_LABELS[item.docType]} · {formatBytes(item.size)}</span>
                        <h3>{item.title}</h3>
                        <p>{item.fileName}</p>
                      </div>
                      <div className="sample-actions">
                        <a
                          href="#library-modal-title"
                          onClick={(event) => { event.preventDefault(); openDocument(item.file); }}
                        >
                          Belgeyi aç
                        </a>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!selectable || selectedFileName === item.fileName}
                          title={selectable ? undefined : "Analiz için yalnızca PDF belgeler seçilebilir."}
                          onClick={() => pickDocument(item)}
                        >
                          {selectedFileName === item.fileName ? "Seçildi" : selectable ? "Bu belgeyi seç" : "PDF değil"}
                        </button>
                        {confirmingId === item.id ? (
                          <span className="delete-confirm">
                            <button type="button" className="danger-button" disabled={busy} onClick={() => remove(item.id)}>Sil</button>
                            <button type="button" className="text-button" onClick={() => setConfirmingId(null)}>Vazgeç</button>
                          </span>
                        ) : (
                          <button type="button" className="text-button danger-text" onClick={() => setConfirmingId(item.id)}>Sil</button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="library-empty">
                {query
                  ? "Aramanızla eşleşen belge yok."
                  : usage === "rapor"
                    ? "Havuzda örnek yarışmacı raporu yok. “+ Yeni belge ekle” ile ekleyin ve belge türünü “Örnek yarışmacı raporu” seçin."
                    : "Henüz görevli tarafından eklenmiş belge yok. Havuza eklenen belgeler burada listelenir ve analiz için seçilebilir."}
                {otherUsageCount > 0 && !query
                  ? ` Havuzda başka süreçte kullanılan ${otherUsageCount} belge daha var.`
                  : ""}
              </p>
            )}
          </section>

          {!totalVisible && query ? <p className="library-empty">Hiçbir belge “{query}” aramasıyla eşleşmedi.</p> : null}
        </div>
      </div>
    </div>
  );
}
