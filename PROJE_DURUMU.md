# AI-Gambit — Proje Durumu ve Yapılacaklar

**Tarih:** 26 Ağustos 2026 · **Dal:** `faruk_deneme` · **Temel işleme:** `4e47e4b`

Bu belge projenin **güncel durumunu** tutar: neyin çalıştığı, neyin eksik olduğu ve
neyin düzeltilmesi gerektiği. Aşağıdaki her madde bugün kod üzerinde veya gerçek
çalıştırmayla doğrulanmıştır; doğrulanmayan iddialar "ölçülmedi" olarak işaretlidir.

İş bölümü:

| Belge | Neyi anlatır |
|---|---|
| `README.md` | Ürün tanıtımı ve rol bazlı giriş |
| `GUIDE.md` | Kurulum, çalıştırma, sorun giderme |
| `NIHAI_SISTEM_AKISI.md` | Roller, akış ve veritabanı mimarisi |
| `docs/*_SOZLESMESI.md` | AI uçlarının veri sözleşmeleri (kod bunlara atıf yapıyor) |
| `PROJE_DURUMU.md` (bu belge) | Durum, ölçüm, eksik iş listesi |

---

## 1. Bugün yapılan iş — AI belge analizi hatası

**Belirti:** Kriter Atölyesi'nde şartname analizi "Belge analiz edilemedi. AI belge
analizi tamamlanamadı… API bağlantısını, kotayı veya kaynak belgenin geçerliliğini
kontrol edin." hatasıyla düşüyordu.

### Kök neden

Hata mesajı üç ayrı sorunu tek kovaya atıyordu. Gerçek nedenler:

| # | Neden | Kanıt |
|---|---|---|
| 1 | **Faturalama** — Google AI Studio projesinin ön ödemeli kredisi aralıklı olarak tükeniyor | `HTTP 429 RESOURCE_EXHAUSTED · "Your prepayment credits are depleted"` |
| 2 | **Birincil model yanıt vermiyor** — `gemini-3.7-flash` ağır PDF çağrılarında sürekli 503 dönüyor | Sunucu günlüğünde bir koşudaki 10 reddin 10'u bu modelden |
| 3 | **İnce yeniden deneme bütçesi** — birincil 2 + yedek 1 deneme; bir 503 dalgası üçünü tüketince analiz komple iptal oluyordu | Analiz ucu belge başına 5 paralel çağrı yapıyor; **tek** sayfa aralığının düşmesi bütün analizi düşürüyordu (`failedRange` → `failWith`) |

API anahtarı geçerli. `AQ.` ile başlayan anahtar biçimi Gemini API tarafından kabul
ediliyor (`models.list` 50 model döndürüyor); anahtar biçimini yerelde tahmin etmeye
çalışmak yanlış teşhis üretiyordu.

### Yapılan düzeltmeler

**`app/api/analyze/route.ts`**

- Yeniden deneme planı model listesini birden çok tur tarıyor (`GEMINI_MODEL_SWEEPS`,
  öntanımlı 2), turlar arasında artan bekleme uygulanıyor. Tek bir geçici 503 dalgası
  artık analizi öldürmüyor.
- Paralel sayfa aralıkları birbirinin öğrendiğini kullanıyor: bir çağrı "bu model şu an
  503" bilgisini yazınca kardeş çağrılar, ileride denenecek başka kademe varken o modeli
  atlıyor. Son çare konumunda yine deniyor — hiçbir zaman denemeden vazgeçmiyor.
- `GEMINI_THIRD_MODEL` ile isteğe bağlı üçüncü kademe.
- `GEMINI_RETRY_BUDGET_MS` (öntanımlı 300 s): ek turlar isteği süresiz uzatamıyor.
- Hata mesajları ayrıştırıldı: tükenmiş bakiye · anlık hız sınırı · model yoğunluğu
  (503) · kimlik doğrulama · zaman aşımı. Bakiye tükenmesinde artık yanlış olan
  "bir dakika sonra deneyin" yönlendirmesi verilmiyor.
- Yukarı akış 401/503 durumları istemciye 502 olarak iletiliyor: uygulamanın kendi
  oturum katmanı 401'i "yeniden giriş yap" olarak yorumluyor.
- Files API yüklemesi hatayı sessizce yutup satır içi göndermeye düşmüyor; nedenini
  günlüğe yazıyor.

**`app/api/evaluate-report/route.ts`** — aynı mesaj ayrıştırması; eksik olan 429 mesajı
da eklendi.

**`tools/check_gemini_access.mjs` (yeni)** — `npm run check:gemini`. Anahtarı,
yapılandırılan model adlarını ve gerçek üretim çağrısını tek komutta doğrular; 429'un
bakiye mi hız sınırı mı olduğunu ayırt eder; yapılandırılan modeller çalışmıyorsa
çalışan alternatifleri tarayıp listeler. Anahtarı hiçbir zaman ekrana yazmaz.

**`.env.example`** — yeni ayarlar (`GEMINI_THIRD_MODEL`, `GEMINI_MODEL_SWEEPS`,
`GEMINI_RETRY_BUDGET_MS`, `MODEL_COOLDOWN_MS`) belgelendi.

### Doğrulama

Ekrandaki 1.8 MB'lık Çelikkubbe şartnamesi gerçek `/api/analyze` ucundan iki kez geçti
(`tools/run_celikkubbe_benchmark.mjs`):

| | 1. koşu | 2. koşu |
|---|---|---|
| Sonuç | başarılı | başarılı |
| Toplam puan | 500/500 ✓ | 500/500 ✓ |
| Puan matematiği | tutarlı ✓ | tutarlı ✓ |
| Kural kapsamı | %76.9 | %92.3 |
| Görevli kararı | %66.7 | %33.3 |
| Süre | 185 s | 294 s |
| Sonucu üreten model | `gemini-3.5-flash` (yedek) | `gemini-3.5-flash` (yedek) |

---

## 1b. Bugün yapılan iş — kriter yayımı, başvuru ve hakem kararı akışı

| Değişiklik | Dosya | Ne yapıldı |
|---|---|---|
| Kriter listesinden aktif/pasif anahtarı kaldırıldı | `app/components/criteria-app.tsx` | Analiz çıktısı listede olduğu gibi durur. `active` artık elle çevrilen bir anahtar değil, kapsam sınıfından (`applicability`) türeyen deterministik bir alandır. İstenmeyen kriter **silinir**; silme her kriter için açık (eskiden yalnızca elle eklenenler silinebiliyordu). Karar bekleyen bulgular yayımı kilitlemez |
| Yayım öncesi ikinci doğrulama | `app/components/criteria-app.tsx` | “Başvuruyu onayla” → kriter sayısı, kapsam ve puan ölçeğini özetleyen “emin misiniz?” penceresi → “Evet, kriterleri paylaş” |
| Dosya boyutu gösterimi | `app/components/participant-portal.tsx` | `toFixed(1)` her küçük dosyayı `0.0 / 0.1 MB` gösteriyordu. 1 MB altı KB, üstü iki ondalıklı MB |
| “Başvuruyu gönder” sessiz kalıyordu | `app/components/participant-portal.tsx` | Düğme eksik alan varken `disabled` olduğu için tıklama hiçbir şey yapmıyordu. Artık düğme her zaman tıklanabilir; eksik alanlar ad ad yazılır, PDF biçimi/boyutu istemcide de kontrol edilir |
| Başvuru hakem paneline düşüyor | `app/lib/workflow-db.ts` | Hakem (02) artık kendisine atanmış başvuruların yanında **atanmamış** başvuruları da görür. `markApplicationAnalyzing` `submitted` durumunu kabul eder ve analizi başlatan hakem dosyayı atomik olarak üstlenir (`assigned_judge_id IS NULL` koşuluyla; iki hakem aynı anda başlatırsa yalnızca biri geçer) |
| AI uygunluk kararı | `app/lib/compliance-verdict.ts` (yeni) | Yayımlanmış profildeki zorunlu koşulları (required · gate · threshold · eleme) rapor bulgularıyla karşılaştırır; `compliant / not_compliant / needs_human` verdiği gibi Hakemin doğrudan kullanabileceği **ret gerekçesi taslağı** üretir. Karar değil, gerekçeli öneridir |
| Hakem ekranında onay/ret | `app/components/evaluation-app.tsx` | Uygunluk paneli, karşılanmayan zorunlu koşulları kaynak sayfasıyla listeler; “Başvuruyu onayla” / “Başvuruyu reddet · AI gerekçesiyle” düğmeleri sonucu ve gerekçeyi doldurur. Hakem metni serbestçe değiştirebilir. Reddedilen başvuru puanlanmaz; gerekçesiz ret sunucuda 400 ile reddedilir |
| Ret sebebi yarışmacıya | `app/lib/mailer.ts`, `app/api/applications/[id]/route.ts`, `app/lib/workflow-db.ts` | Karar tamamlanınca yarışmacıya e-posta gönderilir (sağlayıcı yoksa giden kutusu). Ret ve revizyon kararları sonuçlar yayımlanmayı beklemeden “Başvurularım” ekranında gerekçesiyle görünür; **kabul** kararı eskisi gibi yayına kadar kapalıdır. Mail gönderilemezse karar geri alınmaz, Hakeme uyarı düşer |

### Kök neden — "İşlem tamamlanamadı" (kriter yayımı)

`criteria` tablosunda `id` **genel** bir birincil anahtar (`migrations/0005_final_workflow.sql:28`),
analiz motoru ise her belgede aynı `criterion-1..N` kimliklerini üretiyor. Yayımdan önceki
`DELETE FROM criteria WHERE profile_id = ?` yalnızca o profilin satırlarını sildiği için
**ikinci** profil yayımı her seferinde `UNIQUE constraint failed: criteria.id` ile düşüyor,
`handleError` bunu genel 500 mesajına çeviriyordu.

- **Düzeltme:** satır kimliği artık `${profileId}:${position}:${criterionId}`. Kriterin kendi
  kimliği `criterion_json` içinde değişmeden korunur; bulgu eşleştirmesi orayı okur ve
  `criteria` tablosunu hiçbir sorgu okumaz (yalnızca denormalize indeks).
- **Regresyon testi:** `tools/regression-tests.mjs` — iki farklı profilin 74'er kriteri ve aynı
  profilde tekrarlanan kimlik için çakışma olmadığını doğrular. Düzeltme geri alınınca test düşüyor.
- **Hata mesajları:** `handleError` artık her beklenmeyen hataya bir referans kodu üretir
  (günlükteki satırla eşleşir) ve üretim dışı ortamda nedeni okunur Türkçeye çevirir
  (benzersizlik / NOT NULL / yabancı anahtar / şema / D1). Üretimde yalnızca referans kodu gider.
  İstemci tarafında `responseJson` gerekçesiz yanıtı HTTP durumuna göre cümleye çevirir;
  Kriter Atölyesi yayım hatasını onay çubuğunun üstünde kırmızı bir blokta gösterir.

### Kök neden — "Başvuruyu gönder" sessizce başarısız

Düğme isteği gönderiyordu; sunucu reddediyordu ve reddin gerekçesi **sayfanın en
üstündeki** şeritte basılıyordu. Uzun formun dibindeki kullanıcı bunu hiç görmüyor,
"hiçbir şey olmuyor" olarak yaşıyordu. Reddin başlıca sebebi: seçilen yarışma
başvuruya açık değil (`competitions.status != 'open'` ya da yayımlanmış profil yok) —
liste 40 yarışmanın tamamını sunduğu için kapalı bir yarışma seçilebiliyordu.

- **Seçim listesi daraltıldı:** `GET /api/applications` artık `openCompetitions`
  döndürüyor (`listOpenCompetitionNames`); `CompetitionSelect` aldığı `allowed`
  listesiyle yalnızca başvuruya açık yarışmaları gösteriyor. Hiç açık yarışma yoksa
  bunu açıkça yazıyor. Sunucudaki `competitionAcceptsApplications` kontrolü yerinde —
  bu yalnızca kullanıcıyı çıkmaz bir seçimden koruyor.
- **Hata artık görünür:** gönderme hatası düğmenin hemen altında kırmızı blokta
  gösteriliyor ve oraya kaydırılıyor; sunucunun gerekçesi, referans kodu ve ağ
  kopması ayrı ayrı yazılıyor. Sayfa üstündeki şerit yükleme hataları için kaldı.
- **409 mesajı ayrıştırıldı:** "açık değil VEYA profil yok" ikilemi yerine gerçek
  sebep yazılıyor (kriter yayımlanmadı / profil yok / yarışma durumu "X").
- **R2 bağlaması yoksa:** `ReportStorageUnavailableError` artık genel 500'e düşmüyor;
  503 ve "dosya deposu (R2 REPORTS bağlaması) tanımlı değil" mesajı dönüyor.
- **Yükleme sağlamlaştırıldı:** `reportBucket().put(key, file.stream())` yerine
  `File` (Blob) doğrudan veriliyor; ReadableStream'de R2 içerik uzunluğunu bilemediği
  için yükleme sessizce düşebiliyordu.
- **Dosya boyutu:** 17 KB gibi küçük dosyalar `0.0 MB` yerine gerçek boyutuyla yazılıyor.

### Kök neden — "yayında" ama yarışmacı yarışmayı seçemiyor

Yayımlanan profilin yarışma adı **şartnameden AI ile çıkarılır** (ör. "TEKNOFEST
Havacılık, Uzay ve Teknoloji Festivali"). Hem yarışmacının seçim listesi hem de
`POST /api/applications` doğrulaması ise koddaki **sabit 72 kayıtlık `COMPETITIONS`
havuzuna** bağlıydı. Çıkarılan ad havuzda yoksa yarışma listede hiç görünmüyor,
elle yazılsa bile "Listeden geçerli bir yarışma seçin." ile reddediliyordu — yani
yayımlanan profil hiçbir zaman başvuru alamıyordu.

- **Yetkili kaynak değişti:** yarışma adının otoritesi artık yayımlanmış profildir.
  `listOpenCompetitions()` başvuruya açık yarışmaları (ad + kategori etiketi) döndürür;
  `POST` yalnızca `competitionAcceptsApplications` kontrolüne bakar, sabit havuz şartı kalktı.
- **Seçici genelleştirildi:** `searchCompetitionList(entries, query)` ile arama artık
  verilen liste üzerinde çalışıyor; `CompetitionSelect` `options` aldığında kayıtlı
  havuzu değil o listeyi arıyor. Kayıtlı havuzda olmayan bir yarışma da seçilebiliyor.
- **Yayım hedefi düzenlenebilir oldu:** Kriter Atölyesi'nin inceleme adımına
  "Bu kriterler hangi yarışma için yayımlanacak?" bölümü eklendi (yarışma adı, yıl,
  aşama, rapor türü). AI yanlış okuduysa yönetici yayımdan önce düzeltir; yarışma adı
  boşken profil yayımlanamaz.
- **Regresyon testi:** kayıtlı havuzda bulunmayan açık bir yarışmanın aramada
  bulunduğu doğrulanıyor.

Bilinen sınır: yönetici aynı şartnameyi düzeltilmiş bir yarışma adıyla yeniden
yayımlarsa yeni bir `competition_key` üretilir ve eski kayıt "başvuruya açık" kalır.
Eski kaydı kapatmak Değerlendirme Yöneticisi'nin aşama yönetimi işidir (`/api/operations`).

### Kök neden — Hakem "AI analizini başlat" dediğinde analiz düşüyor

`/api/analyze` 25 Ağustos'ta çok turlu yeniden deneme motoruna geçirilmişti;
`/api/evaluate-report` ise **eski ince döngüde** kalmıştı: iki model, her birine bir
deneme, bekleme yok, soğutma yok. `gemini-3.7-flash` ağır PDF çağrılarında 503
döndüğünde (bkz. B1) iki deneme de tükeniyor ve kullanıcı içi boş
"AI rapor analizi tamamlanamadı. Lütfen yeniden deneyin." mesajını alıyordu — 503
o mesaj listesinde hiç yoktu.

- **Ortak motor:** `app/lib/gemini-generation.ts` (yeni). Model sweep'leri, model
  soğutma kayıt defteri, yeniden deneme bütçesi ve hata taksonomisi tek yerde.
  `/api/evaluate-report` bu motora geçti; `/api/analyze` da aynı **paylaşılan** soğutma
  defterini kullanıyor, böylece bir ucun "bu model şu an 503" bilgisi diğerinde de geçerli.
- **Hata nedeni söyleniyor:** 503 → "AI modeli şu anda yoğun ve yedek modeller de
  yanıt vermedi"; tükenmiş bakiye hız sınırından ayrıldı; sınıflandırılamayan hatada
  sunucunun bildirdiği neden mesaja yazılıyor. İçi boş "tamamlanamadı" cümlesi kalktı.
- **Hakem çıkmaza düşmüyor:** geçici model yokluğu (429/503/504) artık istemciye 503
  ile iletiliyor. `report-evaluator` bunu "motor şu an yok" olarak okuyup **deterministik
  ön kontrollerle** (dosya kapısı, dil, şablon, başlık, benzerlik) sonucu üretiyor ve
  gerçek nedeni uyarı olarak gösteriyor. Hakem boş ekranla kalmıyor.
- **Canlı doğrulama:** `runGeneration` gerçek Gemini API'sine 1.8 MB'lık PDF ile
  çağrıldı — 11.7 sn'de `gemini-3.7-flash` yanıtladı. `npm run check:gemini` de
  her iki modeli çalışır bildiriyor.
- **Regresyon testi:** hata taksonomisi (503 → geçici + 503, bakiye ≠ hız sınırı,
  401 → 502, sınıflandırılamayan hatada nedenin mesaja girmesi) doğrulanıyor.

Ölçüm notu: bu akış tip kontrolü, lint, regresyon testi ve üretim derlemesinden
geçti. Uçtan uca canlı doğrulama D1 + R2 bağlı bir ortam gerektirir (bkz. E3).

## 2. Doğrulanmış güncel durum

| Kontrol | Komut | Sonuç |
|---|---|---|
| Tip kontrolü | `npx tsc --noEmit` | ✅ temiz |
| Lint | `npm run lint` | ✅ temiz |
| Depo güvenliği | `npm run check:repo-safety` | ✅ PASS |
| Regresyon testleri | `npm run test:regressions` | ✅ PASS |
| Puanlama testleri | `npm run test:scoring` | ❌ 5 dosya düşüyor — **ortam sorunu**, bkz. E1 |
| AI erişimi | `npm run check:gemini` | ✅ anahtar + iki model çalışıyor |
| Doğruluk benchmarkı | `node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze` | ❌ düşüyor — bkz. A1 |

Benchmark **%100 eşik** istiyor: puan grupları, görevli kararı ve kural kapsamı tam
isabet olmalı. Puan matematiği tarafı tam; düşen ölçütler doğruluk tarafında.

---

## 3. Eksikler ve düzeltilmesi gerekenler

Sıra önem derecesine göre. "Dosya" sütunu işe nereden başlanacağını gösterir.

### A · Doğruluk (ürünün asıl değeri burada)

| # | İş | Bugünkü durum | Yapılması gereken | Dosya |
|---|---|---|---|---|
| **A1** | Görevli kararı isabeti | %33–67 arası dalgalanıyor; benchmark'ı düşüren birincil ölçüt | Fiziksel güvenlik/insan kararı gerektiren maddeleri `human`/`hybrid` olarak işaretleyen kural regex tabanlı olduğu için kaçırıyor. Kalıp eşlemesi yerine kriter türü + etkisinden türeyen deterministik kural yazılmalı | `app/components/criteria-app.tsx` → `applyDecisionSafetyPolicy` |
| **A2** | Kural kapsamı | %76.9–92.3 | Kısmi kalan maddeler hep aynı tipte: sayfa üst sınırı ("ÖTR azami 10 sayfa") ve ardışık başarısızlık cezası. Bu iki kalıp için hedefli çıkarım gerekiyor | `app/api/analyze/route.ts` (RANGE talimatı) |
| **A3** | Rapor değerlendirme motorunun doğruluğu | **Hiç ölçülmedi.** Motor bağlı ve çalışıyor (ön kontroller + AI bulguları + insan yönlendirmesi), ama doğruluğunu ölçen bir benchmark yok | Kriter çıkarma tarafındaki gibi elle doğrulanmış cevap anahtarı ve karşılaştırma aracı yazılmalı | `app/api/evaluate-report/route.ts` |
| **A4** | İDA cevap anahtarı | `docs/benchmarks/ida-ground-truth.json` sadece 2.2 KB şema + "nasıl doldurulur" notu — **içi boş** | Resmî 315 puanlık şartnameden elle doldurulmalı. İkinci bir belgeyle ölçmeden tek belgeye aşırı uyum riski var | `docs/benchmarks/ida-ground-truth.json` |
| **A5** | Nihai durum üretimi | `ReportStatus` (`received/analyzing/analyzed/reviewed`) var ama **karar durumu** (`geçti / kaldı / eleme / inceleme gerekli`) hiçbir yerde türetilmiyor | Baraj + ceza + eleme kurallarından nihai durum üreten tek fonksiyon; hakem ekranı ve yarışmacı görünümü bunu okumalı. Ceza uygulaması (`applyPenalties`) artık bağlı, eksik olan durum katmanı | `app/lib/evaluation-summary.ts` |

### B · Model ve maliyet

| # | İş | Bugünkü durum | Yapılması gereken |
|---|---|---|---|
| **B1** | Birincil model dalgalı | `gemini-3.7-flash` 26.08 ölçümünde 1.8 MB'lık PDF'i 11.7 sn'de yanıtladı; ağır çağrılarda aralıklı 503 dönmeye devam ediyor. Artık analizi düşürmüyor (çok turlu yeniden deneme + soğutma) | `.env.local`'de `GEMINI_MODEL` doğrulanmış çalışan bir modele alınmalı. Bugün 200 dönenler: `gemini-3.6-flash`, `gemini-flash-latest`, `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`. Kalite kararı ekibin |
| **B2** | Faturalama bakiyesi | Ön ödemeli kredi aralıklı tükeniyor | ai.dev/projects üzerinden bakiye ve uyarı eşiği ayarlanmalı. Kod artık bu durumu doğru mesajla bildiriyor ama çözemez |
| **B3** | Analiz süresi | 185–294 s (25 sayfalık belge) | **Üretim riski:** Cloudflare Workers istek süre sınırı bu değerlerin altında olabilir; dağıtımdan önce ölçülmeli. Çözüm yönü: analizi arka plan işine alıp istemciye iş kimliği döndürmek |
| **B4** | Çağrı bazında token dökümü | Toplam token, API çağrısı ve belge taşıma sayısı ölçülüyor; birincil tur ile denetim turunun ayrı harcaması **raporlanmıyor** | `AnalysisDiagnostics` içine çağrı bazlı döküm; denetim turunun gerçek maliyetini görmeden `EVIDENCE_VERIFICATION` kararı verilemiyor |
| **B5** | Denetim turunun değeri | Denetim turu 8 bulgu işaretliyor ama bunların gerçek mi gürültü mü olduğu **bilinmiyor** (cevap anahtarında karşılığı yok) | A4 tamamlanınca ölçülmeli; iki çağrılı mimari bu yüzden hâlâ duruyor (`EVIDENCE_VERIFICATION=off` kaçış kapısı mevcut) |

### C · Veri kalıcılığı

| # | İş | Bugünkü durum | Yapılması gereken |
|---|---|---|---|
| **C1** | Belge havuzu cihaza bağlı | Tarayıcı içi IndexedDB. `DocumentRepository` arayüzü hazır, sunucu uygulaması yok | R2 tabanlı sunucu uygulaması; ekip ortak havuzu ancak böyle mümkün. Bugün başka bilgisayardan aynı havuz görülmüyor |
| **C2** | Yarışma listesi kodda sabit | `COMPETITIONS` dizisi 40 kayıt; seçim `setup.competition` **ad dizgesiyle** taşınıyor | Kalıcı `competitionId`; ad değişirse eski profiller kopuyor. D1'de `competitions` tablosu ve `competitionId` akışı zaten var, kriter tarafı bağlanmamış |
| **C3** | Cloudflare kaynakları | 5 göç dosyası hazır (`migrations/0001`–`0005`), uygulanmadı | D1 ve R2 kaynaklarının oluşturulması, göçlerin uygulanması, sunucu sırlarının tanımlanması — dağıtım işi |

### D · Arayüz

| # | İş | Bugünkü durum | Yapılması gereken |
|---|---|---|---|
| **D1** | Uygulama ikonu | `public/favicon.svg` hâlâ "Kriter Atölyesi" kimliğinde; sol rayda `KA` rozeti | AI-Gambit kimliğine uygun favicon, PNG/apple-touch/manifest |
| **D2** | Değerlendirme kılavuzu ekranı | Kriter, açıklama, puan, azami, baraj, ceza ve geçiş koşulu ekranda **dağınık** | Tek tabloda, tek bakışta okunabilir bilgi hiyerarşisi |
| ~~**D3**~~ | ~~Kriter silme~~ | **Tamamlandı (26.08).** Her kriter — AI'nin çıkardıkları dahil — denetçi başlığındaki ve alt bölümdeki iki adımlı onayla silinebiliyor | — |
| **D4** | Dar ekran | Media query kuralları **gerçek dar ekranda doğrulanmadı** | 360/768/1024 px'de elle kontrol |
| **D5** | Ölü CSS | `.setup-preview h2` ve `.setup-preview > p` artık var olmayan yapıyı hedefliyor | `app/globals.css:566-567` silinmeli |

### E · Geliştirme ortamı

| # | İş | Bugünkü durum | Yapılması gereken |
|---|---|---|---|
| **E1** | `npm run test:scoring` çalışmıyor | 5 test dosyası `ERR_UNKNOWN_FILE_EXTENSION: .ts` ile düşüyor. Node 22.14 `.ts` dosyalarını bayrak olmadan yükleyemiyor (`test:regressions` bayrağı taşıyor, bu script taşımıyor) | `package.json` içinde `node --test` → `node --experimental-strip-types --test`, ya da Node 22.18+ gerekliliği. **Bu düşme koddaki bir hata değil** |
| **E2** | Benchmark öntanımlı adresi | Öntanımlı `127.0.0.1:3000`, ama `vinext dev` bu makinede IPv6'ya bağlanıyor → `ECONNREFUSED` | `localhost` öntanımlı olmalı; şimdilik adres elle verilmeli |
| **E3** | Yerel D1 oturum testi | Windows'ta `workerd.exe` işletim sistemi politikasıyla engellenebiliyor | Uçtan uca oturum testi için dağıtım ortamı veya politika izni gerekiyor |

### F · Güvenlik

| # | İş | Yapılması gereken |
|---|---|---|
| **F1** | API anahtarı ifşası | Mevcut `GEMINI_API_KEY` sohbet ortamında düz metin paylaşıldı. AI Studio'dan **iptal edilip yenilenmeli** |
| **F2** | Üretim sırları | `MODERATOR_SECRET` üretimde uzun ve rastgele olmalı; `ALLOW_DEV_LOGIN=off` ve `APP_ENV=production` doğrulanmalı |

---

## 4. Eski raporlardaki, artık geçerli olmayan maddeler

Silinen raporlar bu işleri "eksik" diye listeliyordu; bugün kodda **yapılmış** durumda.
Tekrar yapılmasın:

- **Cezanın skora uygulanması** — `applyPenalties` artık hesap yolunda çağrılıyor
  (`app/components/evaluation-app.tsx:685` ve `:1157`), test kapsamı var.
- **İkinci AI aşamasının bağlanması** — `app/api/evaluate-report/route.ts` çalışıyor;
  deterministik ön kontroller (dosya kapısı, dil, başlık, şablon, benzerlik) ayrı bir
  katmanda (`app/lib/report-prechecks.ts`). Eksik olan doğruluk **ölçümü** (A3), motorun
  kendisi değil.
- **API anahtarının tarayıcıya sızması** — anahtar yalnızca sunucu ortamında; analiz
  isteği sunucudan yapılıyor.

---

## 5. Silinen belgeler

Aşağıdaki 7 dosya kaldırıldı: hepsi tarihli, tek seferlik oturum raporuydu, birbirini ve
kalan belgeleri tekrar ediyordu, hiçbirine kod veya belge atıf yapmıyordu. İçerdikleri
güncel bilgi bu belgeye taşındı; değişiklik geçmişi zaten git'te.

| Silinen | Neden | İçeriği nerede |
|---|---|---|
| `DEGISIKLIK_RAPORU.md` (29.6 KB) | 24 Ağustos, `Deneme` dalı, "eskiden/şimdi" raporu | Eksik iş listesi → bölüm 3 |
| `SISTEM_OZETI_VE_SON_AI_PLANI.md` (15.6 KB) | Önerdiği A–J algoritması büyük ölçüde uygulandı | Tamamlanma ölçütleri → A3, A4 |
| `NIHAI_ENTEGRASYON_RAPORU.md` (8.1 KB) | Silinen rapora atıf yapan birleştirme raporu | Dışarıda bırakılanlar → C3, A3 |
| `CHANGES.md` (7.7 KB) | Tek tarihli değişiklik kaydı; git geçmişiyle çakışıyor | — |
| `docs/SON_ENTEGRASYON_DUZELTMELERI.md` (4.4 KB) | 24 Ağustos düzeltme + test raporu | Test durumu → bölüm 2 |
| `docs/PDF_MERKEZLI_AKIS_GUNCELLEMESI.md` (3.9 KB) | Ürün kararı `README`/`NIHAI_SISTEM_AKISI`'nda zaten var | — |
| `PAYLASIM_NOTU.md` (1.0 KB) | Kurulum adımları `GUIDE.md`'de var; ayrıca **yanlış** (Node 20 diyor, `package.json` ≥22.13 istiyor) | `GUIDE.md` |

`NIHAI_SISTEM_AKISI.md` korundu (güncel mimari), ancak içindeki bayat "34/34 test
başarılı" bölümü kaldırılıp bu belgeye yönlendirildi.

---

## 6. Doğrulama komutları

```bash
npm run check:gemini          # anahtar, model adları ve gerçek üretim çağrısı
npx tsc --noEmit              # tip kontrolü
npm run lint                  # lint
npm run check:repo-safety     # depoya sır kaçmış mı
npm run test:regressions      # regresyon testleri

# Doğruluk benchmarkı — sunucu ayakta olmalı, adres elle verilmeli (bkz. E2)
npm run dev
node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze
```
