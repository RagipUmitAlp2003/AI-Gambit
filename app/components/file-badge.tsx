"use client";

import { detectFileKind } from "../lib/file-kind";

/** Dosya türüne göre renkli belge ikonu (PDF, DOC, XLS, IMG, TXT…). */
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
    <span
      className={`file-badge file-badge-${size}`}
      style={{ background: info.color }}
      aria-label={`${info.label} dosyası`}
    >
      {info.label}
    </span>
  );
}
