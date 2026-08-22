# Kalite testi korpusu

AI kriter çıkarımının doğruluğunu ölçmek için kullanılan veri seti (2026-08-22 koşusu):

- `ida-sartname-metin.txt`: 2026 İnsansız Deniz Aracı şartnamesinin sayfa sayfa çıkarılmış düz metni (elle karşılaştırma referansı). Üretimi: `node tools/extract_pdf_text.mjs <pdf> <txt>`
- `ida-analiz.json`: Aynı şartnamenin `/api/analyze` çıktısı (35 kriter; puan yapısı 15+55+100+145=315 doğrulandı; bilinen eksikler: görev/komut ihlali cezası ve etik davranış cezası).
- `sentetik-analiz.json`: Cevap anahtarı bilinen sentetik Akıllı Ulaşım kılavuzunun analiz çıktısı (15/15 kriter ve 100 puanlık dağılım birebir doğru; tuzak maddelerin tümü geçildi).

Yeniden üretmek için uygulama çalışırken: `node tools/run_quality_test.mjs`
Çelikkubbe karşılaştırması için: `node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze`
