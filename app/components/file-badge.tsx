"use client";

import { detectFileKind, type FileKind } from "../lib/file-kind";

/** Etiket uzadıkça bant içinde taşmaması için punto küçülür. */
function labelSize(label: string) {
  if (label.length >= 5) return 11;
  if (label.length === 4) return 13;
  return 16;
}

/**
 * Belge gövdesindeki tür işareti: etiket okunamayacak kadar küçüldüğünde bile
 * dosya türünü ayırt edilebilir kılar (tablo çizgileri, sunum karesi, görsel…).
 */
function KindGlyph({ kind, color }: { kind: FileKind; color: string }) {
  if (kind === "excel") {
    return (
      <g stroke={color} strokeWidth="1.6" opacity=".55">
        <rect x="13" y="14" width="22" height="14" fill="none" rx="1.5" />
        <path d="M13 19h22M13 23.5h22M20.5 14v14M27.5 14v14" />
      </g>
    );
  }
  if (kind === "powerpoint") {
    return (
      <g stroke={color} strokeWidth="1.6" opacity=".55" fill="none">
        <rect x="13" y="14" width="22" height="14" rx="1.5" />
        <path d="M17 24l5-5 4 3.5 4-4.5" />
      </g>
    );
  }
  if (kind === "image") {
    return (
      <g stroke={color} strokeWidth="1.6" opacity=".55" fill="none">
        <rect x="13" y="14" width="22" height="14" rx="1.5" />
        <path d="M13 24l6-5 5 4 4-3 7 6" />
        <circle cx="19.5" cy="18.5" r="1.6" />
      </g>
    );
  }
  if (kind === "video") {
    return (
      <g stroke={color} strokeWidth="1.6" opacity=".55" fill="none">
        <rect x="13" y="14" width="22" height="14" rx="2" />
        <path d="M21 18.5l6 3.5-6 3.5z" fill={color} stroke="none" opacity=".7" />
      </g>
    );
  }
  if (kind === "archive") {
    return (
      <g stroke={color} strokeWidth="1.6" opacity=".55" fill="none">
        <path d="M24 12v4M24 18v4M24 24v3" strokeDasharray="0 0" />
        <rect x="21" y="26" width="6" height="5" rx="1.5" />
      </g>
    );
  }
  // pdf / word / text / other: klasik metin satırları
  return (
    <g stroke={color} strokeWidth="2" strokeLinecap="round" opacity=".45">
      <path d="M14 16h20M14 21h20M14 26h13" />
    </g>
  );
}

/**
 * Dosya türüne göre belge ikonu: kıvrık köşeli sayfa silueti, türe özgü renk
 * ve alt bantta biçim etiketi (PDF, DOCX, XLSX, TXT…). Küçük boyutlarda da
 * tür rengi ve gövde işaretiyle ayırt edilebilir.
 */
export default function FileBadge({
  fileName,
  mimeType,
  size = "md",
}: {
  fileName: string;
  mimeType?: string;
  size?: "sm" | "md" | "lg";
}) {
  const info = detectFileKind(fileName, mimeType);
  return (
    <span className={`file-badge file-badge-${size}`} role="img" aria-label={`${info.label} ${info.description}`} title={info.description}>
      <svg viewBox="0 0 48 60" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true">
        {/* Sayfa gövdesi ve kıvrık köşe */}
        <path
          d="M5 4a3 3 0 0 1 3-3h20l15 15v40a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"
          fill={info.tint}
          stroke={info.color}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M28 1l15 15H31a3 3 0 0 1-3-3z" fill={info.color} opacity=".28" />
        <KindGlyph kind={info.kind} color={info.color} />
        {/* Biçim etiketi bandı */}
        <rect x="2" y="36" width="40" height="16" rx="3" fill={info.color} />
        <text
          x="22"
          y="44.6"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#fff"
          fontFamily="Arial, Segoe UI, system-ui, sans-serif"
          fontSize={labelSize(info.label)}
          fontWeight="800"
          letterSpacing=".4"
        >
          {info.label}
        </text>
      </svg>
    </span>
  );
}
