// Kalite koşusu beklentileri (dört aşamalı, puansız kriter modeli).
//
// requiredFindings: anahtar kelimelerin TEK kriterde birlikte geçmesi gerekir;
// stage/required verilmişse eşleşen kriterin aşaması ve zorunluluğu da denetlenir.
// forbiddenCriteria: puan tablosu, saha görevi ve belgede olmayan kurallar
// kriter yapılmamalıdır. `fields: ["name"]` yalnızca kriter adına bakar; böylece
// bir rapor kuralının kaynak alıntısında geçen "puanlama" kelimesi yanlış
// pozitif üretmez, ama "Problem Tanımı (10 puan)" gibi puan kalemleri yakalanır.

/** Puanlama sistemi ve fiziksel aşama kalemleri: hiçbir şartnamede kriter olmamalı. */
export const scoringAndFieldForbidden = [
  { name: "Puan kalemi kriter yapılmış", keywords: ["puan"], fields: ["name"] },
  { name: "Azami puan ifadesi", keywords: ["azami puan"] },
  { name: "Puan üzerinden değerlendirme", keywords: ["puan üzerinden"] },
  { name: "Ceza puanı kuralı", keywords: ["ceza puanı"] },
  { name: "Baraj puanı kuralı", keywords: ["baraj puan"] },
  { name: "Parkur kriteri", keywords: ["parkur"], fields: ["name"] },
  { name: "Saha görevi kriteri", keywords: ["saha görevi"] },
];

export const syntheticExpectation = {
  minCriteria: 10,
  requiredFindings: [
    { name: "Tek PDF dosyası", keywords: ["pdf"], stage: "language_template", required: true },
    { name: "Dosya büyüklüğü 25 MB", keywords: ["25 mb"], stage: "language_template", required: true },
    { name: "Sayfa sınırı 25 sayfa", keywords: ["25 sayfa"], stage: "language_template" },
    { name: "A4 ve 2,5 cm kenar boşluğu", keywords: ["a4", "2,5 cm"], stage: "language_template" },
    { name: "Problem Tanımı bölümü", keywords: ["problem tanımı"], stage: "headings_content" },
    { name: "Mevcut Çözümler bölümü", keywords: ["mevcut çözümler"], stage: "headings_content" },
    { name: "Önerilen Sistem Mimarisi bölümü", keywords: ["sistem mimarisi"], stage: "headings_content" },
    { name: "Doğrulama ve Test Planı bölümü", keywords: ["doğrulama", "test planı"], stage: "headings_content" },
    { name: "Risk ve Etik Değerlendirme bölümü", keywords: ["risk", "etik"], stage: "headings_content" },
    { name: "Kaynakça bölümü", keywords: ["kaynakça"], stage: "headings_content" },
    { name: "Yapay zekâ kullanım açıklaması", keywords: ["yapay zek", "raporun sonunda"], stage: ["criteria_evidence", "headings_content"] },
    { name: "Benzerlik oranı yüzde 20", keywords: ["benzerlik", "20"], stage: "category_similarity" },
  ],
  forbiddenCriteria: [
    // Kılavuz açıkça yazı tipi şartı koymadığını söyler; varsayılan kural üretilmemeli.
    { name: "Varsayılan Times New Roman kuralı", keywords: ["times new roman"] },
    { name: "100 puan üzerinden değerlendirme", keywords: ["100 puan"] },
    ...scoringAndFieldForbidden,
  ],
};

export const idaExpectation = {
  minCriteria: 12,
  requiredFindings: [
    { name: "KTR azami 30 sayfa", keywords: ["30 sayfa"], stage: "language_template", required: true },
    { name: "Sayfa sınırı ihlali değerlendirme dışı", keywords: ["sayfa sınırı", "değerlendirmeye alınmayacak"], stage: "language_template" },
    { name: "TYR: mekanik, elektronik, algoritma ve yazılım tasarımı", keywords: ["mekanik", "elektronik", "yazılım"], stage: ["headings_content", "criteria_evidence"] },
    { name: "Batarya bölmesi sızdırmazlık", keywords: ["batarya", "sızdırmaz"], stage: "criteria_evidence" },
    { name: "Haberleşme: yalnızca telekomut/telemetri modülleri", keywords: ["telekomut", "telemetri"], stage: "criteria_evidence" },
  ],
  forbiddenCriteria: [
    // Saha/ceza maddeleri: PDF aşamasında kontrol edilemez, kriter olmamalı.
    { name: "Görev/komut ihlali 50 ceza puanı", keywords: ["50 ceza"] },
    { name: "Haberleşme ihlali 150 ceza puanı", keywords: ["150 ceza"] },
    { name: "Etik davranış cezası", keywords: ["etik davranış cezası"] },
    { name: "Rapor puanlaması 15 puan", keywords: ["15 puan"] },
    { name: "Görev puanlaması", keywords: ["görev puanlaması"] },
    ...scoringAndFieldForbidden,
  ],
};
