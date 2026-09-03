# Değişiklik Raporu — 3 Eylül 2026

**Dal:** `faruk_finalsonrasi_main1` · **Temel işleme:** `eead40e` ("prompt 1 sonuç")
**Commit/push/merge yapılmadı**; değişiklikler çalışma ağacında incelemeye bırakıldı.

Bu oturumda üç iş yapıldı:

1. **Şartname analizi hiç çalışmıyordu** (500 "beklenmeyen hata") — sunucuda PDF.js açılamıyordu.
2. **Hakem rapor analizi, kriter kararları ve katılımcı akışı** güçlendirildi (12 alan).
3. **25 sayfalık şartnameden 5 kriter çıkıyordu** — üç ayrı kusur düzeltildi, 33 kritere çıktı.

Değişiklik hacmi: 19 dosya güncellendi (+1730 / −265), 8 dosya eklendi (1533 satır),
1 göç dosyası eklendi.

---

## 1. Şartname analizi 500 hatası

### Belirti

Yarışma Yöneticisi PDF yükleyip "Belgeyi analiz et" dediğinde:

> Belge analiz edilemedi. Belge analizi sırasında beklenmeyen bir hata oluştu.
> API bağlantısını, kotayı veya kaynak belgenin geçerliliğini kontrol edin.

Mesaj yanıltıcıydı: Gemini anahtarı, kotası ve belge tamamen sağlamdı
(`node tools/check_gemini_access.mjs` → PASS).

### Kök neden

`eead40e` işlemesi PDF'i sunucuda yapısal bloklara ayırmaya başladı
(`extractPdfStructure`). Ancak uç **Cloudflare Workers (workerd)** üzerinde çalışıyor
ve PDF.js orada iki noktada patlıyordu:

| # | Hata | Sebep |
|---|---|---|
| A1 | `ReferenceError: DOMMatrix is not defined` | `pdfjs-dist` modül gövdesinde `new DOMMatrix()` çağırıyor (`SCALE_MATRIX`). Node'da bu global `@napi-rs/canvas`'tan, tarayıcıda DOM'dan gelir; workerd'de ikisi de yok → **modülün içe aktarılması** patlıyordu |
| A2 | `Setting up fake worker failed` | workerd'de `Worker` global'i yok; PDF.js "fake worker" yoluna düşüp `pdf.worker.mjs`'i dinamik `import()` ile yüklemeye çalışıyor, bu yol paketlenmiş sunucu ortamında çözülemiyordu |

İkisi de `route.ts`'in en dıştaki `catch` bloğuna düşüp 500 üretiyordu.

> Not: `app/lib/pdf-page-count.ts` başlığında bu risk zaten yazılıydı —
> *"PDF.js tarayıcıda kullanılır; Cloudflare sunucu paketinde DOM/canvas
> bağımlılığı doğurur."* Yeni kod bu notu atlamış.

### Çözüm

| Dosya | Değişiklik |
|---|---|
| `app/lib/pdfjs-runtime.ts` **(yeni, 171 satır)** | Sunucu için asgari `DOMMatrix` (gerçek 2B afin dönüşüm: `multiplySelf`, `preMultiplySelf`, `invertSelf`, `translate`, `scale`, `a…f` + `m11…m42`) ve `Path2D` kabuğu. Ardından çözümleyici modülü `globalThis.pdfjsWorker` alanına yerleştirilir — PDF.js'in kendi desteklediği kaçış kapısı: alan doluysa hiçbir dosya yolu çözülmez, çözümleyici aynı iş parçacığında çalışır. **Var olan globaller asla ezilmez**, yani tarayıcı ve Node yolları etkilenmez |
| `app/lib/pdf-structure.ts` | PDF.js yüklemesi `loadPdfJs()` üzerinden. Ayrıca PDF.js verilen tamponu *transfer edip* çağıranın `ArrayBuffer`'ını boşalttığı için artık **kopya** üzerinde çalışılıyor (imza bu yan etkiyi düşündürmüyordu) |
| `pdfjs-worker.d.ts` **(yeni)** | Paket çözümleyici için tür bildirimi yayımlamıyor |

### Doğrulama

29 sayfalık gerçek şartname (`2026_Insansiz_Deniz_Araci_Sartnamesi.pdf`) ile
`POST /api/analyze` → **HTTP 200**, 568 blok → 135 aday → 31 kriter, 1 API çağrısı.
Üretim derlemesinde çözümleyici sunucu paketine gömülüyor
(`dist/server/_next/static/pdf.worker-*.js`), yani üretimde de dinamik yol çözümü gerekmiyor.

---

## 2. Hakem akışı, kriter kapsamı ve katılımcı akışı

Her bug **güncel kodda yeniden doğrulandı**; zaten düzelmiş olanlar tekrar yazılmadı,
regresyon testiyle kilitlendi.

### 2.1 Kriter kapsamı ayrıştırıldı

`ReportEvaluation.criteriaScope` eklendi. Hakem ekranı artık dört sayıyı ayrı gösteriyor:

> **12 yayımlı kriterden 9'u** katılımcı PDF'si üzerinden değerlendirildi.
> 3 kriter video, portal veya fiziksel aşama gerektirdiği için rapor analizine katılmadı.
> 2 kriter hakem kararı bekliyor.

PDF dışı kriterler: uygun/olumsuz sayılmıyor, kritik hata üretmiyor, karar listesinde
görünmüyor, nihai karar kapısını engellemiyor, katılımcıya eksiklik olarak gitmiyor.
Yalnızca kapsam satırında ve denetim kaydında duruyorlar.

### 2.2 Dört aşamalı özet sadeleştirildi

| Aşama | Önce | Sonra |
|---|---|---|
| 1 · Dil ve Şablon | 10 sabit stopword; teknik Türkçe metin `unknown` çıkıyordu | Çok sinyalli tespit: genişletilmiş stopword + **Türkçeye özgü ekler** (-lar/-ler, -dır, -mış, -ması, -nın…) + özel harfler + kelime yoğunluğu; 100 kelime başına oran ve baskınlık eşiği. Kart tek cümle basıyor |
| 2 · Başlık ve İçerik | **her** içerik kriteri zorunlu başlık sayılıyordu | `controlType`'a göre: yalnızca `BIREBIR_BASLIK` başlık konumunda aranıyor, diğerleri bilgi düzeyinde. **İçindekiler/üstbilgi tanınıyor**; yalnızca orada geçen ifade "var/dolu" gösterilmiyor. Doluluk eşleşme noktasından *sonraki* metinden ölçülüyor |
| 3 · Kategori | yapay yüzde ("%100") | Uyumlu / Kısmen uyumlu / Uyumsuz / **Yeterli kanıt bulunamadı** |
| 4 · Kriter Bazlı Kanıt | modelin serbest metni | `9 kriter incelendi · 8 uygun · 1 olumsuz` |

Benzerlik dört aşamadan **çıkarıldı**; ŞÜPHELİ/Normal işareti kendi notuna taşındı.
Benzerlik algoritmasına dokunulmadı (GÖREV 3 kapsamı).

### 2.3 AI bulgusu ile hakem değerlendirmesi ayrıldı

"Onayla/Ret" adları başvuru onayı/reddi sanılıyordu. Yeni adlar:

- **"✓ AI bulgusunu aynen kullan"** — kesin sonuç AI sonucudur, ek form yok.
- **"✎ Hakem değerlendirmesi gir"** — form **AI verileriyle ön dolduruluyor**
  (sonuç, sayfa, bölüm, alıntı, gerekçe), böylece hakem yalnız açıklamayı ya da
  yalnız sonucu değiştirebiliyor.

AI'nin özgün analizi üzerine yazılmıyor; denetim kaydında iki kayıt ayrı tutuluyor.

### 2.4 Hakem alıntısı sunucuda doğrulanıyor

`app/lib/report-text-layer.ts` **(yeni)** · `quoteFoundOnPage()`

Hakem "PDF konumu" dayanağı seçtiğinde yazdığı alıntının **belirttiği sayfada**
gerçekten bulunduğu, katılımcı PDF'i sunucuda okunarak kontrol ediliyor
(`saveApplicationReview` → `verifyJudgeQuotes`). Bulunmazsa karar reddediliyor ve
hangi kriterde hangi sayfanın tutmadığı söyleniyor. **Doğrulanamıyorsa**
(metin katmanı yok, alıntı çok kısa) insan kararı düşürülmüyor.

### 2.5 "Kanıtı PDF'de göster"

`app/components/pdf-evidence-viewer.tsx` **(yeni, 293 satır)**

Eski "Kaynak Satıra Git" düğmesi PDF'i `#page=N` adres parçasıyla yeni sekmede
açıyordu; tarayıcıların yerleşik PDF görüntüleyicileri bu parçayı güvenilir biçimde
uygulamadığı için düğme **sessizce yanlış sayfayı** açıyordu. Yeni panel:

- PDF'i yetkili uçtan indirip **canvas'a kendisi çiziyor**, ilgili sayfaya doğrudan gidiyor
- Alıntıyı metin katmanında bulup **üzerini vurguluyor**
- Vurgulama yapılamazsa bunu **söylüyor**, doğru sayfayı garanti ediyor
- PDF açılamazsa sessizce kapanmıyor; hata ve sebebi görünüyor

### 2.6 Analiz ve önbellek bütünlüğü

| Bug | Kök neden | Çözüm |
|---|---|---|
| Aynı PDF'li iki başvuru künye karıştırıyordu | Önbellek anahtarı `PDF özeti + kriter özeti`'nden kuruluyordu; kaydedilen sonuç ise `submissionVersionId`, rapor adı ve profil künyesi taşıyor | `app/lib/evaluation-cache-key.ts` **(yeni)** — anahtar başvuru + rapor sürümüyle kapsamlandı |
| **Başarısız yenileme çalışan analizi siliyordu** | `analysis_failed` → `saveApplicationEvaluation(…, null, true)` → `evaluation_json = NULL`. Geçici bir 503, hakemin analizini ve kriter kararlarını yok ediyordu | Başarısız deneme yalnızca geçmiş satırı yazıyor; sonuç ve bağları yerinde kalıyor, ekran "eski analiz korunuyor" diyor |
| Taranmış PDF normal sonuç gibi sunuluyordu | Metin katmanı kontrolü yoktu; model görüntüden okuduğunu "alıntı" yazıyordu | Sunucuda `readReportTextLayer` → `OCR_REQUIRED` (422). İstemci de metni okuyamadığında alıntıları sessizce silmiyor |

**Zincir bug:** "Analizi yenile" düğmesi sunucuda **her zaman 409** alıyordu
(`markApplicationAnalyzing`, `awaiting_judge` durumunu kabul etmiyordu) — yani yukarıdaki
düzeltmenin yolu hiç çalışmıyordu. Yeniden analiz artık hakem kuyruğundaki dosyada da
çalışıyor; kesinleşmiş karar ve dondurulmuş yarışma korumaları yerinde.

### 2.7 Katılımcı yükleme ve revizyon

| Bug | Çözüm |
|---|---|
| Revizyon `file.stream()` ile yazılıyordu → R2 içerik uzunluğunu bilemiyor, boş/yarım nesne yazılabiliyordu | İlk başvuru rotasıyla **aynı** yöntem: `storeReportPdf()` — `Blob` ile yazım + **R2'den okuyarak doğrulama** (`bucket.head`, uzunluk karşılaştırması) + PDF hash'inin yeniden ölçülmesi. Veri tabanı doğrulanmadan sürüme geçmiyor; hata yolunda yalnızca yeni nesne siliniyor, önceki PDF korunuyor |
| Çift tıklama iki başvuru oluşturuyordu | `busy` iki `await`ten *sonra* kuruluyordu (React durumu senkron değil). Senkron `useRef` kilidi + sunucuda `(participant_id, competition_key)` kısmi benzersiz dizini |

Göç: **`migrations/0010_submission_integrity.sql`** — `submission_versions.pdf_hash`,
`submission_versions.byte_length`, `idx_applications_participant_competition`.
Yalnızca ekler; hiçbir tablo düşürülmez, satır silinmez. Çalışma zamanında
`addMissingColumns` ile mevcut veri tabanları da yükseltiliyor.

### 2.8 Hakem yaşam döngüsü

`revokeAccount` atanmış dosyalara hiç dokunmuyordu; pasifleştirilen hakemin açık
dosyaları **kalıcı takılıyordu** (otomatik dağıtım yalnızca `assigned_judge_id IS NULL`
satırlara bakıyor). Yeni `reassignApplicationsFromJudge`:

- Yalnızca **tamamlanmamış** ve arşivlenmemiş dosyaları serbest bırakıyor
- Koşullu UPDATE ile → eşzamanlı işlem dosyayı devraldıysa üzerine yazmıyor
  (iki hakeme birden atanma yok)
- Aktif hakem yoksa **yeniden atama kuyruğuna** alıyor
- Tamamlanmış değerlendirmelerin tarihsel hakem bilgisi değişmiyor
- Her devir denetim kaydına yazılıyor

Otomatik atama ilkesi korundu; **manuel atama eklenmedi**.

### 2.9 Arayüz dayanıklılığı

- Başka analiz sürerken düğme etkin görünüp `analyze()` **sessizce dönüyordu** → artık
  gerçek durumu yansıtıyor ve sebebini yazıyor
- Hatalar ayrıştırıldı: **OCR gerekiyor** / **geçici (yeniden denenebilir)** / kalıcı
- "Yapay zekâ hata yapabilir; nihai değerlendirme hakeme aittir." uyarısı korundu

---

## 3. Kriter sayısı: 5 → 33

### Belirti

25 sayfalık `2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf` → **5 kriter**
(beklenen 20–30) ve şu uyarı: *"5 sonuç, kaynak kimliği veya birebir alıntısı
doğrulanamadığı için alınmadı."*

### Ölçüm

Kök neden tahmin edilmedi: kayıtlı **ham model çıktısı** D1 önbelleğinden
(`criteria_analysis_cache.raw_json`) okunup sayıldı:

```
toplam karar: 87   KAPSAM_DISI: 77   KRITER: 10   → 5'i alıntı doğrulamasında düştü
```

Aday seçimi (deterministik, ücretsiz çalıştırılabilir) sorunlu değildi: 87 aday.

### Kök neden 1 — Kaydırılmış madde satırları birleştirilmiyordu *(asıl sebep)*

`buildPageBlocks` madde işaretli bir kural iki görsel satıra taştığında her satırı
**ayrı blok** yapıyordu:

```
blok A: "• ... Hava Savunma Sistemi'nin her boyutu (E x B x D) 100cm' den"
blok B: "küçük olacaktır."
```

**Kuralın kendisi hiçbir blokta tam değildi.** İki sonuç: (1) modele yarım cümleler
aday olarak gidiyor, model bunlarda uygulanabilir bir kural göremeyip "kapsam dışı"
diyordu; (2) cümleyi yakın bağlamdan tamamlayıp alıntıladığında doğrulama onu
reddediyordu.

**Çözüm:** madde/bent **sözdizimsel olarak bitmemişken** (sonunda `.!?:;` yok) ve
sonraki satır yeni bir yapı başlatmıyorken devam satırı ekleniyor. Temkinli ölçüt:
maddeden sonraki gerçek paragrafı yutmuyor. Sınırlar `MAX_WRAPPED_LINES = 8`,
`MAX_WRAPPED_CHARS = 700`.

Çelikkubbe'de 44 parça birleşti (418 → 374 blok); beş bozuk kural tek blokta tam hâle geldi.

### Kök neden 2 — Alıntı doğrulaması, modele *verdiğimiz* bağlamı reddediyordu

`formatCandidatesForLlm` her adaya `contextBefore`/`contextAfter` ekliyor. Kural blok
sonunda başlayıp bağlamda bitiyorsa model **doğru davranıp** tam cümleyi alıntılıyor;
doğrulama ise yalnızca aday bloğun metnine bakıyordu.

**Çözüm:** arama penceresi modele gösterdiğimiz metnin ta kendisi (blok + aynı sayfadaki
komşu bloklar). Ayrıca tire/tırnak/bölünemez boşluk çeşitleri eşitleniyor.
**Bütünlük zayıflamadı:** kaydedilen `sourceId`/`sourcePage` hâlâ sunucunun bloğundan
geliyor, sayfa eşleşmesi kontrol ediliyor ve belgede hiç bulunmayan alıntı reddediliyor.

### Kök neden 3 — Kanıtı rapor dışında olan kuralı kaydetmenin yolu yoktu

`normalizeCandidateDecisions` `verifiability`'yi sabit `"PDF_DENETLENEBILIR"` yazıyordu
ve talimat *"KRITER yalnızca PDF'den doğrulanabiliyorsa"* diyordu. Yani
"rapor KYS'ye yüklenmelidir", "tanıtım videosu gönderilmelidir" gibi **bağlayıcı**
kurallar için modelin tek seçeneği `KAPSAM_DISI`, yani kuralı **tamamen silmekti**.
Bu yüzden §2.1'deki PDF-dışı kriter sayaçları da hep sıfır kalıyordu.

**Çözüm:** şemaya `verifiability` eklendi; kural silinmiyor, işaretleniyor. Talimatta
"bu bir kural mı?" ile "kanıtı nerede?" soruları ayrıldı ve kaybolmuş kapsam
rehberliği (zorunluluk kipi taraması, tasarım kısıtı listesi, aşama dengesi) geri getirildi.

### Yol boyunca çıkan iki kusur

| Kusur | Çözüm |
|---|---|
| **Aşırı düzeltme:** kapsam genişleyince model puan barajlarını ("Aşama 1 geçiş baraj puanı") kriter yapmaya başladı — bu sistem puan üretmez | Puan/baraj/sıralama yasağı **mutlak** hâle getirildi ("cümlede *zorunludur* geçse bile"). Şimdi 0 tane |
| **Çıktı tavanı:** istem uzayınca 129 adaylı belgede cevap 24.576 token tavanına dayanıp kesildi; uç anlamsız bir *"şemaya uygun JSON okunamadı"* (502) döndürdü. Ölçülen gerçek ihtiyaç **25.564** token | Tavan **65.536**'ya çıkarıldı; kesilme `finishReason: MAX_TOKENS` ile yakalanıp **sebebini söyleyen** hataya çevrildi |

### Sonuç — iki gerçek şartname

| Belge | Önce | Sonra |
|---|---|---|
| Çelikkubbe (25 s.) | **5 kriter** | **33 kriter** · 11 PDF-denetlenebilir · 21 harici · 1 hakem |
| İnsansız Deniz Aracı (29 s.) | 31 kriter | **77 kriter** · 31 PDF-denetlenebilir · 44 harici · 2 hakem |
| Alıntı reddi (Çelikkubbe) | 5 / 10 | **0 / 33** |

Deniz Aracı'nda PDF-denetlenebilir sayısı 31'de sabit kaldı; artış tamamen **eskiden
silinen** kuralların korunup doğru işaretlenmesinden geliyor. Sayfa 14–25'teki puan
tabloları ve saha kuralları doğru biçimde dışlanıyor.

**Sürüm yükseltmeleri** (eski önbellek kayıtlarını geçersiz kılar):

- `PDF_STRUCTURE_VERSION`: `pdf-structure-v1` → `pdf-structure-v2-wrapped-lines`
- `EXTRACTION_PROMPT_VERSION`: `v25-structured-candidates` → `v28-verifiability-coverage-stages-scoreban`
- `PROMPT_VERSION` (rapor): `report-v6-…` → `report-v7-control-type-scope-category-fit`

> Ekranda duran eski analizler için **"Yeniden analiz et"** gerekiyor.

---

## Değişen dosyalar

### Eklenen

| Dosya | Satır | Amaç |
|---|---|---|
| `app/lib/pdfjs-runtime.ts` | 171 | Sunucuda PDF.js için `DOMMatrix`/`Path2D`/çözümleyici |
| `app/components/pdf-evidence-viewer.tsx` | 293 | Uygulama içi kanıt görüntüleyici (sayfa + vurgu) |
| `app/lib/report-text-layer.ts` | 90 | OCR koruması + hakem alıntısı doğrulama |
| `app/lib/evaluation-cache-key.ts` | 43 | Başvuru/sürüm kapsamlı önbellek anahtarı |
| `pdfjs-worker.d.ts` | 14 | Çözümleyici için tür bildirimi |
| `migrations/0010_submission_integrity.sql` | 32 | `pdf_hash`, `byte_length`, çift başvuru dizini |
| `tools/judge-flow-v2.test.ts` | 645 | 16 kabul senaryosu + 4 ek (20 test) |
| `tools/criteria-coverage.test.ts` | 245 | Kriter sayısı/kapsam regresyonu (5 test) |

### Güncellenen

`app/api/analyze/route.ts` · `app/api/evaluate-report/route.ts` ·
`app/api/applications/route.ts` · `app/api/applications/[id]/route.ts` ·
`app/api/applications/[id]/versions/route.ts` · `app/api/admin/accounts/[id]/route.ts` ·
`app/components/evaluation-app.tsx` · `app/components/participant-portal.tsx` ·
`app/evaluation.css` · `app/lib/pdf-structure.ts` · `app/lib/criteria-extraction.ts` ·
`app/lib/report-prechecks.ts` · `app/lib/report-evaluator.ts` · `app/lib/workflow-db.ts` ·
`app/lib/workflow-client.ts` · `app/lib/types.ts` · `app/lib/admin-types.ts` ·
`app/lib/admin-roles.ts` · `tools/authorization.test.ts`

### Değiştirilen bir regresyon testi

`tools/authorization.test.ts` içindeki *"hakem ekranında kaynak satıra git düğmesi…"*
testi, §2.5 ve §2.2'nin **açıkça değiştirmesi istenen** davranışı koruyordu
(`Kaynak Satıra Git` metni ve benzerliğin aşama kartında olması). Test silinmedi,
**yeni davranışı koruyacak şekilde genişletildi**: düğme adı, uygulama içi
görüntüleyicinin bağlı olması, vurgulama ve hata mesajları, benzerlik işaretinin kendi
notunda durması. Ayrıca aşama kartına benzerliğin/ham skorun geri sızmasını engelleyen
yeni bir test eklendi.

---

## Doğrulama

| Kontrol | Sonuç |
|---|---|
| Birim testleri | **144 / 144** |
| Regresyon paketi | **7 / 7 PASS** |
| TypeScript (`tsc --noEmit`) | temiz |
| Lint (`eslint`) | temiz |
| Depo güvenliği (`check_repo_safety`) | PASS |
| Üretim derlemesi (`vinext build`) | başarılı |
| Canlı doğrulama | Göç mevcut D1'e sorunsuz uygulandı (mükerrer aktif başvuru yok); dört sayfa 200 |

**Ücretli AI çağrısı:** §3'ün ölçümü için 5 gerçek `analyze` çağrısı yapıldı —
Çelikkubbe'de üç tur (v26 kapsam, v27 aşama, v28 puan yasağı) ve Deniz Aracı'nda iki
tur (biri çıktı tavanı kesilmesiyle 502 verdi, tavan yükseltildikten sonra başarılı).
§1 ve §2'nin doğrulaması ücretsiz yollarla yapıldı. Testlerin tamamı canlı model
çağrısı yapmadan çalışır: saf işlevler, gerçek göç dosyaları (`node:sqlite`), kayıtlı
PDF'ler ve kaynak sözleşmesi üzerinden doğrulanır.

### Tamamlanamayan tek madde

`npm run test:e2e` **temiz bir veri tabanı istiyor**:

```
Veri tabanında bu koşuya ait olmayan 1 aktif Hakem var.
  node tools/dev_reset.mjs --apply
```

Bu komut mevcut gerçek hesapları, başvuruları ve PDF'leri silecekti; **çalıştırılmadı**.
Senaryonun koşulması için ya veri tabanının sıfırlanması ya da betiğin mevcut veriyi
tolere edecek şekilde uyarlanması gerekiyor — karar kullanıcıya bırakıldı.

---

## Bilinen sınır

Kriter çıkarımı **tek AI çağrısıyla** çalışıyor ve cevap her güçlü aday için bir karar
satırı taşıyor. Çıktı tavanı 65.536 token; çok büyük şartnamelerde (yüzlerce aday) bu da
yetmezse analiz **sessizce eksik sonuç vermez**, kesilmeyi açık bir hatayla bildirir
(§3). Kalıcı çözüm belgeyi bölümlere ayırmak ya da çıkarımı sayfa gruplarına bölmektir;
bu oturumun kapsamında değildi.
