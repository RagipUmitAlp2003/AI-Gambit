# Değişiklik Raporu

**Tarih:** 2026-08-24 · **Dal:** `Deneme` · **Temel alınan işleme:** `1b85bea`

Bu belge iki turda yapılan değişiklikleri **eskiden nasıldı / şimdi nasıl** biçiminde kaydeder.
Sonda yapılamayan ve yarım kalan işler ayrıca listelenmiştir.

---

## İçindekiler

- [A. Özellik değişiklikleri](#a-özellik-değişiklikleri)
- [B. Doğruluk ve puanlama düzeltmeleri](#b-doğruluk-ve-puanlama-düzeltmeleri)
- [C. Performans ve token maliyeti](#c-performans-ve-token-maliyeti)
- [D. Test ve ölçüm altyapısı](#d-test-ve-ölçüm-altyapısı)
- [E. Ölçüm sonuçları](#e-ölçüm-sonuçları)
- [F. Yapılamayanlar ve yarım kalanlar](#f-yapılamayanlar-ve-yarım-kalanlar)
- [G. Dosya envanteri](#g-dosya-envanteri)
- [H. Nasıl doğrulanır](#h-nasıl-doğrulanır)

---

## A. Özellik değişiklikleri

### A1. Yarışma seçim sistemi

`app/lib/competitions.ts` · `app/components/competition-select.tsx` · `app/components/search-select.tsx`

| | Eskiden | Şimdi |
|---|---|---|
| Arama fonksiyonu | `filterCompetitions(query, limit = 12)` → `CompetitionEntry[]` | `searchCompetitions(query, limit = 50)` → `{ items, total }` |
| Türkçe karakter | `toLocaleLowerCase("tr-TR")` sonrası birebir eşleşme. `insansiz` yazan hiçbir sonuç alamıyordu | `fold()` ile aksan sadeleştirmesi (`ı→i, ş→s, ğ→g, ü→u, ö→o, ç→c, â/î/û`). `İnsansız`, `insansiz`, `INSANSIZ` aynı 4 sonucu veriyor |
| Performans | Her tuş vuruşunda 40 kaydın tamamı yeniden küçültülüyordu | `SEARCH_INDEX` modül yüklenirken bir kez kuruluyor; filtreleme tek geçiş |
| Çok kelimeli arama | Yok — `yapay zeka` tek dizge olarak aranıyordu | Boşlukla ayrılan her parça ad **ve** alan içinde aranıyor |
| Sıralama | `startsWith` sonra `includes` | `adın başı → kelime başı → içerik`, aynı rank içinde özgün liste sırası korunuyor |
| Kırpma bildirimi | Sessizce ilk 12'de kesiyordu; kullanıcı listede olmayan yarışmayı "yok" sanabiliyordu | Sticky bilgi satırı: `"40 kayıtlı yarışma · yazmaya başlayın"` / `"N eşleşmenin ilk 50 tanesi listelendi · +M yarışma daha"` |
| Seçim sonrası | Alan tekrar açıldığında filtre seçili adla çalıştığı için liste **tek kayda düşüyordu** | `filtering` bayrağı: filtre yalnızca kullanıcı yazarken uygulanıyor, odaklanınca tam liste |
| Klavye | `highlighted` liste kısaldığında sınır dışına taşabiliyor, Enter boş/yanlış kayda basabiliyordu | `activeIndex` ile kırpılıyor; `scrollIntoView({ block: "nearest" })`; `aria-activedescendant` |

Aynı iyileştirmeler Kategori / Aşama / Rapor türü alanlarını besleyen `SearchSelect`'e de uygulandı.

---

### A2. Ana ekran yazı boyutları

`app/globals.css`

Ana ekran metinleri büyütüldü, sağ alttaki yardımcı metin küçültüldü. (İlk turda daha büyük yapılmış, sonra isteğiniz üzerine bir tık geri çekilmişti — aşağıdaki "Şimdi" sütunu son hâldir.)

| Öğe | Eskiden | Şimdi |
|---|---:|---:|
| Form girişleri (`input`, `select`) | 13.5 px / 42 px yükseklik | **14 px / 43 px** |
| Alan etiketi (`.field-label`) | 12 px | **13 px** |
| Alan ipucu (`.field-hint`) | 10.5 px | **11 px** |
| Bölüm başlığı (`legend`) | 15 px | **16 px** |
| Açıklama paragrafı | 15 px | **15.5 px** |
| İhlal seçeneği başlık / açıklama | 12.5 / 10.5 px | **13.5 / 11 px** |
| Butonlar | 11 px | **12 px** |
| Dropdown seçenekleri | 12.5 / 10 px | **13 / 10.5 px** |
| Bölüm kickerı, adım sayacı, taslak notu | 10–12 px | **10.5–12.5 px** |
| **Sağ alt yardımcı metin** (`.preview-note p`) | 8.5 px | **8 px** (ikon 20 → 18 px) |

Media query kurallarına dokunulmadı.

---

### A3. Sağ panel canlı önizleme

`app/components/template-preview.tsx` · `app/globals.css`

**Düzeltilen hata (mevcut koddan geliyordu, `git stash` ile doğrulandı):**

| | Eskiden | Şimdi |
|---|---|---|
| Yatay kırpma | Panel 249 px, içerik **285 px** → `"Kritik Tasarım Raporu (KTR"`, `"PD"` gibi kesik metinler. Sebep: `.template-preview` örtük ızgara sütunu `auto` boyutlanıyor, çocuklar min-content genişliğine kilitleniyordu | `grid-template-columns: minmax(0,1fr)` + `min-width: 0` (`.setup-preview`, `.template-head > div`, `.template-file-row > div`) + `overflow-wrap: anywhere`. Ölçüm: içerik 249 px, taşma **0** |

**İçerik değişiklikleri:**

| | Eskiden | Şimdi |
|---|---|---|
| Durum bilgisi | Yoktu | Renkli rozet: `Bilgi giriliyor` → `Analize hazır` → `N sayfa analiz edildi` |
| Format satırı | Sabit `"PDF"` yazıyordu | `setup.allowedFormats.join(", ")` |
| Kategori / Aşama / Yıl | Tek satırda küçük punto `small` içinde | Ayrı şablon satırları (`dl`) |
| Profil kimliği | Yoktu | `Profil 2026 / Kritik tasarım değerlendirmesi · v1.0` |
| Boş durum | Kriterler yokken "Değerlendirme yapısı" bölümü tamamen kayboluyordu | Bölüm duruyor, ne zaman dolacağını açıklıyor |
| Grup normalize önizlemesi | Her zaman `≈ N/100` gösteriliyordu | Kriter toplamı ile grup toplamı çelişiyorsa gösterilmiyor (yanıltıcı olduğu için) |

Canlı güncelleme tarayıcıda doğrulandı: Yıl `2026 → 2031` ve İhlal `Yüklemeyi engelle → Uyarı oluştur` anında yansıdı.

---

### A4. Dosya türüne göre ikonlar

`app/components/file-badge.tsx` · `app/lib/file-kind.ts` · `app/globals.css`

| | Eskiden | Şimdi |
|---|---|---|
| Görsel | Düz renkli yuvarlatılmış dikdörtgen + CSS `font-size` ile yazı | Kıvrık köşeli **SVG belge silueti** (`viewBox 0 0 48 60`): tür rengiyle kenarlık, açık gövde tonu, gövdede tür işareti, altta biçim bandı |
| Ölçeklenme | Punto sabit; 30 px'te okunmuyordu | SVG viewBox ile ölçekleniyor; 30 px'te de 76 px'te de net |
| Dosya ailesi | 7 (`pdf, word, excel, powerpoint, image, text, other`) | **9** (+ `archive`, `video`) |
| Etiket | Aile etiketi (`DOC`, `XLS`) | Uzantı ≤ 4 karakterse **gerçek uzantı** (`DOCX`, `XLSX`, `ZIP`), değilse aile etiketi |
| Gövde işareti | Yok | Excel → tablo ızgarası, PowerPoint → grafik, Görsel → dağ+güneş, Video → oynat, Arşiv → fermuar+kilit, diğerleri → metin satırları |
| Erişilebilirlik | `aria-label="PDF dosyası"` | `aria-label="PDF PDF belgesi"` + `title` |
| Uzantı tanıma | 21 uzantı | **30 uzantı** (+ `odp, json, zip, rar, 7z, mp4, mov, avi, mkv, webm`) |

---

### A5. Referans belge yönetimi

`app/components/document-library-modal.tsx` (**yeni**) · `app/lib/sample-documents.ts` (**yeni**) · `app/components/document-library-panel.tsx` (**silindi**)

| | Eskiden | Şimdi |
|---|---|---|
| Yerleşim | Aşama 2'de **iki ayrı gömülü bölüm**: "Hazır test belgeleri" (kodda sabit) + "Görevli belge havuzu" | Tek **modal pencere**; Aşama 2'de kompakt kart + "Belge havuzunu aç" butonu |
| Modal davranışı | — | Esc ile kapanır, dışarı tıklanınca kapanır, açılışta odak alır, arka plan kaydırması kilitlenir, her açılışta temiz durumla monte olur |
| Arama | Yok | Türkçe aksana duyarsız arama kutusu (hazır + görevli belgeleri birlikte) |
| Belge türleri | 6 (`sartname, kilavuz, resmi_belge, ek_kriter, teknik, ornek`) | **8** (+ `ornek_rapor` = Örnek yarışmacı raporu, `referans` = Diğer referans belgesi) |
| Süreç ayrımı | Yok — tüm belgeler her yerde | `DOCUMENT_TYPE_USAGE`: şartname/kılavuz/referans → Kriter Atölyesi, örnek yarışmacı raporu → Değerlendirme Atölyesi |
| Değerlendirme Atölyesi | Yalnızca diskten PDF seçilebiliyordu | **"Belge havuzundan seç"** butonu — havuzdaki örnek raporlar doğrudan değerlendirme havuzuna alınıyor |
| Hata durumları | Sessiz `await`, hata yakalama yok | Havuz okunamadı / depolama dolu / silinemedi / arama eşleşmedi / PDF değil durumları ayrı ayrı |
| Örnek belge listesi | `criteria-app.tsx` içinde gömülü `SAMPLE_DOCUMENTS` | Ortak modül `app/lib/sample-documents.ts` |

---

### A6. Belge havuzu depolama katmanı

`app/lib/document-library.ts`

| | Eskiden | Şimdi |
|---|---|---|
| Yapı | `listLibraryDocuments` / `addLibraryDocument` / `deleteLibraryDocument` doğrudan IndexedDB işlemi yapıyordu | `DocumentRepository` arayüzü (`list` / `add` / `remove`); IndexedDB bir **uygulama**, dışa açık fonksiyonlar aktif depoya delege ediyor |
| Depo değiştirme | Mümkün değildi | `setDocumentRepository(repo)` — sunucu havuzu yazıldığında çağıran kod hiç değişmez |
| Davranış | — | **Aynı** — IndexedDB bozulmadı, veri kaybı yok |

---

## B. Doğruluk ve puanlama düzeltmeleri

### B1. Normalize puanın 100'ü aşması (KRİTİK)

`app/lib/evaluation-summary.ts` · `app/lib/types.ts` · `app/components/criteria-app.tsx` · `app/lib/demo-report-evaluator.ts`

**Kök neden:** `approve()` normalizasyon paydasını **yalnızca kapsama alınan puan gruplarının** toplamına indiriyordu, ama `criteria` listesinde **bütün** aktif kriterler kalıyordu. Hakem kapsam dışı kriterleri de puanlıyor, sonuç daraltılmış paydaya bölünüyordu.

> **Örnek:** 315 puanlık şartname (Rapor 100 / Parkur 150 / Teknik 65). Görevli yalnızca "Rapor"u kapsama alır → payda 100. Hakem parkur ve teknik kriterlerini de puanlar → **210 / 100 üzerinden**.

| | Eskiden | Şimdi |
|---|---|---|
| Payda kaynağı | Kapsanan **puan gruplarının** `maxScore` toplamı | Kapsamdaki **aktif puan kriterlerinin** `maxScore` toplamı (`maxRawScoreOf`) — pay ve payda aynı kümeden gelir |
| Kapsam dışı kriterler | Profilde **aktif** kalıyordu | `scopeCriteriaToGroups()` ile **pasifleştiriliyor**; profile aktif girmiyor |
| Aralık koruması | Yok — sonuç 100'ü aşabiliyordu | Yapısal olarak imkânsız; ayrıca `normalizeScoreDetailed` son emniyet kemeri |
| Aralık dışı girdi | Sessizce geçiyordu | `anomaly` alanıyla işaretleniyor ve **arayüzde kırmızı uyarı** olarak gösteriliyor (`Math.min` ile gizlenmiyor) |
| Negatif ham puan | Kontrol yok | 0'a sabitleniyor + anomali |
| `maxRawScore ≤ 0` / `NaN` | 0 dönüyordu, sessizce | Anomali mesajı |
| Ham puan sınırı | Öneriler toplanıyordu, sınır yok | Her öneri kendi kriterinin `maxScore`'uyla sınırlanıyor (`demo-report-evaluator`) |
| Ceza mantığı | Yoktu | `applyPenalties(raw, penalty)` — sıfırın altına inmez, uygulanan ceza ayrı döner |
| Arayüz gösterimi | Tek satır: `finalTotal / declaredTotal · N/100` | **Üç değer ayrı**: `Ham puan` · `Maksimum ham puan` · `100 üzerinden` (hem hakem hem yarışmacı görünümünde) |

**Yeni API:**

```ts
normalizeScoreDetailed(raw, maxRaw) -> { value: 0..100, rawScore, maxRawScore, anomaly: string | null }
normalizeScore(raw, maxRaw)         -> number            // geriye uyumlu kısayol
maxRawScoreOf(criteria)             -> number            // payda
applyPenalties(raw, penalty)        -> { finalRaw, appliedPenalty }
scopeCriteriaToGroups(criteria, groups, includedIds) -> Criterion[]
```

**Test sonuçları** (`tools/scoring.test.ts`, 17/17 geçti):

| Girdi | Beklenen | Sonuç |
|---|---|---|
| 0 / 315 | 0 | ✅ |
| 157.5 / 315 | 50 | ✅ |
| 252 / 315 | 80 | ✅ |
| 315 / 315 | 100 | ✅ |
| 330 / 315 | **anomali** | ✅ `value: 100` + `anomaly` dolu, `rawScore: 330` korunuyor |
| −5 / 315 | anomali | ✅ |
| 10 / 0 | anomali | ✅ |

---

### B2. İsimle eşleştirmenin kaldırılması (KRİTİK)

`app/lib/types.ts` · `app/api/analyze/route.ts` · `app/components/criteria-app.tsx` · `app/lib/draft-store.ts`

**Kök neden:** Puan grupları isimle takip ediliyordu. Aynı ad iki farklı sayfada geçtiğinde (`Teknik Değerlendirme` s.4 ve s.11) `groups.filter(g => includedGroups.includes(g.name))` **her ikisini** yakalıyor, payda çift sayıyordu; birini çıkarmak diğerini de sessizce düşürüyordu.

| | Eskiden | Şimdi |
|---|---|---|
| `ScoreGroup` kimliği | Yok | `id?: string` — sunucuda `group-${index+1}` olarak kararlı üretiliyor |
| `Criterion` → grup bağı | Yok (yalnızca serbest metin `scope`) | `groupId?: string \| null` |
| Bağın kurulması | — | Yapılandırılmış çıktıya `scoreGroupIndex` alanı eklendi; model her kriteri kendi grubunun 0 tabanlı indeksine bağlıyor, sunucu indeksi `id`'ye çeviriyor |
| Kapsam durumu | `includedGroups: string[]` (**isimler**) | `includedGroupIds: string[]` (**kimlikler**) |
| React `key` | `${group.name}-${group.sourcePage}` | `group.id` |
| Onay kutusu / rozet / hesaplama | Ayrı ayrı isim kontrolü yapıyordu | Tek kaynak: `isIncluded(group)` |
| Eski taslak/profil | — | Otomatik göç: isim listesi kimliğe çevriliyor. Kimlik yoksa **kapsam daraltması uygulanmıyor** ve bilgilendirme gösteriliyor (aksi hâlde profil hiç onaylanamaz hâle gelirdi) |
| Yönetici kriterleri | — | `groupId: null` — hiçbir gruba bağlı değil, hiçbir zaman kapsam dışı kalmıyor |

**Test senaryoları** (hepsi geçti): aynı isimli iki grup · benzer isimli iki grup · Türkçe karakterli isimler · kriter adının sonradan değişmesi · gruba bağlı olmayan kriter · kimliksiz eski analiz.

---

### B3. Denetim turunun kapsam kayması

`app/api/analyze/route.ts`

| | Eskiden | Şimdi |
|---|---|---|
| `mergeRawCriteria` dönüşü | `RawCriterion[]` | `{ merged, confirmed, flagged }` |
| Denetim turunun bulduğu yeni madde | Doğrudan **aktif kriter** olarak ekleniyordu | `auditOnly: true` işaretiyle **pasif** ekleniyor + `issue` alanına gerekçe yazılıyor |
| Görünürlük | Yok | `analysisWarnings`: `"Bağımsız denetim turu N olası eksik madde işaretledi (M madde doğrulandı). Bu maddeler PASİF olarak eklendi..."` |
| Etki | Denetim turu tek başına yeni değerlendirme kuralı yürürlüğe koyabiliyordu | Koyamıyor — görevli kaynağı görüp etkinleştirmeden profile giremez |

Ölçüldü: gerçek koşuda **8 madde** pasif işaretlendi, hiçbiri sessizce kural olmadı.

---

## C. Performans ve token maliyeti

### C1. İki AI çağrısının paralelleştirilmesi

`app/api/analyze/route.ts`

| | Eskiden | Şimdi |
|---|---|---|
| Akış | Birincil çıkarım **bitince** denetim turu başlıyordu (ardışık) | İkisi `Promise.all` ile **eşzamanlı** |
| Denetim prompt'u | "İlk tur şunları buldu: … bunları tekrar etme" (birincil sonuca bağımlı) | Bağımsız kontrol listesi (fiziksel güvenlik, yasaklar, teslim şartları, cezalar, barajlar, dipnotlar, çift etkili maddeler) |
| Tekrarların elenmesi | Prompt'a güveniliyordu | `criterionFingerprint` parmak izi eşlemesi (zaten vardı) |
| `thinkingLevel` (denetim) | `HIGH` | `LOW` |
| `mediaResolution` (denetim) | `MEDIA_RESOLUTION_MEDIUM` | `MEDIA_RESOLUTION_LOW` |
| `maxOutputTokens` (denetim) | 24576 | 16384 |
| `PROMPT_VERSION` | `v2` | `v3` (eski önbellek geçersiz) |

**Ölçülen etki:** birincil 149.692 ms + denetim 134.687 ms = ardışık olsaydı **284.379 ms**. Gerçekleşen toplam **151.659 ms** → **~133 sn tasarruf**.

---

### C2. PDF'nin tek kez yüklenmesi (Files API)

`app/api/analyze/route.ts`

| | Eskiden | Şimdi |
|---|---|---|
| Gönderim | PDF her iki isteğe de `inlineData` base64 olarak **ayrı ayrı** gömülüyordu | Belge **bir kez** Files API'ye yükleniyor (`uploadPdfOnce`), iki istek de `fileData.fileUri` ile referans veriyor |
| Başarısızlık | — | Yükleme başarısız olursa sessizce satır içi gönderime düşüyor; yeni kırılma noktası yok |
| Ölçülen | 2 belge taşıma | **1 belge taşıma** (`documentDelivery: "file_uri"`, yükleme 1.948 ms) |

> ⚠️ Bu **girdi token'ını azaltmaz** — belge her istekte yeniden tokenize edilir. Kazanç yükleme süresi ve bant genişliğindedir.

---

### C3. Model devre kesici (ölçümden doğdu)

`app/api/analyze/route.ts`

Benchmark koşusu birincil modelin (`gemini-3.7-flash`) hiç yanıt vermediğini ortaya çıkardı — 8 token'lık bir istekte bile 300 sn+ header timeout. Kod her analizde 80 sn zaman aşımını doldurup yedeğe düşüyordu.

| | Eskiden | Şimdi |
|---|---|---|
| Yanıt vermeyen model | Her istekte yeniden deneniyor, her seferinde 80 sn ölü bekleme | `MODEL_COOLDOWN_MS` (varsayılan 10 dk) boyunca atlanıyor; süre dolunca kendiliğinden yeniden deneniyor |
| Tetikleyici | — | Zaman aşımı veya 5xx. **4xx tetiklemez** (yapılandırma hatasında modeli suçlamak yanlış olur) |
| Görünürlük | Yok | `analysisWarnings`: `"Yanıt vermediği için geçici olarak atlanan model: …"` |

---

### C4. Denetim turu model yedeklemesi

| | Eskiden | Şimdi |
|---|---|---|
| Model | `PRIMARY_MODEL` ile **sabit** | Önce birincil, geçici hatada **bir kez** yedek model |
| Kalıcı hata (400/401/403) | — | Yedek denenmiyor (boşuna maliyet) |
| Ana analiz | Denetim düşerse etkilenmiyordu (bu doğruydu) | Aynı — hiçbir koşulda düşmüyor |
| Kullanılan model | Görünmüyordu | `diagnostics.auditModel` + yedeğe düşüldüyse uyarı metni |

---

### C5. Context caching — **uygulanmadı**

| Ölçüt | Değer |
|---|---|
| Belge kaç kez kullanılıyor? | **2** (birincil + denetim), üstelik eşzamanlı |
| Belge token büyüklüğü | ~22k giriş token (iki çağrı toplamı) |
| Cache maliyeti | Oluşturma ≈ tam girdi token'ı + saatlik depolama |
| Kullanım süresi | ~2,5 dakika, sonra bir daha kullanılmıyor |
| **Karar** | **Uygulanmadı** — 2 eşzamanlı kullanımda tasarruf yok/negatif. Ayrıca mevcut SHA-256 sunucu önbelleği aynı belgenin yeniden analizini zaten **0 token / 11 ms** yapıyor |

---

## D. Test ve ölçüm altyapısı

### D1. Puanlama testleri (yeni)

`tools/scoring.test.ts` · `package.json` · `tsconfig.json`

| | Eskiden | Şimdi |
|---|---|---|
| Test | **Hiç yoktu** | 17 test — normalizasyon aralığı, anomali tespiti, ceza, payda hesabı, kriter↔grup eşleştirme, uçtan uca regresyon |
| Koşucu | — | Node yerleşik `node --test` + yerleşik tip sıyırıcı. **Yeni bağımlılık yok** |
| Komut | — | `npm test` |

### D2. Çelikkubbe benchmark'ı

`tools/run_celikkubbe_benchmark.mjs` · `docs/benchmarks/celikkubbe-expected.json`

| | Eskiden | Şimdi |
|---|---|---|
| Beklenen maddeler | Tek düz liste (`requiredFindings`) | **Kategorili**: geçiş (6), baraj (3), ceza (1), eleme (2), puan (1) |
| Eşleşme | İkili (var/yok) | **Tam / kısmi / eksik** — anahtar kelimelerin kaçının tuttuğuna göre |
| Puan matematiği | Yalnızca `declaredTotalScore` karşılaştırması | Grupların toplamı ile ilan edilen toplam ayrıca denetleniyor |
| Halüsinasyon | Kontrol yok | **Dayanaksız kriter** (kaynak alıntısı yok / sayfa dışı) + **yasaklı ifade** + **denetim işaretli pasif madde** sayımı |
| Süre/token | Raporlanmıyordu | `totalMs`, `modelMs`, `auditMs`, `uploadMs`, giriş/çıkış token, API çağrısı, belge taşıma, denetim modeli |
| Sonuç | Yalnızca JSON | Konsol özeti + ölçüt düşerse **çıkış kodu 1** |

### D3. İnsansız Deniz Aracı ground-truth şeması (yeni)

`docs/benchmarks/ida-ground-truth.json`

| | Eskiden | Şimdi |
|---|---|---|
| İDA doğrulaması | Yok. `docs/corpus/ida-analiz.json` **model çıktısıdır** — ona karşı ölçmek dairesel test olurdu | Elle doldurulacak şema: `sections`, `thresholds`, `penalties`, `passRules`, `humanReviewFindings`, `forbiddenFindings` |
| İçerik | — | **Boş** — değer uydurulmadı. Doldurulmamış diziler benchmark tarafından atlanır |

### D4. Yeni teşhis alanları

`app/lib/types.ts` → `AnalysisDiagnostics`

| Alan | Eskiden | Şimdi |
|---|---|---|
| `uploadMs` | Yoktu | Files API yükleme süresi |
| `apiCalls` | Yoktu | Bu analizdeki üretim çağrısı sayısı |
| `documentTransfers` | Yoktu | PDF baytlarının kaç kez taşındığı |
| `documentDelivery` | Yoktu | `"file_uri"` \| `"inline"` |
| `auditModel` | Yoktu | Denetim turunun fiilen kullandığı model |

---

## E. Ölçüm sonuçları

**Koşu:** `node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze`
**Belge:** `2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf` (25 sayfa)
**Kayıt:** `output/benchmarks/celikkubbe-olcum-kaydi.json`

### Süre ve maliyet

| Metrik | Önce | Sonra | Değişim |
|---|---:|---:|---:|
| Toplam süre | **ölçülemedi** | 151.659 ms | ölçülemedi |
| Birincil analiz | ölçülemedi | 149.692 ms | — |
| Denetim turu | ölçülemedi | 134.687 ms | — |
| Belge yükleme | — | 1.948 ms | — |
| API çağrısı | ölçülemedi | 2 | — |
| **Belge taşıma** | 2 (satır içi) | **1** (fileUri) | **−%50** |
| Input token | ölçülemedi | 22.393 | ölçülemedi |
| Output token | ölçülemedi | 20.365 | ölçülemedi |

> **"Önce" değeri neden yok:** Arşivdeki tek benchmark kaydının teşhisi `{ totalMs: 14, cached: true }` idi — bir önbellek isabetiydi, ölçüm değil. Eski mimari için gerçek bir sayı hiç kaydedilmemiş.

### Doğruluk

| Kontrol | Sonuç |
|---|---|
| Maksimum toplam puan | 500 beklendi, **500 bulundu** ✅ |
| Puan matematiği | gruplar 500 = ilan 500 ✅ |
| Ana başlıklar / puan grupları | **%100** (5/5, puanlarıyla) ✅ |
| Kriter kapsamı | **%100** — tam 13 / kısmi 0 / eksik 0 ✅ |
| ↳ Geçiş koşulları | 6/6 ✅ |
| ↳ Barajlar | 3/3 ✅ |
| ↳ Cezalar | 1/1 ✅ |
| ↳ Eleme / diskalifiye | 2/2 ✅ |
| Görevli kararı gereken maddeler | **%66,7** ⚠️ (3'ten 1'i `human`/`hybrid` işaretlenmemiş) |
| Dayanaksız kriter (halüsinasyon) | **0** ✅ |
| Yasaklı ifade | **0** ✅ |
| Denetim turunun işaretlediği madde | 8 (pasif, görevli onayı bekliyor) |

Benchmark %66,7 nedeniyle **çıkış kodu 1** döndürüyor — gerçek açığı gizlemiyor.

### 🔴 Ölçümün ortaya çıkardığı kritik bulgu

Koşu `gemini-3.5-flash` (yedek model) ile tamamlandı. Doğrudan sondalandı:

- `gemini-3.7-flash` model listesinde **var**
- 8 token'lık bir istekte bile **hiç yanıt döndürmüyor** (`UND_ERR_HEADERS_TIMEOUT`, 300 sn+)
- Ölçülen 151,7 sn'nin yaklaşık **80 sn'si bu ölü beklemedir**

**Kalıcı çözüm sizde:** `.env.local` → `GEMINI_MODEL` çalışan bir modele çevrilmeli. Model adları **sizin onayınız olmadan değiştirilmedi**.

---

## F. Yapılamayanlar ve yarım kalanlar

### F1. Hiç yapılmayanlar

| # | İş | Neden |
|---|---|---|
| **1** | **Uygulama ikonu** — AI Gambit kimliğine uygun favicon, PNG/apple-touch/manifest, sol raydaki `KA` rozeti | Sizin talimatınızla atlandı ("boşver ilk önce"). Mevcut `public/favicon.svg` hâlâ "Kriter Atölyesi" kimliğinde |
| **8** | **Değerlendirme kılavuzu ekranının netleştirilmesi** — kriter / açıklama / puan / azami / baraj / ceza / geçiş koşulunun tek tabloda, iyileştirilmiş bilgi hiyerarşisiyle gösterilmesi | Hiç başlanmadı. Bilgiler ekranda dağınık hâlde mevcut ama tek bakışta okunabilir hâle getirilmedi |

### F2. Yarım kalanlar

| # | İş | Yapılan | Eksik |
|---|---|---|---|
| **7** | Analiz süresi | Paralelleştirme, Files API, denetim turu ucuzlatma, devre kesici, gerçek ölçüm | **Düzeltme sonrası süre ölçülmedi.** Temiz bir "sonra" sayısı bir analiz daha (token) gerektiriyor. Asıl darboğaz (ölü model) `.env.local` ayarı olduğu için tarafımdan çözülmedi |
| **10** | Geçiş / baraj / ceza kontrolü | Kurallar belgeden çıkarılıyor (`deriveDecisionRules`), hakem ekranında dört sütun hâlinde gösteriliyor, `applyPenalties` yazıldı ve test edildi | **Cezanın toplam skora otomatik uygulanması yok.** **Nihai durum üretimi yok** (`başarılı / başarısız / geçti / kaldı / inceleme gerekli`). `applyPenalties` hiçbir hesap yolunda çağrılmıyor |
| **11** | Kriter silme | Kullanıcı eklediği kriterler iki adımlı onayla silinebiliyor (bu özellik zaten vardı, doğrulandı) | Liste satırına **çöp kutusu ikonu** eklenmedi; silme yalnızca müfettiş panelinden erişilebilir |
| **11 (2. tur)** | Token/maliyet ölçümü | Toplam token, API çağrısı, belge taşıma sayısı ölçüldü | **Çağrı bazında token dökümü yok** — birincil ve denetim turunun ayrı ayrı ne harcadığı raporlanmıyor. Denetim turunun `LOW` ayarlarıyla ne kadar tasarruf ettiği ölçülemedi |
| **D3** | İDA ground-truth | Şema hazır | **İçi boş.** Resmî 315 puanlık şartnameden elle doldurulmadı — uydurmamak için |

### F3. Bilinen açık sorunlar

1. **`gemini-3.7-flash` yanıt vermiyor.** Devre kesici ilk istekten sonraki gecikmeyi ortadan kaldırıyor ama ilk istekte hâlâ ~80 sn kayıp var. Çözüm `.env.local`'de.
2. **Görevli kararı doğruluğu %66,7.** 3 fiziksel güvenlik maddesinden biri `human`/`hybrid` işaretlenmiyor — `applyDecisionSafetyPolicy` regex'i (`criteria-app.tsx`) o maddeyi yakalamıyor. Benchmark'ı düşüren tek ölçüt.
3. **Denetim turunun 8 bulgusunun doğruluğu bilinmiyor.** Ground-truth'ta karşılığı olmadığı için gerçek mi gürültü mü ölçülemiyor. Bu yüzden 2 çağrılı mimari kaldırılmadı (`COVERAGE_AUDIT=off` kaçış kapısı duruyor).
4. **Eski profillerde payda küçük çıkabiliyor.** Kriter `maxScore`'ları belgede ilan edilen toplamla örtüşmüyorsa payda kriter toplamı olur (ör. 30 iken belge 315 ilan ediyor). Anomali uyarısı doğru gösteriliyor ama profil **yeniden analiz edilmeden** düzelmez.
5. **Belge havuzu hâlâ cihaza bağlı** (IndexedDB). `DocumentRepository` arayüzü hazır, sunucu uygulaması yazılmadı (istenmedi).
6. **Responsive breakpoint'ler dar ekranda test edilmedi.** Tarayıcı penceresi maksimize olduğu için otomatik yeniden boyutlandırma çalışmadı (3 deneme). Media query kurallarına dokunulmadı ve yalnızca taşmayı azaltan eklemeler yapıldı, ama gerçek dar ekran doğrulaması yapılmadı.
7. **`.setup-preview h2` / `.setup-preview > p` ölü CSS.** Artık kullanılmayan bir yapıyı hedefliyor.
8. **`COMPETITIONS` hâlâ kodda sabit 40 kayıt** ve seçilen yarışma **ad dizgesi** ile taşınıyor (`setup.competition`). Kalıcı bir `competitionId` alanı eklenmedi.

---

## G. Dosya envanteri

### Yeni dosyalar

| Dosya | Amaç |
|---|---|
| `app/components/document-library-modal.tsx` | Belge havuzu penceresi |
| `app/lib/sample-documents.ts` | Hazır test belgeleri (ortak modül) |
| `tools/scoring.test.ts` | 17 puanlama/eşleştirme testi |
| `docs/benchmarks/ida-ground-truth.json` | İDA ground-truth şeması (boş) |
| `output/benchmarks/celikkubbe-olcum-kaydi.json` | Gerçek API ölçüm kaydı |
| `DEGISIKLIK_RAPORU.md` | Bu belge |

### Silinen dosyalar

| Dosya | Neden |
|---|---|
| `app/components/document-library-panel.tsx` | Modal ile değiştirildi |

### Değiştirilen dosyalar

`app/api/analyze/route.ts` · `app/components/criteria-app.tsx` · `app/components/evaluation-app.tsx` · `app/components/competition-select.tsx` · `app/components/search-select.tsx` · `app/components/template-preview.tsx` · `app/components/file-badge.tsx` · `app/globals.css` · `app/lib/types.ts` · `app/lib/evaluation-summary.ts` · `app/lib/competitions.ts` · `app/lib/file-kind.ts` · `app/lib/document-library.ts` · `app/lib/demo-report-evaluator.ts` · `app/lib/draft-store.ts` · `tools/run_celikkubbe_benchmark.mjs` · `docs/benchmarks/celikkubbe-expected.json` · `package.json` · `tsconfig.json`

**Eklenen bağımlılık: yok.**

---

## H. Nasıl doğrulanır

```bash
npx tsc --noEmit     # tip kontrolü      → temiz
npm run lint         # eslint            → temiz
npm test             # 17 puanlama testi → 17/17
npm run build        # üretim derlemesi  → başarılı
```

Benchmark (sunucu çalışırken, **token harcar**):

```bash
npm run dev
node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze
node tools/run_celikkubbe_benchmark.mjs --reuse   # token harcamadan son çıktıyı yeniden ölçer
```

### Elle kontrol edilecekler

- **Yarışma seçimi:** `insansiz` (Türkçe karaktersiz) yazın → 4 sonuç. Bir kayıt seçip alana tekrar tıklayın → tam liste açılmalı.
- **Sağ panel:** Sağ kenarda kesik metin olmamalı. Yıl veya ihlal seçeneğini değiştirin → anında yansımalı.
- **Dosya ikonları:** Havuza `.docx` / `.xlsx` / `.zip` ekleyin → mavi DOCX / yeşil XLSX (tablo ızgaralı) / hardal ZIP.
- **Belge havuzu:** Aşama 2 → "Belge havuzunu aç". Esc ile kapanmalı. Belge türü listesinde "Örnek yarışmacı raporu" olmalı. Değerlendirme Atölyesi'nde "Belge havuzundan seç" yalnızca örnek raporları göstermeli.
- **Puanlama:** Aşama 3'te puan gruplarından birini kapsam dışı bırakın → payda ve "kapsam dışı" rozetleri güncellenmeli. Kriter toplamı ile grup toplamı çelişirse kırmızı anomali uyarısı görünmeli.

### Sonraki önerilen adımlar

1. `.env.local` → `GEMINI_MODEL`'i çalışan bir modele çevirin, benchmark'ı bir kez daha çalıştırın.
2. `applyDecisionSafetyPolicy` regex'ini düzeltin (`output/benchmarks/celikkubbe-latest.json` → `comparison.humanReviewFindings` içindeki eksik maddeye bakın).
3. `docs/benchmarks/ida-ground-truth.json`'u resmî şartnameden elle doldurun.
