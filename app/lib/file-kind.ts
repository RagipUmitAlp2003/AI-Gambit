export type FileKind =
  | "pdf" | "word" | "excel" | "powerpoint" | "image" | "text" | "archive" | "video" | "other";

export type FileKindInfo = {
  kind: FileKind;
  /** İkon üzerinde gösterilen kısa etiket. */
  label: string;
  /** Dosya türüne özgü ana ikon rengi. */
  color: string;
  /** Belge gövdesinde kullanılan açık ton. */
  tint: string;
  /** Ekran okuyucular ve başlık metni için tam tür adı. */
  description: string;
};

type KindStyle = Omit<FileKindInfo, "kind">;

const KIND_INFO: Record<FileKind, KindStyle> = {
  pdf: { label: "PDF", color: "#b3261e", tint: "#fdeceb", description: "PDF belgesi" },
  word: { label: "DOC", color: "#1a56a8", tint: "#e9f0fb", description: "Word belgesi" },
  excel: { label: "XLS", color: "#1d6f42", tint: "#e7f4ec", description: "Excel tablosu" },
  powerpoint: { label: "PPT", color: "#c4491d", tint: "#fdeee8", description: "PowerPoint sunumu" },
  image: { label: "IMG", color: "#6b4b9e", tint: "#f1ecfa", description: "Görsel dosyası" },
  text: { label: "TXT", color: "#4a5b66", tint: "#eef1f3", description: "Metin dosyası" },
  archive: { label: "ZIP", color: "#8a6a12", tint: "#faf1dc", description: "Arşiv dosyası" },
  video: { label: "VID", color: "#155e75", tint: "#e5f2f6", description: "Video dosyası" },
  other: { label: "DOSYA", color: "#66788a", tint: "#eef1f3", description: "Diğer dosya türü" },
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
  odp: "powerpoint",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  txt: "text",
  md: "text",
  json: "text",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  mp4: "video",
  mov: "video",
  avi: "video",
  mkv: "video",
  webm: "video",
};

/** Türü etiket yerine gerçek uzantısıyla göstermenin daha anlaşılır olduğu aileler. */
const SHOW_EXTENSION: FileKind[] = ["word", "excel", "powerpoint", "archive", "other"];

/** Dosya adı ve/veya MIME türünden dosya türünü otomatik tespit eder. */
export function detectFileKind(fileName: string, mimeType?: string): FileKindInfo {
  let kind: FileKind | undefined;
  if (mimeType) {
    if (mimeType === "application/pdf") kind = "pdf";
    else if (mimeType.startsWith("image/")) kind = "image";
    else if (mimeType.startsWith("video/")) kind = "video";
    else if (mimeType.startsWith("text/")) kind = "text";
    else if (mimeType.includes("wordprocessingml") || mimeType === "application/msword") kind = "word";
    else if (mimeType.includes("spreadsheetml") || mimeType === "application/vnd.ms-excel") kind = "excel";
    else if (mimeType.includes("presentationml") || mimeType === "application/vnd.ms-powerpoint") kind = "powerpoint";
    else if (mimeType.includes("zip") || mimeType.includes("compressed")) kind = "archive";
  }
  const extension = fileName.split(".").pop()?.toLocaleLowerCase("tr-TR") ?? "";
  if (!kind) kind = EXTENSION_MAP[extension] ?? "other";
  const info = KIND_INFO[kind];
  // Uzantı kısa ve okunaklıysa aile etiketi yerine onu göster (DOCX, XLSX, ZIP…).
  const useExtension = SHOW_EXTENSION.includes(kind) && extension.length > 0 && extension.length <= 4;
  return {
    kind,
    color: info.color,
    tint: info.tint,
    description: info.description,
    label: useExtension ? extension.toLocaleUpperCase("tr-TR") : info.label,
  };
}
