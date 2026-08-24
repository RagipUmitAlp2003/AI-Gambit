# Kriter Atölyesi

TEKNOFEST benzeri yarışmalarda organizatörün yüklediği değerlendirme PDF'sini; kaynakları gösterilen, düzenlenebilir ve onaylanabilir bir kriter profiline dönüştüren ilk modül prototipidir.

## Bu sürümde çalışan akış

1. Görevli yarışmayı arama destekli listeden seçer (serbest metin de girilebilir); aşama, rapor türü ve katılımcı teslim sınırlarını tanımlar. Sağ paneldeki canlı önizleme her seçimde anında güncellenir.
2. Organizatörün kriter/şartname PDF'si yüklenir.
3. PDF, tablo ve sayfa yapısı korunarak sunucu üzerinden Gemini'ye gönderilir. Uzun şartnamelerde ilk çıkarımdan sonra bağımsız bir eksik-kural denetimi daha çalışır.
4. İlan edilen puan toplamı ve birbirini örtmeyen puan grupları ayrıca çıkarılır; grup toplamı ile PDF toplamı otomatik karşılaştırılır.
5. Kriter adı, kapsam/aşama, etki türü, puanı, zorunluluğu, ihlal sonucu, değerlendirme yöntemi, kaynak sayfası, ilgili metin ve sistem önerisi yöneticiye gösterilir.
6. Fiziksel güvenlik ve hakem uygunluğu maddelerinde sistem nihai karar vermez; bulgu üretir ve insan onayı ister.
7. Yönetici kriterleri düzenleyebilir, pasifleştirebilir, yenisini ekleyebilir veya manuel eklediği kriteri onaylı bir silme akışıyla kaldırabilir. Geçiş koşulları, barajlar, cezalar ve eleme maddeleri "Karar kuralları" bölümünde ayrıca gösterilir. İlan edilen toplam puan varsa sonuçların 100 üzerinden gösterimi için normalizasyon formülü profile eklenir (orijinal puan sistemi korunur).
8. Çok aşamalı şartnamelerde (rapor + saha görevleri aynı belgede) yönetici, hangi puan gruplarının bu profilde değerlendirileceğini seçer. Kapsam dışı bırakılan gruplar 100'e normalizasyonda paydaya girmez: örneğin İnsansız Deniz Aracı şartnamesi 315 puan ilan eder, ancak yalnızca "Rapor Puanlaması" kapsama alınırsa değerlendirme 15 puan üzerinden yapılır. Belgede ilan edilen genel toplam profilde ayrıca korunur.
9. Yönetici kaynakları ve çakışmaları doğruladıktan sonra profil onaylanır ve JSON olarak indirilebilir. Ayrı aşamalara ait puanlar bulunan şartnamelerde toplamın 100 olması zorunlu tutulmaz.

Seçilen PDF, analiz taslağı ve kriter düzenlemeleri tarayıcıda yerel olarak saklanır. Yönetici önceki adımlara dönebilir veya sayfayı yenileyebilir; yalnızca yeni bir belge seçmesi ya da “Taslağı sıfırla” işlemi mevcut analizi temizler.

## Değerlendirme Atölyesi (`/degerlendirme`)

Onaylı profil, ikinci modülde katılımcı raporlarına uygulanır:

1. **Rapor havuzu:** Profildeki dosya kapısı kuralları (format, boyut, ihlal davranışı) yükleme anında çalışır. Kabul edilen raporlar cihaz içi havuza alınır; dil tespiti, sayfa sınırı/şablon kontrolü, zorunlu başlık taraması ve havuz içi benzerlik analizi kesin kontroller olarak çalıştırılır.
2. **Hakem incelemesi:** Her aktif kriter için üretilen bulgu, kanıtı ve şartnamedeki dayanağıyla birlikte gösterilir. Hakem puanı verir veya öneriyi düzeltir; insan kararı gerektiren maddeler karara bağlanmadan inceleme tamamlanamaz. Geri bildirim taslağı hakem tarafından düzenlenir ve onaylanır.
3. **Yarışmacı görünümü:** Yalnızca hakemin tamamladığı değerlendirmeler görünür; güçlü yönler, gelişim alanları ve öneriler hakem onayı olmadan yayımlanmaz.

Anlamsal kriter analizi (AI puan önerisi, kategori uygunluğu) ayrı bir motor olarak geliştirilir: uç nokta iskeleti `app/api/evaluate-report/route.ts`, veri sözleşmesi `docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md`. Motor bağlanana kadar sistem yalnızca kesin kontrolleri çalıştırır ve anlamsal kriterleri açıkça "insan kararı bekliyor" olarak işaretler; puan uydurmaz.

## Gemini yapılandırması

Gerçek sağlayıcı sunucu tarafındaki `app/api/analyze/route.ts` uç noktasıdır. API anahtarı yalnızca `.env.local` içinde tutulur; tarayıcı koduna ve Git'e dahil edilmez. Birincil model `gemini-3.7-flash`, geçici yoğunluk halinde yedek model `gemini-3.5-flash` olarak ayarlanmıştır.

Yerel ortam değişkenleri `.env.example` örneğine göre tanımlanır. Bu prototip doğrudan PDF aktarımında 18 MB sınırı uygular. Daha büyük kaynaklar için Gemini Files API akışı eklenmelidir. `app/lib/demo-analyzer.ts` çevrimdışı geliştirme ve karşılaştırma için korunmuştur; normal arayüz akışında kullanılmaz.

Maliyet kontrolü: 12 sayfadan uzun belgelerde ikinci bir "eksik kural denetimi" turu çalışır ve kapsamı artırır, ancak token maliyetini ve süreyi yaklaşık iki katına çıkarır (İDA şartnamesinde 105 sn / 56 bin token). Bu tur `COVERAGE_AUDIT=off` ile kapatılabilir, `COVERAGE_AUDIT_MIN_PAGES` ile eşiği yükseltilebilir; ayar önbellek anahtarına dahildir.

Aynı belge + aynı bağlam yeniden analiz edilirse sunucu içi önbellek (SHA-256 hash) sayesinde model tekrar çağrılmaz. Her analiz için süre ve token kullanımı `diagnostics` alanında döner; oturum toplamları (istek sayısı, giriş/çıkış token, ortalama süre, hata oranı) `GET /api/metrics` ucundan okunur. Resmî kota takibi Google AI Studio üzerinden yapılır. Kullanıcı arayüzünde model/sağlayıcı adı gösterilmez.

## Yerel çalıştırma

```bash
npm install --legacy-peer-deps
cp .env.example .env.local   # GEMINI_API_KEY satırını kendi anahtarınızla doldurun
npm run dev
```

Uygulama varsayılan olarak `http://localhost:3000` adresinde açılır; Değerlendirme
Atölyesi `http://localhost:3000/degerlendirme` adresindedir.

`--legacy-peer-deps` zorunludur (react sürüm çakışması) ve `.env.local` git'e girmediği
için her makinede ayrıca oluşturulmalıdır. Ayrıntılı kurulum, ilk deneme akışı,
verilerin nerede saklandığı ve sorun giderme için **[GUIDE.md](GUIDE.md)** dosyasına bakın.

## Test belgeleri

- `output/pdf/Ornek_Akilli_Ulasim_OTR_Degerlendirme_Kilavuzu.pdf`: sentetik, kısa karşılaştırma belgesi.
- `output/pdf/official/2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf`: resmî 2026 TEKNOFEST şartnamesi.
- `output/pdf/official/2026_Insansiz_Deniz_Araci_Sartnamesi.pdf`: resmî 2026 TEKNOFEST şartnamesi.
- `output/pdf/official/2026_Insansiz_Su_Alti_Sistemleri_Sartnamesi.pdf`: resmî 2026 TEKNOFEST şartnamesi.

Belgelerin tümü uygulamadaki “Hazır test belgeleri” bölümünden seçilebilir. Resmî PDF'ler değiştirilmeden yerel test kütüphanesine alınmıştır. Görevli, “Görevli belge havuzu” panelinden kendi şartname/kılavuz/ek kriter dokümanlarını da ekleyebilir, görüntüleyebilir, analiz için seçebilir ve silebilir; bu belgeler tarayıcı deposunda saklanır.

## Ana dosyalar

- `app/components/criteria-app.tsx`: dört adımlı yönetici akışı
- `app/components/evaluation-app.tsx`: Değerlendirme Atölyesi (rapor havuzu, hakem incelemesi, yarışmacı görünümü)
- `app/lib/report-prechecks.ts`: dosya kapısı, dil, şablon/başlık ve benzerlik kesin kontrolleri
- `app/lib/report-pool.ts`: cihaz içi rapor havuzu deposu
- `app/lib/report-evaluator.ts` + `app/lib/demo-report-evaluator.ts`: analiz motoru istemcisi ve çevrimdışı yedek
- `app/api/evaluate-report/route.ts`: AI rapor analiz motoru uç nokta iskeleti (sözleşme: `docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md`)
- `app/components/competition-select.tsx`: arama destekli yarışma seçici
- `app/components/template-preview.tsx`: sağ panel canlı şablon önizlemesi
- `app/components/document-library-panel.tsx`: görevli belge havuzu yönetimi
- `app/components/file-badge.tsx`: dosya türüne göre renkli ikon
- `app/lib/competitions.ts`: kayıtlı yarışma listesi ve filtreleme
- `app/lib/evaluation-summary.ts`: 100'e normalizasyon ve geçiş/baraj/ceza/eleme kural çıkarımı
- `app/lib/document-library.ts`: tarayıcı içi belge havuzu deposu
- `app/lib/usage-metrics.ts` + `app/api/metrics/route.ts`: API kullanım sayaçları
- `app/api/analyze/route.ts`: güvenli Gemini çağrısı, yapılandırılmış çıktı, önbellek ve yönetici kuralı birleştirme
- `app/lib/gemini-analyzer.ts`: tarayıcıdan sunucu analiz uç noktasına bağlantı
- `app/lib/pdf-reader.ts`: tarayıcı içi PDF doğrulama ve sayfa sayısı
- `app/lib/draft-store.ts`: adımlar arası ve sayfa yenileme sonrası taslak kalıcılığı
- `app/lib/demo-analyzer.ts`: çevrimdışı karşılaştırma sağlayıcısı
- `app/lib/types.ts`: kriter ve profil veri modeli
- `tools/create_sample_pdf.py`: sentetik PDF üreticisi
- `DESIGN.md`: arayüz tasarım sistemi
- `PRODUCT.md`: ürün kapsamı ve değişmez ilkeler

## Karşılaştırma testi

`docs/benchmarks/celikkubbe-expected.json`, Çelikkubbe şartnamesi için PDF'den elle doğrulanmış beklenen puan planı ve kritik bulguları içerir. Yerel uygulama çalışırken aşağıdaki komut gerçek Gemini çıktısını bu referansla karşılaştırır:

```bash
node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze
```

Sonuç `output/benchmarks/celikkubbe-latest.json` dosyasına yazılır.
