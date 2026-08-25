# Kriter Atölyesi

TEKNOFEST benzeri yarışmalarda organizatörün yüklediği değerlendirme PDF'sini; kaynakları gösterilen, düzenlenebilir ve onaylanabilir bir kriter profiline dönüştüren ilk modül prototipidir.

## Rol bazlı yönetici girişi

Uygulama `http://localhost:3000` adresinde yönetici giriş ekranıyla açılır. Yönetici hesapları ve oturumları Cloudflare D1 içinde saklanır; gerçek giriş e-posta ve PBKDF2 ile özetlenmiş parola üzerinden yapılır. Yerel geliştirmede `ALLOW_DEV_LOGIN=on` olduğunda dört şifresiz rol kısayolu görünür; bu kısayollar `APP_ENV=production` ortamında sunucu tarafından kapatılır.

- **00 · Baş Yönetici:** yönetici hesaplarını, rolleri ve işlem geçmişini yönetir; iki çalışma alanını da denetler.
- **01 · Yarışma Yöneticisi:** `/kriter-atolyesi` üzerinden resmî PDF'yi analiz eder ve değerlendirme profilini kesinleştirir.
- **02 · Hakem / Değerlendirici:** `/degerlendirme` üzerinden AI bulgularını inceler ve nihai uzman kararını verir.
- **03 · Yarışmacı:** hesap oluşturur, yarışmayı seçer, PDF raporunu gönderir ve yalnızca hakem onaylı sonucunu görür.
- **04 · Değerlendirme Yöneticisi:** hakem yüklerini ve hata kuyruğunu izler; yeniden atama, hatırlatma, analizi yeniden sıraya alma, süreç kilitleme ve sonuç yayınını yönetir. Rapor puanlayamaz veya nihai karar veremez.

Problem 4'teki **03 · Yarışmacı** yönetici rolü değildir ve yönetici hesap ekranından atanmaz. Yarışmacı giriş ekranından kendi hesabını oluşturur. Hem sayfalar hem de ücretli analiz uçları sunucu oturumuna ve role göre korunur.

## Bu sürümde çalışan akış

1. Görevli organizatörün kriter/şartname PDF'sini yükler; isterse ayrı resmî rapor şablonu ekler. Ayrı bir temel ayar formu doldurmaz.
2. PDF, tablo ve sayfa yapısı korunarak sunucu üzerinden Gemini'ye gönderilir. Yarışma, kategori, aşama, rapor türü ve katılımcı teslim sınırları da yalnızca bu belgeden çıkarılır. Uzun şartnamelerde ilk çıkarımdan sonra bağımsız bir eksik-kural denetimi daha çalışır.
3. PDF'de bulunmayan format, boyut, dosya adedi veya ihlal sonucu için sistem varsayım üretmez.
4. İlan edilen puan toplamı ve birbirini örtmeyen puan grupları ayrıca çıkarılır; grup toplamı ile PDF toplamı otomatik karşılaştırılır.
5. Kriter adı, kapsam/aşama, etki türü, puanı, zorunluluğu, ihlal sonucu, kaynak sayfası, ilgili metin ve sistem önerisi yöneticiye gösterilir. Değerlendirme yöntemi AI tarafından belirlenen teknik bir alan olarak saklanır; yarışma yöneticisine gereksiz bir seçim olarak gösterilmez.
6. Fiziksel güvenlik ve hakem uygunluğu maddelerinde sistem nihai karar vermez; bulgu üretir ve insan onayı ister.
7. Yönetici kriterleri düzenleyebilir, yenisini ekleyebilir veya istemediği herhangi bir kriteri onaylı bir silme akışıyla kaldırabilir. Listede aktif/pasif anahtarı yoktur: analiz çıktısı olduğu gibi durur, istenmeyen kriter silinir. Kriterin PDF puanına girip girmeyeceği kapsam sınıfından türer (rapor/dosya kapsamı puana girer; fiziksel, haricî ve bilgi notu maddeleri kaynak olarak korunur). Yayım, kriter sayısını ve puan ölçeğini özetleyen bir "emin misiniz?" penceresiyle ikinci kez doğrulanır. Ayrı karar kuralı özeti kaldırılmıştır; bütün kurallar tek kriter listesinde kaynaklarıyla incelenir. Sonuçlar, PDF'de ilan edilen resmî puan ölçeğiyle gösterilir; sistem kendiliğinden 100'lük ölçeğe dönüştürmez.
8. Çok aşamalı şartnamelerde (rapor + saha görevleri aynı belgede) yönetici, hangi puan gruplarının bu profilde değerlendirileceğini seçer. Örneğin İnsansız Deniz Aracı şartnamesi 315 puan ilan eder, ancak yalnızca "Rapor Puanlaması" kapsama alınırsa değerlendirme resmî 15 puanlık grup üzerinden yapılır. Belgede ilan edilen genel toplam profilde ayrıca korunur.
9. Yarışma Yöneticisi kaynakları ve AI yorumlarını doğruladıktan sonra profili doğrudan yayımlar. Hakem kriter oluşturma veya profil yayımlama aşamasına katılmaz. Ayrı aşamalara ait puanlar bulunan şartnamelerde toplamın 100 olması zorunlu tutulmaz.

Seçilen kaynak PDF, analiz taslağı ve henüz onaylanmamış kriter düzenlemeleri görevlinin tarayıcısında saklanır. Yönetici önceki adımlara dönebilir veya sayfayı yenileyebilir; yalnızca yeni bir belge seçmesi ya da “Taslağı sıfırla” işlemi taslağı temizler. Onaylanan profil D1'e yayınlanır. Yarışmacı başvuruları D1'de, PDF dosyaları özel R2 deposunda saklanır ve roller arasında aynı kayıt üzerinden taşınır.

## Değerlendirme Atölyesi (`/degerlendirme`)

Onaylı profil, ikinci modülde katılımcı raporlarına uygulanır:

1. **Başvuru havuzu:** Yarışmacı başvuru sahibi adı, takım adı ve ekip üyeleriyle birlikte yarışmayı seçip PDF'yi gönderir. Bu işlem analiz başlatmaz. Başvuru D1'e, değiştirilmeyen PDF özel R2 deposuna kaydedilir ve hakem havuzuna otomatik düşer.
2. **Hakem incelemesi:** Yarışmacı başvurusu doğrudan hakem paneline düşer. Hakem önce yarışmayı, sonra bekleyen takımı seçer; AI analizi yalnızca hakemin “AI analizini başlat” eylemiyle ve yalnızca Yarışma Yöneticisinin yayımladığı kriterlerle çalışır. Analizi başlatan hakem dosyayı üstlenir. Her kriter için üretilen bulgu, kanıtı ve şartnamedeki dayanağıyla gösterilir; ayrıca zorunlu koşullardan hangilerinin karşılanmadığını gerekçesiyle listeleyen bir **uygunluk önerisi** üretilir. Hakem başvuruyu onaylar veya reddeder — ret gerekçesi AI taslağı olarak gelir, hakem onu değiştirebilir. Karar kesinleşince yarışmacıya e-posta gider; ret gerekçesi yarışmacının “Başvurularım” ekranında da görünür. Kabul kararında insan kararı gerektiren maddeler karara bağlanmadan inceleme tamamlanamaz.
3. **Yarışmacı sonucu:** Başvurular yarışmacıya “Gönderildi” veya “İnceleme sonucu” aşamasında gösterilir. Tamamlanan kayıtta kabul, ret ya da düzeltme gerektiren sonuç ile hakem açıklaması görünür; güçlü yönler, gelişim alanları ve öneriler hakem onayı olmadan yayımlanmaz.

Anlamsal kriter analizi (AI puan önerisi, kategori uygunluğu) `app/api/evaluate-report/route.ts` üzerinden çalışır; veri sözleşmesi `docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md` dosyasındadır. API anahtarı kullanılamazsa sistem kesin kontrollerle çevrimdışı sonuca düşer ve anlamsal kriterleri açıkça "insan kararı bekliyor" olarak işaretler; puan uydurmaz.

## Gemini yapılandırması

Gerçek sağlayıcı sunucu tarafındaki `app/api/analyze/route.ts` uç noktasıdır. API anahtarı yalnızca `.env.local` içinde tutulur; tarayıcı koduna ve Git'e dahil edilmez. PDF işlemede daha güçlü `gemini-3-flash-preview` birincil, yoğunluk veya zaman aşımında `gemini-3.1-flash-lite` yedek modeldir. Normal şartnameler Files API'ye bir kez yüklenir ve paralel analiz çağrıları aynı güvenli dosya URI'sini kullanır.

Yerel ortam değişkenleri `.env.example` örneğine göre tanımlanır. Organizatör kaynak PDF'si için teknik analiz sınırı 18 MB, katılımcı raporu için 50 MB'dir. Bu değerler yarışma kuralı değildir; katılımcı teslim sınırı yalnızca organizatör PDF'sinden gelir. `app/lib/demo-analyzer.ts` çevrimdışı geliştirme ve karşılaştırma için korunmuştur; normal arayüz akışında kullanılmaz.

Analiz tek bir örnek PDF'ye bağlı değildir. Kısa belgeler bütünsel, uzun belgeler 2–4 paralel sayfa aralığında işlenir; bölüm haritası, tipli kriterler ve puan planı çıkarılır. Ardından her kriterin koşulu, sayısı, kapsamı, sonucu ve birebir alıntısı PDF'ye karşı ikinci kez doğrulanır; ilk geçişte atlanan açık kurallar ayrıca işaretlenir. Ayrıntılı mimari `docs/GENEL_BELGE_ANALIZ_MIMARISI.md` dosyasındadır. Kanıt turu üretimde açık tutulmalıdır; yalnızca kontrollü karşılaştırma için `EVIDENCE_VERIFICATION=off` kullanılabilir.

Aynı belge, aynı analiz talimatı ve sayfa bağlamıyla yeniden analiz edilirse sunucu içi önbellek (SHA-256 hash) sayesinde model tekrar çağrılmaz. Analiz ucunda geçici istek ve eşzamanlılık sınırı vardır; hesap modülü bağlandığında bunun kullanıcı/kurum kotasıyla tamamlanması gerekir. Her analiz için süre ve token kullanımı `diagnostics` alanında döner. Yerel geliştirmede oturum toplamları `GET /api/metrics` ucundan okunabilir; üretimde bu uç varsayılan olarak kapalıdır. Resmî kota takibi Google AI Studio üzerinden yapılır. Kullanıcı arayüzünde model/sağlayıcı adı gösterilmez.

## Yerel çalıştırma

```bash
npm install --legacy-peer-deps
cp .env.example .env.local   # GEMINI_API_KEY satırını kendi anahtarınızla doldurun
npm run dev
```

Uygulama varsayılan olarak `http://localhost:3000` adresindeki giriş panelinde açılır. Kriter
Atölyesi `/kriter-atolyesi`, Değerlendirme Atölyesi `/degerlendirme` adresindedir.

`--legacy-peer-deps` React sürümü uyumluluğu için zorunludur ve `.env.local` git'e girmediği
için her makinede ayrıca oluşturulmalıdır. Ayrıntılı kurulum, ilk deneme akışı,
verilerin nerede saklandığı ve sorun giderme için **[GUIDE.md](GUIDE.md)** dosyasına bakın.

## Test belgeleri

- `output/pdf/Ornek_Akilli_Ulasim_OTR_Degerlendirme_Kilavuzu.pdf`: sentetik, kısa karşılaştırma belgesi.
- `output/pdf/official/2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf`: resmî 2026 TEKNOFEST şartnamesi.
- `output/pdf/official/2026_Insansiz_Deniz_Araci_Sartnamesi.pdf`: resmî 2026 TEKNOFEST şartnamesi.
- `output/pdf/official/2026_Insansiz_Su_Alti_Sistemleri_Sartnamesi.pdf`: resmî 2026 TEKNOFEST şartnamesi.

Belgelerin tümü uygulamadaki “Hazır test belgeleri” bölümünden seçilebilir. Resmî PDF'ler değiştirilmeden yerel test kütüphanesine alınmıştır. Görevli, “Görevli belge havuzu” panelinden kendi şartname/kılavuz/ek kriter dokümanlarını da ekleyebilir, görüntüleyebilir, analiz için seçebilir ve silebilir; bu belgeler tarayıcı deposunda saklanır.

## Ana dosyalar

- `app/components/criteria-app.tsx`: üç adımlı, PDF merkezli yönetici akışı
- `app/components/evaluation-app.tsx`: Değerlendirme Atölyesi (rapor havuzu, hakem incelemesi, yarışmacı görünümü)
- `app/components/participant-portal.tsx`: yarışma arama, PDF başvurusu ve yarışmacı sonuç takibi
- `app/components/manager-profile-history.tsx`: geçmiş kriter ayıklamaları ve onaylanan projeler
- `app/components/operations-panel.tsx`: 00/04 için hakem yükü, yeniden atama, hata kuyruğu ve yarışma aşaması yönetimi
- `app/lib/workflow-db.ts`: yayınlı profiller ve başvurular için D1/R2 veri katmanı
- `app/api/applications/*`: başvuru, dosya erişimi ve hakem durum güncellemeleri
- `app/api/profiles/route.ts`: onaylı kriter profillerini yayınlama ve okuma
- `app/api/extractions/route.ts`: kriter ayıklama geçmişini yetkiye göre okuma
- `app/lib/report-prechecks.ts`: dosya kapısı, dil, şablon/başlık ve benzerlik kesin kontrolleri
- `app/lib/report-pool.ts`: cihaz içi rapor havuzu deposu
- `app/lib/report-evaluator.ts` + `app/lib/demo-report-evaluator.ts`: analiz motoru istemcisi ve çevrimdışı yedek
- `app/api/evaluate-report/route.ts`: AI rapor analiz motoru uç nokta iskeleti (sözleşme: `docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md`)
- `app/components/template-preview.tsx`: PDF'den çıkarılan profil özetinin açılır önizlemesi
- `app/components/document-library-panel.tsx`: görevli belge havuzu yönetimi
- `app/components/file-badge.tsx`: dosya türüne göre renkli ikon
- `app/lib/competitions.ts`: kayıtlı yarışma listesi ve filtreleme
- `app/lib/evaluation-summary.ts`: geçiş/baraj/ceza/eleme kural çıkarımı ve eski profil uyumluluğu
- `app/lib/document-library.ts`: tarayıcı içi belge havuzu deposu
- `app/lib/usage-metrics.ts` + `app/api/metrics/route.ts`: API kullanım sayaçları
- `app/api/analyze/route.ts`: güvenli Gemini çağrısı, PDF'den profil/kriter çıkarımı, yapılandırılmış çıktı ve önbellek
- `app/lib/gemini-analyzer.ts`: tarayıcıdan sunucu analiz uç noktasına bağlantı
- `app/lib/pdf-reader.ts`: tarayıcı içi PDF doğrulama ve sayfa sayısı
- `app/lib/draft-store.ts`: adımlar arası ve sayfa yenileme sonrası taslak kalıcılığı
- `app/lib/demo-analyzer.ts`: çevrimdışı karşılaştırma sağlayıcısı
- `app/lib/types.ts`: kriter ve profil veri modeli
- `migrations/0001_admin.sql` … `0005_final_workflow.sql`: D1 şema geçmişi (5 göç)
- `tools/create_sample_pdf.py`: sentetik PDF üreticisi
- `DESIGN.md`: arayüz tasarım sistemi
- `PRODUCT.md`: ürün kapsamı ve değişmez ilkeler
- `PROJE_DURUMU.md`: güncel durum, ölçüm sonuçları ve eksik iş listesi
- `NIHAI_SISTEM_AKISI.md`: roller, akış ve veritabanı mimarisi

## Karşılaştırma testi

`docs/benchmarks/celikkubbe-expected.json`, Çelikkubbe şartnamesi için PDF'den elle doğrulanmış beklenen puan planı ve kritik bulguları içerir. Yerel uygulama çalışırken aşağıdaki komut gerçek Gemini çıktısını bu referansla karşılaştırır:

```bash
node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze
```

Sonuç `output/benchmarks/celikkubbe-latest.json` dosyasına yazılır.
Test; her beklenen bulgunun anahtarlarını aynı kriter kaydında arar, tek kriteri iki ayrı kural yerine kullanmaz ve bütün eşikler karşılanmazsa başarısız durum kodu döndürür.

Hızlı regresyon kontrolleri:

```bash
npm test
npm run test:quality:saved
npm run test:benchmark:celikkubbe
```

`test:quality:saved`, kayıtlı eski model çıktılarını güncel cevap anahtarıyla karşılaştırır. Mevcut İDA kaydı, görev/komut ihlali ile etik davranış cezalarını atladığı için bilinçli olarak başarısızdır; yeni ve döndürülmüş bir API anahtarıyla `node tools/run_quality_test.mjs` çalıştırıldığında çıktı yalnızca bütün beklentiler geçerse yenilenir.
