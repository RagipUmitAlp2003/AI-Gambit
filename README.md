# Kriter Atölyesi

TEKNOFEST benzeri yarışmalarda organizatörün yüklediği şartname PDF'sini; kaynakları gösterilen, düzenlenebilir ve yayımlanabilir bir kriter profiline dönüştüren ve katılımcı raporlarını bu profile göre dört aşamada kontrol eden değerlendirme sistemidir. Sistem puan üretmez; her kural için **BAŞARILI / REVİZYON / KRİTİK HATA** sonucu, rapordan sayfa/paragraf numaralı alıntı ve gerekçe verir. Nihai karar her zaman hakemdedir.

**Güncel dal:** `furkan_faruk_v1_bugfixing` (4 Eylül 2026). Bu dal, `entegrasyon/umit-umut-2026-09-03` üzerine benzerlik filtresi, hakem ekranı ve kayıt güvenilirliği düzeltmelerini ekler; kriter çıkarımı ve hakem AI değerlendirme mantığı değişmemiştir. Ne değişti: [`README_DEGISIKLIKLER_2026-09-04.md`](README_DEGISIKLIKLER_2026-09-04.md) · ölçümler ve teslim: [`BUGFIX_RAPORU_2026-09-04.md`](BUGFIX_RAPORU_2026-09-04.md) · önceki entegrasyon: [`ENTEGRASYON_RAPORU_2026-09-03.md`](ENTEGRASYON_RAPORU_2026-09-03.md) · durum ve ölçümler: [`PROJE_DURUMU.md`](PROJE_DURUMU.md).

## Rol bazlı yönetici girişi

Uygulama `http://localhost:3000` adresinde **tek bir giriş formuyla** açılır: kullanıcı adı (veya e-posta) ve şifre. **Giriş sırasında rol seçilmez.** Sistem hesabı Cloudflare D1'den doğrular ve hesabın rolüne göre doğru paneli otomatik açar. Parolalar açık metin saklanmaz; PBKDF2-SHA256 ile özetlenir. Bilinmeyen kullanıcı, yanlış şifre ve pasif hesap aynı 401 cevabını alır; başarısız denemeler D1 sayacıyla sınırlanır. Tanınmayan rol kodu hiçbir role çevrilmez (fail-closed).

Sistemde hiç aktif Admin yokken giriş ekranında **“Kurulum Admini oluştur”** düğmesi görünür ve `admin` / `1234` hesabını **bir kez** açar. Bu kolaylık yalnızca dört koşul birlikte sağlanınca çalışır: açık development ortamı (`APP_ENV`), `.env.local` içinde `ALLOW_LOCAL_ADMIN_BOOTSTRAP=on`, loopback istek ve sıfır aktif Admin. `APP_ENV` tanımsızsa sistem kendini **production** sayar; üretimde ilk Admin yalnızca `MODERATOR_BOOTSTRAP_TOKEN` ile ve sıfır hesap evresinde açılır, sonrasında uç nötr 404 döner.

- **00 · Genel Yönetici / Admin:** yalnızca yönetici ataması yapar. Personel hesabı açar, rol atar/kaldırır ve atama geçmişini izler. Kriter, değerlendirme, operasyon ve başvuru uçlarına erişmez; hakem atayamaz.
- **01 · Yarışma Yöneticisi:** `/kriter-atolyesi` üzerinden şartname PDF'sini analiz eder, kriterleri düzenler ve değerlendirme profilini yayımlar. Benzerlik analizinde ortak metni ayıklamak için yarışmaya resmî rapor şablonu yükleyebilir (şablon kriter üretmez).
- **02 · Hakem:** `/degerlendirme` üzerinden kendisine atanmış başvuruyu açar, **Yapay Zekâ Analizi Yap** ile kriterleri PDF'e karşı kontrol ettirir, her AI bulgusu için **“AI bulgusunu aynen kullan”** ya da **“Hakem değerlendirmesi gir”** seçer, bütün kriterler bitince nihai **ONAY / RET** kararını kesinleştirir. Kanıt, uygulama içi PDF görüntüleyicisinde sayfa ve vurguyla gösterilir.
- **03 · Yarışmacı:** hesap oluşturur, yarışmayı seçer, PDF raporunu gönderir, gerekirse revizyon yükler ve hakem kesinleştirdiğinde onay ya da ret sonucunu gerekçesiyle görür.
- **04 · Değerlendirme Yöneticisi:** hakem yüklerini ve hata kuyruğunu izler; yeniden atama, hatırlatma, analizi yeniden sıraya alma, yarışmayı aktif/pasif yapma ve sonuç yayın akışını yönetir. Kriter değiştiremez, rapor değerlendiremez, nihai karar veremez.

Başvuru alındığı anda **sistem** dosyayı en az açık dosyası olan uygun hakeme otomatik atar (eşit yükte sıra deterministiktir); manuel hakem seçimi yoktur. Pasifleştirilen bir hakemin tamamlanmamış dosyaları serbest bırakılıp yeniden dağıtılır; aktif hakem yoksa yeniden atama kuyruğuna alınır. Atama geçmişi korunur.

Yetki matrisi tek kaynaktan okunur: `app/lib/authorization.ts`. Her API ucu bu matristeki bir izne bağlıdır; 00 rolü yalnızca `manage_accounts` iznine sahiptir. **03 · Yarışmacı** yönetici rolü değildir; yarışmacı giriş ekranından kendi hesabını oluşturur. Sayfalar, ücretli analiz uçları ve dosya uçları sunucu oturumuna, role ve veri sahipliğine göre korunur; JSON ve dosya gövdeleri parse edilmeden önce bayt sınırından geçer (aşımda 413).

## Kriter Atölyesi (`/kriter-atolyesi`)

Şartname analizi **dört aşamalı kontrol prensibine** göre çalışır. Her kriter bu aşamalardan birine bağlanır; aynı dört aşama rapor değerlendirmesinde de kullanılır:

| # | Aşama | Kontrol |
|---|---|---|
| 1 | Dil ve Şablon Uygunluğu | Rapor dili; sayfa sınırı, A4/sayfa düzeni, yazı tipi/punto, kenar boşluğu, satır aralığı, kapak, içindekiler, kaynakça, üstbilgi/altbilgi, sayfa numarası; yalnızca rapor PDF'sine ait dosya adı/türü/boyutu. |
| 2 | Başlık ve İçerik Kontrolü | Raporda bulunması zorunlu ana/alt başlıklar ve belirli bir bölümde açıklanması, hesaplanması, gerekçelendirilmesi veya gösterilmesi istenen içerik (çok satırlı zorunlu listelerin her maddesi ayrı kriter). |
| 3 | Kategori Uygunluğu | Yarışmanın kabul ettiği proje türü, hedef problem, teknoloji ve kullanım alanı, açık konu/kapsam sınırı. Sonuç dört durumdan biridir: uyumlu, kısmen uyumlu, uyumsuz, yeterli kanıt yok. Yüzde gösterilmez. |
| 4 | Kriter Bazlı Kanıt Çıkarma | Katılımcının **PDF raporundan metinsel veya sayısal olarak denetlenebilen** teknik tasarım kuralları: boyut, ağırlık, gerilim/akım/güç, motor, batarya, malzeme, haberleşme, zorunlu donanım (acil durdurma, yalıtım), yasaklar (patlayıcı), belgelenmesi istenen analiz/test. Her kural için BAŞARILI / REVİZYON / KRİTİK HATA ve sayfa/paragraf numaralı alıntı. |

**Hiçbir aşamada kriter yapılmayanlar:** yarışma günü/sırasında ölçülen performans; parkur, uçuş, sürüş, canlı görev, saha uygulaması ve fiziksel ölçüm; puan, baraj, ceza, sıralama ve ödül; video içeriği/süresi/formatı/yüklemesi; portal/KYS işlemleri; ayrı belge, veri veya fiziksel teslim; takım üyeliği, yaş, okul, danışman; iletişim ve duyuru takibi; hakem/kurul talimatları; yarışma sonrası işlemler; tavsiye ve opsiyonel içerik. Bir cümlede "zorunludur", "olmalıdır" veya "en fazla" geçmesi tek başına kriter olması için yeterli değildir.

Çalışan akış:

1. Yarışma Yöneticisi yalnızca şartname PDF'sini yükler; ayrı bir ayar formu doldurmaz.
2. PDF sunucuda (Cloudflare Workers uyumlu PDF.js ile) sayfa, başlık, numaralı madde, paragraf, liste ve tablo satırı düzeyinde yapısal bloklara ayrılır; satıra taşmış maddeler birleştirilir; her bloğa kararlı bir kaynak kimliği verilir. Metin katmanı yoksa uydurma sonuç üretilmez: uç açıkça OCR gerektiğini bildirir, yönetici onaylarsa görüntüden metin **bir kez** Gemini ile çıkarılıp R2'de sabitlenir.
3. Türkçe normalizasyon ve sürümlü sözlük (zorunluluk/yasak/sınır ifadeleri, sayı-birim, dil/şablon, başlık/içerik, kategori, teknik, fiziksel aşama ve haricî kanıt sinyalleri) güçlü adayları deterministik olarak seçer. Seçilmeyen bloklar sessizce elenmez; yönetici inceleme özetinde sayfa sayfa görünür.
4. **Tek LLM çağrısı** yalnızca seçilmiş özgün metinleri ve yakın bağlamlarını alır; PDF dosyası modele verilmez. Her aday için **KRITER** veya **KAPSAM_DISI** kararı zorunludur; cevapsız aday varsa sonuç başarılı sayılmaz ve kaydedilmez. Çıktı kesilirse sebebini söyleyen açık hata döner.
5. Sunucu her kararı doğrular: kaynak kimliği sunucunun gönderdiği adaylardan biri olmalı, birebir alıntı adayın metninde veya modele gösterilen yakın bağlamda kesintisiz bulunmalı, aşama dört aşamadan biri olmalı (tanınmayan aşama teknik aşamaya düşmez), kanıt yeri PDF olmalı ve kaynak metin ilgili aşamanın kapsam kapısından geçmelidir. Modelin ürettiği ad/açıklama kapsam kanıtı sayılmaz. Tekrarlar birleştirilir; sayfa uyuşmazlığında sunucunun doğruladığı sayfa yazılır.
6. Her kriter ad, aşama, **Zorunlu / Diğer** ayrımı, kontrol türü, tek cümlelik açıklama, kaynak sayfa ve birebir alıntıyla listelenir. Güven seviyesi, "emin değilim" durumu veya puan yoktur. Yönetici kriterleri düzenleyebilir, yenisini ekleyebilir veya silebilir; pasif kriter kavramı yoktur, listedeki her kriter yayımlanır.
7. Profil sahipliği R2 yazımından önce doğrulanır; kaynak PDF sürümlü anahtarla saklanır, yeni PDF seçmeden yeniden yayımda eski dosya korunur. Profil sürümü **2.0**'dır; eski 1.0 (puanlı) profiller okunurken yükseltilir. Taslaklar yarışma bazında ayrılır ve görevlinin tarayıcısında saklanır; yayımlanan profil D1'e yazılır.

Aynı belge aynı istem, sözlük, seçici ve yapı sürümüyle yeniden analiz edilirse model tekrar çağrılmaz; sonuç 0 token ile süreç belleğinden ya da D1'deki kalıcı kayıttan döner. Bu sürümlerden biri değişince eski önbellek kaydı yeniden kullanılmaz. Eski sürümle üretilmiş bir taslak veya sonuç açıldığında Kriter Atölyesi şartnamenin yeniden analiz edilmesi gerektiğini açıkça yazar.

## Değerlendirme Atölyesi (`/degerlendirme`)

1. **Giriş:** Hakem **Değerlendirme Atölyesi** ya da **Geçmiş değerlendirmeler** seçer.
2. **Yarışma → başvuru:** Yayımlı profili olan yarışmalar listelenir; seçilen yarışmanın hakeme atanmış başvuruları görünür. Başvuru D1'de, PDF özel R2 deposundadır; ilk başvuru ve revizyon yüklemeleri R2'den geri okunarak doğrulanır (uzunluk + SHA-256), çift tıklamayla mükerrer başvuru oluşmaz.
3. **Yapay Zekâ Analizi:** Yayımlı kriterlerin her biri rapor PDF'iyle karşılaştırılır. Ekran dört sayıyı ayrı gösterir: yayımlı kriter, PDF üzerinden değerlendirilebilen, video/portal/fiziksel aşama gerektirdiği için analize katılmayan ve hakem kararı bekleyen. Dört aşama tek şerit hâlinde özetlenir ve şeridin **AI ön değerlendirmesi** olduğu açıkça yazılır; hakemin kesinleşen sayaçlarıyla karıştırılmaz. Teknik bulgu gelmediğinde kart, doğrulayamadığı bir olguyu iddia etmez: PDF dışı kriter varsa sayısıyla açıklanır, yoksa temkinli ifade kullanılır. Kriter analizi **benzerliği beklemez**; sonuç hazır olur olmaz kaydedilir ve hakem çalışmaya başlar. Taranmış (metin katmansız) rapor açık hata verir; başarısız yenilemede önceki başarılı analiz korunur.
4. **Kanıt:** Her bulguda **“Kanıtı PDF'de göster”** uygulama içi görüntüleyiciyi doğru sayfada açar ve alıntıyı vurgular; vurgulanamazsa bunu söyler.
5. **Kriter kararları + nihai ONAY / RET:** Hakem her bulgu için **AI bulgusunu aynen kullan** (AI sonucu kesinleşir) ya da **Hakem değerlendirmesi gir** seçer. Form iki ayrı soru sorar — *Kriter sonucu* (Uygun/Olumsuz) ve *Dayanak* (PDF'de bulunan bilgi / Raporda bulunmayan içerik) — ve AI verileriyle ön doldurulur; sayfa numarası tam sayı ve belge aralığında olmak zorundadır. Hakemin PDF konumu dayanağı sunucuda rapor metnine karşı doğrulanır. **Her karar sunucuya taslak olarak yazılır:** taslak nihai karar üretmez, katılımcıya gitmez, analiz künyesine bağlıdır (yeni analizden sonra otomatik uygulanmaz) ve "kaydedildi" yalnızca kayıt gerçekten kalıcılaştığında söylenir; iki sekmede yapılan düzenleme birbirini sessizce ezemez. AI bulgusu ile hakem kararı ayrı tutulur; bütün kriterler sonuçlanmadan genel karar bölümü açılmaz. Nihai **RET** açıklaması reddedilen kriterlerden deterministik şablonla üretilir.
6. **Yarışmacı sonucu:** Portalda ONAY/RET, hakem açıklaması, **Güçlü Yönler** ve **Gelişime Açık Yönler** görünür.

### Raporlar arası benzerlik

Benzerlik ayrı bir sistemdir; kriter, ihlal veya otomatik ret kararı üretmez ve aşama kartlarında yer almaz. Hakeme kendi notunda, "Bu sonuç intihal veya otomatik ret kararı değildir" uyarısıyla gösterilir. Kriter analizini **beklet(e)mez**: analiz sonucu hemen kaydedilir, benzerlik kendi kartında ilerler ve bittiğinde sonucu kayda iliştirilir; bağımsız "Benzerliği yenile" eylemi kriter analizini yeniden başlatmaz. Durum her zaman doğru adlandırılır — başarısız, eksik ya da hiç yapılmamış karşılaştırmaya "Normal" denmez; işaret suçlayıcı değildir ("inceleme önerilir"):

- Yapısal parçalama (başlık/paragraf); kapak (numaralı ilk bölüme kadarki 1. sayfa içeriği), içindekiler, tekrarlanan üstbilgi/altbilgi (sayfa numarası değişse bile), kaynakça, şartname alıntısı, resmî şablon metni ve çok kısa ortak ifadeler karşılaştırma dışı bırakılır ve "puana katılmayan içerik" olarak gerekçesiyle raporlanır. Başlık filtreleri bölüm numarasını yok sayar ("8.3 Kaynakça"); karma başlık ("Risk, Takvim ve Kaynakça") bölümün tamamını kaynakça yapmaz. Kaydırılmış bir gövde cümlesi başlık sayılmaz.
- MinHash ile doğrudan kopya, `gemini-embedding-001` ile anlamı korunarak yeniden yazılmış içerik tespiti; ortak teknik kelimelerin etkisini azaltan ayırt edicilik ağırlığı; ardışık eşleşmelerin birleştirilmesi; kapsama oranında çift sayım yok.
- Yalnızca aynı yarışma, yıl ve aşamadaki **güncel** raporlar karşılaştırılır; aynı takımın eski sürümü başka takım benzerliği sayılmaz.
- PDF özeti, embedding modeli, şablon sürümü ve işlem sürümüne bağlı önbellek; havuza yeni rapor gelince eski sonuçlar "güncel değil" işaretlenir; embedding başarısız olursa MinHash sonucu korunur.
- Sayfa, bölüm ve kısa alıntıyla açıklanabilir eşleşmeler; isteğe bağlı LLM açıklama katmanı yüzdeyi veya eşleşmeyi değiştiremez. Maliyet kapısı: güçlü eşleşme yoksa **hiç** çağrı yapılmaz, varsa en yakın **tek** rapor ve en fazla **3** kanıt çifti ile **tek** yapılandırılmış çağrı yapılır; havuz büyüdükçe çağrı sayısı artmaz. Tarama, kanıt seçimi ve AI açıklaması arayüzde ayrı sayılardır, tek "incelendi" sayısında birleştirilmez.

## Gemini yapılandırması

Gerçek sağlayıcı sunucu tarafındaki `app/api/analyze/route.ts` ve `app/api/evaluate-report/route.ts` uçlarıdır. API anahtarı yalnızca `.env.local` içinde tutulur; tarayıcı koduna ve Git'e girmez. Model `GEMINI_MODEL` ile seçilir (öntanımlı `gemini-3-flash-preview`); yedek model kademesi, model taraması ve gizli yeniden deneme yoktur. Şartname analizi tam olarak **bir** `generateContent` isteğidir (OCR onaylanırsa bir ek istek); çıktı tavanı 65 536 token'dır. 429/503/zaman aşımında uç açık hata ve `retryable: true` döndürür, kullanıcı "Yeniden dene" ile kendisi karar verir. `diagnostics` alanı gerçek çağrı sayısını, süreyi, token kullanımını, yapı/sözlük/seçici/istem sürümlerini taşır.

Organizatör kaynak PDF'si için analiz sınırı 18 MB, katılımcı raporu için 50 MB'dir; katılımcı teslim sınırı yalnızca organizatör PDF'sinden gelir. Şema, talimat ve normalizasyon `app/lib/criteria-extraction.ts`; aday seçimi `app/lib/criteria-candidates.ts` ve `app/lib/criteria-dictionary.ts`; mimari `docs/GENEL_BELGE_ANALIZ_MIMARISI.md`; veri sözleşmeleri `docs/AI_API_ENTEGRASYON_SOZLESMESI.md` ve `docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md`; önbellek `docs/KALICI_ANALIZ_ONBELLEGI.md`.

## Yerel çalıştırma

```bash
npm install --legacy-peer-deps
cp .env.example .env.local   # GEMINI_API_KEY ve APP_ENV=development satırlarını doldurun
npm run dev
```

Uygulama `http://localhost:3000` giriş panelinde açılır. Kriter Atölyesi `/kriter-atolyesi`, Değerlendirme Atölyesi `/degerlendirme` adresindedir. `--legacy-peer-deps` React sürümü uyumluluğu için zorunludur. Kurulum, ilk deneme akışı ve sorun giderme için **[GUIDE.md](GUIDE.md)**.

## Test belgeleri

- `output/pdf/Ornek_Akilli_Ulasim_OTR_Degerlendirme_Kilavuzu.pdf`: sentetik, kısa karşılaştırma belgesi.
- `output/pdf/official/2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf`: resmî 2026 TEKNOFEST şartnamesi (25 sayfa).
- `output/pdf/official/2026_Insansiz_Deniz_Araci_Sartnamesi.pdf`: resmî 2026 TEKNOFEST şartnamesi (29 sayfa).
- `output/pdf/official/2026_Insansiz_Su_Alti_Sistemleri_Sartnamesi.pdf`: resmî 2026 TEKNOFEST şartnamesi.

Belgeler uygulamadaki "Hazır test belgeleri" bölümünden seçilebilir; görevli kendi belgelerini "Görevli belge havuzu" panelinden ekleyebilir (tarayıcı deposu). `corpus/` altındaki şartname PDF'leri referans veri setidir ve silinmez.

## Testler ve doğrulama

Canlı model çağrısı yapmayan kontroller:

```bash
npx tsc --noEmit --incremental false   # tip kontrolü
npm run lint
npm run test:unit                       # 350 birim testi (node:test, node:sqlite ile gerçek göç dosyaları)
npm run test:regressions                # 9 regresyon paketi
npm run check:repo-safety               # izlenen dosyalarda API anahtarı taraması
npm run build                           # üretim derlemesi (prebuild depo güvenliğini çalıştırır)
```

Öne çıkan test dosyaları: `tools/four-stage-extraction.test.ts` (dört aşamalı çıkarım ve kapsam kapıları; gerçek Çelikkubbe/İDA PDF'leriyle deterministik aday kontrolü), `tools/four-stage-ui.test.ts` (benzerliğin kararları değiştirmemesi, eski profil geriye uyumluluğu, boş teknik aşama kartı, yeniden analiz uyarısı), `tools/bootstrap-atomicity.test.ts`, `tools/criteria-coverage.test.ts`, `tools/criteria-pipeline.test.ts`, `tools/judge-flow-v2.test.ts`, `tools/similarity*.test.ts`, `tools/request-guard.test.ts`, `tools/auth-security.test.ts`, `tools/migrations.test.ts`.

Canlı koşular (ücretli, açık izinle): `npm run check:gemini` erişimi doğrular; sunucu açıkken `node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze` gerçek çıktıyı `docs/benchmarks/celikkubbe-expected.json` ile karşılaştırır (`--benchmark ida` İDA için); `npm run test:e2e` temiz bir veri tabanı ister (mevcut veriyi silen `dev_reset` yalnızca açık izinle).

## Ana dosyalar

- `app/components/management-app.tsx`: rol bazlı giriş ve yönetim paneli kabuğu; `access-login.tsx`, `role-gate.tsx`, `password-change-gate.tsx`, `topbar-session.tsx`
- `app/components/admin-accounts-panel.tsx`: 00 için hesap açma, rol atama/kaldırma ve atama geçmişi
- `app/components/criteria-app.tsx`: PDF merkezli Kriter Atölyesi (aday inceleme özeti, OCR onayı, Zorunlu/Diğer liste, kaynak sayfa, manuel düzenleme, yeniden analiz uyarısı)
- `app/components/evaluation-app.tsx` + `pdf-evidence-viewer.tsx`: Değerlendirme Atölyesi (kapsam sayaçları, dört aşama şeridi, AI bulgusu / hakem değerlendirmesi ayrımı, uygulama içi kanıt görüntüleyici, benzerlik notu, geçmiş)
- `app/components/participant-portal.tsx`: yarışma arama, PDF başvurusu, revizyon ve sonuç takibi
- `app/components/operations-panel.tsx`, `judge-queue-panel.tsx`, `competition-stage-panel.tsx`: 04 için hakem yükü, yeniden atama, hata kuyruğu ve yarışma aşaması yönetimi
- `app/components/manager-profile-history.tsx`, `document-library-modal.tsx`, `file-badge.tsx`, `ai-disclaimer.tsx`
- `app/lib/types.ts`: dört aşama, kriter (kontrol türü, kanıt yeri), profil 2.0 ve rapor değerlendirme veri modeli
- `app/lib/pdf-structure.ts`, `pdfjs-runtime.ts`, `pdf-ocr.ts`, `report-text-layer.ts`: yapısal PDF ayrıştırma, Workers uyumlu PDF.js, OCR yedeği, rapor metin katmanı ve hakem alıntısı doğrulama
- `app/lib/turkish-text.ts`, `criteria-dictionary.ts`, `criteria-candidates.ts`: Türkçe normalizasyon, sürümlü sözlük, deterministik aday seçimi
- `app/lib/criteria-extraction.ts`: şema, sistem talimatı, normalizasyon ve kapsam kapıları; `criteria-hash.ts`, `source-lock.ts`: kriter sürüm özeti ve kaynak kilidi
- `app/lib/report-prechecks.ts`, `report-evaluator.ts`, `judge-review.ts`, `evaluation-cache-key.ts`: rapor ön kontrolleri, aşama özetleri, hakem kararı modeli, sürüm kapsamlı önbellek anahtarı
- `app/lib/similarity-text.ts`, `similarity-engine.ts`, `similarity-embedding.ts`, `similarity-candidates.ts`, `similarity-corroboration.ts`, `similarity-llm.ts`, `similarity-config.ts`: benzerlik motoru
- `app/lib/authorization.ts`, `admin-roles.ts`, `admin-guard.ts`, `session.ts`, `request-guard.ts`, `password.ts`: yetki matrisi, oturum, istek ve gövde sınırları
- `app/lib/workflow-db.ts`, `admin-db.ts`, `profile-loader.ts`, `draft-store.ts`: D1/R2 veri katmanı, profil doğrulama/yükseltme, taslak kalıcılığı
- `app/api/analyze/route.ts`: yapısal tarama + tek çağrılık çıkarım + kalıcı önbellek; `app/api/evaluate-report/route.ts`: dört aşamalı rapor değerlendirmesi
- `app/api/applications/*`: başvuru, sürüm, dosya erişimi, benzerlik; `app/api/competitions/*`: yarışma ve benzerlik şablonu; `app/api/admin/*`: hesap, oturum, bootstrap, parola, denetim; `app/api/profiles/*`, `extractions`, `operations`, `participant/register`, `timeline`, `metrics`
- `migrations/0001_admin.sql` … `0015_submission_integrity.sql`: D1 şema geçmişi (15 göç; çalışma zamanı şeması aynı sütunları ad bağımsız ekler)
- `DESIGN.md`, `PRODUCT.md`, `NIHAI_SISTEM_AKISI.md`, `GUIDE.md`; raporlar: `README_DEGISIKLIKLER_2026-09-04.md`, `BUGFIX_RAPORU_2026-09-04.md`, `ENTEGRASYON_RAPORU_2026-09-03.md`, `DEGISIKLIK_RAPORU_2026-09-03.md`, `SIMULASYON_RAPORU_CELIKKUBBE.md`, `TESLIM_RAPORU_NIHAI_HAKEM_AKISI.md`

## Güncel durum (4 Eylül 2026)

Son yapılanlar (`furkan_faruk_v1_bugfixing`; ayrıntı: [`README_DEGISIKLIKLER_2026-09-04.md`](README_DEGISIKLIKLER_2026-09-04.md)):

- **Benzerlik filtresi gerçek PDF'lerle düzeltildi.** İki sentetik test raporuyla beş kusur yeniden üretildi ve giderildi: kapak künyesi, "0. İçindekiler ve Beyan" tablosu, "8.3 Kaynakça" satırları, her sayfadaki altbilgi ve başlık sanılan gövde cümleleri artık karşılaştırmaya girmiyor; ayıklanan içerik gerekçesiyle denetimde duruyor. Başlık eşleşmesi bölüm numarasını yok sayıyor, karma başlık bölümün tamamını yutmuyor, gerçek proje beyanı korunuyor. `pdf-structure.ts` (ortak ayrıştırıcı) değiştirilmedi; uyarlama yalnızca benzerlik katmanında. İşlem sürümü `sim-v3-frontmatter-furniture` — eski parça önbelleği kendiliğinden düşer.
- **Benzerlik hakem analizini bekletmiyor.** `Promise.allSettled` bağı kaldırıldı; kriter sonucu hemen kaydediliyor, benzerlik kendi kartında ilerliyor ve geç gelen sonuç yeni `attach_similarity` ucuyla, karşılaştırmalı (CAS) yazma ile iliştiriliyor — hakem kararlarını, başka başvuruyu veya yeni bir analizi ezemiyor. Bağımsız "Benzerliği yenile" eylemi eklendi.
- **Hakem düzenleme formu.** Genel `input` kuralının radyoları dev yuvarlağa çevirmesi bu forma kapsamlı sıfırlamayla giderildi (`globals.css` değişmedi); dört seçenek iki ayrı soruya bölündü; alıntı ve gerekçe tam genişlikte; yüzey nötr, Kaydet birincil eylem; alan bazlı hata + `aria-invalid`/`aria-describedby`; sayfa numarası tam sayı ve belge aralığında (ondalık artık sessizce yuvarlanmıyor).
- **Kriter kararları artık gerçekten kaydediliyor.** Her karar sunucuya `in_progress` taslak olarak yazılıyor (nihai karar üretmez, katılımcıya gitmez); "kaydedildi" yalnızca kalıcılaşınca deniyor, başarısızlıkta form kapanmıyor. Taslak analiz künyesi/PDF özeti/kriter sürümüyle kapsamlı — yeni analizden sonra otomatik uygulanmıyor; iki sekme çakışması sunucuda damgayla engelleniyor.
- **Sunum:** "ŞÜPHELİ" yerine "inceleme önerilir"; başarısız/eksik koşuya "Normal" denmiyor (dokuz ayrı durum); uyarı "intihal **veya otomatik ret** kararı değildir"; tarama, kanıt seçimi ve AI açıklaması ayrı sayılar; dört kutunun AI ön değerlendirmesi olduğu yazılı.
- **Madde 8'deki on "düzeltildi" bulgusu** güncel kodda ve regresyon paketlerinde yeniden doğrulandı; hiçbiri yeniden üretilemedi, hiçbiri yeniden yazılmadı.
- Ölçüm (canlı model çağrısı YOK, yalnız yerel MinHash): A→B %94 (1077/1151 kelime), B→A %99. Eşleşmelerin tamamı birebir metin; kanıt olarak kapak/içindekiler/kaynakça değil, gerçek proje anlatımı seçiliyor.
- Doğrulama: tsc ve lint temiz, birim **350/350** (13 yeni test), regresyon 9/9, depo güvenliği PASS, üretim derlemesi başarılı. **Canlı Gemini çağrısı yapılmadı.** Commit/push/merge yapılmadı.

## Önceki durum (3 Eylül 2026)

Son yapılanlar (`entegrasyon/umit-umut-2026-09-03`, commit `578f1d7` ve sonrası):

- İki geliştirme hattı güvenli biçimde birleştirildi: benzerlik motoru aynen korundu (dosyalar umit hattıyla bayt bayt aynı); PDF.js Workers çalışma zamanı, kanıt görüntüleyici, hakem akışı v2, katılımcı yükleme/revizyon bütünlüğü ve pasifleştirilen hakemin dosyalarının yeniden atanması korundu. Dokuz dosyadaki çakışma davranış bazında çözüldü; `0010` migration çakışması `0015_submission_integrity.sql` olarak giderildi.
- Şartname çıkarımı yeniden **dört aşama** üretiyor. Teknik aşama, aday seçici, istem ve sunucu kapısı düzeyinde en küçük değişiklikle açıldı; yarışma anı, saha, parkur, ceza/puan, video, portal, takım ve iletişim dışlamaları korundu ve genişletildi. Sürümler: istem `v36-four-stages-pdf-verifiable-technical`, sözlük `sozluk-v6-four-stages-scope-gates`, seçici `candidate-selector-v2-technical-restored`, yapı `pdf-structure-v3-clauses-wrapped-lines`.
- Çevrimdışı ölçüm: Çelikkubbe'de aday sayısı 32 → 96 (teknik sinyalli 8 → 28), İDA'da 43 → 145 (18 → 66). Önbellekteki gerçek Çelikkubbe model çıktısı yeni kapılardan geçirildiğinde 3 dil/şablon + 6 teknik kriter kaldı; puan tablosu ve saha güç tedariki dışlandı.
- Doğrulanmış buglar: 9.1 bootstrap kısmi hesap birleşik kodda üretilemedi (test eklendi); 9.2 benzerlik gövdesi parse'tan önce 413 alıyor; 9.3 teknik kriteri olmayan profilde 4. kart "uygulanmıyor"; 9.4 sunucu `diagnostics.promptVersion` yazıyor, eski sürümlü taslak/sonuçta yeniden analiz uyarısı çıkıyor, eski kriterler silinmiyor.
- Doğrulama: tsc ve lint temiz, birim 337/337, regresyon 9/9, depo güvenliği PASS, üretim derlemesi başarılı. **Canlı Gemini çağrısı yapılmadı.**

## Kalan işler ve yapılması gerekenler

Önem sırasına göre:

0. **Görsel doğrulama (yeni).** 4 Eylül'deki form ve kart değişiklikleri kaynak/CSS düzeyinde regresyonla kilitlendi ama tarayıcıda görülmedi: 360px / tablet / masaüstü / %200 yakınlaştırma, klavyeyle seçim ve odak, hata düzeltme akışı elle doğrulanmalı.
1. **Canlı doğrulama (en kritik).** Yeni sürüm etiketleriyle Çelikkubbe ve İDA şartnamelerinin gerçek Gemini analizi; rapor değerlendirmesi ve OCR yolunun canlı koşusu. Çıkan her aktif kriter için: dört kapsamdan birinde mi, kaynak sayfası ve alıntısı doğru mu, şartnamenin kendi başlığı yanlış anlaşılmış mı, tavsiye kriter olmuş mu, teknik/yarışma-anı kuralı sızmış mı.
2. **Benchmark beklentilerini yeni kapsama göre kalibre etme.** `docs/benchmarks/celikkubbe-expected.json` hâlâ video 720p/süre kuralını beklenen bulgu sayıyor (yeni kapsamda video kriter değildir); `docs/benchmarks/ida-ground-truth.json` boş. Canlı koşu sonrası `run_celikkubbe_benchmark.mjs` ile ölçüm.
3. **`main`'e alma.** Entegrasyon dalı push edildi, PR açılmadı: `https://github.com/RagipUmitAlp2003/AI-Gambit/pull/new/entegrasyon/umit-umut-2026-09-03`. Gözden geçirip `main`'e alınmalı; ardından eski dallar temizlenebilir.
4. **Eski yayımlı profiller.** Üç aşamalı (v35) veya daha eski istemle yayımlanmış profiller silinmez ama yeni kapsam için şartname **yeniden analiz edilmelidir**. Yayımlı profilde sürüm işareti yoktur; uyarı yalnızca taslak ve analiz sonuçları için üretilir. Profil dışa aktarımına çıkarım sürümü eklenmesi değerlendirilmeli.
5. **Kapsam kapısı sınırları (canlı ölçümle ayarlanmalı).** `derece` puan ailesinde olduğu için "360 derece dönebilmelidir" gibi açı limitleri dışlanıyor; "yarışma sırasında …" ile başlayan tasarım limitleri yarışma-anı kuralı sayılıyor; işaretsiz saha prosedürlerinde ("güvenlik kurallarını tatbik ettikten sonra enerji verilebilir") son karar modelin KAPSAM_DISI sınıflamasına kalıyor.
6. **Uçtan uca senaryo.** `npm run test:e2e` temiz veri tabanı ister; mevcut veriyi korumak için anlık görüntü → `dev_reset` → e2e → geri yükleme yöntemi kullanılmalı. Tekdüze giriş + 429 bölümü canlı koşulmadı.
7. **Benzerlik kalibrasyonu.** Eşikler (doğrudan 0.55/0.30, anlamsal 0.90/0.82, rapor %55/%30) başlangıç değeri; kontrollü rapor çiftleriyle canlı embedding ve LLM açıklama katmanı ölçülmeli. 4 Eylül ölçümü yalnız yerel MinHash ile yapıldı: anlamsal kanal **hiç çalıştırılmadı**, "0 anlamsal eşleşme" başarısızlık değildir. Ayrıca ortak ayrıştırıcının yanlış başlık ürettiği durumda bölüm adı sonraki bloklara yazılmış geliyor (kozmetik; karşılaştırma doğruluğunu bozmuyor) ve LLM kapsamını tek rapordan beş rapora çıkarmak ayrı bir ürün kararıdır.
8. **Büyük şartnameler.** Çıkarım tek çağrıdır ve çıktı tavanı 65 536 token'dır; yüzlerce adaylı belgede kesilme açık hata verir ama bölümleme yoktur. Cloudflare Workers istek süre sınırı canlı ölçülmeli; gerekirse analiz arka plan işine alınmalı.
9. **Dağıtım.** `APP_ENV` tanımsız ortam production sayılır (önizlemede giriş sessizce başarısız görünebilir); D1/R2 kaynakları, `migrations/0001–0015` uygulaması, `MODERATOR_BOOTSTRAP_TOKEN` ile gerçek Admin, `admin/1234` hesabının kaldırılması, `MODERATOR_SECRET` ve daha önce paylaşılmış `GEMINI_API_KEY`'in yenilenmesi.
10. **Arayüz ve veri.** Dar ekran (360/768/1024 px) elle doğrulanmadı; favicon hâlâ eski kimlikte; kullanılmayan CSS seçicileri taranmalı; görevli belge havuzu tarayıcıya bağlı (ortak R2 havuzu yok); yarışma seçimi ad dizgesiyle taşınıyor (kalıcı `competitionId` bağlanmalı).
