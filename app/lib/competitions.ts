export type CompetitionEntry = {
  name: string;
  field: string;
};

/**
 * Sistemde kayıtlı yarışma havuzu. Görevli listeden arayarak seçer;
 * listede olmayan bir yarışma serbest metin olarak da girilebilir.
 */
export const COMPETITIONS: CompetitionEntry[] = [
  { name: "5G Yapay Zekâ ile Akıllı Yol Güvenliği Yarışması", field: "Yapay Zeka" },
  { name: "Yapay Zekâ Destekli Havayolu Optimizasyonu Yarışması", field: "Yapay Zeka" },
  { name: "Makine Öğrenmesi Destekli Lojistik Anahat Optimizasyonu Yarışması", field: "Yapay Zeka" },
  { name: "İleri Otonom Sistemler Tasarım ve Operasyon Yarışması", field: "Otonom Sistemler" },
  { name: "Elektronik Harp Yarışması", field: "Savunma" },
  { name: "Nükleer Enerji Teknolojileri Tasarım Yarışması", field: "Enerji" },
  { name: "Dikey İnişli Roket Yarışması", field: "Uzay" },
  { name: "Avcı Dron Yarışması", field: "Havacılık" },
  { name: "Sürü İHA Yarışması", field: "Havacılık" },
  { name: "Teknolojide Yararlı Düşünce ve Araştırma Yarışması", field: "Araştırma" },
  { name: "Akıllı Ulaşım Sistemleri Yarışması", field: "Ulaşım" },
  { name: "Çelikkubbe Hava Savunma Sistemleri Yarışması", field: "Savunma" },
  { name: "İnsansız Deniz Aracı Yarışması", field: "Deniz" },
  { name: "İnsansız Su Altı Sistemleri Yarışması", field: "Deniz" },
  { name: "İnsansız Hava Araçları Yarışması (Döner Kanat)", field: "Havacılık" },
  { name: "İnsansız Hava Araçları Yarışması (Sabit Kanat)", field: "Havacılık" },
  { name: "Savaşan İHA Yarışması", field: "Havacılık" },
  { name: "Uluslararası Serbest Görev İHA Yarışması", field: "Havacılık" },
  { name: "Roket Yarışması (Orta İrtifa)", field: "Uzay" },
  { name: "Roket Yarışması (Yüksek İrtifa)", field: "Uzay" },
  { name: "Model Uydu Yarışması", field: "Uzay" },
  { name: "Uydu Teknolojileri Yarışması", field: "Uzay" },
  { name: "Çip Tasarım Yarışması", field: "Elektronik" },
  { name: "Jet Motor Tasarım Yarışması", field: "Havacılık" },
  { name: "Uçan Araba Simülasyon Yarışması", field: "Havacılık" },
  { name: "Robotaksi - Binek Otonom Araç Yarışması", field: "Ulaşım" },
  { name: "Efficiency Challenge Elektrikli Araç Yarışması", field: "Ulaşım" },
  { name: "Hyperloop Geliştirme Yarışması", field: "Ulaşım" },
  { name: "Ulaşımda Yapay Zeka Yarışması", field: "Yapay Zeka" },
  { name: "Sağlıkta Yapay Zeka Yarışması", field: "Yapay Zeka" },
  { name: "Havacılıkta Yapay Zeka Yarışması", field: "Yapay Zeka" },
  { name: "Türkçe Doğal Dil İşleme Yarışması", field: "Yapay Zeka" },
  { name: "Siber Güvenlik Yarışması", field: "Bilişim" },
  { name: "Blokzincir Yarışması", field: "Bilişim" },
  { name: "Oyun Geliştirme Yarışması", field: "Bilişim" },
  { name: "Eğitim Teknolojileri Yarışması", field: "Sosyal İnovasyon" },
  { name: "İnsanlık Yararına Teknoloji Yarışması", field: "Sosyal İnovasyon" },
  { name: "Engelsiz Yaşam Teknolojileri Yarışması", field: "Sosyal İnovasyon" },
  { name: "Psikolojide Dijital Teknolojiler Yarışması", field: "Sosyal İnovasyon" },
  { name: "Turizm Teknolojileri Yarışması", field: "Sosyal İnovasyon" },
  { name: "Finansal Teknolojiler Yarışması", field: "Bilişim" },
  { name: "Biyoteknoloji İnovasyon Yarışması", field: "Sağlık" },
  { name: "Tarım Teknolojileri Yarışması", field: "Tarım ve Çevre" },
  { name: "Çevre ve Enerji Teknolojileri Yarışması", field: "Tarım ve Çevre" },
  { name: "Sanayide Dijital Teknolojiler Yarışması", field: "Sanayi" },
  { name: "Kutup Araştırma Projeleri Yarışması", field: "Araştırma" },
  { name: "Denizaltı Teknolojileri Yarışması", field: "Deniz" },
  { name: "Karma Sürü Simülasyon Yarışması", field: "Savunma" },
  { name: "Akıllı Şehirler Teknolojileri Yarışması", field: "Ulaşım" },
  { name: "Helikopter Tasarım Yarışması", field: "Havacılık" },
];

/**
 * Yarışmaya göre kategori/aşama/rapor türü hiyerarşisi.
 * Bir yarışma için özel yapı tanımlı değilse genel yapı kullanılır;
 * görevli her alanda serbest metin de girebilir.
 */
export type CompetitionStructure = {
  categories: string[];
  stages: Array<{ name: string; reportTypes: string[] }>;
};

export const DEFAULT_STRUCTURE: CompetitionStructure = {
  categories: ["Üniversite Seviyesi", "Lise Seviyesi", "Ortaokul Seviyesi", "Serbest / Karma"],
  stages: [
    { name: "Ön değerlendirme", reportTypes: ["Ön Tasarım Raporu (ÖTR)"] },
    { name: "Kritik tasarım değerlendirmesi", reportTypes: ["Kritik Tasarım Raporu (KTR)"] },
    { name: "Video değerlendirmesi", reportTypes: ["Araç / Sistem Tanıtım Videosu"] },
    { name: "Final değerlendirmesi", reportTypes: ["Final Tasarım Raporu (FTR)", "Sunum Dosyası"] },
    { name: "Teknik şartname profili", reportTypes: ["Teknik şartname değerlendirme profili"] },
  ],
};

const STRUCTURES: Record<string, CompetitionStructure> = {
  "Akıllı Ulaşım Sistemleri Yarışması": {
    categories: ["Üniversite Seviyesi", "Lise Seviyesi"],
    stages: [
      { name: "Ön değerlendirme", reportTypes: ["Ön Tasarım Raporu (ÖTR)"] },
      { name: "Kritik tasarım değerlendirmesi", reportTypes: ["Kritik Tasarım Raporu (KTR)"] },
      { name: "Final değerlendirmesi", reportTypes: ["Final Tasarım Raporu (FTR)", "Sunum Dosyası"] },
    ],
  },
  "İnsansız Deniz Aracı Yarışması": {
    categories: ["Üniversite Seviyesi", "Lise Seviyesi"],
    stages: [
      { name: "Ön değerlendirme", reportTypes: ["Ön Tasarım Raporu (ÖTR)"] },
      { name: "Kritik tasarım değerlendirmesi", reportTypes: ["Kritik Tasarım Raporu (KTR)", "Araç Tanıtım Videosu"] },
      { name: "Teknik kontrol ve yarışlar", reportTypes: ["Teknik Kontrol Formu", "Saha Değerlendirmesi"] },
      { name: "Teknik şartname profili", reportTypes: ["Teknik şartname değerlendirme profili"] },
    ],
  },
  "İnsansız Su Altı Sistemleri Yarışması": {
    categories: ["Temel Kategori", "İleri Kategori", "Temel / İleri Kategori"],
    stages: [
      { name: "Ön değerlendirme", reportTypes: ["Ön Tasarım Raporu (ÖTR)"] },
      { name: "Kritik tasarım değerlendirmesi", reportTypes: ["Kritik Tasarım Raporu (KTR)", "Araç Tanıtım Videosu"] },
      { name: "Görev değerlendirmesi", reportTypes: ["Görev Performans Raporu", "Saha Değerlendirmesi"] },
      { name: "Teknik şartname profili", reportTypes: ["Teknik şartname değerlendirme profili"] },
    ],
  },
  "Çelikkubbe Hava Savunma Sistemleri Yarışması": {
    categories: ["Üniversite Seviyesi"],
    stages: [
      { name: "Ön değerlendirme", reportTypes: ["Ön Tasarım Raporu (ÖTR)"] },
      { name: "Kritik tasarım değerlendirmesi", reportTypes: ["Kritik Tasarım Raporu (KTR)", "Tanıtım Videosu"] },
      { name: "Teknik şartname profili", reportTypes: ["Kritik Tasarım Raporu (KTR)", "Teknik şartname değerlendirme profili"] },
      { name: "Saha yarışması", reportTypes: ["Saha Değerlendirmesi"] },
    ],
  },
};

function structureFor(competition: string): CompetitionStructure {
  return STRUCTURES[competition.trim()] ?? DEFAULT_STRUCTURE;
}

/** Seçilen yarışmaya göre kategori/seviye seçenekleri. */
export function categoriesFor(competition: string): string[] {
  return structureFor(competition).categories;
}

/** Seçilen yarışmaya göre aşama seçenekleri (kategori seçimi korunarak). */
export function stagesFor(competition: string): string[] {
  return structureFor(competition).stages.map((stage) => stage.name);
}

/** Seçilen yarışma ve aşamaya göre uygun rapor türleri. */
export function reportTypesFor(competition: string, stage: string): string[] {
  const structure = structureFor(competition);
  const match = structure.stages.find((item) => item.name === stage.trim());
  if (match) return match.reportTypes;
  // Serbest metin aşamada tüm rapor türlerini tekrarsız öner.
  return [...new Set(structure.stages.flatMap((item) => item.reportTypes))];
}

const FOLD_MAP: Record<string, string> = {
  ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c", â: "a", î: "i", û: "u",
};

/**
 * Arama karşılaştırması için Türkçe sadeleştirme: önce tr-TR küçültme
 * ("İ" → "i", "I" → "ı"), ardından aksan katlaması. Böylece görevli
 * klavyesinde "insansiz" yazsa da "İnsansız Deniz Aracı" eşleşir.
 */
export function fold(value: string): string {
  return value.toLocaleLowerCase("tr-TR").replace(/[ışğüöçâîû]/g, (character) => FOLD_MAP[character] ?? character);
}

type IndexedCompetition = CompetitionEntry & {
  /** Ad üzerinden sıralama için sadeleştirilmiş biçim. */
  foldedName: string;
  /** Ad + alan; çok kelimeli aramada tüm parçalar burada aranır. */
  haystack: string;
};

/**
 * Arama dizini modül yüklenirken bir kez kurulur. Her tuş vuruşunda tüm
 * listeyi yeniden küçültmek yerine hazır dizgeler taranır; liste binlerce
 * yarışmaya çıksa da filtreleme tek geçişte kalır.
 */
const SEARCH_INDEX: IndexedCompetition[] = COMPETITIONS.map((entry) => {
  const foldedName = fold(entry.name);
  return { ...entry, foldedName, haystack: `${foldedName} ${fold(entry.field)}` };
});

/** Listede aynı anda gösterilecek en fazla kayıt; gerisi sayıyla bildirilir. */
export const COMPETITION_RESULT_LIMIT = 50;

export type CompetitionSearchResult = {
  /** Gösterilecek kayıtlar (en fazla `limit` adet). */
  items: CompetitionEntry[];
  /** Aramayla eşleşen toplam kayıt sayısı; `items` kırpılmış olabilir. */
  total: number;
};

/**
 * Anlık yarışma araması. Boşlukla ayrılmış her parça ad veya alan içinde
 * aranır; eşleşmeler "adın başı → kelime başı → içerik" sırasına göre döner.
 */
export function searchCompetitions(query: string, limit = COMPETITION_RESULT_LIMIT): CompetitionSearchResult {
  const normalized = fold(query.trim());
  if (!normalized) {
    return { items: COMPETITIONS.slice(0, limit), total: COMPETITIONS.length };
  }
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const ranked: Array<{ entry: CompetitionEntry; rank: number }> = [];
  for (const indexed of SEARCH_INDEX) {
    if (!tokens.every((token) => indexed.haystack.includes(token))) continue;
    const rank = indexed.foldedName.startsWith(normalized)
      ? 0
      : new RegExp(`(?:^|\\s)${tokens[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(indexed.foldedName)
        ? 1
        : 2;
    ranked.push({ entry: indexed, rank });
  }
  // Aynı ranktaki kayıtlar özgün liste sırasını korur (kararlı sıralama).
  ranked.sort((a, b) => a.rank - b.rank);
  return { items: ranked.slice(0, limit).map((item) => item.entry), total: ranked.length };
}
