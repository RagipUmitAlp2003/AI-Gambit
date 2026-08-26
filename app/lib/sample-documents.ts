import type { SetupData } from "./types";

export type SampleDocument = {
  path: string;
  name: string;
  title: string;
  source: string;
  description: string;
  pages: number;
  /** Belge seçildiğinde başlangıç ayarlarına uygulanacak varsayılanlar. */
  setup: Partial<SetupData>;
};

/**
 * Uygulamayla birlikte gelen hazır test belgeleri. Görevlinin havuza eklediği
 * belgelerden farkı: bunlar salt okunurdur ve silinemez.
 */
export const SAMPLE_DOCUMENTS: SampleDocument[] = [
  {
    path: "/ornek-degerlendirme-kilavuzu.pdf",
    name: "Ornek_Akilli_Ulasim_OTR_Degerlendirme_Kilavuzu.pdf",
    title: "Akıllı Ulaşım - kısa test kılavuzu",
    source: "Sentetik test belgesi",
    description: "100 puanlık sade tablo, teknik teslim kuralları ve bilinçli olarak atlanan biçim kontrolleri.",
    pages: 3,
    setup: {
      competition: "Akıllı Ulaşım Sistemleri Yarışması",
      category: "Üniversite Seviyesi",
      stage: "Ön değerlendirme",
      reportType: "Ön Tasarım Raporu (ÖTR)",
      year: "2026",
    },
  },
  {
    path: "/samples/2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf",
    name: "2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf",
    title: "Çelikkubbe Hava Savunma Sistemleri",
    source: "Resmî TEKNOFEST şartnamesi",
    description: "Çok aşamalı puanlama, barajlar, sayfa sınırları, başarısızlık koşulları ve toplam puan formülleri.",
    pages: 25,
    setup: {
      competition: "Çelikkubbe Hava Savunma Sistemleri Yarışması",
      category: "Üniversite Seviyesi",
      stage: "Teknik şartname profili",
      reportType: "Kritik Tasarım Raporu (KTR)",
      year: "2026",
    },
  },
  {
    path: "/samples/2026_Insansiz_Deniz_Araci_Sartnamesi.pdf",
    name: "2026_Insansiz_Deniz_Araci_Sartnamesi.pdf",
    title: "İnsansız Deniz Aracı Yarışması",
    source: "Resmî TEKNOFEST şartnamesi",
    description: "Rapor, video, teknik uygunluk ve parkur puanlarını aynı belgede birleştiren karmaşık değerlendirme yapısı.",
    pages: 29,
    setup: {
      competition: "İnsansız Deniz Aracı Yarışması",
      category: "Üniversite Seviyesi",
      stage: "Kritik tasarım değerlendirmesi",
      reportType: "Kritik Tasarım Raporu (KTR)",
      year: "2026",
    },
  },
  {
    path: "/samples/2026_Insansiz_Su_Alti_Sistemleri_Sartnamesi.pdf",
    name: "2026_Insansiz_Su_Alti_Sistemleri_Sartnamesi.pdf",
    title: "İnsansız Su Altı Sistemleri",
    source: "Resmî TEKNOFEST şartnamesi",
    description: "Kategoriye göre değişen puanlar, görev başarımı, minimum başarı şartları ve eleme incelemeleri.",
    pages: 35,
    setup: {
      competition: "İnsansız Su Altı Sistemleri Yarışması",
      category: "Temel / İleri Kategori",
      stage: "Kritik tasarım değerlendirmesi",
      reportType: "Kritik Tasarım Raporu (KTR)",
      year: "2026",
    },
  },
  {
    path: "/samples/2026_Robotaksi_Binek_Otonom_Arac_Sartnamesi.pdf",
    name: "2026_Robotaksi_Binek_Otonom_Arac_Sartnamesi.pdf",
    title: "Robotaksi - Binek Otonom Araç",
    source: "Resmî TEKNOFEST şartnamesi",
    description: "İki araç kategorisi, Teknik Yeterlilik Formu ile başlayan zincirleme eleme, tur puanları, ceza ve diskalifiye koşulları.",
    pages: 38,
    setup: {
      competition: "Robotaksi - Binek Otonom Araç Yarışması",
      category: "Üniversite Seviyesi",
      stage: "Kritik tasarım değerlendirmesi",
      reportType: "Kritik Tasarım Raporu (KTR)",
      year: "2026",
    },
  },
  {
    path: "/samples/2026_Saglikta_Yapay_Zeka_Sartnamesi.pdf",
    name: "2026_Saglikta_Yapay_Zeka_Sartnamesi.pdf",
    title: "Sağlıkta Yapay Zeka",
    source: "Resmî TEKNOFEST şartnamesi",
    description: "Lise ve üniversite seviyesi için ayrı görev tanımları, yalnızca eleme amaçlı rapor puanları ve %90 final / %10 sunum ağırlığı.",
    pages: 19,
    setup: {
      competition: "Sağlıkta Yapay Zeka Yarışması",
      category: "Lise Seviyesi",
      stage: "Teknik şartname profili",
      reportType: "Teknik şartname değerlendirme profili",
      year: "2026",
    },
  },
  {
    path: "/samples/2026_Tarim_Teknolojileri_Sartnamesi.pdf",
    name: "2026_Tarim_Teknolojileri_Sartnamesi.pdf",
    title: "Tarım Teknolojileri",
    source: "Resmî TEKNOFEST şartnamesi",
    description: "Alt kategorilere ayrılmış proje yarışması: üç aşamalı değerlendirme, baraj puanı ve 25 puanlık itiraz eşiği.",
    pages: 23,
    setup: {
      competition: "Tarım Teknolojileri Yarışması",
      category: "Serbest / Karma",
      stage: "Ön değerlendirme",
      reportType: "Proje Ön Değerlendirme Raporu",
      year: "2026",
    },
  },
  {
    path: "/samples/2026_Model_Uydu_Sartnamesi.pdf",
    name: "2026_Model_Uydu_Sartnamesi.pdf",
    title: "TÜRKSAT Model Uydu",
    source: "Resmî TEKNOFEST şartnamesi",
    description: "Etap bazlı yüzde ağırlıkları (PDR %18, CDR %10, QR %20, uçuş %50, PFR %2), bonus görevler ve teslim formatı kuralları.",
    pages: 29,
    setup: {
      competition: "Model Uydu Yarışması",
      category: "Üniversite Seviyesi",
      stage: "Kritik tasarım değerlendirmesi",
      reportType: "Kritik Tasarım İnceleme Raporu (CDR)",
      year: "2026",
    },
  },
  {
    path: "/samples/2026_Insanlik_Yararina_Teknolojiler_Lise_Sartnamesi.pdf",
    name: "2026_Insanlik_Yararina_Teknolojiler_Lise_Sartnamesi.pdf",
    title: "İnsanlık Yararına Teknolojiler - Lise",
    source: "Resmî TEKNOFEST şartnamesi",
    description: "Yalnızca lise seviyesine açık üç kategori; ön değerlendirme ve yarı final puanları finale taşınmayan, prototip ağırlıklı yapı.",
    pages: 15,
    setup: {
      competition: "İnsanlık Yararına Teknoloji Yarışması",
      category: "Lise Seviyesi",
      stage: "Ön değerlendirme",
      reportType: "Proje Ön Değerlendirme Raporu",
      year: "2026",
    },
  },
  {
    path: "/samples/2026_Blokzincir_Sartnamesi.pdf",
    name: "2026_Blokzincir_Sartnamesi.pdf",
    title: "Blokzincir",
    source: "Resmî TEKNOFEST şartnamesi",
    description: "Dört aşamalı yüzdelik puanlama (%10 / %15 / %15 / %60) ve beş başlıkta tanımlanmış nitel değerlendirme yaklaşımları.",
    pages: 15,
    setup: {
      competition: "Blokzincir Yarışması",
      category: "Serbest / Karma",
      stage: "Ön değerlendirme",
      reportType: "Proje Ön Değerlendirme Raporu",
      year: "2026",
    },
  },
];
