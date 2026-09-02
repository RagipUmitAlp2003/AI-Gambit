/**
 * Türkçe metin normalizasyonu — şartname taramasının ortak tabanı.
 *
 * Bu modül ARAMA metnini üretir; ORİJİNAL metni asla değiştirmez. Kaynak
 * alıntıları her zaman `originalText` alanından alınır, buradaki
 * `normalizedText` yalnızca sözlük eşleşmesi ve aday bulma içindir
 * (bkz. app/lib/criteria-dictionary.ts).
 *
 * Naif alt dize eşleşmesi kullanılmaz: eşleşmeler kelime sınırıyla ve
 * olumsuzluk penceresiyle birlikte değerlendirilir.
 */

/** PDF metin katmanında sık görülen, anlamı değiştirmeyen boşluk türleri. */
const SPACE_LIKE = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\u2007\u2008\u2009]/g;
/** Görünmez biçim karakterleri: yumuşak tire, sıfır genişlikli birleştirici. */
const INVISIBLE = /[\u00ad\u200b\u200c\u200d\ufeff]/g;

/** Yazı tipi bağlaçları (ligature); tek karakterde birleşmiş harfler. */
const LIGATURES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\ufb00/g, "ff"], [/\ufb01/g, "fi"], [/\ufb02/g, "fl"],
  [/\ufb03/g, "ffi"], [/\ufb04/g, "ffl"], [/\ufb05/g, "st"], [/\ufb06/g, "st"],
];

/** Tipografik noktalama → düz karşılığı. Sayı ve birim biçimi korunur. */
const PUNCTUATION: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\u2018\u2019\u201a\u2032\u00b4`]/g, "'"],
  [/[\u201c\u201d\u201e\u2033]/g, '"'],
  [/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-"],
  [/\u2026/g, "..."],
];

/**
 * KONTROLLÜ OCR/font onarımı.
 *
 * Bazı PDF yazı tipleri Türkçe harfleri "taban harf + ayrı aksan karakteri"
 * olarak yazar; metin katmanı bu yüzden "s¸ekil" ya da "g˘ ovde" gibi çıkar.
 * Yalnızca bu belirli çiftler onarılır — tahmine dayalı harf değişimi YOKTUR.
 */
const OCR_REPAIRS: ReadonlyArray<readonly [RegExp, string]> = [
  // Sedilla: s¸ → ş, c¸ → ç (U+00B8 CEDILLA ve U+0327 birleşen sedilla)
  [/s[\u00b8\u0327]/g, "ş"], [/S[\u00b8\u0327]/g, "Ş"],
  [/c[\u00b8\u0327]/g, "ç"], [/C[\u00b8\u0327]/g, "Ç"],
  // Breve: g˘ → ğ (U+02D8 ve U+0306)
  [/g[\u02d8\u0306]/g, "ğ"], [/G[\u02d8\u0306]/g, "Ğ"],
  // Nokta: I˙ → İ (U+02D9 ve U+0307)
  [/I[\u02d9\u0307]/g, "İ"],
  // İki nokta: u¨ → ü, o¨ → ö (U+00A8 ve U+0308)
  [/u[\u00a8\u0308]/g, "ü"], [/U[\u00a8\u0308]/g, "Ü"],
  [/o[\u00a8\u0308]/g, "ö"], [/O[\u00a8\u0308]/g, "Ö"],
];

/**
 * Görüntülenebilir metni tek biçime getirir: Unicode NFC, bağlaç açma,
 * görünmez karakter temizliği, kontrollü aksan onarımı ve boşluk sadeleştirme.
 *
 * Harf kimliği korunur; hiçbir kelime silinmez veya kısaltılmaz.
 */
export function normalizeUnicode(value: string): string {
  let text = value.normalize("NFC");
  for (const [pattern, replacement] of LIGATURES) text = text.replace(pattern, replacement);
  text = text.replace(INVISIBLE, "");
  for (const [pattern, replacement] of OCR_REPAIRS) text = text.replace(pattern, replacement);
  for (const [pattern, replacement] of PUNCTUATION) text = text.replace(pattern, replacement);
  return text.replace(SPACE_LIKE, " ").normalize("NFC");
}

/** Fazla boşluk ve satır sonlarını tek boşluğa indirir. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Satır sonunda bölünmüş kelimeleri KONTROLLÜ biçimde birleştirir.
 *
 * Yalnızca "harf + tire" ile biten ve ardından küçük harfle başlayan satır
 * birleştirilir. "acil durdurma -" gibi ayrı bir tire veya "12- 24 VDC" gibi
 * sayısal bağlam birleştirilmez; bileşik sözcük tiresi (ör. "sol-sağ") satır
 * ortasında olduğu için buraya hiç girmez.
 */
export function joinHyphenatedLines(lines: readonly string[]): string[] {
  const output: string[] = [];
  for (const line of lines) {
    const previous = output.at(-1);
    const broken = previous !== undefined && /[\p{L}]{2}[-\u2010\u2011]$/u.test(previous.trimEnd());
    const continues = /^[\p{Ll}]/u.test(line.trimStart());
    if (broken && continues) {
      output[output.length - 1] = previous.trimEnd().slice(0, -1) + line.trimStart();
      continue;
    }
    output.push(line);
  }
  return output;
}

/**
 * Sözlük eşleşmesi için arama metni.
 *
 * Türkçe küçük harfe indirir (I→ı, İ→i), aksanları ASCII karşılığına çevirir
 * ve noktalamayı boşluğa dönüştürür. SAYILAR, ONDALIK AYIRICILAR, YÜZDE
 * İŞARETİ VE DERECE İŞARETİ KORUNUR; birim tespiti bunlara dayanır.
 */
export function normalizeForSearch(value: string): string {
  return normalizeUnicode(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9%°.,:/\-\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Karşılaştırma anahtarı: arama metninden noktalama ve sayı biçimi de düşer.
 * Tekrar tespiti ve ad eşleştirmesi için kullanılır.
 */
export function foldKey(value: string): string {
  return normalizeForSearch(value).replace(/[^a-z0-9]+/g, " ").trim();
}

/** Bir metnin Türkçe harf yoğunluğu; taranmış/bozuk metin katmanını ayırt eder. */
export function letterRatio(value: string): number {
  if (!value) return 0;
  const letters = value.match(/[\p{L}]/gu)?.length ?? 0;
  return letters / value.length;
}

/**
 * Kelime sınırı: eşleşmenin öncesi ve sonrası harf/rakam OLMAMALIDIR.
 *
 * `\b` Türkçe karakterlerde ASCII sınırına takıldığı için elle kontrol edilir.
 * Arama metni zaten ASCII'ye indirgenmiştir; yine de sayı-harf bitişikliği
 * (ör. "12mm" içindeki "m") yanlış eşleşme üretmesin diye rakam da sınır sayılmaz.
 */
export function isWordBoundary(haystack: string, start: number, end: number): boolean {
  const before = start > 0 ? haystack[start - 1] : "";
  const after = end < haystack.length ? haystack[end] : "";
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
}

/** Olumsuzluk penceresi: eşleşmeden sonraki kısa aralıkta "değil" var mı? */
const NEGATION_TAIL = /^[\s,;]*(?:degil|zorunlu degil|gerekli degil|sart degil)/;

/**
 * Eşleşme olumsuzlanmış mı? "zorunludur" ile "zorunlu değildir" aynı sinyal
 * sayılamaz; ikincisi bir istisna kaydıdır.
 */
export function isNegated(haystack: string, end: number): boolean {
  return NEGATION_TAIL.test(haystack.slice(end, end + 24));
}
