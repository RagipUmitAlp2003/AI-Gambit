"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { COMPETITIONS, searchCompetitions } from "../lib/competitions";

/**
 * Arama destekli yarışma seçici. Görevli yazdıkça kayıtlı yarışmalar anlık,
 * büyük/küçük harfe ve Türkçe aksana duyarsız filtrelenir; listede olmayan bir
 * ad serbest metin olarak da bırakılabilir. Uzun listelerde yalnızca ilk
 * eşleşmeler basılır, kalan sayı listenin altında bildirilir.
 */
export default function CompetitionSelect({
  value,
  onChange,
  onPick,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Listeden seçim yapıldığında çağrılır (serbest yazımda çağrılmaz); verilmezse onChange kullanılır. */
  onPick?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  // Seçimden sonra alan tekrar açıldığında liste tek kayda düşmesin diye
  // filtre yalnızca görevli yazarken uygulanır.
  const [filtering, setFiltering] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const query = filtering ? value : "";
  const { items, total } = useMemo(() => searchCompetitions(query), [query]);
  // Liste kısaldığında imleç listenin dışında kalabilir.
  const activeIndex = items.length ? Math.min(highlighted, items.length - 1) : 0;
  const hiddenCount = total - items.length;

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

  function select(name: string) {
    (onPick ?? onChange)(name);
    setOpen(false);
    setFiltering(false);
    setHighlighted(0);
  }

  function shouldFilterCurrentValue() {
    const exactSelection = COMPETITIONS.some((competition) => competition.name === value);
    return Boolean(value.trim()) && !exactSelection;
  }

  return (
    <div className="combo" ref={wrapRef}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items.length ? `${listId}-${activeIndex}` : undefined}
        aria-label="Yarışma ara ve seç"
        value={value}
        placeholder="Yarışma adını yazın veya listeden seçin"
        onFocus={() => { setOpen(true); setFiltering(shouldFilterCurrentValue()); setHighlighted(0); }}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setFiltering(true); setHighlighted(0); }}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            setOpen(true);
            setFiltering(shouldFilterCurrentValue());
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlighted(Math.min(activeIndex + 1, items.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted(Math.max(activeIndex - 1, 0));
          } else if (event.key === "Enter" && open && items[activeIndex]) {
            event.preventDefault();
            select(items[activeIndex].name);
          } else if (event.key === "Escape") {
            setOpen(false);
            setFiltering(false);
          }
        }}
      />
      <span className="combo-caret" aria-hidden="true">▾</span>
      {open ? (
        <div className="combo-list" id={listId} role="listbox" aria-label="Kayıtlı yarışmalar" ref={listRef}>
          {items.map((option, index) => (
            <button
              key={option.name}
              id={`${listId}-${index}`}
              data-index={index}
              type="button"
              role="option"
              aria-selected={option.name === value}
              className={`combo-option ${index === activeIndex ? "highlighted" : ""} ${option.name === value ? "current" : ""}`}
              onMouseEnter={() => setHighlighted(index)}
              onMouseDown={(event) => { event.preventDefault(); select(option.name); }}
            >
              <strong>{option.name}</strong>
              <small>{option.field}</small>
            </button>
          ))}
          {!items.length ? (
            <div className="combo-empty">
              Eşleşen kayıtlı yarışma yok; yazdığınız ad serbest metin olarak kullanılacak.
            </div>
          ) : (
            <div className="combo-footer">
              {hiddenCount > 0
                ? `${total} eşleşmenin ilk ${items.length} tanesi listelendi · +${hiddenCount} yarışma daha, aramayı daraltın`
                : filtering
                  ? `${total} eşleşen yarışma`
                  : `${COMPETITIONS.length} kayıtlı yarışma · yazmaya başlayın`}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
