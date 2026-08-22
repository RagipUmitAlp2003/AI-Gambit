export type CompetitionEntry = {
  name: string;
  field: string;
};

/**
 * Sistemde kayıtlı yarışma havuzu. Görevli listeden arayarak seçer;
 * listede olmayan bir yarışma serbest metin olarak da girilebilir.
 */
export const COMPETITIONS: CompetitionEntry[] = [
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

/** Büyük/küçük harfe duyarsız (tr-TR) anlık filtreleme. */
export function filterCompetitions(query: string, limit = 12): CompetitionEntry[] {
  const normalized = query.trim().toLocaleLowerCase("tr-TR");
  if (!normalized) return COMPETITIONS.slice(0, limit);
  const starts: CompetitionEntry[] = [];
  const contains: CompetitionEntry[] = [];
  for (const entry of COMPETITIONS) {
    const name = entry.name.toLocaleLowerCase("tr-TR");
    if (name.startsWith(normalized)) starts.push(entry);
    else if (name.includes(normalized)) contains.push(entry);
  }
  return [...starts, ...contains].slice(0, limit);
}
