"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fold } from "../lib/competitions";

/** Listede aynı anda gösterilecek en fazla seçenek; gerisi sayıyla bildirilir. */
const RESULT_LIMIT = 50;

/**
 * Arama destekli genel seçim alanı (kategori, aşama, rapor türü…).
 * Yazdıkça seçenekler Türkçe aksana ve büyük/küçük harfe duyarsız filtrelenir;
 * listedeki bir seçenek tıklanarak veya klavyeyle seçilir, listede olmayan
 * değer serbest metin olarak bırakılabilir.
 */
export default function SearchSelect({
  value,
  onChange,
  onPick,
  options,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Listeden seçim yapıldığında çağrılır (serbest yazımda çağrılmaz); verilmezse onChange kullanılır. */
  onPick?: (value: string) => void;
  options: string[];
  placeholder?: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [filtering, setFiltering] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Alan yeni açıldığında tüm seçenekler görünür; yazmaya başlayınca filtrelenir.
  const query = filtering ? value.trim() : "";
  const matches = useMemo(() => {
    const normalized = fold(query);
    if (!normalized) return options;
    const tokens = normalized.split(/\s+/).filter(Boolean);
    return options.filter((option) => {
      const haystack = fold(option);
      return tokens.every((token) => haystack.includes(token));
    });
  }, [options, query]);

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

  function select(option: string) {
    (onPick ?? onChange)(option);
    setOpen(false);
    setFiltering(false);
    setHighlighted(0);
  }

  return (
    <div className="combo" ref={wrapRef}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && visible.length ? `${listId}-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setFiltering(false); setHighlighted(0); }}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setFiltering(true); setHighlighted(0); }}
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
            select(visible[activeIndex]);
          } else if (event.key === "Escape") {
            setOpen(false);
            setFiltering(false);
          }
        }}
      />
      <span className="combo-caret" aria-hidden="true">▾</span>
      {open ? (
        <div className="combo-list" id={listId} role="listbox" aria-label={ariaLabel} ref={listRef}>
          {visible.map((option, index) => (
            <button
              key={option}
              id={`${listId}-${index}`}
              data-index={index}
              type="button"
              role="option"
              aria-selected={option === value}
              className={`combo-option ${index === activeIndex ? "highlighted" : ""} ${option === value ? "current" : ""}`}
              onMouseEnter={() => setHighlighted(index)}
              onMouseDown={(event) => { event.preventDefault(); select(option); }}
            >
              <strong>{option}</strong>
            </button>
          ))}
          {!visible.length ? (
            <div className="combo-empty">
              Eşleşen seçenek yok; yazdığınız değer serbest metin olarak kullanılacak.
            </div>
          ) : hiddenCount > 0 ? (
            <div className="combo-footer">
              {matches.length} eşleşmenin ilk {visible.length} tanesi listelendi · +{hiddenCount} seçenek daha
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
