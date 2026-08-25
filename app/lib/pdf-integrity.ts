import { Buffer } from "node:buffer";

/**
 * Gemini'ye gönderilmeden önce PDF'nin temel ikili bütünlüğünü doğrular.
 * Tam bir PDF ayrıştırıcısı değildir; sık görülen metin olarak yeniden yazılma,
 * yarım indirme ve bozuk startxref durumlarını deterministik biçimde yakalar.
 */
export function pdfIntegrityError(bytes: ArrayBuffer): string | null {
  if (bytes.byteLength < 5) return "Dosya boş veya geçerli bir PDF başlığı taşımıyor.";
  const data = Buffer.from(bytes);
  if (!data.subarray(0, Math.min(data.length, 1024)).includes(Buffer.from("%PDF-"))) {
    return "Dosyanın içeriği geçerli bir PDF başlığı taşımıyor.";
  }

  const replacement = Buffer.from([0xef, 0xbf, 0xbd]);
  let replacementCount = 0;
  for (let offset = data.indexOf(replacement); offset >= 0; offset = data.indexOf(replacement, offset + replacement.length)) {
    replacementCount += 1;
    if (replacementCount > Math.max(1_024, Math.floor(data.length * 0.01))) {
      return "PDF'nin ikili verisi bozulmuş. Dosyayı orijinal kaynaktan yeniden indirin veya PDF olarak yeniden dışa aktarın.";
    }
  }

  const tailStart = Math.max(0, data.length - 65_536);
  const tail = data.subarray(tailStart).toString("latin1");
  if (!tail.includes("%%EOF")) return "PDF tamamlanmamış veya hasarlı; dosya sonu kaydı bulunamadı.";
  const matches = [...tail.matchAll(/startxref\s+(\d+)/g)];
  const last = matches.at(-1);
  if (!last) return "PDF hasarlı; çapraz başvuru başlangıcı bulunamadı.";
  const xrefOffset = Number(last[1]);
  if (!Number.isSafeInteger(xrefOffset) || xrefOffset < 0 || xrefOffset >= data.length) {
    return "PDF hasarlı; çapraz başvuru adresi dosya sınırlarının dışında.";
  }
  const xrefTarget = data.subarray(xrefOffset, Math.min(data.length, xrefOffset + 96)).toString("latin1").trimStart();
  if (!/^(?:xref\b|\d+\s+\d+\s+obj\b)/.test(xrefTarget)) {
    return "PDF yapısı hasarlı; dosya içi çapraz başvuru adresi geçersiz. Belgeyi yeniden indirin veya yeniden PDF olarak kaydedin.";
  }
  return null;
}
