"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fold } from "../lib/competitions";
import {
  COMPETITION_STATUS_LABELS,
  type CompetitionApplication,
  type CompetitionProfile,
  type CompetitionWorkflow,
} from "../lib/workflow-types";

/** Açılır listede aynı anda gösterilecek en fazla yarışma; gerisi sayıyla bildirilir. */
const RESULT_LIMIT = 50;

type PickerEntry = {
  key: string;
  name: string;
  profile: CompetitionProfile | null;
  /** Öncelik ve aktiflik bilgisi; yarışma durumu alınamadıysa null. */
  competition: CompetitionWorkflow | null;
  /** Bu ekrandaki (bekleyen ya da tamamlanan) başvuru sayısı. */
  count: number;
  priority: boolean;
};

/**
 * Hakem yarışma seçici (kutucuk).
 *
 * Yayımlanmış yarışmalar eskiden yan sütunda tek tek kart olarak diziliyor ve
 * ekranı kalabalıklaştırıyordu. Artık tek bir arama kutusunda toplanır: hakem
 * yarışma adını yazdıkça liste Türkçe aksana ve büyük/küçük harfe duyarsız
 * daralır; ÖNCELİKLİ yarışmalar listenin başında kalır. Seçim `competitionKey`
 * ile yapılır, aynı adlı iki yarışma birbirine karışmaz. Hem "Değerlendirme
 * Atölyesi" hem "Geçmiş değerlendirmeler" ekranı bu kutuyu kullanır.
 */
export default function CompetitionPicker({ profiles, applications, competitions, selectedKey, history, onSelect }: {
  profiles: CompetitionProfile[];
  applications: CompetitionApplication[];
  /** Öncelik bayrakları; Değerlendirme Yöneticisi tarafından atanır. */
  competitions: CompetitionWorkflow[];
  selectedKey: string | null;
  /** Geçmiş ekranında tamamlanan, atölyede bekleyen başvurular sayılır. */
  history: boolean;
  onSelect: (key: string) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  // Kutu yeni açıldığında tüm yarışmalar görünür; yazmaya başlayınca filtrelenir.
  const [filtering, setFiltering] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const listId = useId();

  // Kriteri çıkarılmış (yayımlı) her yarışma listelenir; henüz başvurusu olmayan da görünür.
  const entries = useMemo<PickerEntry[]>(() => {
    const workflowByKey = new Map(competitions.map((item) => [item.competitionKey, item]));
    const byKey = new Map<string, { key: string; name: string; profile: CompetitionProfile | null; items: CompetitionApplication[] }>();
    for (const profile of profiles.filter((item) => item.status === "approved")) {
      byKey.set(profile.competitionKey, { key: profile.competitionKey, name: profile.competitionName, profile, items: [] });
    }
    for (const application of applications) {
      const entry = byKey.get(application.competitionKey) ?? { key: application.competitionKey, name: application.competitionName, profile: null, items: [] };
      entry.items.push(application);
      byKey.set(application.competitionKey, entry);
    }
    // ÖNCELİKLİ yarışmalar her zaman listenin başında; gerisi ada göre sıralı.
    return [...byKey.values()]
      .map((entry) => {
        const competition = workflowByKey.get(entry.key) ?? null;
        return {
          key: entry.key,
          name: entry.name,
          profile: entry.profile,
          competition,
          count: entry.items.filter((item) => history ? item.status === "completed" : item.status !== "completed").length,
          priority: competition?.isPriority ?? false,
        };
      })
      .sort((left, right) => Number(right.priority) - Number(left.priority) || left.name.localeCompare(right.name, "tr"));
  }, [profiles, applications, competitions, history]);

  const selected = entries.find((entry) => entry.key === selectedKey) ?? null;

  // Boşlukla ayrılmış her parça yarışma adında aranır ("insansiz deniz" → İnsansız Deniz Aracı).
  const query = filtering ? text.trim() : "";
  const matches = useMemo(() => {
    const tokens = fold(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return entries;
    return entries.filter((entry) => {
      const haystack = fold(entry.name);
      return tokens.every((token) => haystack.includes(token));
    });
  }, [entries, query]);

  const visible = matches.length > RESULT_LIMIT ? matches.slice(0, RESULT_LIMIT) : matches;
  // Liste kısaldığında imleç listenin dışında kalabilir.
  const activeIndex = visible.length ? Math.min(highlighted, visible.length - 1) : 0;
  const hiddenCount = matches.length - visible.length;

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setFiltering(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  // Klavyeyle gezinirken seçili satır her zaman görünür kalır.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function choose(entry: PickerEntry) {
    onSelect(entry.key);
    setOpen(false);
    setFiltering(false);
    setHighlighted(0);
  }

  function describe(entry: PickerEntry) {
    const state = entry.competition
      ? `${entry.competition.isActive ? "Aktif" : "Pasif"} · ${COMPETITION_STATUS_LABELS[entry.competition.status]}`
      : "Yarışma durumu alınamadı";
    const criteria = entry.profile ? `${entry.profile.profile.criteria.length} kriter` : "Kriter profili yok";
    return `${state} · ${criteria}`;
  }

  // Başvuru sayısı hakemin iş yükünü gösterir; satırın en belirgin ikinci bilgisidir.
  function countLabel(entry: PickerEntry) {
    return `${entry.count} ${history ? "tamamlanan" : "bekleyen"} başvuru`;
  }

  const priorityEntries = entries.filter((entry) => entry.priority);

  // Yazarken kutuda yazılan metin, aksi hâlde seçili yarışmanın adı görünür;
  // böylece dışarı tıklayınca yarım kalan arama seçimi bozmaz.
  const displayValue = filtering ? text : (selected?.name ?? "");
  const disabled = !entries.length;

  return (
    <section className="eval-competition-picker" aria-label="Yarışma seçimi">
      <div className="eval-competition-picker-head">
        <label htmlFor={inputId}>Yarışma ara</label>
        <small>Yayımlanmış yarışmalar tek kutuda; adını yazarak listeyi daraltın.</small>
      </div>
      <div className="combo" ref={wrapRef}>
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && visible.length ? `${listId}-${activeIndex}` : undefined}
          value={displayValue}
          placeholder={disabled ? "Yayımlanmış yarışma yok" : "Yarışma adını yazın veya listeden seçin"}
          disabled={disabled}
          onFocus={() => { setOpen(true); setFiltering(false); setHighlighted(0); }}
          onChange={(event) => { setText(event.target.value); setOpen(true); setFiltering(true); setHighlighted(0); }}
          onKeyDown={(event) => {
            if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { setOpen(true); return; }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlighted(Math.min(activeIndex + 1, visible.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlighted(Math.max(activeIndex - 1, 0));
            } else if (event.key === "Enter" && open && visible[activeIndex]) {
              event.preventDefault();
              choose(visible[activeIndex]);
            } else if (event.key === "Escape") {
              setOpen(false);
              setFiltering(false);
            }
          }}
        />
        <span className="combo-caret" aria-hidden="true">▾</span>
        {open && !disabled ? (
          <div className="combo-list" id={listId} role="listbox" aria-label="Yayımlanmış yarışmalar" ref={listRef}>
            {visible.map((entry, index) => (
              <button
                key={entry.key}
                id={`${listId}-${index}`}
                data-index={index}
                type="button"
                role="option"
                aria-selected={entry.key === selectedKey}
                className={`combo-option ${index === activeIndex ? "highlighted" : ""} ${entry.key === selectedKey ? "current" : ""} ${entry.priority ? "priority" : ""}`.trim()}
                title={entry.priority && entry.competition?.priorityNote ? `Öncelik gerekçesi: ${entry.competition.priorityNote}` : undefined}
                onMouseEnter={() => setHighlighted(index)}
                onMouseDown={(event) => { event.preventDefault(); choose(entry); }}
              >
                <span className="combo-option-title">
                  {/* Değerlendirme Yöneticisi bu yarışmayı acil işaretledi. */}
                  {entry.priority ? <em className="priority-badge">🔥 ACİL / ÖNCELİKLİ</em> : null}
                  <strong>{entry.name}</strong>
                </span>
                <span className={`combo-option-count ${entry.count ? "" : "empty"}`.trim()}>{countLabel(entry)}</span>
                <small>{describe(entry)}</small>
              </button>
            ))}
            {!visible.length ? (
              <div className="combo-empty">Bu aramayla eşleşen yayımlanmış yarışma yok.</div>
            ) : (
              <div className="combo-footer">
                {hiddenCount > 0
                  ? `${matches.length} eşleşmenin ilk ${visible.length} tanesi listelendi · +${hiddenCount} yarışma daha, aramayı daraltın`
                  : filtering
                    ? `${matches.length} eşleşen yarışma`
                    : `${entries.length} başvuruya açık yarışma · yazmaya başlayın`}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {priorityEntries.length ? (
        // Değerlendirme Yöneticisi'nin acil işaretlediği yarışmalar kutu kapalıyken de görünür;
        // hakem listeyi açmadan tek tıkla geçebilir.
        <div className="eval-priority-pins" aria-label="Öncelikli yarışmalar">
          {priorityEntries.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`eval-priority-card ${entry.key === selectedKey ? "active" : ""}`.trim()}
              aria-pressed={entry.key === selectedKey}
              title={entry.competition?.priorityNote ? `Öncelik gerekçesi: ${entry.competition.priorityNote}` : undefined}
              onClick={() => choose(entry)}
            >
              <em className="priority-badge">🔥 ACİL / ÖNCELİKLİ</em>
              <strong>{entry.name}</strong>
              <span>{describe(entry)}</span>
              <span className="eval-priority-count">{countLabel(entry)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {disabled ? (
        <p className="eval-competition-picker-note">
          Kriteri çıkarılmış yarışma yok. Yarışma Yöneticisi Kriter Atölyesi&apos;nde profil yayımladığında burada görünür.
        </p>
      ) : null}

      {selected ? (
        <div className="eval-competition-summary" aria-live="polite">
          {selected.priority ? <em className="priority-badge">🔥 ACİL / ÖNCELİKLİ</em> : null}
          {selected.competition ? (
            <>
              <span className={`status-chip ${selected.competition.isActive ? "success" : "danger"}`}>{selected.competition.isActive ? "Aktif" : "Pasif"}</span>
              <span className="status-chip neutral">{COMPETITION_STATUS_LABELS[selected.competition.status]}</span>
            </>
          ) : <span className="status-chip neutral">Yarışma durumu alınamadı</span>}
          <span className="status-chip neutral">{selected.profile ? `${selected.profile.profile.criteria.length} kriter` : "Kriter profili yok"}</span>
          <span className={`status-chip ${selected.count ? "warning" : "neutral"}`}>{countLabel(selected)}</span>
          {selected.priority && selected.competition?.priorityNote ? (
            <span className="priority-reason">Öncelik gerekçesi: {selected.competition.priorityNote}</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
