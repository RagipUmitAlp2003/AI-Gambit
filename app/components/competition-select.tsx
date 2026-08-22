"use client";

import { useEffect, useRef, useState } from "react";
import { filterCompetitions } from "../lib/competitions";

/**
 * Arama destekli yarışma seçici. Görevli yazdıkça kayıtlı yarışmalar
 * anlık ve büyük/küçük harfe duyarsız filtrelenir; listede olmayan bir
 * ad serbest metin olarak da bırakılabilir.
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const options = filterCompetitions(value);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function select(name: string) {
    (onPick ?? onChange)(name);
    setOpen(false);
  }

  return (
    <div className="combo" ref={wrapRef}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls="competition-listbox"
        aria-autocomplete="list"
        aria-label="Yarışma ara ve seç"
        value={value}
        placeholder="Yarışma adını yazın veya listeden seçin"
        onFocus={() => setOpen(true)}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setHighlighted(0); }}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { setOpen(true); return; }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlighted((current) => Math.min(current + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter" && open && options[highlighted]) {
            event.preventDefault();
            select(options[highlighted].name);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      <span className="combo-caret" aria-hidden="true">▾</span>
      {open ? (
        <div className="combo-list" id="competition-listbox" role="listbox" aria-label="Kayıtlı yarışmalar">
          {options.map((option, index) => (
            <button
              key={option.name}
              type="button"
              role="option"
              aria-selected={option.name === value}
              className={`combo-option ${index === highlighted ? "highlighted" : ""}`}
              onMouseEnter={() => setHighlighted(index)}
              onMouseDown={(event) => { event.preventDefault(); select(option.name); }}
            >
              <strong>{option.name}</strong>
              <small>{option.field}</small>
            </button>
          ))}
          {!options.length ? (
            <div className="combo-empty">
              Eşleşen kayıtlı yarışma yok; yazdığınız ad serbest metin olarak kullanılacak.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
