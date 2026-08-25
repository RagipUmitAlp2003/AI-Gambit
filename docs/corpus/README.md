# Kalite testi korpusu

AI kriter çıkarımının (dört aşamalı, puansız model) doğruluğunu ölçmek için kullanılan veri seti:

- `ida-sartname-metin.txt`: 2026 İnsansız Deniz Aracı şartnamesinin sayfa sayfa çıkarılmış düz metni (elle karşılaştırma referansı). Üretimi: `node tools/extract_pdf_text.mjs <pdf> <txt>`
- `sentetik-analiz.json` ve `ida-analiz.json`: `/api/analyze` çıktıları. `node tools/run_quality_test.mjs` her koşuda yeniden üretir ve `tools/quality-expectations.mjs` beklentileriyle karşılaştırır. Depodaki mevcut kayıtlar **eski (puanlı, 1.0) biçimdedir**; silinmez, canlı koşuyla yenilenene kadar `npm run test:quality:saved` bunları "eski biçim" diye bildirir.

Analiz çıktısının şekli: `{ setup, templateProfile, criteria[], pageCount, analysisWarnings, diagnostics, model }`.
Her kriter `{ id, name, stage, required, description, violationOutcome, sourcePage, sourceText, active, origin }` alanlarını taşır; puan, ağırlık, güven seviyesi veya değerlendirme yöntemi yoktur.

Beklentiler üç şeyi denetler:

1. `requiredFindings`: rapor aşamasında kontrol edilecek kuralın tek kriterde bulunması; verilmişse aşama (`stage`) ve zorunluluk (`required`) eşleşmesi.
2. `forbiddenCriteria`: puan tablosu, baraj/ceza ve saha maddelerinin kriter yapılmamış olması.
3. Dayanaksız kriter: belge kaynaklı olup kaynak sayfası veya alıntısı olmayan madde bulunmaması.

Komutlar (uygulama çalışırken):

- Kalite koşusu: `node tools/run_quality_test.mjs`
- Kayıtlı çıktıyı yeniden doğrulama (ağ yok): `npm run test:quality:saved` — kayıt yoksa bilgi verip 0 ile çıkar; eski biçimli kayıtta açık mesajla 1 döner.
- Çelikkubbe yer gerçeği karşılaştırması: `node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze` (sonuç `output/benchmarks/celikkubbe-latest.json`; depodaki mevcut kayıt eski biçimdedir, canlı koşu üzerine yazar)
- İDA yer gerçeği (önce `docs/benchmarks/ida-ground-truth.json` doldurulur): `node tools/run_celikkubbe_benchmark.mjs --benchmark ida`
