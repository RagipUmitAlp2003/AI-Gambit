export type FileKind = "pdf" | "word" | "excel" | "powerpoint" | "image" | "text" | "other";

export type FileKindInfo = {
  kind: FileKind;
  /** İkon üzerinde gösterilen kısa etiket. */
  label: string;
  /** Dosya türüne özgü ikon rengi. */
  color: string;
};

const KIND_INFO: Record<FileKind, Omit<FileKindInfo, "kind">> = {
  pdf: { label: "PDF", color: "#b3261e" },
  word: { label: "DOC", color: "#1a56a8" },
  excel: { label: "XLS", color: "#1d6f42" },
  powerpoint: { label: "PPT", color: "#c4491d" },
  image: { label: "IMG", color: "#6b4b9e" },
  text: { label: "TXT", color: "#4a5b66" },
  other: { label: "DOSYA", color: "#66788a" },
};

const EXTENSION_MAP: Record<string, FileKind> = {
  pdf: "pdf",
  doc: "word",
  docx: "word",
  odt: "word",
  rtf: "word",
  xls: "excel",
  xlsx: "excel",
  ods: "excel",
  csv: "excel",
  ppt: "powerpoint",
  pptx: "powerpoint",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  txt: "text",
  md: "text",
};

/** Dosya adı ve/veya MIME türünden dosya türünü otomatik tespit eder. */
export function detectFileKind(fileName: string, mimeType?: string): FileKindInfo {
  let kind: FileKind | undefined;
  if (mimeType) {
    if (mimeType === "application/pdf") kind = "pdf";
    else if (mimeType.startsWith("image/")) kind = "image";
    else if (mimeType.startsWith("text/")) kind = "text";
    else if (mimeType.includes("wordprocessingml") || mimeType === "application/msword") kind = "word";
    else if (mimeType.includes("spreadsheetml") || mimeType === "application/vnd.ms-excel") kind = "excel";
    else if (mimeType.includes("presentationml") || mimeType === "application/vnd.ms-powerpoint") kind = "powerpoint";
  }
  if (!kind) {
    const extension = fileName.split(".").pop()?.toLocaleLowerCase("tr-TR") ?? "";
    kind = EXTENSION_MAP[extension] ?? "other";
  }
  const uppercaseExtension = fileName.split(".").pop()?.toUpperCase();
  const info = KIND_INFO[kind];
  return {
    kind,
    color: info.color,
    label: kind === "word" || kind === "excel" || kind === "powerpoint"
      ? (uppercaseExtension && uppercaseExtension.length <= 4 ? uppercaseExtension : info.label)
      : info.label,
  };
}
