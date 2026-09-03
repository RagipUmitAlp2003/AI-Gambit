/**
 * Şartname tarama sözlüğü — İNSAN tarafından tanımlanır, sürümlenir.
 *
 * Regex ve kelime taraması kendi sözlüğünü üretemez; bu dosya tek merkezdir.
 * Modelden çalışma sırasında regex veya kelime listesi İSTENMEZ.
 *
 * Kurallar:
 *   - Bütün desenler `normalizeForSearch` çıktısı üzerinde çalışır
 *     (ASCII küçük harf, ı→i, aksan düşer; SAYI, %, ° ve ondalık ayırıcı korunur).
 *   - Her eşleşme kelime sınırıyla doğrulanır (bkz. isWordBoundary); naif alt
 *     dize eşleşmesi yoktur.
 *   - Olumsuzluk duyarlı girdiler ("zorunlu") "zorunlu değildir" bağlamında
 *     yükümlülük sayılmaz; ayrı bir istisna sinyali üretir.
 *   - Sürüm numarası her içerik değişikliğinde artırılır ve kaydedilen her
 *     analize yazılır; hangi eşleşmenin hangi girdiden geldiği izlenebilir.
 *   - Kullanıcıya "güven skoru" olarak GÖSTERİLMEZ; bu bir iç izleme aracıdır.
 *
 * Yarışmaya özgü ek sözlük tarama çağrısına `extraGroups` ile verilir; bu
 * dosya belirli bir yarışmaya aşırı uyarlanmaz.
 */

import { isNegated, isWordBoundary, normalizeForSearch } from "./turkish-text";

/** İçerik her değiştiğinde artırılır. Analiz kayıtlarına bu değer yazılır. */
export const DICTIONARY_VERSION = "sozluk-v3-core-report-checks";

export type DictionaryCategory =
  | "obligation"
  | "prohibition"
  | "limit"
  | "language_template"
  | "heading_content"
  | "category"
  | "technical"
  | "negation"
  | "physical_stage"
  | "external_evidence";

export type DictionaryEntry = {
  /** Kararlı kimlik: eşleşme kaydında bu değer saklanır. */
  id: string;
  category: DictionaryCategory;
  /** Türkçe, insan tarafından okunabilir açıklama. */
  label: string;
  /** Arama metni üzerinde çalışan desen; `g` bayrağı taramada eklenir. */
  source: string;
  /**
   * "değildir / gerekmez" takip ederse yükümlülük sayılmaz, istisna sinyali
   * üretilir. Yalnızca yükümlülük ve sınır girdilerinde anlamlıdır.
   */
  negationSensitive?: boolean;
};

export type DictionaryGroupEntry = {
  key: string;
  label: string;
  source: string;
  negationSensitive?: boolean;
};

export type DictionaryGroup = {
  id: string;
  title: string;
  category: DictionaryCategory;
  entries: readonly DictionaryGroupEntry[];
};

function group(
  id: string,
  title: string,
  category: DictionaryCategory,
  entries: readonly DictionaryGroupEntry[],
): DictionaryGroup {
  return { id, title, category, entries };
}

/* ------------------------------------------------------------------ *
 * 1 · Zorunluluk ve gereklilik
 * ------------------------------------------------------------------ */

const OBLIGATION = group("obligation", "Zorunluluk ve gereklilik", "obligation", [
  { key: "zorunlu", label: "zorunlu / zorunludur / zorunluluk", source: "zorunlu(?:luk|dur|lugu|lulugu)?", negationSensitive: true },
  { key: "zorunda", label: "zorunda / zorundadir", source: "zorunda(?:dir|ydi)?", negationSensitive: true },
  { key: "sart", label: "sart / sarttir", source: "sart(?:tir|ttir)?", negationSensitive: true },
  { key: "gerekli", label: "gerekli / gereklidir / gereklilik", source: "gerekli(?:dir|lik|ligi)?", negationSensitive: true },
  { key: "gerek", label: "gerekir / gerekmektedir", source: "gerek(?:ir|mektedir|mekte|tedir)", negationSensitive: true },
  { key: "mecbur", label: "mecbur / mecburidir", source: "mecbur(?:idir|dur|i)?", negationSensitive: true },
  // Sartnamelerde en sik gecen baglayici fiiller; acikca sayilir.
  { key: "olmali", label: "olmali / olmalidir", source: "olmali(?:dir)?" },
  { key: "hazirlanmali", label: "hazirlanmali", source: "hazirlanmali(?:dir)?" },
  { key: "sunulmali", label: "sunulmali", source: "sunulmali(?:dir)?" },
  { key: "bulunmali", label: "bulunmali", source: "bulunmali(?:dir)?" },
  { key: "kullanilmali", label: "kullanilmali", source: "kullanilmali(?:dir)?" },
  { key: "saglanmali", label: "saglanmali", source: "saglanmali(?:dir)?" },
  { key: "uyulmali", label: "uyulmali", source: "uyulmali(?:dir)?" },
  { key: "icermeli", label: "icermeli", source: "icermeli(?:dir)?" },
  { key: "belirtilmeli", label: "belirtilmeli", source: "belirtilmeli(?:dir)?" },
  { key: "aciklanmali", label: "aciklanmali", source: "aciklanmali(?:dir)?" },
  { key: "gosterilmeli", label: "gosterilmeli", source: "gosterilmeli(?:dir)?" },
  { key: "yazilmali", label: "yazilmali", source: "yazilmali(?:dir)?" },
  { key: "eklenmeli", label: "eklenmeli", source: "eklenmeli(?:dir)?" },
  { key: "verilmeli", label: "verilmeli", source: "verilmeli(?:dir)?" },
  { key: "yuklenmeli", label: "yuklenmeli", source: "yuklenmeli(?:dir)?" },
  { key: "teslim-edilmeli", label: "teslim edilmeli", source: "teslim edilmeli(?:dir)?" },
  { key: "yer-almali", label: "yer almali / yer almasi gerekir", source: "yer alma(?:li(?:dir)?|si gerek(?:ir|mektedir))" },
  { key: "uygun-olmali", label: "uygun olmali / uygun olmak zorundadir", source: "uygun ol(?:mali(?:dir)?|mak zorunda(?:dir)?)" },
  { key: "karsilamali", label: "karsilamali", source: "karsilamali(?:dir)?" },
  { key: "dikkat-edilmeli", label: "dikkat edilmeli", source: "dikkat edilmeli(?:dir)?" },
  {
    key: "isim-fiil-zorunlu",
    label: "hazirlanmasi / bulunmasi / sunulmasi zorunludur",
    source: "(?:hazirlanmasi|bulunmasi|sunulmasi|verilmesi|eklenmesi|yuklenmesi) zorunlu(?:dur)?",
    negationSensitive: true,
  },
  {
    key: "isim-fiil-gerek",
    label: "hazirlanmasi / sunulmasi / yer almasi gerekir",
    source: "(?:hazirlanmasi|bulunmasi|sunulmasi|verilmesi|eklenmesi|yuklenmesi|aciklanmasi|gosterilmesi|yer almasi|uygun olmasi) gerek(?:ir|mektedir)",
    negationSensitive: true,
  },
  {
    key: "baglayici-gelecek-zaman",
    label: "hazirlanacaktir / sunulacaktir / belirtilecektir benzeri baglayici gelecek zaman",
    source: "(?:hazirlanacak|sunulacak|bulunacak|kullanilacak|saglanacak|uyulacak|aciklanacak|yazilacak|yuklenecek|eklenecek|verilecek|gosterilecek|belirtilecek|icerecek)(?:tir)?|teslim edilecek(?:tir)?|yer alacak(?:tir)?",
  },
  {
    key: "modal-genel",
    label: "genel -mali/-meli kipi (olumsuz cekim haric)",
    // Olumsuz cekim (-mamali / -memeli) geriye bakisla dislanir; o desen
    // yasak grubunda ayrica tanimlidir.
    source: "[a-z]{3,}(?<!ma)mali(?:dir)?|[a-z]{3,}(?<!me)meli(?:dir)?",
  },
]);

/**
 * Genel modal desenin yanlış yakalayabileceği, yükümlülük OLMAYAN sözcükler.
 * Liste kısadır, elle bakılır ve testte de doğrulanır.
 */
const MODAL_FALSE_FRIENDS = new Set(["normali", "normalidir", "kemali", "cemali", "temeli", "temelidir", "emeli"]);

/* ------------------------------------------------------------------ *
 * 2 · Yasak ve sınır
 * ------------------------------------------------------------------ */

const PROHIBITION = group("prohibition", "Yasak", "prohibition", [
  { key: "yasak", label: "yasak / yasaktir / yasaklanmistir", source: "yasak(?:tir|lanmistir|lanmis|lar)?" },
  { key: "izin-verilmez", label: "izin verilmez", source: "izin veril(?:mez|memektedir|meyecektir)" },
  { key: "kabul-edilmez", label: "kabul edilmez", source: "kabul edil(?:mez|meyecektir|memektedir)" },
  { key: "degerlendirmeye-alinmaz", label: "degerlendirmeye alinmaz", source: "degerlendirmeye alin(?:maz|mayacaktir)" },
  { key: "uygulanmaz", label: "uygulanmaz", source: "uygulan(?:maz|mayacaktir)" },
  { key: "olumsuz-yeterlik", label: "-amaz / -emez (kullanilamaz, bulunamaz)", source: "[a-z]{3,}(?:amaz|emez)" },
  { key: "olumsuz-modal", label: "-mamali / -memeli", source: "[a-z]{2,}(?:mamali|memeli)(?:dir)?" },
]);

const LIMIT = group("limit", "Sinir ve aralik", "limit", [
  { key: "en-az", label: "en az", source: "en az" },
  { key: "en-fazla", label: "en fazla / en cok", source: "en (?:fazla|cok)" },
  { key: "en-dusuk", label: "en dusuk / en yuksek", source: "en (?:dusuk|yuksek)" },
  { key: "asgari", label: "asgari", source: "asgari" },
  { key: "azami", label: "azami", source: "azami" },
  { key: "minimum", label: "minimum / min.", source: "minimum|min\\." },
  { key: "maksimum", label: "maksimum / maks.", source: "maksimum|maks\\." },
  { key: "asamaz", label: "asamaz / gecemez / olamaz", source: "asamaz|gecemez|olamaz" },
  { key: "yalnizca", label: "yalnizca / sadece", source: "yalnizca|sadece" },
  { key: "haric-dahil", label: "haric / dahil", source: "haric|dahil" },
  { key: "alt-ust-sinir", label: "alt sinir / ust sinir", source: "(?:alt|ust) sinir(?:i)?" },
  { key: "buyuk-kucuk-olamaz", label: "-den kucuk/buyuk olamaz", source: "(?:kucuk|buyuk) olamaz" },
]);

/* ------------------------------------------------------------------ *
 * 3 · Dil ve şablon
 *
 * Tek başına aday üretmez; yükümlülük, yasak veya sınır sinyaliyle birlikte
 * değerlendirilir (bkz. criteria-candidates · selectCandidates).
 * ------------------------------------------------------------------ */

const LANGUAGE_TEMPLATE = group("language_template", "Dil ve sablon", "language_template", [
  { key: "turkce", label: "Turkce", source: "turkce" },
  { key: "ingilizce", label: "Ingilizce", source: "ingilizce" },
  { key: "rapor-dili", label: "rapor dili / yazim dili", source: "(?:rapor|yazim) dili" },
  { key: "yazi-tipi", label: "yazi tipi / font", source: "yazi tipi|font(?:u|lari)?" },
  { key: "punto", label: "punto", source: "punto" },
  { key: "kenar-boslugu", label: "kenar boslugu", source: "kenar bosluk(?:lari|u)?|kenar boslugu" },
  { key: "satir-araligi", label: "satir araligi", source: "satir arali(?:gi|klari)" },
  { key: "sayfa-duzeni", label: "sayfa duzeni", source: "sayfa duzeni" },
  { key: "sayfa-sayisi", label: "sayfa siniri / sayfa sayisi", source: "sayfa (?:sinir(?:i|lari)|sayisi|adedi)" },
  { key: "sayfa", label: "sayfa", source: "sayfa(?:yi|dan|da|lik)?" },
  { key: "kapak", label: "kapak / kapak sayfasi", source: "kapak(?: sayfasi)?" },
  { key: "icindekiler", label: "icindekiler", source: "icindekiler" },
  { key: "dosya-adi", label: "dosya adi", source: "dosya ad(?:i|lari|landirma)" },
  { key: "dosya-turu", label: "dosya turu / format", source: "dosya tur(?:u|leri)|format(?:inda|lari|i)?" },
  { key: "pdf", label: "PDF", source: "pdf" },
  { key: "sablon", label: "sablon", source: "sablon(?:una|dan|u)?" },
  { key: "a4", label: "A4 sayfa", source: "a4" },
  { key: "kaynakca", label: "kaynakca / referanslar", source: "kaynakca|referans(?:lar|lar bolumu)?" },
  { key: "ust-alt-bilgi", label: "ustbilgi / altbilgi / sayfa numarasi", source: "ustbilgi|altbilgi|sayfa numara(?:si|landirma)" },
  { key: "paragraf-hizalama", label: "paragraf / hizalama / girinti", source: "paragraf duzeni|hizalama|girinti" },
]);

/* ------------------------------------------------------------------ *
 * 4 · Başlık ve içerik
 * ------------------------------------------------------------------ */

const HEADING_CONTENT = group("heading_content", "Baslik ve icerik", "heading_content", [
  { key: "baslik", label: "baslik", source: "baslik(?:larin|lari|lar|i)?" },
  { key: "bolum", label: "bolum / alt bolum", source: "(?:alt )?bolum(?:leri|ler|u)?" },
  { key: "raporda-yer-almali", label: "raporda yer almali", source: "raporda yer al" },
  { key: "anlatilmali", label: "anlatilmali / tanimlanmali", source: "(?:anlatilmali|tanimlanmali)(?:dir)?" },
  { key: "analiz-edilmeli", label: "analiz edilmeli / hesaplanmali / gerekcelendirilmeli", source: "(?:analiz edilmeli|hesaplanmali|gerekcelendirilmeli)(?:dir)?" },
  { key: "tablo-cizim", label: "tablo / cizim / sema / diyagram / gorsel", source: "tablo(?:lari|sunda|su|lar)?|cizim(?:leri|ler|i)?|sema(?:lari|si|lar)?|diyagram(?:lari|lar|i)?|gorsel(?:leri|ler|i)?" },
  { key: "yontem-sonuc", label: "yontem / sonuc / test / dogrulama", source: "yontem(?:leri|ler|i)?|sonuc(?:lari|lar|u)?|test(?:leri|ler|i)?|dogrulama(?:si)?" },
  { key: "tasarim-basliklari", label: "mekanik / elektronik tasarim, yazilim, guvenlik", source: "mekanik tasarim|elektronik tasarim|yazilim(?:lari|lar|i)?" },
  { key: "rapor-turleri", label: "teknik yeterlilik / kritik tasarim / on tasarim raporu", source: "teknik yeterlilik raporu|kritik tasarim raporu|on tasarim raporu|final degerlendirme raporu|proje raporu" },
  { key: "rapor-icerigi", label: "rapor icerigi / raporda aciklanacaklar", source: "rapor icerigi|raporda (?:aciklan|anlatil|belirtil|sunul|gosteril|yer al)" },
  { key: "hesap-gerekce", label: "hesap / gerekce / analiz raporu", source: "hesap(?:lari|lama)?|gerekce(?:si|lendirme)?|analiz(?:leri|i)?" },
]);

/* ------------------------------------------------------------------ *
 * 5 · Kategori
 *
 * Genel kategori TANITIMI kriter değildir; yalnızca katılımcı projesinin
 * kategoriye uygun olmasını isteyen AÇIK kural aday olur.
 * ------------------------------------------------------------------ */

const CATEGORY = group("category", "Kategori ve kapsam", "category", [
  { key: "kategori", label: "kategori", source: "kategori(?:sine|leri|ler|si|ye)?" },
  { key: "yarisma-alani", label: "yarisma alani / konusu", source: "yarisma (?:alani|konusu|kategorisi)" },
  { key: "amac-kapsam", label: "amac / kapsam / gorev tanimi", source: "amac(?:lari|i)?|kapsam(?:inda|i)?|gorev tanimi" },
  { key: "proje-konusu", label: "proje konusu / cozum alani", source: "proje konusu|cozum alani" },
  { key: "hedef-kullanim", label: "hedef kullanim / kullanim senaryosu", source: "hedef kullanim|kullanim senaryosu" },
  { key: "uygunluk", label: "yarismaya uygunluk / beklenen sistem", source: "yarismaya uygun(?:lugu|luk)?|beklenen sistem" },
  { key: "tematik-alan", label: "tematik alan / teknoloji alani / alt kategori", source: "tematik alan|teknoloji alani|proje alani|alt kategori" },
  { key: "hedef-problem", label: "hedef problem / cozulmesi beklenen problem", source: "hedef problem|cozulmesi beklenen problem|problem alani" },
  { key: "proje-turu", label: "kabul edilen / beklenen proje turu", source: "kabul edilen proje turu|beklenen proje turu|proje turu" },
]);

/* ------------------------------------------------------------------ *
 * 6 · Teknik terimler
 *
 * Tek başına yeterli değildir; sayı-birim ya da yükümlülük sinyaliyle
 * birleştiğinde güçlü aday olur.
 * ------------------------------------------------------------------ */

const TECHNICAL = group("technical", "Teknik terimler", "technical", [
  { key: "olcu", label: "olcu / boyut / gabari", source: "olcu(?:leri|su)?|boyut(?:lari|u)?|gabari(?:si)?" },
  { key: "uzunluk", label: "uzunluk / genislik / yukseklik / cap", source: "uzunluk|genislik|yukseklik|cap(?:i)?" },
  { key: "hacim", label: "hacim / alan", source: "hacim|hacmi" },
  { key: "agirlik", label: "agirlik / kutle", source: "agirlik(?:lari|i)?|agirligi|kutle(?:si)?" },
  { key: "hiz-sure", label: "hiz / sure / mesafe / menzil", source: "hiz(?:lari|i)?|sure(?:leri|si)?|mesafe(?:si)?|menzil(?:i)?" },
  { key: "guc-enerji", label: "guc / enerji / gerilim / akim / kapasite / frekans", source: "guc(?:leri|u)?|enerji(?:si)?|gerilim(?:i)?|akim(?:i)?|kapasite(?:si)?|frekans(?:i)?" },
  { key: "sicaklik", label: "sicaklik / basinc / dayanim", source: "sicaklik(?:i)?|basinc(?:i)?|dayanim(?:i)?" },
  { key: "malzeme", label: "malzeme / batarya / motor / sensor", source: "malzeme(?:leri|si|ler)?|batarya(?:lar|si)?|motor(?:lar|u)?|sensor(?:leri|ler|u)?" },
  { key: "haberlesme", label: "haberlesme / telemetri / yalitim / protokol", source: "haberlesme(?:si)?|telemetri|yalitim(?:i)?|protokol(?:u)?" },
  { key: "acil-durdurma", label: "acil durdurma / kill switch", source: "acil durdurma|acil stop|kill switch" },
  { key: "algoritma", label: "algoritma / mimari / test yontemi / tasarim siniri", source: "algoritma(?:si)?|mimari(?:si)?|test yontemi|tasarim siniri" },
  { key: "kontrol-guvenlik", label: "kontrol / guvenlik", source: "kontrol(?:u|leri)?|guvenlik(?:leri|i)?" },
]);

/* ------------------------------------------------------------------ *
 * 7 · Olumsuzluk ve istisna
 * ------------------------------------------------------------------ */

const NEGATION = group("negation", "Olumsuzluk ve istisna", "negation", [
  { key: "degil", label: "degil / degildir", source: "degil(?:dir)?" },
  { key: "gerekmez", label: "gerekmez", source: "gerek(?:mez|memektedir)" },
  { key: "istisna", label: "istisna / disinda", source: "istisna(?:lari|si|lar)?|disinda" },
  { key: "opsiyonel", label: "istege bagli / opsiyonel / tavsiye edilir", source: "istege bagli|opsiyonel|tavsiye edilir|onerilir" },
]);

/* ------------------------------------------------------------------ *
 * 8 · Fiziksel aşama (kapsam işareti — SİLİNMEZ, işaretlenir)
 * ------------------------------------------------------------------ */

const PHYSICAL_STAGE = group("physical_stage", "Fiziksel / saha asamasi", "physical_stage", [
  { key: "yarisma-gunu", label: "yarisma gunu / yarisma sirasinda", source: "yarisma (?:gunu|alaninda|sirasinda)" },
  { key: "saha", label: "saha / parkur / pist", source: "saha(?:sinda|da)?|parkur(?:da|u)?|pist(?:te|i)?" },
  { key: "ucus", label: "ucus / atis / surus denemesi", source: "ucus(?:lari|lar|u)?|atis(?:lar|i)?|surus" },
  { key: "canli", label: "canli sunum / canli demo", source: "canli (?:sunum|demo|gosterim)|yerinde sunum" },
  { key: "fiziksel-test", label: "fiziksel test / yerinde olcum", source: "fiziksel test|yerinde olcum|sahada olcul" },
  { key: "puanlama", label: "puan / ceza puani / baraj", source: "puan(?:lamasi|lama|lari|lar|i)?|ceza(?:lar|si)?|baraj(?:i)?" },
]);

/* ------------------------------------------------------------------ *
 * 9 · Haricî kanıt (kapsam işareti — SİLİNMEZ, işaretlenir)
 * ------------------------------------------------------------------ */

const EXTERNAL_EVIDENCE = group("external_evidence", "Rapor disi kanit", "external_evidence", [
  { key: "video", label: "video / youtube / vimeo", source: "video(?:lari|su|lar)?|youtube|vimeo" },
  { key: "portal", label: "portal / sisteme yukleme / cevrim ici form", source: "portal(?:uzerinden|dan|a)?|sisteme yukle|cevrim ici form" },
  { key: "fiziksel-teslim", label: "fiziksel teslim / numune", source: "fiziksel teslim|numune teslimi|elden teslim" },
  { key: "islak-imza", label: "islak imza / imzali belge", source: "islak imza|imzali belge" },
  { key: "veritabani", label: "veri tabani / kayit sistemi", source: "veri taban(?:indan|i)|kayit sistemi" },
]);

export const DICTIONARY_GROUPS: readonly DictionaryGroup[] = [
  OBLIGATION, PROHIBITION, LIMIT, LANGUAGE_TEMPLATE, HEADING_CONTENT,
  CATEGORY, TECHNICAL, NEGATION, PHYSICAL_STAGE, EXTERNAL_EVIDENCE,
];

/* ------------------------------------------------------------------ *
 * Sayı ve birim tespiti
 * ------------------------------------------------------------------ */

/**
 * Başlangıç birim listesi. Arama metni küçük harfe indiği için birimler de
 * küçüktür; `m`, `a`, `n` gibi kısa birimler YALNIZCA sayıdan hemen sonra ve
 * kelime sınırında kabul edilir.
 */
export const UNITS: readonly string[] = [
  "mm", "cm", "km", "m",
  "mg", "kg", "ton", "g",
  "ms", "saniye", "sn", "dakika", "dk", "saat",
  "vdc", "vac", "v", "ma", "a",
  "kwh", "wh", "kw", "w", "ah",
  "khz", "mhz", "hz", "rpm",
  "°c", "kpa", "pa", "bar",
  "nm", "n", "derece", "litre", "lt", "l",
];

/** Uzun birimler önce denenir: "mm" varken "m" eşleşmemelidir. */
const UNIT_ALTERNATION = [...UNITS]
  .sort((left, right) => right.length - left.length)
  .map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

const NUMBER = "\\d+(?:[.,]\\d+)?";

export type NumberPatternKind = "sayi" | "yuzde" | "aralik" | "sayi_birim" | "sayfa_adet" | "tarih_sure";

export type NumberMatch = {
  kind: NumberPatternKind;
  text: string;
  index: number;
  /** Yalnızca sayı-birim eşleşmelerinde dolu. */
  unit?: string;
};

const NUMBER_PATTERNS: ReadonlyArray<{ kind: NumberPatternKind; source: string }> = [
  { kind: "yuzde", source: `%\\s?${NUMBER}|${NUMBER}\\s?%` },
  { kind: "aralik", source: `${NUMBER}\\s?-\\s?${NUMBER}\\s?(?:${UNIT_ALTERNATION})?(?![a-z0-9])` },
  { kind: "sayi_birim", source: `${NUMBER}\\s?(${UNIT_ALTERNATION})(?![a-z0-9])` },
  { kind: "sayfa_adet", source: `${NUMBER}\\s?(?:sayfa|adet|dosya|kelime|karakter)` },
  { kind: "tarih_sure", source: `\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}|${NUMBER}\\s?(?:gun|hafta|ay|yil|saat|dakika|saniye)` },
  { kind: "sayi", source: NUMBER },
];

/**
 * Arama metnindeki sayı ve birim izlerini bulur.
 *
 * Sayı-birim bulunması KRİTER KARARI DEĞİLDİR; yalnızca aday sinyalidir.
 */
export function findNumberPatterns(searchText: string): NumberMatch[] {
  const matches: NumberMatch[] = [];
  const covered: Array<[number, number]> = [];
  for (const { kind, source } of NUMBER_PATTERNS) {
    for (const match of searchText.matchAll(new RegExp(source, "g"))) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      // Daha belirgin bir desen bu aralığı kapsadıysa çıplak "sayı" eşleşmesi
      // ikinci kez yazılmaz.
      if (covered.some(([from, to]) => start >= from && end <= to)) continue;
      covered.push([start, end]);
      matches.push({ kind, text: match[0].trim(), index: start, ...(match[1] ? { unit: match[1] } : {}) });
    }
  }
  return matches.sort((left, right) => left.index - right.index);
}

/* ------------------------------------------------------------------ *
 * Tarama
 * ------------------------------------------------------------------ */

export type DictionaryMatch = {
  entryId: string;
  category: DictionaryCategory;
  label: string;
  /** Arama metninde eşleşen parça. */
  text: string;
  index: number;
  /** "değildir / gerekmez" ile olumsuzlanmış yükümlülük; istisna sayılır. */
  negated: boolean;
};

function flatten(groups: readonly DictionaryGroup[]): DictionaryEntry[] {
  return groups.flatMap((item) => item.entries.map((entry) => ({
    id: `${item.id}.${entry.key}`,
    category: item.category,
    label: entry.label,
    source: entry.source,
    ...(entry.negationSensitive ? { negationSensitive: true } : {}),
  })));
}

const BASE_ENTRIES = flatten(DICTIONARY_GROUPS);

/** Sözlüğün tamamı; yarışmaya özgü ek gruplar sona eklenir. */
export function dictionaryEntries(extraGroups: readonly DictionaryGroup[] = []): DictionaryEntry[] {
  return extraGroups.length ? [...BASE_ENTRIES, ...flatten(extraGroups)] : BASE_ENTRIES;
}

/**
 * Bir metin parçasını sözlüğe karşı tarar.
 *
 * `searchText` `normalizeForSearch` çıktısı olmalıdır. Her eşleşme kelime
 * sınırıyla doğrulanır ve hangi sözlük girdisinden geldiği kaydedilir.
 */
export function scanDictionary(searchText: string, extraGroups: readonly DictionaryGroup[] = []): DictionaryMatch[] {
  const matches: DictionaryMatch[] = [];
  for (const entry of dictionaryEntries(extraGroups)) {
    for (const found of searchText.matchAll(new RegExp(entry.source, "g"))) {
      const start = found.index ?? 0;
      const end = start + found[0].length;
      if (!isWordBoundary(searchText, start, end)) continue;
      if (entry.id === "obligation.modal-genel" && MODAL_FALSE_FRIENDS.has(found[0])) continue;
      matches.push({
        entryId: entry.id,
        category: entry.category,
        label: entry.label,
        text: found[0],
        index: start,
        negated: entry.negationSensitive === true && isNegated(searchText, end),
      });
    }
  }
  return matches.sort((left, right) => left.index - right.index);
}

/** Kısa yol: ham metni normalleştirip tarar (test ve araçlar için). */
export function scanText(value: string, extraGroups: readonly DictionaryGroup[] = []): DictionaryMatch[] {
  return scanDictionary(normalizeForSearch(value), extraGroups);
}
