"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Arama destekli genel seçim alanı (kategori, aşama, rapor türü…).
 * Yazdıkça seçenekler tr-TR duyarsız filtrelenir; listedeki bir seçenek
 * tıklanarak veya klavyeyle seçilir, listede olmayan değer serbest metin
 * olarak bırakılabilir.
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
  const listId = useId();

  // Alan yeni açıldığında tüm seçenekler görünür; yazmaya başlayınca filtrelenir.
  const normalized = value.trim().toLocaleLowerCase("tr-TR");
  const visible = filtering && normalized
    ? options.filter((option) => option.toLocaleLowerCase("tr-TR").includes(normalized))
    : options;

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

  function select(option: string) {
    (onPick ?? onChange)(option);
    setOpen(false);
    setFiltering(false);
  }

  return (
    <div className="combo" ref={wrapRef}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setFiltering(false); setHighlighted(0); }}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setFiltering(true); setHighlighted(0); }}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { setOpen(true); return; }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlighted((current) => Math.min(current + 1, visible.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter" && open && visible[highlighted]) {
            event.preventDefault();
            select(visible[highlighted]);
          } else if (event.key === "Escape") {
            setOpen(false);
            setFiltering(false);
          }
        }}
      />
      <span className="combo-caret" aria-hidden="true">▾</span>
      {open ? (
        <div className="combo-list" id={listId} role="listbox" aria-label={ariaLabel}>
          {visible.map((option, index) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              className={`combo-option ${index === highlighted ? "highlighted" : ""} ${option === value ? "current" : ""}`}
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
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
