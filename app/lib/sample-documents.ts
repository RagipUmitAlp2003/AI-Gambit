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
];
