# Teslim Raporu — Problem 4 son entegrasyon

**Tarih:** 26 Ağustos 2026 · **Dal:** `son_merge_deneme_2` · **Temel işleme:** `d92d8f8`
**Commit/push yapılmadı**; değişiklikler çalışma ağacında incelemeye bırakıldı.

---

## 1. İlk code review'da bulunan sorunlar

| # | Bulgu | Kanıt (değişiklikten önceki hâl) |
|---|---|---|
| R1 | **Kriter setinin sürümü yoktu.** `submitProfileForReview` aynı `profileId` satırını `ON CONFLICT(id) DO UPDATE` ile sessizce eziyordu. Kriterler değişince eski hakem analizinin hangi kriterlerle üretildiği kanıtlanamıyordu | `app/lib/workflow-db.ts` · eski `submitProfileForReview` |
| R2 | **Rapor analizi tamamen istemciye güveniyordu.** `/api/evaluate-report` `file` (PDF) ve `profile` (kriter seti) alanlarını istemciden alıyordu. Başvuru kimliği hiç yoktu; sonuç `save_evaluation` ile herhangi bir başvuruya yazılabiliyordu | eski `app/api/evaluate-report/route.ts` + `app/lib/report-evaluator.ts` |
| R3 | **PDF dışı kanıt kavramı yoktu.** Tanıtım videosu gibi bir kriter modele gönderiliyor, raporda karşılığı bulunmadığı için `KRITIK_HATA` üretiyordu | `Criterion` tipinde kanıt yeri alanı yok |
| R4 | **Katılımcı ONAY sonucunu göremiyordu.** `toApplication` içindeki `participantResultHidden`, `accepted` sonucunu yarışma `results_published`/`archived` olana kadar gizliyor; `rejected` ve `revision_required` ise anında görünüyordu. Madde 9'daki hatanın kök nedeni budur | eski `app/lib/workflow-db.ts` · `participantResultHidden` |
| R5 | **Rol seçerek şifresiz giriş.** `/api/admin/dev-session` rol koduyla oturum açıyordu; giriş ekranında dört rol kısayolu vardı | silinen `app/api/admin/dev-session/route.ts`, eski `access-login.tsx` |
| R6 | **Kaynak sayfa/alıntı serbestçe düzenlenebiliyordu.** Hem arayüzde `update({ sourcePage })` / `update({ sourceText })` hem de sunucuda hiçbir kontrol yoktu | eski `criteria-app.tsx` inspector |
| R7 | **Aktif/pasif yarışma yoktu.** Yalnızca doğrusal aşama zinciri vardı; `manage_competition_stage` sadece 01'deydi | `app/lib/authorization.ts` |
| R8 | **Arayüzdeki kaldırma işlemleri ve denetim görünürlüğü yoktu.** Yarışma arşivleme ve başvuru kaldırma uçları yoktu | — |
| R9 | **AI uyarısı hiçbir ekranda yoktu** | — |
| R10 | **Otomatik atama yarışma bağlamını görmüyordu**, yük sayımına arşiv kavramı yoktu ve atama `admin_audit_log`'a yazılmıyordu | eski `autoAssignJudge` |
| R11 | **Operasyon sayacı yanıltıcıydı.** `aiPending` yalnızca `submitted` sayıyordu; `assigned`, `resubmitted`, `analysis_failed` görünmüyordu → pano "0 bekleyen" derken kuyruk doluydu | eski `operationsSummary` |
| R12 | **Önbellek anahtarı analiz yapılandırmasını eksik kapsıyordu** (çıktı tavanı ve sıcaklık yoktu) ve **“Yeniden analiz et” seçeneği yoktu**: hatalı bir kayıt kalıcı olabiliyordu | eski `app/api/analyze/route.ts` |

**Doğru bulunan ve korunanlar:** kalıcı önbelleğin iki katmanı, boş/bozuk sonucun
yazılmaması, uçuş içi birleştirme, D1 auth + R2 belge yapısı, dört aşamalı prensip,
tek çağrı mimarisi, kaynak sayfa doğrulaması, benzerlik izleri, "AI karar vermez"
ilkesi ve "Kaynak Satıra Git" işlevi.

---

## 2. Değiştirilen dosyalar

**Yeni (6):**
`migrations/0008_integrity_and_lifecycle.sql` · `app/components/ai-disclaimer.tsx` ·
`tools/dev_reset.mjs` · `tools/e2e_scenario.mjs` · `tools/migrations.test.ts` ·
`tools/verifiability.test.ts`

**Silinen (1):** `app/api/admin/dev-session/route.ts` (şifresiz rol kısayolu ucu)

**Değiştirilen (39):**

| Katman | Dosyalar |
|---|---|
| Veri sözleşmesi | `app/lib/types.ts`, `app/lib/workflow-types.ts`, `app/lib/admin-types.ts` |
| Veri katmanı | `app/lib/workflow-db.ts`, `app/lib/admin-db.ts` |
| İş kuralları | `app/lib/authorization.ts`, `app/lib/admin-roles.ts`, `app/lib/report-prechecks.ts`, `app/lib/criteria-extraction.ts`, `app/lib/profile-loader.ts`, `app/lib/demo-report-evaluator.ts` |
| API | `app/api/evaluate-report/route.ts`, `app/api/applications/[id]/route.ts`, `app/api/competitions/route.ts`, `app/api/profiles/route.ts`, `app/api/operations/route.ts`, `app/api/analyze/route.ts`, `app/api/admin/session/route.ts`, `app/api/admin/bootstrap/route.ts` |
| İstemci | `app/lib/report-evaluator.ts`, `app/lib/workflow-client.ts`, `app/lib/admin-client.ts`, `app/lib/gemini-analyzer.ts` |
| Ekranlar | `access-login.tsx`, `criteria-app.tsx`, `evaluation-app.tsx`, `participant-portal.tsx`, `operations-panel.tsx`, `competition-stage-panel.tsx` |
| Biçim | `app/globals.css`, `app/evaluation.css` |
| Test/araç | `tools/regression-tests.mjs`, `tools/authorization.test.ts`, `tools/profile-loader.test.ts`, `tools/cleanup_test_data.mjs`, `tools/cleanup-test-data.sql`, `package.json` |
| Belge | `PROJE_DURUMU.md`, `README.md`, `GUIDE.md`, `NIHAI_SISTEM_AKISI.md`, `docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md`, `docs/KALICI_ANALIZ_ONBELLEGI.md`, `.env.example` |

Toplam: **45 dosya, +3138 / −586 satır.**

---

## 3. Oluşturulan migration

`migrations/0008_integrity_and_lifecycle.sql` — **tek dosya, eklemeli, geriye uyumlu.**
`DROP TABLE` ve `DELETE FROM` içermez (test bunu doğruluyor). Var olan `0001`–`0007`
dosyalarına dokunulmadı.

| Bölüm | İçerik |
|---|---|
| 1 | `criteria_profile_versions` tablosu + 2 dizin — değişmez kriter sürümleri |
| 2 | `criteria.verifiability` (varsayılan `PDF_DENETLENEBILIR`) |
| 3 | `evaluation_results` ve `competition_applications` için kriter sürümü / kriter özeti / PDF özeti bağı |
| 4 | `competitions.is_active` (varsayılan 1) + aktivasyon denetim sütunları + dizin |
| 5 | `competitions` ve `competition_applications` için `deleted_at` / `deleted_by` / `deleted_by_name` / `deleted_reason` |
| 6 | `admin_accounts.username` + **kısmi** benzersiz dizin (`WHERE username IS NOT NULL`) |

Uygulama şeması (`workflow-db.ts`, `admin-db.ts`) aynı değişiklikleri çalışma anında da
uygular; sütun varsa dokunmaz.

---

## 4. Düzeltilen özellikler (madde madde)

| # | Yapılan |
|---|---|
| **1** | Önbellek anahtarına `maxOutputTokens` ve `temperature` eklendi (belge hash'i, model, istem sürümü, çözünürlük, düşünme bütçesi, sayfa sayısı zaten vardı). **“Yeniden analiz et”** hem 1. adımda hem önbellek notunun yanında; `refresh=1` bellek kaydını siler, `deleteStoredAnalysis` ile D1 kaydını kaldırır, uçuş içi birleştirmeyi atlar. Boş/0 kriterli sonucun yazılmaması, okunan kaydın süzülmesi, eş zamanlı isteklerin birleştirilmesi ve iki katmanın uyumu korundu. Önbellekten dönen sonuç taze sonuçla aynı `AnalysisResult` şemasını kullanır |
| **2** | Her yayım `criteria_profile_versions`'a **yeni** satır yazar (`criteria_version`, `criteria_hash`, `published_at`, `published_by`); mevcut satır hiç `UPDATE`/`DELETE` edilmez (regresyon testi kaynak üzerinden doğruluyor). İçerik değişmemişse sürüm artmaz. Hakem analizi daima son sürümü kullanır. Rapor değerlendirme önbellek anahtarı: `PROMPT_VERSION : sha256(katılımcı PDF) : criteriaHash : criteriaVersion : model : mediaResolution`. Kriterler değişince `criteriaOutdated` işaretlenir, ekranda **“Kriterler güncellendi, yeniden analiz gerekli”** uyarısı + “Analizi yenile” düğmesi çıkar ve sunucu `save_review`'u 409 ile reddeder. Geçmiş kararlar kendi sürümleriyle korunur |
| **3** | `/api/evaluate-report` artık **yalnızca `applicationId`** alır. `resolveEvaluationContext` zinciri sunucuda kurar: başvuru → yarışma → son yayımlanmış kriter sürümü (D1) + geçerli PDF sürümü (R2). `save_evaluation` kaydetmeden önce zinciri yeniden çözer, PDF'i R2'den okuyup SHA-256'sını yeniden hesaplar ve `criteriaVersion` / `criteriaHash` / `pdfHash` eşleşmesini arar; uyuşmazlıkta 409 + açık gerekçe. Atama, başvuru durumu ve `decisions_locked` kontrolleri korundu; kararı yalnızca atanan hakem yazabilir; işlem `admin_audit_log`'a düşer |
| **4** | `Criterion.verifiability` üç değerli. Şartname analizinde model bu alanı doldurur; doldurmazsa dar bir işaret taraması (video/portal/kurul) yedek olur. Rapor analizinde PDF dışı kurallar **modele hiç gönderilmez**, sunucu `DEGERLENDIRILEMEDI` atar. Bu durum hata sayaçlarına girmez (`summary.disiKanit` ayrı), aşamayı kötüleştiremez (sıralamada BAŞARILI'nın altında), zorunlu olsa bile kritik hata doğurmaz (`capStageVerdict`), yarışmacı geri bildirimine yazılmaz (`feedbackOf`) ve hakem ekranında **ayrı bir bölümde** listelenir |
| **5** | Atama sırası: aynı yarışmada görevli aktif hakem → en az açık dosya (arşivlenmişler sayılmaz) → en eski hesap → kimlik (deterministik). Koşullu `UPDATE ... WHERE assigned_judge_id IS NULL AND status = 'submitted'` çift atamayı engeller; atama satırları tek `batch` içinde yazılır. Sonuç hem süreç zaman çizelgesine hem **denetim izine** yazılır. Yeniden atama `application_assignments` geçmişini korur |
| **6** | `is_active` anahtarı; `toggle_competition_activation` izni **01 + 04**. Pasif yarışma: `listOpenCompetitions` ve `competitionAcceptsApplications` sorgularından düşer (yeni başvuru 409), hakem geçmişi görmeye devam eder. 04 panosunda aktif/pasif durumu, toplam başvuru, **analizi tamamlanan**, **analiz bekleyen**, onaylanan, reddedilen, bekleyen, atanamayan, arşivlenen sayaçları ve hakem iş yükü. `operationsSummary.aiPending` düzeltildi |
| **7** | Rol kısayolları ve `/api/admin/dev-session` kaldırıldı. Tek form: kullanıcı adı **veya** e-posta + şifre; rol veri tabanından okunur, istemci rol göndermez. `admin_accounts.username` + kısmi benzersiz dizin. Bootstrap: `admin` / `1234`, PBKDF2-SHA256 ile hash'li, yalnızca üretim dışı, **idempotent** (ikinci çağrı `created:false`), arayüzde ve API yanıtında "yalnızca geliştirme/demo" uyarısı. Admin paneli 01/02/04 hesabı açar; 00 ve 03 sunucu tarafında reddedilir |
| **8** | `tools/dev_reset.mjs`: yalnızca `.wrangler/state/v3/d1/...`, uzak seçenek YOK, `APP_ENV=production` reddi (ortam + `.env.local`), varsayılan kuru çalıştırma, tek transaction + `ROLLBACK`, idempotent. Corpus, kaynak kod, göçler, şema, R2 nesneleri ve bootstrap Admin korunur; R2 anahtarları yalnızca raporlanır. Arayüzdeki kaldırma işlemleri soft delete'e çevrildi |
| **9** | `participantResultHidden` artık yalnızca `review.status === "completed"` koşuluna bağlı. ONAY/RED/REVİZYON aynı kaynaktan aynı anda görünür; onay kutusu karar tarihi, yarışma, takım ve hakem notunu gösterir. Beklemede / analiz bekliyor / inceleniyor durumları `APPLICATION_STATUS_LABELS`'tan okunur |
| **10** | `AI_DISCLAIMER` tek kaynak; `AiDisclaimer` bileşeni hakem ekranında aşama şeridinin hemen altında ve katılımcı geri bildirim kartlarının altında. Altbilgide değil |
| **11** | `archiveCompetition` (01, kendi yarışması) ve `archiveApplication` (02, kendi dosyası) soft delete; gerekçe zorunlu; `recordWorkflowEvent` + `recordAudit`. 04 panosunda "Arşivleme ve kaldırma kayıtları" tablosu: kayıt, işlemi yapan, tarih, önceki → yeni durum, gerekçe. 04 yalnızca görüntüler |
| **12** | Kaynak alanları arayüzde `<output>` ile salt okunur; `update({ sourcePage })` / `update({ sourceText })` çağrıları kaldırıldı. Sunucuda `sourceLockFor` + `applySourceLock` ilk sürümdeki değeri geri koyar ve `criteria_source_locked` olayı yazar; API yanıtı `sourceLockWarning` döndürür ve ekran gösterir. Kriter adı, açıklaması, zorunluluğu ve denetlenebilirlik türü düzenlenebilir kaldı. Manuel kriterlerde kaynak boş ve "Manuel kriter" olarak işaretli |
| **13** | D1 auth ve R2 yapısı, dört aşamalı prensip, "AI karar vermez", "Kaynak Satıra Git", mevcut ekranlar ve API sözleşmeleri korundu; tek zorunlu sözleşme değişikliği `/api/evaluate-report` isteğidir (bütünlük için kaçınılmaz) |

---

## 5. Çalıştırılan testler ve gerçek sonuçları

| Kontrol | Komut | Sonuç |
|---|---|---|
| Tip kontrolü | `npx tsc --noEmit` | ✅ temiz (0 hata) |
| Lint | `npm run lint` | ✅ temiz (0 hata, 0 uyarı) |
| Sır taraması | `npm run check:repo-safety` | ✅ PASS |
| Birim testleri | `npm run test:unit` | ✅ **76/76** (önce 63; +13 yeni) |
| Regresyon testleri | `npm run test:regressions` | ✅ PASS — 6 blok |
| Üretim derlemesi | `npm run build` | ✅ Build complete |
| D1 göç testi | `tools/migrations.test.ts` | ✅ 0001–0008 sırayla boş veri tabanına uygulanıyor; sürüm benzersizliği, pasif/arşiv sorgusu, kullanıcı adı dizini, bağ sütunları ve `verifiability` varsayılanı doğrulandı |
| Geliştirme sıfırlaması | `node tools/dev_reset.mjs --apply` | ✅ 204 satır silindi; ikinci koşu "silinecek kayıt yoktu" (idempotent); bootstrap Admin korundu |
| **Uçtan uca senaryo** | `node tools/e2e_scenario.mjs` | ✅ **96/96** canlı sunucuya karşı |

### Uçtan uca senaryonun kapsadıkları (96 kontrol, 12 bölüm)

Kurulan veri: **1 Admin · 3 Yarışma Yöneticisi · 3 Hakem · 1 Değerlendirme Yöneticisi ·
9 Katılımcı · 3 yarışma · 9 başvuru (her yarışmada kötü/orta/iyi).** Hepsi normal API
akışlarından geçer; uygulama koduna gömülü değildir.

| Bölüm | Doğrulanan |
|---|---|
| 1 | `admin`/`1234` oluşturma, idempotanlık, giriş, yanlış şifre reddi, `/api/admin/dev-session` → 404 |
| 2 | 7 personel hesabı, rol bazlı yönlendirme, Admin'in 00 ve 03 atayamaması |
| 3 | RBAC: Admin → başvuru/operasyon/profil 403; hakem → hesap yönetimi 403; 01 → operasyon 403; oturumsuz → 401 |
| 4 | Kriter sürümü v1, aynı içerikte sürüm artmaması, başka yöneticinin profilinin 403 |
| 5 | Kaynak sayfa/alıntı değişikliğinin API üzerinden reddi ve ilk değere dönmesi |
| 6 | 9 katılımcı kaydı, açık yarışma listesi, 9 başvuru, otomatik atama, dengeli yük (3/3/3), **R2 yükleme + indirme (SHA-256 birebir)**, atanmamış hakemin PDF'e erişememesi, 01'in PDF görememesi |
| 7 | Atanmamış hakemin analiz başlatamaması; yanlış kriter sürümü / yanlış PDF / başka başvuru sonucunun 409 ile reddi; doğru bağlamla kaydın sürüme bağlanması |
| 8 | **Video kriteri `DEGERLENDIRILEMEDI`**, kritik hata sayılmıyor, `disiKanit: 1`, genel durum BAŞARILI |
| 9 | Kriterlerin v2 olarak yayımlanması, eski analizin "eskimiş" işaretlenmesi, nihai kararın 409 ile reddi |
| 10 | **Katılımcının ONAY sonucunu, karar tarihini, notu ve geri bildirimi görmesi**; başkasının başvurusunu görmemesi |
| 11 | Pasifleştirme (01), listeden düşme, yeni başvurunun 409'u, hakemin geçmişi görmesi, 04'ün aktifleştirmesi |
| 12 | Gerekçesiz arşivlemenin reddi, hakemin listesinden düşme, katılımcının kaydı görmeye devam etmesi, yarışma arşivi, sahiplik 403'leri, 04 panosunda kim/ne zaman/gerekçe/önceki-yeni durum |

Senaryo **hiçbir ücretli Gemini çağrısı yapmaz**: `/api/analyze` ve
`/api/evaluate-report` uçlarına dokunmaz; kriter profilini doğrudan yayımlar ve
hakem sonucunu elle kurup bütünlük kapılarını sınar.

---

## 6. Bilerek değiştirilmeden bırakılan alanlar

1. **Canlı AI doğruluğu ölçülmedi.** `PROJE_DURUMU.md` A1–A3 açık: dört aşamalı
   çıkarımın ve rapor değerlendirmesinin recall/precision'ı hâlâ ölçülmedi. Ölçüm
   ücretli çağrı gerektirir; açık izin alınmadı.
2. **`app/lib/demo-report-evaluator.ts` artık çağrılmıyor.** Çevrimdışı yedek sunucuya
   taşındı (anahtar yoksa `provider: "demo"` sonucu sunucuda üretilir). Dosya, ileride
   istemci tarafı bir yedek istenirse diye **silinmedi**; tipleri güncel tutuldu.
3. **`reviewProfile`** (hakem profil onayı) eski kayıtlarla uyum için duruyor;
   `PATCH /api/profiles` zaten 405 döndürüyor. Dokunulmadı.
4. **Hesap kalıcı silme (`purge`)** hard delete olarak kaldı. Arayüzdeki varsayılan
   işlem soft delete'tir (`status = 'revoked'`); kalıcı silme yalnızca zaten pasife
   alınmış bir hesap için ikinci ve bilinçli bir adımdır, denetim izine yazılır ve
   aynı e-postayla yeni hesap açılabilmesi için gereklidir.
5. **`ALLOW_DEV_LOGIN`** artık hiçbir kod tarafından okunmuyor; eski kurulumlarla
   uyum için `.env.example` içinde açıklamasıyla bırakıldı.
6. **`tools/cleanup_test_data.mjs`** (ada göre hedefli eski temizlik) korundu; yalnızca
   uzak D1 çalıştırma talimatı kaldırıldı ve yeni araca yönlendirildi.
7. **Yarışma listesi kodda sabit (`COMPETITIONS`, C2)** ve **belge havuzu cihaza bağlı
   (C1)** maddelerine dokunulmadı; kapsam dışıydı.
8. **Dar ekran (D4) ve ölü CSS (D5)** taraması yapılmadı; yeni bileşenler için
   `@media` kuralları yazıldı ama gerçek cihazda doğrulanmadı.

---

## 7. Canlı ortamda yapılması gereken D1/R2 işlemleri

1. **Göçü uygula** (sırayla, yalnızca eksik olanlar):
   ```bash
   npx wrangler d1 execute <DB_ADI> --remote --file=migrations/0008_integrity_and_lifecycle.sql
   ```
   Uygulama şeması aynı sütunları çalışma anında da açar; göç dosyası kayıt ve elle
   kurulum içindir. `0008` eklemelidir, veri silmez.

2. **Mevcut yayımlanmış profiller için kriter sürümü yoktur.** `criteria_profile_versions`
   boş olduğu sürece hakem analizi `409 · "Bu yarışmanın yayımlanmış kriter sürümü yok"`
   döner. Çözüm: her aktif yarışmada Yarışma Yöneticisi Kriter Atölyesi'nden profili
   **bir kez yeniden yayımlar** (kriterleri değiştirmeye gerek yok); bu v1 sürümünü
   oluşturur. Bu adım **atlanamaz**.

3. **Eski AI sonuçları "eskimiş" görünecek.** Sürüm bağı olmayan kayıtlar
   `criteriaOutdated: true` sayılır (hangi kriterlerle üretildikleri kanıtlanamaz).
   İlgili başvurular için hakem "Analizi yenile" demelidir.

4. **R2:** yapı değişmedi; yeni bağlama veya taşıma gerekmez. Rapor analizi artık PDF'i
   R2'den sunucu tarafında okur — `REPORTS` bağlaması Worker'da tanımlı olmalıdır
   (zaten gerekliydi).

5. **Sırlar:** `MODERATOR_SECRET` uzun ve rastgele; `APP_ENV=production`.
   Üretimde geliştirme bootstrap ucu 404 döner; ilk Admin
   `MODERATOR_BOOTSTRAP_TOKEN` ile açılır.

6. **Demo hesabı temizliği:** üretime taşınan bir veri tabanında `admin` / `1234`
   hesabı varsa **kaldırılmalıdır**.

---

## 8. Kalan riskler ve eksikler

| Risk | Ayrıntı |
|---|---|
| **AI doğruluğu ölçülmedi** | Dört aşamalı çıkarımın ve `verifiability` sınıflandırmasının gerçek şartnamelerdeki isabeti ölçülmedi. Model kanıt yerini yanlış işaretlerse gerçek bir PDF kuralı "harici kanıt" sayılıp AI tarafından atlanabilir. Azaltma: alan Kriter Atölyesi'nden düzenlenebilir ve kural yine hakeme görünür bir bölümde listelenir |
| **`pages` alanı hâlâ istemciden geliyor** | Yalnızca deterministik dil tespiti ve başlık yedeği için. Sunucu, sayfa sayısı kendi ölçümüyle tutmuyorsa metni tamamen yok sayar ve uyarı yazar; ama aynı sayfa sayısında sahte metin gönderilebilir. Kural KARARLARININ kaynağı sunucunun R2'den okuduğu PDF'tir. Tam çözüm sunucu tarafı PDF metin çıkarımıdır (Worker'da pdfjs maliyeti nedeniyle yapılmadı) |
| **Kaynak kilidi ilk yayımdan sonra başlar** | İlk yayımdaki kaynak değeri istemciden gelir (analiz sonucu tarayıcıdadır). Sonraki her değişiklik sunucuda reddedilir. Tam çözüm, analiz çıktısını sunucuda başvuru gibi kalıcılaştırmaktır |
| **İzolatlar arası eşzamanlılık** | Analiz uçuş içi birleştirmesi izolat yereldir. Farklı izolatlarda aynı belge iki kez analiz edilebilir; veri bozulmaz, yalnızca çift maliyet olur (mevcut davranış, değiştirilmedi) |
| **Cloudflare Workers süre sınırı (B3)** | Tek çağrılık analizin süresi hâlâ ölçülmedi; uzun şartnamelerde istek süresi sınırı aşılabilir. Dağıtımdan önce doğrulanmalı |
| **Bootstrap hesabı** | `admin` / `1234` herkesçe bilinen bir şifredir. Üretim dışı ortamla sınırlı ve arayüzde uyarılı, ama geliştirme sunucusu ağa açılırsa risklidir |
| **Yerel D1'de eş zamanlı erişim** | `dev_reset.mjs` çalışırken `npm run dev` açık olmamalıdır (miniflare dosyayı tutar). Betik bunu denetlemez |
| **API sözleşme değişikliği** | `/api/evaluate-report` artık `applicationId` ister; eski bir istemci sürümü bu uca `file` + `profile` gönderirse `400` alır. Depodaki tek istemci güncellendi |

---

## 9. Yeniden üretme adımları

```bash
npm run dev                       # ayrı kabuk; http://localhost:3000
node tools/dev_reset.mjs --apply  # temiz başlangıç (yalnızca yerel D1)
node tools/e2e_scenario.mjs       # 96 kontrol · ücretli AI çağrısı yapmaz

npx tsc --noEmit                  # tip kontrolü
npm run lint                      # lint
npm test                          # sır taraması + regresyon + birim testleri
npm run build                     # üretim derlemesi
```
