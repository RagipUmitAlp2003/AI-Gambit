# AI-Gambit · Nihai Entegrasyon Raporu

**Entegrasyon dalı:** `son_merge_deneme` (temeli `dort-asamali-prensip` · `37a0eb1`)
**Kaynak dallar değiştirilmedi:** `dort-asamali-prensip` ve `rol_duzen` olduğu gibi duruyor.
**Commit / push yapılmadı.** Değişiklikler çalışma ağacında bırakıldı.
**Eski `son_merge_deneme` içeriği** (`rol_duzen` ile aynı commit `fc77333`) `son_merge_deneme_yedek` dalında korunuyor.

---

## 1. Sistem özeti

Sistem, yarışma şartnamesinden **dört aşamalı, puansız bir kriter seti** çıkarır ve katılımcı raporunu bu sete göre değerlendirir. Puan, baraj, ceza ve güven skoru yoktur; her kural için tek bir durum üretilir ve **nihai kararı her zaman hakem verir**.

### Dört aşama

| # | Aşama | Ne kontrol edilir |
|---|---|---|
| 1 | Dil ve Şablon Uygunluğu | Rapor dili, sayfa sınırı, biçim ve teslim kuralları |
| 2 | Başlık ve İçerik Kontrolü | Zorunlu başlıkların varlığı ve altındaki içeriğin doluluğu |
| 3 | Kategori Uygunluğu ve Benzerlik | Kategoriye uygunluk ve havuz içi benzerlik |
| 4 | Kriter Bazlı Kanıt Çıkarma | Her teknik kural için karar + rapordan sayfa/paragraf alıntısı |

Kriter yalnızca **Zorunlu** veya **Diğer**'dir. Kural sonucu yalnızca `BASARILI` · `REVIZYON` · `KRITIK_HATA` olabilir; zorunlu olmayan bir kriter otomatik olarak kritik hata üretemez (sunucuda sınırlanır).

### Roller ve karar sınırları

| Rol | Yapar | Yapamaz |
|---|---|---|
| **00 Admin** | Yalnızca 01/02/04 hesabı açar, rol değiştirir, hesabı pasife alır | Yeni Admin veya Yarışmacı hesabı açamaz · kriter, başvuru, değerlendirme ve operasyon uçlarına erişemez |
| **01 Yarışma Yöneticisi** | Şartname PDF'i yükler, kriterleri düzenler, onay kutusu + ikinci kesinleştirme penceresiyle yayımlar; geçmiş profili açıp yeniden yayımlar; **başvuruyu açar/kapatır ve sonuçları yayımlar** | Rapor kararı veremez · başka yöneticinin profilini veya yarışmasını güncelleyemez |
| **02 Hakem** | Sistemin kendisine ATADIĞI başvuruda AI analizini başlatır, her kriter kararını ve gerekçesini değiştirir, nihai kararı verir | Dosya seçemez: atanmamış veya başkasına atanmış başvuruyu göremez ve üstlenemez · yayımlanmış kriter setini değiştiremez |
| **03 Yarışmacı** | Açık yarışmayı seçer, PDF yükler, kendi başvurusunu ve hakem onaylı geri bildirimi izler | Başka takımın verisini, kriterleri ve yayımlanmamış AI taslağını göremez |
| **04 Değerlendirme Yöneticisi** | Yarışma bazlı sayaçları ve darboğazları izler, 🔥 ÖNCELİKLİ işareti koyar, hakem yeniden atar | Hakem kararı veremez · kriter değiştiremez · rapor içeriğini ve katılımcı adını görmez · **başvuru durumunu değiştiremez** |

Başvuru alındığı anda **sistem** dosyayı en az yüklü aktif hakeme atar; hakem dosya seçemez, 04 gerektiğinde yeniden atar.

Bu kısıtlar arayüzde değil, **her API ucunda sunucu tarafında** uygulanır (`app/lib/authorization.ts` yetki matrisi + `requirePermission`).

### İki AI aşaması — tek çağrı prensibi

Bir kullanıcı işlemi modele **tam olarak bir** `generateContent` isteği gönderir.

1. **Şartnameden kriter çıkarma** (`POST /api/analyze`, rol 01) — belgenin tamamı tek geçişte okunur, dört aşamalı kriter seti kaynak sayfası ve birebir alıntıyla döner. Fiziksel aşama, puan tablosu ve PDF'den doğrulanamayan maddeler kriter yapılmaz.
2. **Katılımcı rapor analizi** (`POST /api/evaluate-report`, rol 02) — yalnızca hakem düğmeye bastığında, yalnızca başvuruya bağlı **yayımlanmış** profille çalışır. Profilden bağımsız yeni kriter üretmez, ret/diskalifiye kararı vermez.

429/503/zaman aşımında uç açık bir hata ve `retryable: true` döndürür; arayüz **"Yeniden dene"** gösterir. Sistem sizin adınıza ikinci bir çağrı yapmaz. `diagnostics.apiCalls` ve kullanım ölçümü **gerçek** istek sayısını taşır (önbellek isabetinde 0).

---

## 2. Değiştirilen dosyalar

### Yeni

| Dosya | Amaç |
|---|---|
| `app/lib/gemini-generation.ts` | Tek çağrılık Gemini katmanı (`runSingleGeneration`) + Türkçe hata çevirisi (`describeGeminiFailure`) |
| `tools/authorization.test.ts` | Rol sınırı ve tek çağrı regresyon testleri (19 test) |
| `FINAL_ENTEGRASYON_RAPORU.md` | Bu belge |

### Silinen

| Dosya | Gerekçe |
|---|---|
| `app/components/audit-panel.tsx` | Admin ekranındaki "İşlem Geçmişi" paneli kaldırıldı. Denetim izi **kayıt olarak korunuyor** (`/api/admin/audit`), yalnızca ekrandan çıkarıldı. |

### Güncellenen

**Yetki ve güvenlik**
- `app/lib/admin-roles.ts` — rol 00 `assignable: false`; atanabilir roller yalnızca 01/02/04
- `app/lib/admin-guard.ts` — R2 bağlaması yokluğu için açık 503; beklenmeyen hatalarda referans kodlu, ayrıştırılmış Türkçe mesaj (üretimde teknik ayrıntı sızmaz)
- `app/lib/authorization.ts` — saf `canViewApplication` ve `canUpdateProfile` yardımcıları (SQL filtresinin test edilebilir karşılığı)
- `app/api/admin/accounts/[id]/route.ts` — Admin (00) hesabının rolü panelden değiştirilemez; pasife alınmış Admin yalnızca kendi rolüyle geri alınır
- `app/components/admin-accounts-panel.tsx` — atanamaz rol satırı için role duyarlı açıklama

**Profil ve kriter atölyesi**
- `app/lib/workflow-db.ts` — `ProfileOwnershipError` + `created_by` sahiplik kontrolü · `criterionRowId` profil **ve** sıra ile nitelendi · `listOpenCompetitions()` · ret/revizyon kararının yarışmacıya anında açılması · `ConflictError` ile 409
- `app/api/profiles/route.ts` — sahiplik ihlali 403
- `app/components/criteria-app.tsx` — rapor şablonu yükleme alanı kaldırıldı · aktif/pasif anahtarı kaldırıldı · yayın öncesi ikinci kesinleştirme penceresi · `?profile=<id>` ile yayımlanmış profili açıp düzenleyip yeniden yayımlama · geçici AI hatasında "Yeniden dene"
- `app/components/manager-profile-history.tsx` — iki ekran tek "Kriter Geçmişi" ekranında birleşti; her profil için "Kriter Atölyesi'nde düzenle" bağlantısı
- `app/components/management-app.tsx` — İşlem Geçmişi paneli kaldırıldı, bölümler `overview / history / accounts` oldu
- `app/components/operations-panel.tsx` — kriter listesinde "Etkin/Pasif" yerine "Zorunlu/Diğer"
- `app/lib/draft-store.ts` — şablon taslağı API'si kaldırıldı, eski kayıt için tek seferlik temizlik
- `app/lib/types.ts` — `Criterion.active` ve `TemplateProfile` geriye uyumluluk alanı olarak belgelendi

**AI çağrı katmanı**
- `app/api/analyze/route.ts` — yedek model kademesi, model taraması, devre kesici ve 300 sn'lik yeniden deneme bütçesi kaldırıldı; tek çağrı, gerçek `apiCalls`, `retryable` bayrağı, şablon PDF'i kabul edilmiyor
- `app/api/evaluate-report/route.ts` — aynı tek çağrı politikası; motorun hiç yapılandırılmadığı durum (`engineUnavailable`) geçici model hatasından ayrıldı
- `app/lib/gemini-analyzer.ts` — şablon parametreleri kaldırıldı, `AnalysisRequestError.retryable`
- `app/lib/report-evaluator.ts` — geçici model hatası artık sessizce çevrimdışı yedeğe düşmüyor, hakeme açık hata olarak gösteriliyor
- `app/lib/usage-metrics.ts` — `apiCalls` ve `generationCalls` sayacı, `callsPerAnalysis` özeti

**Başvuru akışı**
- `app/api/applications/route.ts` — sabit `COMPETITIONS` kontrolü kaldırıldı, açık yarışma listesi D1'den · R2'ye `File/Blob` gönderimi · ayrıştırılmış 409 gerekçeleri
- `app/api/applications/[id]/route.ts` — hakem kararı sonrası yarışmacıya e-posta bildirimi; bildirim hatası kararı geri almaz, `notificationWarning` + denetim kaydı olarak bildirilir; gerekçesiz ret reddedilir
- `app/lib/mailer.ts` — `buildApplicationOutcomeMail`
- `app/lib/competitions.ts` — `searchCompetitionList` (verilen liste üzerinde Türkçe karakter katlamalı arama)
- `app/components/competition-select.tsx` — `options` / `emptyNote` desteği
- `app/components/participant-portal.tsx` — açık yarışma listesi, eksik alan bildirimi, istemci tarafı PDF kapısı (uzantı · `%PDF-` imzası · boş dosya · boyut), okunur dosya boyutu, ret gerekçesi kutusu
- `app/lib/workflow-client.ts` — `WorkflowApiError.reference` / `.retryable`, HTTP durumundan okunur mesaj, `openCompetitions`, `notificationWarning`
- `app/components/evaluation-app.tsx` — bildirim uyarısının hakeme gösterilmesi, başarısız analizde "Yeniden dene"

**Diğer**
- `app/globals.css` — yeni sınıflar (yayın onay penceresi, geçmiş sekmeleri, ret kutusu, gönderim hatası); kullanılmayan kurallar (şablon kartı, aktif/pasif anahtarı, pasif kriter rozeti) temizlendi
- `app/lib/admin-client.ts` — denetim izi ucunun neden ekranda olmadığı notu
- `.env.example`, `GUIDE.md`, `PROJE_DURUMU.md`, `docs/AI_API_ENTEGRASYON_SOZLESMESI.md`, `docs/GENEL_BELGE_ANALIZ_MIMARISI.md` — tek çağrı prensibi ve kaldırılan ayarlar
- `tools/check_gemini_access.mjs` — yalnızca yapılandırılmış modeli sınar
- `tools/regression-tests.mjs` — taşınan ve yeni regresyonlar

**Veritabanı:** migration dosyaları değiştirilmedi. Şema değişikliği yoktur; tüm değişiklikler mevcut sütunlarla geriye uyumludur ve üretim verisi silinmez.

---

## 3. `rol_duzen`'den taşınanlar

| Taşınan | Nereye |
|---|---|
| Dinamik açık yarışma listesi (`listOpenCompetitions`) | `workflow-db.ts`, `applications/route.ts` |
| Sabit `COMPETITIONS` kontrolünün kaldırılması + ayrıştırılmış 409 gerekçesi | `applications/route.ts` |
| R2'ye `file.stream()` yerine `File/Blob` gönderimi | `applications/route.ts` |
| Katılımcı portalında açık hata mesajları, eksik alan bildirimi, yükleme geri bildirimi, okunur dosya boyutu | `participant-portal.tsx` |
| PDF doğrulaması (istemci tarafı) | `participant-portal.tsx` (sunucu tarafı zaten vardı) |
| `searchCompetitionList` + Türkçe karakter arama; `CompetitionSelect` dinamik seçenekleri | `competitions.ts`, `competition-select.tsx` |
| Hakem kararı sonrası yarışmacıya e-posta/portal bildirimi | `mailer.ts`, `applications/[id]/route.ts`, `workflow-db.ts` |
| Bildirim hatasının kararı geri almaması + ayrıca kaydedilmesi | `applications/[id]/route.ts` (try/catch ile sertleştirildi), `evaluation-app.tsx` |
| Gemini hatalarını anlaşılır Türkçeye çeviren bölüm (`describeGeminiFailure`) | `gemini-generation.ts` |
| `WorkflowApiError` referans kodu + HTTP durumundan okunur mesaj | `workflow-client.ts` |
| `handleError` referans kodu + SQLite ihlali çevirisi; `ReportStorageUnavailableError` yanıtı | `admin-guard.ts` |
| Kriter satırı kimliğinin sıra ile nitelenmesi (UNIQUE ihlali düzeltmesi) | `workflow-db.ts` · `criterionRowId` |
| Uyumlu regresyon testleri (satır kimliği, yarışma araması, Gemini hata taksonomisi) | `tools/regression-tests.mjs` |

## 4. `rol_duzen`'den **taşınmayanlar** ve gerekçeleri

| Taşınmadı | Gerekçe |
|---|---|
| Hakemin atanmamış başvuruları görmesi (`assigned_judge_id IS NULL` kaçağı) | Nihai rol tanımı: hakem yalnızca 04'ün atadığı dosyayı görür. `applicationVisibility` 02 dalı sıkı bırakıldı, test ile kilitlendi. |
| Hakemin AI analizini başlatarak dosyayı üstlenmesi (self-assign) | İlk atama 04'ün yetkisidir. `markApplicationAnalyzing` içindeki üstlenme bloğu alınmadı. |
| İlk atamanın Admin'e (`initial_requires_admin`) bağlanması | Admin akışa katılmaz; ilk atama `assign_judge` yetkisiyle (04) yapılır. |
| Eski puan/baraj/ceza/eleme/toplam puan yapıları, `proposedTotals`, `finalScore`, `penaltyPoints` | Nihai mimari puansızdır. |
| `evaluation-summary.ts`, `score-coverage.ts`, `report-pool.ts`, eski demo değerlendiricileri | Dört aşamalı dalda silinmiş dosyalar; geri getirilmedi. |
| Eski `met` / `not_met` / `partially_met` tipleri | Yerine `RuleVerdict` (`BASARILI` / `REVIZYON` / `KRITIK_HATA`). |
| Çoklu model sweep, devre kesici ve 300 sn'lik gizli yeniden deneme döngüsü | Tek çağrı prensibiyle çelişiyor; kaldırıldı. Yerine `retryable` + kullanıcı kontrolündeki "Yeniden dene". |
| Eski büyük `evaluation-app.tsx` ve eski kriter atölyesi mimarisi | Dört aşamalı dal ana kaynak. |
| `app/lib/compliance-verdict.ts` | Olduğu gibi alınmadı; işlevi `RuleVerdict` ve dört aşamalı `ReportEvaluation` içinde zaten karşılanıyor (`summarizeFindings`, `capStageVerdict`, `worstVerdict` — `report-prechecks.ts`). |
| `evaluation-summary.ts` bağımlı regresyon testi (`criterionEliminates`) | Test ettiği modül artık yok. |
| `changeCompetitionStage` içindeki "Admin `force` ile barajı atlar" yorumu | Admin bu uca erişmiyor; dört aşamalı daldaki açıklama korundu. |
| Yarışmacı geri bildirim başlıklarının "Güçlü yönler / Gelişime açık alanlar" hâli | Kriter bazlı başlıklar korundu: "Karşılanan kriterler", "Hatalı kriterler ve sebepleri", "Revizyon önerileri". |

---

## 5. Giderilen hatalar

| # | Hata | Çözüm | Doğrulama |
|---|---|---|---|
| 1 | `profileId` üzerinden başka yöneticinin profilinin değiştirilebilmesi | `submitProfileForReview` içinde `created_by` sahiplik kontrolü → `ProfileOwnershipError` → 403 | Canlı: ikinci yönetici hesabıyla 403 alındı, profil içeriği bozulmadı |
| 2 | Admin API'sinin `00` veya `03` hesabı oluşturabilmesi | Rol 00 `assignable: false`; allowlist yalnızca 01/02/04. Ayrıca Admin hesabının rolü panelden değiştirilemez | Canlı: 00 ve 03 istekleri HTTP 400 |
| 3 | Hakemin atanmamış başvuruları görmesi / üzerine alması | `rol_duzen`'deki gevşetme taşınmadı; `applicationVisibility` ve `markApplicationAnalyzing` sıkı | Canlı: atanmamış başvuru listede yok, `start_analysis` HTTP 404 |
| 4 | Yayımlanmış yarışmanın sabit `COMPETITIONS` listesinde olmadığı için başvurunun reddedilmesi | Yetkili kaynak yayımlanmış profil; `listOpenCompetitions()` ile portala dinamik liste | Canlı: şartnameden çıkan yarışma adı listede göründü, başvuru HTTP 201 |
| 5 | R2'ye `file.stream()` gönderiminden kaynaklanan yükleme sorunu | `reportBucket().put(objectKey, file)` (Blob) | Canlı: PDF R2'ye yazıldı, başvuru kaydı oluştu |
| 6 | Tek çağrı denmesine rağmen birden çok Gemini isteği ve `apiCalls: 1` yazılması | `runSingleGeneration` ile tek istek; sweep/cooldown/bütçe kaldırıldı; sayaç gerçek değeri taşıyor | Canlı: iki AI aşamasında da `apiCalls=1`; birim test 503'te yeniden deneme olmadığını kanıtlıyor |
| 7 | Kaldırılması istenen resmî şablon, pasif kriter ve puan sistemlerinin kalması | Şablon yükleme alanı ve API alanları kaldırıldı; aktif/pasif anahtarı kaldırıldı, yayımlanan her kriter etkin | Canlı: `templateProfile.provided=false`; kriterlerde puan/güven alanı yok |
| 8 | Admin ekranında İşlem Geçmişi panelinin görünmesi | `AuditPanel` kaldırıldı; denetim kaydı yazılmaya devam ediyor | Kod incelemesi + derleme |
| 9 | Yönetici geçmişinin iki ekranda kalması ve geçmiş profilin düzenlenememesi | Tek "Kriter Geçmişi" ekranı; `/kriter-atolyesi?profile=<id>` ile açılıp düzenlenip aynı kimlikle yeniden yayımlanıyor | Canlı: sahibi kendi profilini yeniden yayımladı (HTTP 201), içerik güncellendi |
| 10 | `pdf-integrity.test.ts` modül çözümleme hatası | `dort-asamali-prensip` dalında zaten giderilmişti (uzantılı içe aktarım + `tools/ts-resolve-hook.mjs`) | 3 test geçiyor |

---

## 6. Doğrulama sonuçları

Tümü bu çalışma ağacında çalıştırıldı.

| Kontrol | Komut | Sonuç |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | ✅ 0 hata |
| ESLint | `npm run lint` | ✅ 0 hata / 0 uyarı |
| Depo güvenliği (gizli anahtar taraması) | `npm run check:repo-safety` | ✅ PASS |
| Regresyon testleri | `npm run test:regressions` | ✅ PASS + "Extended regression tests: PASS" |
| Birim testleri | `npm run test:unit` | ✅ 45/45 geçti, 0 başarısız |
| Üretim derlemesi | `npm run build` | ✅ Build complete (24 rota) |
| Git durumu | `git status` | 34 değişiklik + 2 yeni dosya; beklenmeyen/izlenmeyen artık yok |

### Eklenen yetki testleri (`tools/authorization.test.ts`)

| Test | Sonuç |
|---|---|
| Admin yalnızca 01, 02, 04 oluşturabilir | ✅ |
| Admin (00) hesabının rolü panelden değiştirilemez | ✅ |
| Admin kriter/değerlendirme/başvuru uçlarına erişemez | ✅ |
| Yarışma yöneticisi başka yöneticinin profilini değiştiremez (saf karar + sunucu kaynağı) | ✅ |
| Hakem yalnızca kendisine atanmış başvuruyu görebilir (saf karar + SQL kaçak kontrolü) | ✅ |
| Hakem analiz başlatarak atanmamış dosyayı üstlenemez | ✅ |
| İlk hakem atamasını yetki matrisi (04) belirler | ✅ |
| Katılımcı yalnızca kendi başvurusunu görebilir | ✅ |
| Değerlendirme Yöneticisi karar veremez ve kriter değiştiremez | ✅ |
| AI sonucu tek başına başvuruyu reddedemez (`saveApplicationEvaluation` `outcome`'a dokunmaz) | ✅ |
| Şartname ve rapor analizi tek `generateContent` çağrısı yapar | ✅ |
| Şartname analizi ayrı rapor şablonu kabul etmez | ✅ |

### Uçtan uca akış (yerel dev sunucusu + gerçek Gemini çağrısı)

Küçük ve kontrollü örnek kullanıldı: `output/pdf/Ornek_Akilli_Ulasim_OTR_Degerlendirme_Kilavuzu.pdf` (82 KB). API anahtarı hiçbir çıktıda gösterilmedi.

| # | Adım | Sonuç |
|---|---|---|
| 1 | `01` şartname PDF'i yükler | ✅ HTTP 200 |
| 2 | Tek LLM çağrısıyla kriterler çıkarılır | ✅ `apiCalls=1` · 14 kriter · `gemini-3-flash-preview` |
| 3 | `01` kriterleri yayımlar | ✅ HTTP 201 |
| 4 | `03` açık yarışmayı görür | ✅ "2026 Akıllı Ulaşım Sistemleri Yarışması" listede |
| 5 | `03` PDF yükler, rapor D1/R2'de kaydedilir | ✅ HTTP 201 · bozuk PDF HTTP 400 ile reddedildi |
| 6 | `04` başvuruyu `02` hakeme atar | ✅ HTTP 200 · atama öncesi hakem dosyayı göremedi, üstlenemedi (HTTP 404) |
| 7 | `02` AI analizini başlatır | ✅ HTTP 200 · rapor analizi `apiCalls=1` |
| 8 | Kanıtlar ve kaynak bağlantıları görünür | ✅ 14 bulgu · 4 aşama · 7 bulguda sayfa numaralı alıntı |
| 9 | Hakem karar verir | ✅ HTTP 200 · gerekçesiz ret HTTP 400 ile engellendi |
| 10 | `03` sonucu ve hakem onaylı geri bildirimi görür | ✅ `outcome=rejected` · gerekçe ve geri bildirim açık · yalnızca kendi başvuruları |
| 11 | E-posta başarısız olsa bile karar korunur | ✅ Mail sağlayıcısı tanımsız → uyarı döndü, karar veri tabanında kaldı |

Ek olarak doğrulandı: Admin 00/03 hesabı açamadı (HTTP 400), Admin kriter profillerini okuyamadı (HTTP 403), Değerlendirme Yöneticisi karar veremedi (HTTP 403), AI sonucu kaydedildikten sonra başvuru sonucu `pending` kaldı, zorunlu olmayan kriter kritik hata üretmedi.

---

## 7. İkinci tur — performans, veri temizliği ve UI düzeltmeleri

Entegrasyondan sonra istenen refactor bu dalda tamamlandı.

### 7.1 LLM performansı ve kaynak sayfa hatası

**Kök neden — "tüm kriterlerde kaynak sayfa girilmedi":** `sourcePage` yalnızca bir bilgi alanı değil, model çıktısının doğrulama sınırıydı ve sınır **istemciden** geliyordu. `/api/analyze` içindeki `Number(formData.get("pageCount"))` alan eksik geldiğinde `0` üretiyor, `Math.max(1, 0)` bunu **1**'e çekiyordu. Sonuçta 1'den büyük her kaynak sayfası "aralık dışı" sayılıp `null`'a çekiliyor ve ekranda her kriterde "kaynak sayfa girilmedi" yazıyordu.

Yapılanlar:

- **Sayfa sınırı sunucuda belgeden okunuyor** (yeni `app/lib/pdf-page-count.ts`). Sayfa nesneleri (`/Type /Page`) ile sayfa ağacının `/Count` değeri çapraz kontrol edilir; doğrulama sınırı olarak ölçümlerin **büyüğü** alınır (`upperBound`), böylece dar bir sınır geçerli kriterleri silemez. `/api/evaluate-report` de aynı modülü kullanır.
- **Ayrıştırıcı doğrulanmamış sayfayı kaydetmiyor.** `normalizeCriteria` artık sayfası eksik veya sınır dışı olan kriteri listeye almaz; düşen kriterlerin **adları** uyarıya yazılır. Kaydedilen bir profilde `sourcePage: null` durumu artık oluşamaz.
- **Sistem istemi** `sourcePage`'i zorunlu kılar, basılı sayfa etiketi ile dosya sırasını ayırır ve alıntı ile sayfanın aynı sayfadan gelmesini şart koşar. Şemada `minimum: 1`.
- **Token ve süre optimizasyonu:** şemadan `templateProfile` ve `excludedRules` çıkarıldı (ikisi de yalnızca sayaç/uyarı üretiyordu); `description` tek cümle ve 300 karakter, `sourceText` 320 karakterle sınırlandı; `temperature: 0`, `topP: 1`; `maxOutputTokens` 65 536 → 24 576.
- **Düşünme bütçesi belge uzunluğuna göre seçiliyor** (`< 40 sayfa → LOW`, `40–79 → MEDIUM`, `80+ → HIGH`), `GEMINI_THINKING_LEVEL` ile sabitlenebilir.
- **Görüntü çözünürlüğü `LOW`** oldu — sürekli 503 hatasının asıl nedeni buydu (aşağıda).
- **Derinlik korundu:** ilk sıkılaştırma kriter sayısını 13'ten 10'a düşürünce istem "eksiksiz ol" kuralıyla güçlendirildi ve prompt sürümü `v21`'e alındı.

#### Sürekli 503 "AI modeli şu anda yoğun" hatası — asıl neden

Kullanıcı, aynı belgeyi defalarca denemesine rağmen her seferinde 503 aldı. Kontrollü ölçüm bunun **kapasite değil ayar** sorunu olduğunu gösterdi. 29 sayfalık İnsansız Deniz Aracı şartnamesi (1,8 MB), aynı istek gövdesi, aynı model:

| Görüntü çözünürlüğü | Sonuç |
|---|---|
| `MEDIA_RESOLUTION_MEDIUM` (eski) | **4/4 denemede 503** (biri 200 sn zaman aşımı) |
| çözünürlük belirtilmemiş | 503 |
| `MEDIA_RESOLUTION_LOW` | **3/3 denemede başarılı** · 16 719 giriş tokenı · 14 kriter · 14/14 kaynak sayfa |

Gemini, çok sayfalı PDF'leri yüksek görüntü çözünürlüğüyle işlemeyi yüksek kapasiteli istek sayıp "high demand" koduyla reddediyor. Küçük bir `generateContent` ping'i aynı anda sorunsuz geçiyordu (`npm run check:gemini` → OK), bu yüzden hata "model çökmüş" gibi değil "yoğun" gibi görünüyordu.

Yapılanlar:
- Her iki uçta çözünürlük **`MEDIA_RESOLUTION_LOW`** oldu; ortak `mediaResolutionPart()` üzerinden okunur ve `GEMINI_MEDIA_RESOLUTION` ile değiştirilebilir.
- Ayar **önbellek anahtarına** eklendi; aksi hâlde değiştirilen ayar hiç denenmeden eski sonuç dönüyordu.
- **503 mesajı düzeltildi.** Eskiden "GEMINI_MODEL değerini başka modele alın" diyordu — bu hata için yanlış yönlendirme. Artık aynı belgede tekrarlanan 503'ün ayar kaynaklı olabileceğini ve `GEMINI_MEDIA_RESOLUTION`'ı söylüyor.
- Kural ve kanıt metinleri PDF'in **metin katmanından** okunduğu için düşük görüntü çözünürlüğü kriter sayısını ve kaynak sayfa doluluğunu değiştirmedi.

#### Ölçümler (uçtan uca `POST /api/analyze`, istemci sayfa sayısı bilinçli gönderilmedi)

| Belge | Sayfa | Önce | Sonra | Kriter | Kaynak sayfa |
|---|---|---|---|---|---|
| Çelikkubbe Hava Savunma | 25 | 47,9 sn | **9,3 sn** | 13 | **13/13** |
| İnsansız Deniz Aracı | 29 | **503 (hiç tamamlanmadı)** | **14,4 sn** | 14 | **14/14** |
| İnsansız Su Altı Sistemleri | 35 | — | **14,1 sn** | 12 | **12/12** |

Düşünme bütçesi karşılaştırması (Çelikkubbe, LOW çözünürlük): `LOW` 9,0 sn / 15 kriter · `MEDIUM` 19,9 sn / 16 kriter. Varsayılan `LOW` hedeflenen **13 maddelik derinliği koruyor**; daha fazlası için `GEMINI_THINKING_LEVEL=MEDIUM`.

Açıklama uzunluğu ortalama 103 karaktere indi (önceki kayıtta 149–192). Sunucu her belgede sayfa sayısını kendisi okudu (25 / 29 / 35) ve **hiçbir kaynak sayfası kaybolmadı** — eski kodda bu senaryoda sınır 1'e düşüp bütün sayfalar siliniyordu.

### 7.2 Veritabanı kalıcılığı ve temizlik

- **Kalıcılık doğrulandı.** Çelikkubbe profili tarayıcı belleğinde değil D1'de duruyor: `GET /api/profiles` ve `GET /api/profiles?id=…` sunucudan okuyor, oturum kapatılıp açıldığında kayıp yok, 13 kriterin **13'ünde de** kaynak sayfa dolu.
- **Temizlik scripti:** `tools/cleanup-test-data.sql` (mantığın tek kaynağı) + `tools/cleanup_test_data.mjs` (yerel çalıştırıcı, kuru çalıştırma varsayılan). Silinecek yarışmalar adıyla sayılır; adı listede olmayan hiçbir kayıt etkilenmez, bu yüzden üretimde de güvenle çalıştırılabilir (`wrangler d1 execute --file`).
- **Silinenler:** 4 yarışma, 3 profil, 49 kriter, 3 ayıklama kaydı, 2 başvuru ve bağlı 11 satır (takım üyesi, sürüm, atama, değerlendirme sonucu, süreç olayı). Silinen 4. yarışma, aynı Çelikkubbe'nin profilsiz kalmış öksüz `criteria_review` kaydıydı.
- **Sonuç (canlı doğrulandı):** Yayımlanan profiller **1** (Çelikkubbe) · Geçmiş ayıklamalar yalnızca Çelikkubbe · Yarışmacı açık yarışma listesi yalnızca Çelikkubbe · **Başvurularım 0 kayıt** · Hakem atölyesi 1 yarışma / 0 başvuru · Operasyon panosu 1 yarışma.
- Silinen başvuruların R2 nesneleri script çıktısında listeleniyor; SQL bunları silemez (yerel geliştirmede `.wrangler/state/v3/r2` klasörü temizlenebilir).

### 7.3 Kriter Atölyesi UI

- **Kesin ikili kategori:** "Zorunlu ve diğer / Yalnızca zorunlu / Yalnızca diğer" filtresi tamamen kaldırıldı; iki bölüm her zaman birlikte listelenir. `[+ Zorunlu Kriter Ekle]` ve `[+ Diğer Kriter Ekle]` düğmeleri artık **kriter giriş formu açar** (ad, aşama, açıklama, ihlal sonucu, kaynak sayfa, alıntı); tür düğmeyle belirlenir ve form içinde değiştirilemez. Kriter "Ekle" ile listeye girer — eskiden düğme doğrudan "Yeni kriter" yer tutucusu ekliyordu.
- **Dinamik ana buton:** ilk analizde `[Kriterleri Oluştur]`, daha önce kaydedilmiş bir profil düzenlenirken `[Değişiklikleri Kaydet]`. Kaydetme yolu **yapay zekâyı çalıştırmaz**; form aynı profil kimliğiyle doğrudan veri tabanına yazılır. Ekran başlığı, kesinleştirme penceresi ve durum metinleri de bu iki duruma göre değişir.
- Canlı doğrulandı: aynı profil kimliği güncellendi, D1'e yazıldı, **yeni profil oluşmadı** (liste hâlâ tek kayıt).

### 7.4 Bu turda değişen dosyalar

**Yeni:** `app/lib/pdf-page-count.ts` · `tools/cleanup-test-data.sql` · `tools/cleanup_test_data.mjs`

**Güncellenen:** `app/lib/criteria-extraction.ts` (şema, sistem istemi, sıkı sayfa doğrulaması) · `app/lib/gemini-generation.ts` (görüntü çözünürlüğü ayarı, düzeltilmiş 503 mesajı) · `app/api/analyze/route.ts` (sunucu sayfa sınırı, üretim ayarları, düşünme bütçesi, çözünürlük) · `app/api/evaluate-report/route.ts` (ortak sayfa sayacı ve çözünürlük) · `app/components/criteria-app.tsx` (kriter formu, filtre kaldırma, dinamik buton) · `app/globals.css` · `package.json` (regresyon koşucusuna tip çözümleme kancası) · `.env.example` · `GUIDE.md` · `docs/AI_API_ENTEGRASYON_SOZLESMESI.md` · `tools/criteria-extraction.test.ts` · `tools/regression-tests.mjs` · `tools/authorization.test.ts`

### 7.5 İkinci tur doğrulama

| Kontrol | Sonuç |
|---|---|
| TypeScript | ✅ 0 hata |
| ESLint | ✅ 0 uyarı |
| Birim testleri | ✅ 49/49 |
| Regresyon testleri | ✅ PASS (temel · genişletilmiş · kaynak sayfa · görüntü çözünürlüğü) |
| Üretim derlemesi | ✅ Build complete |
| Secret taraması | ✅ PASS |
| Panel içerikleri (canlı) | ✅ 11/11 kontrol geçti |

---

## 8. Üçüncü tur — kaynak sayfa bağlantısı ve hakem akışı

### 8.1 Kaynak sayfa artık gerçek bir bağlantı

Kriter listesinde "Kaynak s. 10" yalnızca metindi; tıklanamıyordu. Nedeni yapısaldı: **şartname PDF'i hiçbir yerde saklanmıyordu.** Belge yalnızca tarayıcının yerel taslağında (IndexedDB) duruyordu, bu yüzden profil Kriter Geçmişi'nden açıldığında bağlanacak bir adres yoktu.

- Yayımlama ucu (`POST /api/profiles`) artık `multipart/form-data` da kabul ediyor; `sourceFile` verilirse şartname R2'ye `profiles/{profileId}/{ad}.pdf` anahtarıyla yazılır. Anahtar profil kimliğine bağlı olduğu için yeniden yayımda bağlantı değişmez.
- Anahtar `sourceDocument.fileKey` alanında saklanır — **veritabanı şeması değişmedi**, eski profillerde alan yoktur ve bağlantı yerine açıklayıcı not gösterilir.
- Yeni uç: `GET /api/profiles/[id]/file`. `content-disposition: inline` ile döner, böylece `#page=N` çapası çalışır ve PDF doğrudan ilgili sayfada açılır.
- Görünürlük profil okuma yetkisiyle aynı: 01 yalnızca **kendi** profilinin şartnamesini, 02/04 yalnızca yayımlanmış profillerinkini açar; yarışmacı (03) bu uca **hiç giremez**.
- Bağlantı üç yerde: kriter satırı, kriter inceleme paneli ve Kriter Geçmişi. Geçmişte ayrıca "Şartnameyi aç" düğmesi var.
- Profil kaydedilemezse yüklenen R2 nesnesi geri alınır.

Canlı doğrulama (13/13 kontrol): şartname yüklendi, profil kimliği korundu, `/api/profiles/{id}/file` gerçek PDF döndürdü (1,75 MB, `inline`), 13/13 kriterde kaynak sayfa var, hakem açabildi, **yarışmacı 403 aldı**.

### 8.2 Başvuru hakem paneline düşmüyordu

Yarışmacı Çelikkubbe'ye PDF gönderiyor, hakem panelinde "0 başvuru" görünüyordu. Bu bir hata değil, ikinci turda belirlenen kuralın sonucuydu: *"04 ilk hakem atamasını yapar"* + *"hakem atanmamış raporu göremez"*. Kimse atamadığı için dosya hiçbir panelde görünmüyordu ve süreç **sessizce** duruyordu.

Kullanıcı kararıyla **otomatik atamaya** geçildi:

- Başvuru alındığı anda **sistem** en az yüklü aktif hakeme atar (`autoAssignJudge`); eşitlikte en eski hesap. Durum `submitted` → `assigned` olur.
- **Güvenlik kuralı korundu:** hakem hâlâ dosya seçemez. Atanmamış veya başkasına atanmış dosyayı göremez (`applicationVisibility`) ve üzerine alamaz (`markApplicationAnalyzing`).
- 04 gerektiğinde başka hakeme **yeniden atayabilir**.
- Atama koşulu SQL `WHERE`'de tutulur; eşzamanlı iki başvuru aynı satırı iki kez atayamaz.
- **Atama başarısız olursa başvuru düşmez:** kayıt korunur, `submitted` kalır ve 04 panosunda görünür.
- Aktif hakem yoksa 04 panosu bunu sayar ve uyarır.

Görünürlük iyileştirmeleri (sessiz tıkanmayı önlemek için):
- 04 panosunda **"hakem ataması bekliyor"** sayacı, atanmamış satırlar listenin başında ve kırmızı **"Hakem atanamadı"** etiketi.
- Hakem ekranındaki boş durum artık akışı açıklıyor; "0 başvuru" tek başına bozuk sistem gibi görünmüyor.
- Hakem sayacı düzeltildi: `submitted` durumu hakem listesinde hiç görünmediği için "AI ön değerlendirmesi bekliyor" sayacı her zaman 0 yazıyordu; yerine "size atandı" sayılıyor.
- Yarışmacıya "Başvurunuz alındı **ve bir hakeme iletildi**" bildirimi.

Canlı doğrulama (14/14 kontrol): 03 PDF gönderdi → durum `assigned`, hakem "Demo Hakem" otomatik atandı → 02 başvuruyu gördü ve AI analizini başlattı → **ikinci hakem dosyayı ne gördü ne de üzerine alabildi (404)** → 04 yeniden atadı → yeni hakem gördü, eski hakem görmez oldu.

### 8.3 Bu turda değişen dosyalar

**Yeni:** `app/api/profiles/[id]/file/route.ts`

**Güncellenen:** `app/lib/types.ts` (`sourceDocument.fileKey`) · `app/lib/profile-loader.ts` · `app/api/profiles/route.ts` (multipart yayımlama + R2) · `app/lib/workflow-client.ts` (`submitProfileForReview(profile, sourceFile)`, `profileFileUrl`) · `app/lib/workflow-db.ts` (`autoAssignJudge`) · `app/components/criteria-app.tsx` (kaynak sayfa bağlantısı, şartname yükleme) · `app/components/manager-profile-history.tsx` (bağlantılı kaynak sayfa, "Şartnameyi aç") · `app/components/operations-panel.tsx` (atama bekleyen sayacı ve sıralama) · `app/components/judge-queue-panel.tsx` · `app/components/evaluation-app.tsx` · `app/components/participant-portal.tsx` · `app/globals.css` · `tools/authorization.test.ts`

### 8.4 Üçüncü tur doğrulama

| Kontrol | Sonuç |
|---|---|
| TypeScript | ✅ 0 hata |
| ESLint | ✅ 0 uyarı |
| Birim testleri | ✅ 53/53 |
| Regresyon testleri | ✅ PASS (temel · genişletilmiş · kaynak sayfa · görüntü çözünürlüğü) |
| Üretim derlemesi | ✅ Build complete |
| Secret taraması | ✅ PASS |
| Kaynak sayfa bağlantısı (canlı) | ✅ 13/13 |
| Otomatik hakem ataması (canlı) | ✅ 14/14 |

---

## 9. Dördüncü tur — Problem 4 tamamlama

### 9.1 Değerlendirme Yöneticisi paneli

**İzleme ekranı (salt sayısal):** Yeni "Şartname ve kriter özeti" bölümü her yarışma için `[Ad] · [N kriter ayıklandı] · [Başvuru: Açık/Kapalı]` satırı gösterir; altında toplam / değerlendirilen / onaylanan / reddedilen / bekleyen sayaçları ve başvuru yoğunluğu çubuğu yer alır. Veri `GET /api/operations · overview` alanından gelir.

**Gizlilik sunucuda uygulanır:** `CompetitionOverview` tipi katılımcı adı, ekip üyesi, dosya adı ve rapor içeriği alanlarını **hiç taşımaz**; test bu sızıntıyı ayrıca kontrol eder. Kriter ADLARINI gösteren eski "Değerlendirme profilleri" bölümü panelden kaldırıldı — bu rol kriter metinlerini okumaz.

**Başvuru durumu yetkisi taşındı:** `manage_competition_stage` artık `["01"]`. Yarışmanın sahibi kriterleri yayımlayan Yarışma Yöneticisidir; başvuruyu açma/kapatma, kararları dondurma ve sonuç yayımlama onun kararıdır. 04 bu durumu yalnızca **izler**. Yeni `CompetitionStagePanel` bileşeni 01'in çalışma alanına eklendi ve kapatılan bir yarışma yeniden açılabiliyor (`applications_closed -> open` geçişi eklendi).

**[ÖNCELİKLİ] etiketi:** Yeni `flag_competition_priority` yetkisi (`["04"]`) ve `PATCH /api/competitions` ucu. Tek tıkla, isteğe bağlı gerekçeyle atanır.
- Hakem panelinde yarışma kartında **🔥 ACİL / ÖNCELİKLİ** rozeti belirir, gerekçe altında görünür ve yarışma **listenin başında** sıralanır (`ORDER BY is_priority DESC`).
- Öncelik yarışmanın süreç durumuna, kriter setine veya hiçbir karara **dokunmaz** — test bunu SQL düzeyinde doğrular.
- 04 panosu 5+ bekleyen başvurusu olan yarışmayı önceliğe aday olarak uyarır.

**Veritabanı:** `migrations/0006_competition_priority.sql` — `is_priority` (varsayılan 0), `priority_note`, `priority_set_at` ve öncelik indeksi. Tamamen **eklemeli**; uygulama açılışında `upgradeCompetitionTable` aynı sütunları güvenle ekler, mevcut satırlar etkilenmez.

### 9.2 4. prensip (teknik kriter) hassasiyeti

Sistem istemine **zorunluluk kipi taraması** eklendi: *zorunludur · içermelidir · olmalıdır · mecburidir · kesinlikle yasaktır · kullanılamaz · aşamaz · en az · en fazla · aşması durumunda* ve benzerleri. Ayrıca tipik olarak atlanan somut gereksinim türleri tek tek sayıldı: boyut kısıtları (E×B×Y), ağırlık sınırları, batarya/gerilim limitleri, malzeme ve patlayıcı yasakları, **fiziksel acil durdurma butonu**, zorunlu analiz/hesap/test, teslim edilecek çizim ve haberleşme kuralları.

İlk sıkılaştırma 4. aşamayı güçlendirirken 2. aşamayı boşalttığı için istem bir "AŞAMA DENGESİ" kuralıyla tamamlandı ve sürüm `v23`'e alındı.

Gerçek ölçüm (tek çağrı, kaynak sayfa doluluğu %100):

| Belge | Kriter | 1. Dil/Şablon | 2. Başlık | 3. Kategori | 4. Teknik | Süre |
|---|---|---|---|---|---|---|
| Çelikkubbe (25 s) | 15 | 3 | 3 | 1 | 8 | 29,1 sn |
| İnsansız Deniz Aracı (29 s) | 17 | 1 | 2 | 1 | **13** | 65,9 sn |

Yakalanan teknik kriter örnekleri: *İDA Azami Boyut Sınırı (150×200×200 cm)* · *İDA Azami Ağırlık Sınırı (50 kg)* · *Fiziksel Acil Durdurma Butonu* · *Patlayıcı Madde Yasağı* · *Haberleşme Frekans Kısıtlaması* · *Kablo İzolasyonu ve Güvenliği* · *Pervane Koruma Sistemi*. Görev metninde adı geçen madde türlerinin tamamı çıkarıldı.

### 9.3 Problem 4 MVP denetimi — dört bileşen

Uçtan uca gerçek analizle doğrulandı (13 bulgu):

| # | Bileşen | Durum |
|---|---|---|
| 1 | Dil ve Şablon | ✅ `Türkçe` tespit · beklenen `Türkçe` · yeşil/sarı/kırmızı ikon |
| 2 | Başlık ve İçerik | ✅ `0/2 başlık dolu` · eksik başlıklar adıyla listeleniyor |
| 3 | Kategori ve Benzerlik | ✅ kategori `%5` · benzerlik **ŞÜPHELİ / Normal** olarak işaretleniyor |
| 4 | Kriter Değerlendirmesi | ✅ 13 bulgu · her birinde gerekçe · **Kaynak Satıra Git** düğmesi |

**Hakem ekranı:** Yeni `StageIcon` bileşeni her aşamayı yeşil ✓ / sarı ! / kırmızı ✕ ikonuyla gösterir (renk tek başına bilgi taşımasın diye simge de değişir). Aşama kartları artık ölçüm satırları taşıyor: tespit edilen dil ve beklenen dil, dolu/eksik başlık sayısı ve eksik başlık adları, kategori yüzdesi, benzerlik durumu.

**Katılımcı geri bildirimi:** Kart başlıkları PRD diliyle eşlendi ve `PARTICIPANT_FEEDBACK_LABELS` tek kaynağından okunuyor — **Güçlü Yönler**, **Gelişime Açık Yönler**, **Gelişim Önerileri**. Hakem ekranındaki önizleme aynı kaynağı kullanır, başlıklar ikiye ayrılamaz.

### 9.4 Bu turda bulunan ve düzeltilen iki hata

**1. Dil adı uyuşmazlığı (yanlış kırmızı).** Model dili İngilizce adlandırıyor (`"Turkish"`), profildeki beklenen dil ise Türkçe (`"Türkçe"`). Ham metinler karşılaştırılınca **doğru dilde yazılmış rapor** 1. aşamada uyuşmazlık gibi görünüyordu. Artık her iki taraf da `expectedLanguageCode` ile dil koduna çevrilip karşılaştırılıyor; hem sunucu hem ekran aynı mantığı kullanıyor. Ölçüm: `Turkish -> Türkçe`, uyuşmazlık üretilmiyor.

**2. Yinelenen yarışma satırı yayımlanmış olanı gölgeliyordu.** Aynı şartname iki kez analiz edildiğinde modelin çıkardığı yıl/aşama biraz farklı olursa `competitionKey` değişiyor ve **aynı adla profilsiz ikinci bir satır** açılıyordu. `findCompetitionWorkflow` yalnızca `updated_at`'e göre sıraladığı için bu boş satırı seçiyor, yarışmacı yarışmayı listede görüyor ama başvurusu *"yayımlanmış kriter profili yok"* diye reddediliyordu — daha önce giderilen 4 numaralı hatanın farklı bir yoldan tekrarı. Üç katmanda düzeltildi:
- `findCompetitionWorkflow` artık kullanılabilirliğe göre sıralıyor (önce profili olan, sonra açık olan).
- `competitionAcceptsApplications` tek satıra değil, "bu adla açık ve profilli bir satır var mı" sorusuna bakıyor — seçim listesiyle aynı ölçüt.
- Kök neden: analiz, bu ad için zaten yayımlanmış profil varsa **yeni yarışma satırı açmıyor**.

### 9.5 Bu turda değişen dosyalar

**Yeni:** `app/api/competitions/route.ts` · `app/components/competition-stage-panel.tsx` · `migrations/0006_competition_priority.sql`

**Güncellenen:** `app/lib/authorization.ts` (yetki taşıma + `flag_competition_priority`) · `app/lib/workflow-db.ts` (öncelik sütunları, `listCompetitionsFor`, `ownsCompetition`, `setCompetitionPriority`, yarışma arama düzeltmesi) · `app/lib/workflow-types.ts` (`CompetitionOverview`, öncelik alanları) · `app/lib/workflow-client.ts` · `app/lib/types.ts` (geri bildirim başlıkları) · `app/lib/criteria-extraction.ts` (zorunluluk kipi taraması, aşama dengesi) · `app/api/operations/route.ts` (yarışma özeti, PATCH taşındı) · `app/api/evaluate-report/route.ts` (dil normalizasyonu) · `app/components/operations-panel.tsx` · `app/components/evaluation-app.tsx` (öncelik rozeti, aşama ikonları, PRD dili) · `app/components/participant-portal.tsx` (üç geri bildirim kartı) · `app/components/management-app.tsx` · `app/globals.css` · `tools/authorization.test.ts` · `tools/regression-tests.mjs`

### 9.6 Dördüncü tur doğrulama

| Kontrol | Sonuç |
|---|---|
| TypeScript | ✅ 0 hata |
| ESLint | ✅ 0 uyarı |
| Birim testleri | ✅ 63/63 |
| Regresyon testleri | ✅ PASS (6 grup) |
| Üretim derlemesi | ✅ Build complete |
| Secret taraması | ✅ PASS |
| Değerlendirme Yöneticisi akışı (canlı) | ✅ 19/19 |
| Problem 4 dört bileşen (canlı) | ✅ 15/15 |

---

## 10. Beşinci tur — Kalıcı analiz önbelleği ve aşama şeridi düzeltmesi

**Sorun 1:** Şartname analizi yalnızca süreç içi bir `Map`'te önbellekleniyordu (12 kayıt);
sunucu her yeniden başladığında aynı belge için model yeniden çağrılıp token harcanıyordu.

**Sorun 2:** Değerlendirme Atölyesi'ndeki dört aşama kartlarının içi metinleri kutu dışına
taşıyordu: `evaluation.css` kuralları kartların eski işaretlemesine göre yazılmıştı ve
kartı iki sütuna bölüp içerik sütununu sıfır genişliğe sıkıştırıyordu.

Yapılanlar:

- **`criteria_analysis_cache` tablosu (D1) eklendi** (`migrations/0007_analysis_cache.sql`).
  Ham model çıktısı, belge içeriğinin SHA-256'sı + istem sürümü + model + çözünürlük +
  düşünme kademesi + sayfa sayısından türetilen anahtarla saklanır. İsabette model **hiç
  çağrılmaz**; cevap `cached: true`, `cacheStore: "memory" | "database"`, `firstAnalyzedAt`,
  0 token, `apiCalls: 0` taşır. Normalizasyon her okumada yeniden çalışır. Sınır 200 satır
  (LRU); bellek isabeti D1 tazeliğini günceller.
- **Koruma kuralları:** 0 kriter üreten çıktı hiçbir katmana yazılmaz (kalıcı boş-sonuç
  kilidi önlenir); okunan kayıt aynı süzgeçten geçer; aynı belgeye eşzamanlı ikinci istek
  ilkinin sonucunu bekler; nesne olmayan JSON gövdesi 502 ile reddedilir.
- **Arayüz notu:** Kriter Atölyesi isabette "Bu şartname daha önce analiz edilmişti
  (ilk analiz: …). Kayıtlı sonuç gösterildi; yapay zekâ yeniden çalıştırılmadı ve token
  harcanmadı." notunu gösterir; yayımlanmış profil düzenlenirken gösterilmez.
- **Aşama şeridi CSS'i** yeni `eval-stage-head` / `eval-stage-rows` işaretlemesine göre
  yeniden yazıldı; `globals.css` ile özgüllük çakışması giderildi, metinler kart içinde sarılıyor.

Doğrulama: İDA şartnamesi (29 sayfa) ilk analiz 28,4 sn · 14.055 token · 26 kriter;
sunucu yeniden başlatıldıktan sonra aynı belge 1,5 sn · 0 token · birebir aynı kriterler
(`cacheStore: "database"`); aynı süreçte ikinci istek 0,4 sn (`cacheStore: "memory"`).
Değişiklik 3 mercekli bağımsız incelemeden geçirildi; 4 doğrulanmış bulgu düzeltildi.
Ayrıntı: `docs/KALICI_ANALIZ_ONBELLEGI.md`.

---

## 11. Kalan gerçek riskler

1. **Tek model, yedeksiz.** Yapılandırılan model 503 döndürdüğünde analiz tamamlanmaz; kullanıcı "Yeniden dene" demek zorundadır. Bu bilinçli bir seçimdir (tek çağrı prensibi), ama yoğun saatlerde kullanıcı deneyimini doğrudan etkiler. Kesinti sürerse `GEMINI_MODEL` elle erişilebilir bir modele alınmalıdır.

2. **E-posta sağlayıcısı yapılandırılmamış.** `RESEND_API_KEY` / `MAIL_FROM` boş olduğu sürece hakem kararı yarışmacıya e-posta ile ulaşmaz; yalnızca giden kutusuna ve portala yazılır. Sistem bunu hakeme uyarı olarak gösteriyor, fakat üretimde bu ayar yapılmalıdır.

3. **Eski (1.0, puanlı) profiller.** `profile-loader` bunları dört aşamalı şekle yükseltiyor ve bu yolda **pasif kriter** üretebiliyor (fiziksel/bilgi amaçlı maddeler). Değerlendirme motoru `active` bayrağını hâlâ dikkate alıyor. Yeni profillerde pasif kriter oluşmuyor, ancak eski bir profil yeniden yayımlanırsa tüm kriterleri etkin hâle gelir — yönetici gereksiz olanları silmelidir.

4. **Kanıt doğrulaması eksik kalabiliyor.** Uçtan uca testte 14 bulgunun 7'sinde sayfa numaralı alıntı vardı. Alıntı kaynak sayfada birebir doğrulanamazsa kanıt listeden düşürülüp `evidenceMissing` işaretleniyor; bu durumda hakem kaynağı kendisi kontrol etmek zorunda.

5. **Rol 00'ın geri alınamaması riski.** Admin hesabının rolü artık panelden değiştirilemiyor ve `MODERATOR_BOOTSTRAP_TOKEN` yalnızca sistemde hiç hesap yokken çalışıyor. Tek Admin hesabının erişimi kaybolursa kurtarma yolu veri tabanı düzeyinde müdahale gerektirir. "Son aktif 00" koruması sistemi sıfır moderatörle bırakmıyor, ancak ikinci bir Admin hesabı yalnızca kurulum anında açılabiliyor.

6. **Yerel D1 kaydı kirlendi.** Uçtan uca test yerel `.wrangler` veri tabanına demo hesaplar, bir yayımlanmış profil ve bir başvuru yazdı. Bu yalnızca yerel geliştirme durumudur; depoya girmez ve üretim verisine dokunmaz.

7. **`apiCalls` yalnızca üretim çağrısını sayar.** Büyük PDF'lerde Files API yüklemesi ayrı bir HTTP isteğidir; `documentTransfers` alanında ayrıca izleniyor, `apiCalls` içinde değil. "Tek çağrı" ifadesi üretim (`generateContent`) çağrısını kastediyor.

8. **Denetim izi ekranı yok.** Panel kaldırıldığı için kayıtlara yalnızca `/api/admin/audit` ucundan erişilebiliyor. İstenirse ayrı bir görünüm olarak geri eklenebilir.

9. **Eski profillerde kaynak sayfa bağlantısı yok.** Şartname PDF'i yalnızca yayımlama sırasında gönderildiğinde saklanır. Daha önce yayımlanmış profillerde `sourceDocument.fileKey` bulunmaz; bağlantı yerine "kaynak belge kayıtlı değil" notu görünür. Kriterler Kriter Atölyesi'nde yeniden yayımlandığında bağlantı oluşur.

10. **Aktif hakem yoksa otomatik atama yapılamaz.** Başvuru `submitted` durumunda kalır ve yalnızca 04 panosunda görünür. Sistem bunu sayar ve uyarır, ancak hakem hesabı açılana kadar süreç ilerlemez.

11. **Yük dağıtımı basittir.** Atama, tamamlanmamış dosya sayısı en düşük hakeme yapılır; uzmanlık alanı, yarışma kategorisi veya izin durumu dikkate alınmaz. 04 gerektiğinde elle yeniden atar.

12. **Öncelik işareti yalnızca sıralama etkisi taşır.** Hakem panelinde yarışmayı öne çıkarır ve rozet gösterir; hakem yine istediği dosyadan başlayabilir. Zorlayıcı bir kuyruk veya süre hedefi (SLA) yoktur.

13. **Yarışma adı hâlâ eşleştirme anahtarıdır.** Yinelenen satır sorunu üç katmanda kapatıldı, ancak iki FARKLI yarışma tam olarak aynı adı taşırsa (ör. iki yılın aynı adlı yarışması aynı anda açık) başvuru yönlendirmesi ada göre yapılır. Yıl/aşama ayrımı `competitionKey` içinde vardır; ad çakışması olan senaryoda başvuru en uygun açık satıra bağlanır.

14. **Operasyon tablosunda takım adı görünür.** Katılımcı adı, ekip üyeleri, dosya adı ve rapor içeriği bu role hiç gitmez; ancak hakem yeniden ataması için satırın ayırt edilmesi gerektiğinden takım adı korunmuştur.
