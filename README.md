# Kriter Atölyesi

TEKNOFEST benzeri yarışmalarda organizatörün yüklediği şartname PDF'sini; kaynakları gösterilen, düzenlenebilir ve yayımlanabilir bir kriter profiline dönüştüren ve katılımcı raporlarını bu profile göre dört aşamada kontrol eden değerlendirme sistemidir. Sistem puan üretmez; her kural için **BAŞARILI / REVİZYON / KRİTİK HATA** sonucu, rapordan sayfa/paragraf numaralı alıntı ve gerekçe verir. Nihai karar her zaman hakemdedir.

## Rol bazlı yönetici girişi

Uygulama `http://localhost:3000` adresinde **tek bir giriş formuyla** açılır: kullanıcı adı (veya e-posta) ve şifre. **Giriş sırasında rol seçilmez.** Sistem hesabı Cloudflare D1'den doğrular ve hesabın rolüne göre doğru paneli otomatik açar. Parolalar açık metin saklanmaz; PBKDF2-SHA256 ile özetlenir. Şifresiz rol kısayolları kaldırılmıştır.

Sistemde hiç Admin yokken, üretim DIŞI ortamda giriş ekranında **“Kurulum Admini oluştur”** düğmesi görünür ve `admin` / `1234` hesabını **bir kez** açar. Bu hesap yalnızca geliştirme ve demo içindir; ikinci kez çalıştırıldığında ikinci bir Admin üretmez ve üretimde uç 404 döner.

- **00 · Genel Yönetici / Admin:** yalnızca yönetici ataması yapar. Personel hesabı açar, rol atar/kaldırır ve atama geçmişini izler. Kriter, değerlendirme, operasyon ve başvuru uçlarına erişmez; hakem atayamaz.
- **01 · Yarışma Yöneticisi:** `/kriter-atolyesi` üzerinden şartname PDF'sini analiz eder, kriterleri düzenler ve değerlendirme profilini yayımlar.
- **02 · Hakem:** `/degerlendirme` üzerinden kriteri çıkarılmış yarışmayı ve kendisine atanmış başvuruyu seçer, **Yapay Zekâ Analizi Yap** ile kriterleri PDF'e karşı kontrol ettirir (benzerlik karşılaştırması aynı akışta paralel çalışır), her kriter için ayrı **Onay/Ret** kararı verir ve bütün kriterler bitince nihai **ONAY / RET** kararını kesinleştirir; RET açıklaması reddedilen kriterlerden deterministik şablonla üretilip yarışmacıya iletilir.
- **03 · Yarışmacı:** hesap oluşturur, yarışmayı seçer, PDF raporunu gönderir ve yalnızca hakem onaylı sonucunu görür.
- **04 · Değerlendirme Yöneticisi:** hakem yüklerini ve hata kuyruğunu izler; yeniden atama, hatırlatma, analizi yeniden sıraya alma, yarışmayı aktif/pasif yapma ve sonuç yayın akışını yönetir. Arşivleme kayıtlarını (kim, ne zaman, neden) yalnızca **görüntüler**. Kriter değiştiremez, rapor değerlendiremez, nihai karar veremez.

Başvuru alındığı anda **sistem** dosyayı uygun hakemler arasından en az açık dosyası olana otomatik atar (mümkünse aynı yarışmada görevli hakeme); eşit yükte sıra deterministiktir. Değerlendirme Yöneticisi gerektiğinde yeniden atar ve atama geçmişi korunur.

Yetki matrisi tek kaynaktan okunur: `app/lib/authorization.ts`. Her API ucu bu matristeki bir izne bağlıdır; 00 rolü yalnızca `manage_accounts` iznine sahiptir. **03 · Yarışmacı** yönetici rolü değildir ve yönetici hesap ekranından atanmaz; yarışmacı giriş ekranından kendi hesabını oluşturur. Hem sayfalar hem de ücretli analiz uçları sunucu oturumuna ve role göre korunur.

## Kriter Atölyesi (`/kriter-atolyesi`)

Şartname analizi **dört aşamalı kontrol prensibine** göre çalışır. Her kriter bu aşamalardan birine bağlanır; aynı dört aşama rapor değerlendirmesinde de kullanılır:

| # | Aşama | Kontrol |
|---|---|---|
| 1 | Dil ve Şablon Uygunluğu | Tespit edilen dil ve şablon/biçim uyumu (sayfa sınırı, punto, kenar boşluğu, kapak, dosya adı/türü). |
| 2 | Başlık ve İçerik Kontrolü | Zorunlu başlıkların raporda varlığı ve altındaki içeriğin doluluğu. |
| 3 | Kategori Uygunluğu ve Benzerlik | Kategoriye uygunluk skoru ve başvurular arası benzerlik durumu. |
| 4 | Kriter Bazlı Kanıt Çıkarma | Her teknik kural için BAŞARILI / REVİZYON / KRİTİK HATA, rapordan sayfa/paragraf numaralı alıntı ve gerekçe. |

Bu sürümde çalışan akış:

1. Yarışma Yöneticisi şartname PDF'sini yükler; isterse ayrı resmî rapor şablonu ekler. Ayrı bir ayar formu doldurmaz.
2. PDF sunucu üzerinden **tek bir model çağrısıyla** bütünüyle okunur. Yarışma, kategori, aşama, rapor türü, beklenen dil ve katılımcı teslim sınırları da yalnızca bu belgeden çıkarılır. Sayfa aralığı, ikinci denetim turu veya puan planı çıkarımı yoktur.
3. Şablon verildiyse zorunlu başlıklar ve biçim notları ondan alınır; şablondan yeni yarışma kuralı üretilmez.
4. **Puanlama sistemleri kriter sistemine dahil değildir.** Puan tabloları, ağırlıklar, cezalar, barajlar ve saha/fiziksel aşama maddeleri yarışmanın fiziksel aşamasına ait olduğu için kriter yapılmaz; yalnızca PDF (rapor) aşamasında kontrol edilebilen kurallar çıkarılır. Dışarıda bırakılan madde sayısı uyarı olarak gösterilir.
5. Her kriter ad, aşama, **Zorunlu / Diğer** ayrımı, tek anlamlı açıklama, belgede yazan ihlal sonucu, kaynak sayfa ve özgün dilde birebir alıntıyla listelenir. Güven seviyesi, "emin değilim" durumu, soluk gösterim veya karar bekleyen kuyruk yoktur.
6. PDF'de bulunmayan format, boyut, dosya adedi, zorunluluk veya ihlal sonucu için sistem varsayım üretmez.
7. Yönetici kriterleri düzenleyebilir, yenisini ekleyebilir, pasifleştirebilir veya silebilir. Kriter bölümü dışındaki bölümler (sabit ön kontroller, şablon önizleme, puan yapısı, AI notları) ekrandan kaldırılmıştır.
8. Yarışma Yöneticisi kaynakları doğruladıktan sonra profili doğrudan yayımlar. Profil sürümü **2.0**'dır; eski 1.0 (puanlı) profiller okunurken 2.0'a yükseltilir. Hakem kriter oluşturma veya yayımlama aşamasına katılmaz.

Seçilen kaynak PDF, analiz taslağı ve henüz yayımlanmamış kriter düzenlemeleri görevlinin tarayıcısında saklanır. Yönetici önceki adımlara dönebilir veya sayfayı yenileyebilir; yalnızca yeni bir belge seçmesi ya da "Taslağı sıfırla" işlemi taslağı temizler. Yayımlanan profil D1'e yazılır.

## Değerlendirme Atölyesi (`/degerlendirme`)

Yayımlı profil, ikinci modülde katılımcı raporlarına aynı dört aşamayla uygulanır:

1. **Giriş:** Hakem ilk girişte **Değerlendirme Atölyesi** ya da **Geçmiş değerlendirmeler** seçer.
2. **Yarışma → başvuru:** Atölyede kriteri çıkarılmış (yayımlı profili olan) bütün yarışmalar listelenir; seçilen yarışmanın hakeme atanmış başvuruları kutucuk hâlinde görünür. Başvuru D1'de, değiştirilmeyen PDF özel R2 deposundadır; yükleme analiz başlatmaz, ilk atamayı Değerlendirme Yöneticisi (04) yapar.
3. **Yapay Zeka Analizi:** Başvuru açılınca tek düğme vardır. Analiz, yayımlı kriterlerin her birinin rapor PDF'i ile karşılaştırılmasıdır: uygun kriter ✓, hatalı kriter için hata sebebi, rapordan alıntı ve **Kaynağa git** düğmesi (PDF'nin ilgili sayfası). Dört aşama (dil/şablon, başlık/içerik, kategori/benzerlik, teknik kural) tek şerit hâlinde özetlenir; puan yoktur. Benzerlik yalnızca işarettir.
4. **Kriter kararları + nihai ONAY / RET:** Her kriter kartında AI'nin değiştirilemez ön değerlendirmesi (Uygun/Olumsuz) görünür; hakem her kriter için ayrı **Onay** veya **Ret** verir (Ret; gerekçe + PDF konumu ya da "Raporda bulunamadı" dayanağı ister). Bütün kriterler sonuçlanmadan genel karar bölümü açılmaz; sistem öneri üretmez. Nihai **RET** açıklaması reddedilen kriterlerden deterministik şablonla üretilir; ekstra analiz yapılmaz. Tamamlanan kararlar **Geçmiş değerlendirmeler**'de durur ve gerekirse sunucu taraflı "Kararı yeniden aç" ile açılır; hakem isterse **AI analizini sil** ile analizi kaldırıp yeniden çalıştırabilir.
5. **Yarışmacı sonucu:** Portalda ONAY/RET, hakem açıklaması ve iki bölüm görünür: **Güçlü Yönler** (hakemin onayladığı kriterler) ve **Gelişime Açık Yönler** (hakemin reddettiği kriterler; gerekçe + varsa sayfa/alıntı).

Rapor analizi `app/api/evaluate-report/route.ts` üzerinden çalışır; veri sözleşmesi `docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md` dosyasındadır. API anahtarı kullanılamazsa sistem deterministik kontrollerle (dosya kapısı, benzerlik) çevrimdışı sonuca düşer; kural kararı uydurmaz.

## Gemini yapılandırması

Gerçek sağlayıcı sunucu tarafındaki `app/api/analyze/route.ts` uç noktasıdır. API anahtarı yalnızca `.env.local` içinde tutulur; tarayıcı koduna ve Git'e dahil edilmez. PDF işlemede `gemini-3-flash-preview` birincil, yoğunluk veya zaman aşımında `gemini-3.1-flash-lite` yedek modeldir; isteğe bağlı üçüncü kademe ve yeniden deneme bütçesi `.env.example` içinde açıklanmıştır. Belge **tek üretim çağrısı** ile işlenir; 512 KB üstü PDF'ler bir kez Files API'ye yüklenip URI ile verilir, küçük belgeler satır içi gönderilir (`diagnostics.documentDelivery`).

Yerel ortam değişkenleri `.env.example` örneğine göre tanımlanır. Organizatör kaynak PDF'si için teknik analiz sınırı 18 MB, katılımcı raporu için 50 MB'dir. Bu değerler yarışma kuralı değildir; katılımcı teslim sınırı yalnızca organizatör PDF'sinden gelir.

Analiz tek bir örnek PDF'ye bağlı değildir; belge her yüklemede yeniden okunur ve dört aşamalı şemaya göre çıkarılır. Şema, talimat ve normalizasyon `app/lib/criteria-extraction.ts` içindedir; ayrıntılı mimari `docs/GENEL_BELGE_ANALIZ_MIMARISI.md`, veri sözleşmesi `docs/AI_API_ENTEGRASYON_SOZLESMESI.md` dosyasındadır.

Aynı belge aynı talimat sürümüyle yeniden analiz edilirse model tekrar çağrılmaz: sonuç önce süreç belleğinden, yoksa D1'deki kalıcı analiz kaydından (`criteria_analysis_cache`) 0 token ile döner ve sunucu yeniden başlasa bile korunur (bkz. `docs/KALICI_ANALIZ_ONBELLEGI.md`). Analiz ucunda geçici istek ve eşzamanlılık sınırı vardır; üretimde kullanıcı/kurum kotasıyla tamamlanmalıdır. Her analiz için süre ve token kullanımı `diagnostics` alanında döner. Yerel geliştirmede oturum toplamları `GET /api/metrics` ucundan okunabilir; üretimde bu uç varsayılan olarak kapalıdır. Kullanıcı arayüzünde model/sağlayıcı adı gösterilmez.

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

Belgelerin tümü uygulamadaki "Hazır test belgeleri" bölümünden seçilebilir. Resmî PDF'ler değiştirilmeden yerel test kütüphanesine alınmıştır. Görevli, "Görevli belge havuzu" panelinden kendi şartname/kılavuz/ek dokümanlarını da ekleyebilir, görüntüleyebilir, analiz için seçebilir ve silebilir; bu belgeler tarayıcı deposunda saklanır.

## Ana dosyalar

- `app/components/management-app.tsx`: rol bazlı giriş ve yönetim paneli kabuğu
- `app/components/admin-accounts-panel.tsx`: 00 için hesap açma, rol atama/kaldırma ve atama geçmişi
- `app/components/criteria-app.tsx`: üç adımlı, PDF merkezli Kriter Atölyesi (Zorunlu / Diğer kriter listesi, kaynak sayfa, manuel düzenleme)
- `app/components/evaluation-app.tsx`: Değerlendirme Atölyesi (giriş seçimi, yarışma → başvuru kutuları, Yapay Zekâ Analizi + paralel benzerlik, kriter bazlı Onay/Ret kararları, nihai ONAY/RET, AI analizini silme, geçmiş)
- `app/components/participant-portal.tsx`: yarışma arama, PDF başvurusu ve yarışmacı sonuç takibi
- `app/components/manager-profile-history.tsx`: geçmiş kriter ayıklamaları ve yayımlanan profiller
- `app/components/operations-panel.tsx`: 04 için ilk hakem ataması, hakem yükü, yeniden atama, hata kuyruğu ve yarışma aşaması yönetimi
- `app/components/document-library-modal.tsx`: görevli belge havuzu (modal)
- `app/components/file-badge.tsx`: dosya türüne göre renkli ikon
- `app/lib/types.ts`: dört aşama, kural durumu, kriter, profil (2.0) ve rapor değerlendirme veri modeli
- `app/lib/criteria-extraction.ts`: tek çağrılık çıkarım şeması, sistem talimatı ve normalizasyon
- `app/lib/profile-loader.ts`: profil JSON doğrulama; 1.0 profilleri 2.0'a yükseltir
- `app/lib/authorization.ts`: yetki matrisi (tek doğruluk kaynağı)
- `app/lib/admin-roles.ts`: rol katalogu ve süreç olayı etiketleri
- `app/lib/workflow-db.ts`: yayımlı profiller, kriterler ve başvurular için D1/R2 veri katmanı
- `app/api/analyze/route.ts`: güvenli Gemini çağrısı, PDF'den tek çağrıyla profil/kriter çıkarımı, yapılandırılmış çıktı ve kalıcı analiz önbelleği (`docs/KALICI_ANALIZ_ONBELLEGI.md`)
- `app/api/evaluate-report/route.ts`: dört aşamalı rapor değerlendirme motoru (sözleşme: `docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md`)
- `app/api/applications/*`: başvuru, dosya erişimi ve hakem durum güncellemeleri
- `app/api/profiles/route.ts`: yayımlı kriter profillerini yazma ve okuma
- `app/api/extractions/route.ts`: kriter ayıklama geçmişini yetkiye göre okuma
- `app/lib/gemini-analyzer.ts`: tarayıcıdan sunucu analiz uç noktasına bağlantı
- `app/lib/report-prechecks.ts`: dosya kapısı ve deterministik ön kontroller
- `app/lib/report-pool.ts`: cihaz içi rapor havuzu deposu
- `app/lib/report-evaluator.ts` + `app/lib/demo-report-evaluator.ts`: analiz motoru istemcisi ve çevrimdışı yedek
- `app/lib/similarity-engine.ts`: MinHash tabanlı benzerlik izi
- `app/lib/competitions.ts`: kayıtlı yarışma listesi ve filtreleme
- `app/lib/document-library.ts`: tarayıcı içi belge havuzu deposu
- `app/lib/pdf-reader.ts`: tarayıcı içi PDF doğrulama ve sayfa sayısı
- `app/lib/draft-store.ts`: adımlar arası ve sayfa yenileme sonrası taslak kalıcılığı
- `app/lib/usage-metrics.ts` + `app/api/metrics/route.ts`: API kullanım sayaçları
- `app/globals.css` + `app/evaluation.css`: tasarım sistemi ve değerlendirme ekranı stilleri
- `migrations/0001_admin.sql` … `0005_final_workflow.sql`: D1 şema geçmişi (5 göç)
- `tools/create_sample_pdf.py`: sentetik PDF üreticisi
- `DESIGN.md`: arayüz tasarım sistemi
- `PRODUCT.md`: ürün kapsamı ve değişmez ilkeler
- `PROJE_DURUMU.md`: güncel durum, ölçüm sonuçları ve eksik iş listesi
- `NIHAI_SISTEM_AKISI.md`: roller, akış ve veritabanı mimarisi

## Karşılaştırma testi

`docs/benchmarks/celikkubbe-expected.json`, Çelikkubbe şartnamesi için PDF'den elle doğrulanmış beklenen **kural kapsamını** içerir: raporda kontrol edilmesi gereken kuralların anahtar sözcükleri, aşaması ve zorunluluğu. Puan planı, puan grubu veya toplam beklentisi yoktur. Test ayrıca çıkarılan kriter setinde **yasaklı ifadelerin** (puan, ağırlık, ceza, baraj, güven seviyesi, saha görevi) bulunmadığını doğrular. Yerel uygulama çalışırken aşağıdaki komut gerçek Gemini çıktısını bu referansla karşılaştırır:

```bash
node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze
```

Sonuç `output/benchmarks/celikkubbe-latest.json` dosyasına yazılır. Test; her beklenen kuralı tek bir gerçek kriterle eşleştirir, aynı kriteri iki ayrı kural yerine kullanmaz ve kapsam ile yasaklı ifade eşikleri karşılanmazsa başarısız durum kodu döndürür.

Hızlı regresyon kontrolleri (canlı model çağrısı yapmaz):

```bash
npm test                    # depo güvenliği + birim testleri + regresyon testleri
npm run test:unit           # şema, normalizasyon ve profil yükseltme birim testleri
npm run test:regressions    # istek koruması (hız/eşzamanlılık) regresyonları
```

Canlı bir benchmark koşusundan sonra `npm run test:benchmark:celikkubbe`, son çıktıyı model çağırmadan yeniden ölçer (`--reuse`).
