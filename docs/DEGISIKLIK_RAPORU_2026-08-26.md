# Değişiklik raporu · 26.08.2026

**Dal:** `son_merge_deneme` (temel `4228c24`)
**Commit / push yapılmadı.** Değişiklikler çalışma ağacında bırakıldı.

Bu oturumda iki iş yapıldı: belge havuzu 10 hazır belgeye çıkarıldı ve şartname
analizinin 150 saniyede zaman aşımına uğraması giderildi. İkinci iş bir tahmine
değil, gerçek API karşısında yapılan kontrollü ölçümlere dayanıyor; ölçümler
aşağıda olduğu gibi duruyor.

---

## 1. Belge havuzu 4 → 10 hazır belge

`corpus/` altındaki resmî TEKNOFEST şartnamelerinden altısı `public/samples/`
altına ASCII adlarla kopyalandı ve `app/lib/sample-documents.ts` içine kaydedildi.
Belge havuzu ekranındaki sayaç `SAMPLE_DOCUMENTS.length` üzerinden geldiği için
(`app/components/criteria-app.tsx:270`) ayrı bir güncelleme gerekmedi.

| Belge | Sayfa | Neden seçildi |
|---|---|---|
| Robotaksi - Binek Otonom Araç | 38 | İki araç kategorisi, Teknik Yeterlilik Formu → KTR zincirleme eleme, ceza ve diskalifiye koşulları |
| Sağlıkta Yapay Zeka | 19 | Lise/üniversite için ayrı görev tanımları, rapor puanları yalnızca eleme amaçlı, %90 final + %10 sunum |
| Tarım Teknolojileri | 23 | Alt kategoriler, üç aşamalı değerlendirme, baraj puanı ve 25 puanlık itiraz eşiği |
| TÜRKSAT Model Uydu | 29 | Etap bazlı yüzde ağırlıkları (PDR %18, CDR %10, QR %20, uçuş %50, PFR %2), bonus görevler |
| İnsanlık Yararına Teknolojiler - Lise | 15 | Yalnızca lise seviyesine açık üç kategori; ara puanlar finale taşınmıyor |
| Blokzincir | 15 | Dört aşamalı yüzdelik puanlama (%10 / %15 / %15 / %60), nitel kriter başlıkları |

Puanlama yapıları bilinçli olarak farklı seçildi: KTR/CDR tabanlı mühendislik
yarışmaları, etap ağırlıklı uçuş yarışması, saf yüzdelik proje yarışması ve ara
puanların finale yansımadığı yapı. Böylece kriter çıkarımı farklı şartname
kalıplarında sınanabiliyor.

Üstveri belgelerin kendisinden doğrulandı: sayfa sayıları `pdfjs-dist` ile
sayıldı, yarışma adları `app/lib/competitions.ts` havuzundaki adlarla birebir
eşleşiyor, kategori/aşama değerleri `DEFAULT_STRUCTURE` seçenekleriyle uyumlu.

---

## 2. Şartname analizi 150 saniyede zaman aşımına uğruyordu

### Belirti

Yönetici bir şartname yükleyip "Belgeyi analiz et" dediğinde işlem **153,3 saniye**
sürüyor ve ekranda şu çıkıyordu:

> AI belge analizi zaman sınırı içinde tamamlanamadı: AI modeli yanıt vermedi.

Aynı belge başka bir makinede kısa sürede tamamlanıyordu.

### Kök neden

`.env.local` dosyasındaki `GEMINI_MODEL=gemini-3.5-flash`. Bu model, aynı istek
gövdesinde **kararsız biçimde hiç yanıt üretmiyor**. Analiz ucundaki sınır
150 saniye olduğu için (`app/api/analyze/route.ts`) istek tam o duvara çarpıyordu:
~1,7 sn Files API yüklemesi + 150 sn kesme = gözlenen 153,3 saniye.

Ölçüm — 19 sayfalık şartname PDF'i (1,5 MB), aynı istek gövdesi, tek değişken
model adı, şema + `MEDIA_RESOLUTION_LOW` + `thinkingLevel LOW` + `maxOutputTokens 24576`
sabit:

| Model | Sonuç | Süre | Giriş token | Kriter |
|---|---|---|---|---|
| `gemini-3.5-flash` (eski `.env.local` ayarı) | **13 denemenin 8'i yanıtsız** | — | 7 344 | — |
| `gemini-3.6-flash` | 3/3 başarı | **16,3 – 21,0 sn** | 7 344 | 12 – 16 |
| `gemini-3-flash-preview` (eski kod varsayılanı) | 1/1 başarı | 77,4 sn | 12 398 | 14 |
| `gemini-flash-latest` | 2/2 **503 UNAVAILABLE** | — | — | — |
| `gemini-2.5-flash` | **404** — API'nin kendi yanıtı: *"Please update your code to use models/gemini-3.6-flash"* | — | — | — |

`gemini-3-flash-preview` çalışıyor ama dört kat yavaş ve o modelde
`mediaResolution` uygulanmıyor: giriş tokenı 7 344 yerine 12 398'de kalıyor.

**"Arkadaşımda çalışıyor" farkı:** `.env.local` dosyasında bu satırı
değiştirmemiş bir geliştirici kod varsayılanını kullanıyordu; o model 77,4 sn'de
bitirdiği için 150 sn sınırının altında kalıyor ve "çalışıyor" görünüyordu.

### Elenen şüpheliler

Bunların hiçbiri suçlu değil; hepsi ölçümle çürütüldü:

| Şüpheli | Nasıl elendi |
|---|---|
| Düşünme bütçesi | `thinkingBudget: 0` ile de asıldı |
| Uzun çıktı | `maxOutputTokens: 2048` ile de asıldı |
| `responseJsonSchema` | Şema tamamen kaldırıldığında (`--schema none`) da asıldı |
| `mediaResolution`'ın iç içe biçimi | Gerçekten uygulanıyor: giriş tokenı 12 398 → 7 344'e düşüyor |
| Teslim yolu (inline / `fileUri`) | Her ikisinde de aynı model asıldı, çalışan model her ikisinde geçti |
| API anahtarı / erişim | Aynı anahtarla `models.list`, `gemini-3.6-flash` ve `gemini-3-flash-preview` 200 dönüyor |

Eski `responseSchema` yoluna dönmek **çözüm değil**: şemadaki birleşim tipleri
(`type: ["string","null"]`, `app/lib/criteria-extraction.ts:45`) o yolda
`400 INVALID_ARGUMENT` veriyor — *"Unknown name \"type\" ... Proto field is not
repeating, cannot start list."*

### Yapılan değişiklikler

| Dosya | Değişiklik |
|---|---|
| `.env.local` | `GEMINI_MODEL` → `gemini-3.6-flash`; ölçüm tablosu yoruma yazıldı; kodun **hiç okumadığı** `GEMINI_MAX_ATTEMPTS` ve `GEMINI_TOTAL_BUDGET_MS` satırları silindi (tek çağrı politikasından kalan ölü ayarlar) |
| `app/api/analyze/route.ts:49` | Varsayılan model → `gemini-3.6-flash`, gerekçesi ölçüm tablosuyla yoruma yazıldı |
| `app/api/evaluate-report/route.ts:55` | Aynı varsayılan |
| `.env.example:2` · `tools/check_gemini_access.mjs:40` | Aynı varsayılan |
| `app/api/analyze/route.ts:72` | Sabit 150 sn yerine **kademeli sınır**: `generationTimeoutFor(pageCount)` — <40 sayfa 60 sn · 40–79 sayfa 100 sn · 80+ sayfa 150 sn. Eşikler `thinkingLevelFor` ile aynı |
| `app/lib/gemini-generation.ts:89` | `catch {}` → `catch (error)`: zaman aşımı ile ağ hatası ayırt ediliyor, model adı ve geçen süre `console.error` ile günlüğe yazılıyor. Ağa hiç çıkılamadığında `apiCalls` artık **0** (faturalanmayan istek 1 sayılıyordu) |
| `app/lib/gemini-generation.ts:170` | 504 mesajı artık `GEMINI_MODEL`'i işaret ediyor ve `npm run check:gemini` öneriyor |
| `app/api/analyze/route.ts:263` | `AQ.` ön ekli anahtarlar kabul ediliyor |
| `GUIDE.md` · `README.md` | Kurulum talimatındaki ve Gemini bölümündeki eski model adı güncellendi |

**Kademeli sınır ile model değişikliği birlikte uygulanmak zorunda:** 60 saniye,
eski varsayılanın 77,4 saniyesini keserdi.

Kademeli sınırın ikinci gerekçesi eşzamanlılık: takılı bir istek
`acquireAnalysisPermit` iznini sınır boyunca elinde tutuyor
(`app/lib/request-guard.ts`) ve varsayılan `ANALYSIS_MAX_CONCURRENT=2` ile iki
takılı analiz diğer bütün kullanıcılara o süre boyunca 429 verdiriyordu.

### Neden 504 mesajı yanlış yöne gönderiyordu

Üç ayrı kusur üst üste binmişti:

1. `catch {}` hata nesnesini tamamen atıyordu; zaman aşımı, DNS hatası, TLS/vekil
   engeli ve bağlantı kopması **aynı** 504 mesajına çıkıyordu.
2. Zaman aşımı yolunda **hiç günlük kaydı yoktu** (karşılaştırma: reddedilen
   istek `gemini-generation.ts` içinde loglanıyor). 150 saniyelik başarısızlık
   sunucuda hiçbir kanıt bırakmıyordu.
3. Mesaj yalnızca "Yeniden dene" diyordu. Gerçek neden yapılandırma olduğu için
   kullanıcı aynı duvara tekrar tekrar çarpıyordu.

Ayrıca anahtar ön eki denetimi yalnızca `AIza` kabul ediyordu; üretimdeki anahtar
`AQ.` ile başladığı hâlde geçerli olduğu için her istekte "anahtar reddedilebilir"
uyarısı basılıyor ve tanıyı anahtara yönlendiriyordu.

### Doğrulama

Tam üretim ayarıyla, gerçek API'ye karşı üç koşu:

| # | Süre | HTTP | Kriter | Giriş token | `finishReason` |
|---|---|---|---|---|---|
| 1 | 19,0 sn | 200 | 13 | 7 344 | STOP |
| 2 | 15,6 sn | 200 | 11 | 7 344 | STOP |
| 3 | 18,7 sn | 200 | 15 | 7 344 | STOP |

Files API yüklemesi her koşuda 1,5 – 1,6 sn. Beklenen uçtan uca süre: **~18-23 sn**.

`npx tsc --noEmit` temiz · `npm run lint` temiz · `node tools/check_repo_safety.mjs` PASS.

> `.env.local` değişikliğinin etkili olması için **dev sunucusunun yeniden
> başlatılması** gerekir; ortam değişkenleri yalnızca açılışta okunur.

---

## 3. Açık kalan konular

Bunların hiçbiri bu oturumda düzeltilmedi.

### Test paketi çalışmıyor (önceden var olan)

`npm run test:unit` 5/5 başarısız. Bu değişikliklerden **önce de** başarısız
(`git stash` ile doğrulandı). Neden: `tools/ts-resolve-hook.mjs` içindeki
`registerHooks`, `node:module` üzerinde Node 22.15+ gerektiriyor; ortamda
Node 22.14.0 var. Node'u yükseltmek çözer.

### Ölçülmemiş kalanlar

- `gemini-3.5-flash`'in **neden** tıkandığı belirlenemedi: tek API anahtarıyla
  test edildi, dolayısıyla "model genel olarak yavaş" ile "bu proje o modelde
  kuyruğa takılıyor" ayırt edilemez. Hiçbir koşuda 429 görülmedi; asılan
  koşularda hata gövdesi de gelmedi.
- 40+ ve 80+ sayfalık belgelerde `gemini-3.6-flash`'in süresi ölçülmedi. Yani
  100 sn ve 150 sn kademeleri eski sınırdan devralındı, doğrulanmadı.
- `thinkingLevelFor` MEDIUM (40-79 sayfa) ve HIGH (80+ sayfa) dalları hiç
  ölçülmedi; 19 sayfalık belge LOW dalına düşüyor.
- `app/api/evaluate-report/route.ts:57` hâlâ **sabit 150 sn** kullanıyor ve
  `thinkingLevel: "HIGH"` ile çalışıyor. Model düzeltmesi oraya da geçti, ancak
  rapor analizi ölçülmediği için sınır kademelendirilmedi.
- Barındırma platformunun kendi işlev süresi sınırı ölçülmedi; kodda
  `maxDuration` / `runtime` ihracı yok. Platform sınırı bizim sınırımızdan
  kısaysa kullanıcı özenle yazılmış hata mesajını hiç görmez.

### Kod incelemesinde çıkan, düzeltilmeyen bulgular

- **Akış yok.** `:generateContent` akışsız; sınıra kadar hiçbir kısmi çıktı
  gösterilemiyor. `:streamGenerateContent` ile ilk kriterler saniyeler içinde
  akıtılabilirdi.
- **Yükleme ve üretim bütçeleri ayrı.** Files API yüklemesi (60 sn + yoklamalar)
  üretim sınırından bağımsız; uçtan uca tek bir son tarih yok.
- **Önbellek anahtarı** `EXTRACTION_SYSTEM_INSTRUCTION` ve `EXTRACTION_SCHEMA`
  içeriğini kapsamıyor; yalnızca elle güncellenen `EXTRACTION_PROMPT_VERSION`
  dizgesine güveniliyor. İstem/şema değiştirip sürümü artırmayı unutmak eski
  sonucun dönmesine yol açar. `MAX_OUTPUT_TOKENS`, `temperature`/`topP` ve
  teslim yolu da anahtarda değil.
- **Önbellek `globalThis` üzerinde bellek içi Map**, tavan 12; her soğuk
  başlangıçta sıfırlanır, çok işçili çalıştırmada paylaşılmaz.
- **Önbellek isabetinde de** geçmişe yeni bir çalıştırma satırı yazılıyor; aynı
  belge için tekrarlı kayıtlar birikiyor.

### Belgelerdeki çelişki

`FINAL_ENTEGRASYON_RAPORU.md` (bölüm 7.1) `gemini-3-flash-preview` ile
9,3 / 14,4 / 14,1 sn ölçüm bildiriyor. Bu oturumda aynı model 77,4 sn ölçüldü.
Fark açıklanamadı — belgeler farklı (Çelikkubbe 25 sayfa ile Sağlıkta YZ 19
sayfa), tarih ve API koşulları farklı, ve o kaydın önbellek isabeti olup olmadığı
bilinmiyor. Eski kayıt tarihli bir ölçüm olduğu için **değiştirilmedi**; burada
çelişki olarak işaretlendi.
