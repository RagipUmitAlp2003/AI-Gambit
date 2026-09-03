# AI-Gambit — Proje Durumu ve Yapılacaklar

**Tarih:** 3 Eylül 2026 · **Dal:** `entegrasyon/umit-umut-2026-09-03` (commit edilmemiş birleştirme) · **Temel işleme:** `466e1f3` + `b7cc296`

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
| `docs/GENEL_BELGE_ANALIZ_MIMARISI.md` | Dört aşamalı analiz mimarisi |
| `docs/KALICI_ANALIZ_ONBELLEGI.md` | Kalıcı analiz önbelleğinin sözleşmesi ve koruma kuralları |
| `TESLIM_RAPORU_NIHAI_HAKEM_AKISI.md` | Nihai hakem akışı + benzerlik teslim raporu (26 Ağustos) |
| `SIMULASYON_RAPORU_CELIKKUBBE.md` | Canlı uçtan uca Çelikkubbe simülasyonu — 13 maddelik nihai rapor (27 Ağustos) |
| `PROJE_DURUMU.md` (bu belge) | Durum, ölçüm, eksik iş listesi |

---

## Güncel çalışma — İki dalın birleştirilmesi ve dört aşamalı çıkarım (3 Eylül, akşam)

`entegrasyon/umit-umut-2026-09-03` dalında `umit_finalsonrasi_main1` (benzerlik motoru) ile
`umutun_buglarını_düzeltme_final_sonrasi` (PDF.js çalışma zamanı, hakem akışı v2, katılımcı bütünlüğü)
birleştirildi; birleştirme çözülmüş ama COMMIT EDİLMEMİŞ hâlde bekliyor. Şartname çıkarımı yeniden
DÖRT aşama üretiyor: `criteria_evidence` yalnızca katılımcı PDF raporundan metinsel/sayısal
denetlenebilen teknik tasarım kurallarını taşır; yarışma anı, saha, parkur, ceza/puan, video, portal,
takım ve iletişim kuralları hiçbir aşamada kriter olmaz. Sürümler: istem v36, sözlük v6, seçici v2,
yapı v3. Ayrıntı, ölçümler ve bilinen sınırlar: `ENTEGRASYON_RAPORU_2026-09-03.md`.
Doğrulama: tsc/lint temiz, birim 337/337, regresyon 9/9, build başarılı; canlı Gemini çağrısı yapılmadı.

---
## Güncel çalışma — Kimlik doğrulama çekirdeği sertleştirildi (3 Eylül)

GÖREV 3 · madde 10'un çekirdek dilimi (parola değiştirme akışı ve hesap
oluşturma atomikliği ayrı dilimde):

1. **Fail-closed ortam varsayımı:** `APP_ENV`/`NODE_ENV` eksik ya da
   tanınmayan bir değerse sistem artık PRODUCTION sayılır
   (`app/lib/session.ts · runtimeEnvironment`, tek kaynak). Çerezler `Secure`
   olur, hata ayrıntısı maskelenir, dev bootstrap kapanır; tek seferlik uyarı
   logu atılır. **DAĞITIM NOTU:** APP_ENV'i hiç tanımlamamış bir ortam
   (örn. önizleme) bir anda production moduna geçer — http üzerinden Secure
   çerez yazılamayacağı için giriş sessizce başarısız görünebilir; dağıtım
   öncesi `APP_ENV` değeri doğrulanmalı. Araç betikleri
   (`seed_demo_users`/`dev_reset`/`cleanup_sim_celikkubbe`) ortak
   `tools/env_guard.mjs` ile yalnızca AÇIK development işaretinde çalışır.
2. **Dev bootstrap kilitleri:** admin/1234 kolaylığı korunur ama DÖRT koşul
   birlikte aranır: açık development + `ALLOW_LOCAL_ADMIN_BOOTSTRAP=on`
   (`.env.local`'a eklendi) + loopback istek + sıfır aktif Admin; dev hesabı
   `mustChangePassword:false` açılır (onaylı karar). Üretim token akışı yalnız
   sıfır hesap evresinde çalışır; sonrasında GET nötrdür, POST nötr 404
   "Kurulum ucu kapalı." döner.
3. **Rol fail-closed:** tanınmayan `role_code` hiçbir role çevrilmez (eski
   sessiz "01" düşüşü kalktı); böyle hesap giriş yapamaz, açık oturumu düşer
   ve `login_denied_invalid_role`/`session_denied_invalid_role` denetim kaydı
   yazılır.
4. **Giriş tekdüzeliği:** bilinmeyen kullanıcı, yanlış şifre ve pasif hesap
   AYNI 401 + AYNI mesajı alır; her yolda tam BİR PBKDF2 türetmesi çalışır
   (bilinmeyen kullanıcıda önbellekli sahte kayıt).
5. **Dağıtık kaba kuvvet sayacı:** proses içi Map yerine D1
   `admin_login_failures` (yeni `migrations/0014_auth_hardening.sql` +
   çalışma anı şeması): SHA-256(ip|kimlik) anahtarlı 10 dk pencere, 8 deneme,
   fırsatçı TTL temizliği; bootstrap token denemeleri de aynı sayaçtan geçer.

Doğrulama: tür kontrolü, lint, 177 birim + tüm regresyon testleri temiz;
`tools/auth-security.test.ts` sayaç SQL sözleşmesini satır düzeyinde sınar.
E2E'ye 1b bölümü (tekdüze giriş + 429) eklendi ama canlı koşu yapılmadı.
Commit/push yapılmadı.

---

## Güncel çalışma — Madde numarası makullüğü ve yönetici onaylı OCR yedeği (3 Eylül)

İki hata düzeltmesi:

1. **Madde numarası yanlış sınıflaması (`pdf-structure-v2`):** `clauseNumberOf`
   artık korpusla doğrulanmış makullük sınırları uygular — 3 haneden uzun ya da
   öndeki sıfırlı bölütler (yıl "2024", tarih "28.02.2026", tutar "250.000",
   koordinat), tek başına duran çıplak sayılar (sayfa numarası "17") ve Türkçe
   ay adıyla süren tarih başlangıçları ("30 Eylül-4 Ekim 2026") madde sayılmaz.
   Salt rakam satırları paragrafa karışmaz. Yapı sürümü `pdf-structure-v2`ye
   yükseltildi (eski önbellek kayıtları yeni bloklara karşı oynatılmaz) ve
   kapsam denetim nesnesinin R2 anahtarı yapı sürümünü içerir (v1 kayıtları
   üzerine yazılmaz). Yayımlı profiller etkilenmez; aynı şartname yeniden
   analiz edilirse kaynak kimlikleri bir kez değişir.
2. **Taranmış PDF çıkmazı — OCR yedeği:** metin katmansız belgede 422
   `OCR_REQUIRED` kontrollü durağı korunur; yanıt artık `ocrFallbackAvailable`
   bayrağı taşır ve Kriter Atölyesi "Görüntüden metni çıkar ve analiz et (OCR)"
   düğmesini gösterir. Yönetici onaylarsa (`ocr=1`) sunucu tam olarak BİR ek
   Gemini aktarım çağrısıyla (sıcaklık 0, şemalı JSON, `pdf-ocr.ts`) yapısal
   metni çıkarır, aynı `sourceId` şemasını kullanır ve yapıyı R2'de sabitler:
   sonraki yeniden analizler ek çağrı yapmaz. OCR metni aynı yeterlilik
   kapısından ve alıntı doğrulamasından geçer; sonuçlar analiz uyarısı +
   `ocrDerived` iziyle işaretlenir, sayaçlar dürüst toplamı yazar. Metin
   katmanlı belgelerin önbellek anahtarları bayt bayt değişmedi.

Doğrulama: tür kontrolü, lint, birim + regresyon testleri temiz; OCR akışı
YALNIZCA sahte (mock) `fetch` ile doğrulandı — canlı Gemini koşusu yapılmadı,
gerçek taranmış şartnameyle kalite/tavan kalibrasyonu (OCR_MAX_PAGES=60,
65 536 çıktı tokenı) bekliyor. Commit/push yapılmadı.

---

## Güncel çalışma — Yapısal şartname taraması ve güvenli kriter yayımı (3 Eylül)

GÖREV 1/3 kapsamında şartname analizi, PDF'nin tamamını doğrudan LLM'ye gönderen
akımdan açıklanabilir bir aday-tarama akışına geçirildi:

1. Sunucu PDF metnini sayfa, başlık, numaralı madde, paragraf, liste ve tablo satırı
   düzeyinde çıkarır; her parçaya kararlı bir `sourceId` verir. Metin katmanı yoksa
   uydurma sonuç üretmek yerine OCR gerektiğini açıkça bildirir.
2. Sürümlü Türkçe sözlük; normalizasyon, bağlayıcı/yasaklayıcı ifadeler, sayı-birim,
   başlık ve tablo sinyalleriyle güçlü adayları deterministik olarak seçer. Seçilmeyen
   parçalar ve kapsam dışı karar gerekçeleri denetim kaydında korunur.
3. Tek LLM çağrısı yalnızca seçilmiş özgün metinleri ve yakın bağlamlarını alır;
   PDF dosyası modele tekrar verilmez. Her aday `KRITER` veya `KAPSAM_DISI` olur.
   Aynı adayda birden fazla bağımsız kural varsa ayrı kriterler üretilebilir.
4. Kaynak kimliği, sayfası ve birebir alıntısı sunucuda doğrulanamayan sonuçlar
   yayımlanabilir kriter setine alınmaz. Tekrarlar birleştirilir ve cevaplanmayan
   adaylar tanılarda görünür.
5. Kriter modeli `Kuralın önemi` (mutlaka karşılanmalı / iyileştirme bekleniyor)
   ve kontrol türüyle sadeleştirildi; aktif akıştan ihlal/eleme sonucu kaldırıldı.
   Kaynak sayfa ve alıntı değiştirilemez olmaya devam eder.
6. Profil sahipliği R2 yazımından önce doğrulanır. Yeniden yayımda mevcut kaynak
   dosyası korunur, yeni dosya sürümlü anahtarla hazırlanır ve başarısız veri tabanı
   işleminde yalnızca o isteğin yeni nesnesi temizlenir. Çalışma ve profil taslakları
   kapsamlı anahtarlarla birbirinden ayrılır.

Doğrulama: tür kontrolü ve lint temiz; **118/118** birim testi ile bütün regresyon
paketleri geçti. Gerçek bir resmî şartnameyle kararlı kaynak kimliği testi yapıldı.
Ücretli/canlı Gemini çağrısı yapılmadı. Değişiklikler henüz commit, push veya merge
edilmedi.

---

## 0. En son iş — Çelikkubbe uçtan uca simülasyonu ve bulgu-doğrulama modeli (26–27 Ağustos)

Ayrıntılı rapor: `SIMULASYON_RAPORU_CELIKKUBBE.md`. Özet:

| # | İş | Ne değişti / doğrulandı |
|---|---|---|
| 1 | **Hakem kararının anlamı değişti** | Onayla/Ret artık **AI bulgusunun kabulünü** ifade eder: Onayla → AI'nin sonucu (UYGUN **veya** OLUMSUZ) kesinleşir; Ret → bulgu kullanılamaz, hakem kendi sonucunu (UYGUN/OLUMSUZ) + kaynak (sayfa/bölüm/alıntı veya "Raporda bulunamadı") girmek **zorundadır**. Kesin sonuç: `approved → aiVerdict`, `rejected → judgeResult` (`effectiveVerdictOf`, `app/lib/judge-review.ts`) |
| 2 | Atama yığılması düzeltildi | `autoAssignJudge` sıralaması artık önce yük: `ORDER BY open_files ASC, (competition_files > 0) DESC, …` — canlı simülasyonda bulundu, regresyonu `tools/authorization.test.ts` içinde |
| 3 | Canlı simülasyon (gerçek Gemini, izinli) | 7 aşama + 2 karar alt-aşaması: **87/87**. Şartname 11 kriter (3 PDF-dışı süzüldü), HisarNova 8 bulgu tamamı kanıtlı, benzerlik **%100 hybrid/high** (BENZERLIK_A↔B, 3 MinHash doğrudan eşleşme), GokKalkan %95 ŞÜPHELİ, embedding önbelleği yeniden analizde 0 API çağrısı. Gerçek tarayıcıda UI doğrulandı |
| 4 | Test bataryası | tsc temiz · lint 0/0 · birim 108/108 · e2e **139/139** (anlık görüntü → dev_reset → e2e → geri yükleme; İDA verisi ve hesaplar korundu) · build başarılı |
| 5 | Hedefli temizlik | `tools/cleanup_sim_celikkubbe.mjs`: yalnız Çelikkubbe simülasyon verisini siler, idempotent (2. koşu: silinecek veri yok); hesaplar + İDA + analiz önbelleği korunur |

## 1. Bugün yapılan son iş — Nihai hakem akışı, sade kriter görünümü ve hibrit benzerlik

Ayrıntılı teslim raporu: `TESLIM_RAPORU_NIHAI_HAKEM_AKISI.md`. Özet:

| # | İş | Ne değişti |
|---|---|---|
| 1 | Sade Kriter Atölyesi | Yalnızca iki grup: **Zorunlu / Zorunlu olmayan kriterler**. Denetlenebilirlik seçimi/rozeti, güven ifadeleri ve "karşılanmaması … doğurur" metinleri arayüzden kaldırıldı. `verifiability` GİZLİ alan olarak korunur ve kriter metninden otomatik belirlenir (`resolveVerifiability`); tek amacı PDF dışı kuralları hakem analizinden uzak tutmaktır |
| 2 | PDF dışı kriter filtresi | Video/saha/portal kuralları artık **bulgu üretmez**: modele gönderilmez, sayaçlara girmez, hakem ekranında ve katılımcı geri bildiriminde görünmez ("PDF dışı kanıt" bölümü kaldırıldı). Eski kayıtların `DEGERLENDIRILEMEDI` bulguları okunur ama görünür listeye alınmaz; kayıt yolu da süzer (`sanitizeEvaluation`) |
| 3 | Kriter bazlı hakem kararı | AI ön değerlendirmesi kartta `Uygun/Olumsuz` olarak DEĞİŞTİRİLEMEZ biçimde durur; hakem her kriter için ayrı **Onay/Ret** verir (başlangıç daima "Karar bekliyor" — otomatik doldurma kaldırıldı). Ret: gerekçe + dayanak (`PDF_KONUMU`: sayfa+alıntı · `RAPORDA_BULUNAMADI`: aranan içerik, sahte sayfa istenmez). Geçerli sonuç yalnızca hakem kararıdır; sayaçlar anlıktır ve AI sayacından ayrıdır. Veri: `review_json.criterionDecisions` (+ sunucu doğrulaması + audit `judge_criterion_decisions`). **GÜNCELLENDİ — bkz. bölüm 0/1:** Onay/Ret artık kriter sonucunu değil AI bulgusunun kabulünü ifade eder |
| 4 | Nihai karar | Bütün kriterler sonuçlanmadan genel karar bölümü açılmaz (sunucu 409). Sistem öneri üretmez; karar yalnızca **ONAY/RET** (butonlar Onayla/Reddet; durum adı "RED" kullanılmaz). RET açıklaması reddedilen kriterlerden deterministik şablonla üretilir |
| 5 | AI analizini silme | Hakem `AI analizini sil` (onay pencereli): analiz + tamamlanmamış kriter kararları + bu PDF sürümünün benzerlik sonucu kaldırılır; başvuru/PDF/takım/atama/yarışma korunur; başvuru yeniden analiz bekler. Kesin karar önce sunucu taraflı **`reopen_review`** ile açılmalı. Olay audit + süreç geçmişinde (`ai_analysis_deleted`) |
| 6 | Katılımcı geri bildirimi | Yalnızca iki bölüm: **Güçlü Yönler** (hakem onayları) ve **Gelişime Açık Yönler** (hakem retleri + gerekçe + sayfa/alıntı veya "Raporda bulunamadı"). Gelişim Önerileri kartı kaldırıldı; eski `suggestions` okunur ama gösterilmez/üretilmez |
| 7 | Tam otomatik hakem ataması | Elle atama yüzeyi tamamen kapandı: panel salt okunur, API `assign_judge` 403, yetki matrisinden silindi. Yeni `assignPendingApplications()` bekleyenleri dağıtır (tetik: yeni/aktifleşen 02 hesabı + operasyon panosu yüklenişi) |
| 8 | Hibrit benzerlik | MinHash (korundu) + `gemini-embedding-001` (SEMANTIC_SIMILARITY · 768) parça katmanı: 300–500 kelimelik çakışmalı parçalar, şablon/kimlik temizliği, embedding önbelleği (PDF sürümü+hash+model+boru hattı anahtarlı), kapsama tabanlı 0–100 yaklaşık oran (ham cosine gösterilmez), hakem notu + en fazla 3 eşleşmeli ayrıntı, 04'e yalnızca tamamlandı/işaret bilgisi. Kriter analiziyle paralel (`Promise.allSettled`), PDF SHA-256 bağı, kapsam sunucuda (`competition_key`). Göç: `migrations/0009_similarity_v2.sql` |
| 9 | Basit test kullanıcıları | `tools/seed_demo_users.mjs`: admin + projeyoneticisi1..3 + hakem1..3 + degerlendirmeyoneticisi1 + katilimci1..9 (yalnızca yerel, parola 1234 PBKDF2 ile, idempotent, mevcut Admin'e dokunmaz). Hesap uçları isteğe bağlı `username` kabul eder |
| 10 | Test ve temizlik | e2e senaryosu **137 kontrole** çıktı (benzerlik, kriter kararları, analiz silme, manuel atama reddi, basit kullanıcı adlarıyla giriş). `dev_reset` benzerlik tablolarını, `similarity/` R2 anahtarlarının raporunu ve yalnızca akış-kaynaklı audit kayıtlarının temizliğini kapsar |
| 11 | Çekişmeli inceleme | Değişiklikler 5 boyutlu çok-ajanlı incelemeden geçirildi; her bulgu bağımsız çürütücüyle doğrulandı: **25 bulgu → 23 doğrulandı → tamamı düzeltildi veya bilinçli sınırlama olarak raporlandı** (yarış korumaları, kesin karar bypass'ı, decidedAt/aiVerdict damgası, 04/katılımcı redaksiyonları, benzerlik havuzu geriye uyumu, UI kilit/veri kaybı hataları). Ayrıntı: teslim raporu · bölüm 10b |

### Doğrulama (bugün ölçüldü)

| Kontrol | Sonuç |
|---|---|
| `npx tsc --noEmit` | ✅ temiz |
| `npm run lint` | ✅ temiz |
| `npm run check:repo-safety` | ✅ PASS |
| `npm run test:unit` | ✅ **106/106** (yeni: `judge-review.test.ts`, `similarity.test.ts`, göç 0009 testleri) |
| `npm run test:regressions` | ✅ PASS (7 blok; yeni "Judge-decision flow" bloğu) |
| `npm run build` | ✅ üretim derlemesi tamam |
| `node tools/e2e_scenario.mjs` | ✅ **137/137** — canlı sunucu; ücretli AI/embedding çağrısı YAPILMADI |
| `node tools/dev_reset.mjs --apply` | ✅ idempotent (ikinci koşu 0 kayıt) |
| `node tools/seed_demo_users.mjs --apply` | ✅ 16 sade test hesabı; mevcut Admin korunur |

**Ölçülmedi:** canlı Gemini kriter analizi (report-v6) ve canlı `gemini-embedding-001`
doğruluğu — ücretli çağrı için açık izin alınmadı; embedding API sözleşmesi mock ile
doğrulandı (bkz. teslim raporu · bölüm 13).

---

## 1a. Önceki iş — Bütünlük, yaşam döngüsü ve gerçek giriş

Problem 4 teslim listesinin 1–13. maddeleri uygulandı. Çalışan hiçbir özellik
yeniden yazılmadı; şema değişiklikleri **eklemeli** ve geriye uyumludur
(`migrations/0008_integrity_and_lifecycle.sql`).

| # | İş | Ne değişti |
|---|---|---|
| 1 | Kalıcı önbellek güvenliği | Anahtara çıktı tavanı ve sıcaklık eklendi; **“Yeniden analiz et”** seçeneği geldi (bellek + D1 kaydı atlanır ve silinir, model gerçekten yeniden çalışır). Boş/bozuk sonucun yazılmaması ve uçuş içi birleştirme korundu |
| 2 | Değişmez kriter sürümleri | `criteria_profile_versions`: her yayımda yeni satır (`criteria_version`, `criteria_hash`, `published_at`, `published_by`); eski satır ASLA güncellenmez. Hakem analizi daima son sürümü kullanır; kriterler değişince eski analiz "eskimiş" olur ve sunucu o analizle nihai karar verilmesini reddeder |
| 3 | Değerlendirme bütünlüğü | `/api/evaluate-report` artık **yalnızca `applicationId`** alır. Kriter seti ve PDF sunucuda çözülür (`resolveEvaluationContext`). Sonuç kaydedilirken kriter sürümü, kriter özeti ve PDF SHA-256'sı yeniden ölçülüp karşılaştırılır; uyuşmazlıkta kayıt yapılmaz |
| 4 | PDF dışı kanıt | Kriterlere `verifiability` alanı (`PDF_DENETLENEBILIR` / `HARICI_KANIT_GEREKLI` / `HAKEM_KONTROLU_GEREKLI`) eklendi. PDF dışı kurallar modele hiç gönderilmez, `DEGERLENDIRILEMEDI` alır, hata sayılmaz ve hakem ekranında ayrı bölümde listelenir |
| 5 | Otomatik atama | Aynı yarışmada görevli hakem tercih edilir; yük sayımı arşivlenmiş dosyaları saymaz; atama denetim izine de yazılır. Koşullu `UPDATE` ile çift atama engellenir |
| 6 | Aktif / pasif yarışma | Süreç aşamasından bağımsız anahtar; 01 (kendi yarışması) ve 04 çevirebilir. Pasif yarışma listede görünmez, yeni başvuru almaz; hakem geçmişi görmeye devam eder |
| 7 | Gerçek giriş | Rol kısayolları ve `/api/admin/dev-session` **kaldırıldı**. Tek form: kullanıcı adı/e-posta + şifre; rol veri tabanından okunur. Tek seferlik bootstrap Admini `admin` / `1234` (yalnızca üretim dışı, idempotent, PBKDF2 ile hash'li) |
| 8 | Demo verisi temizliği | `tools/dev_reset.mjs`: yalnızca yerel miniflare D1, üretim reddi, kuru çalıştırma varsayılan, tek transaction, idempotent. Corpus, kaynak kod, göçler ve bootstrap Admin korunur |
| 9 | Katılımcı onay sonucu | **Kök neden:** ONAY, yarışma sonuçları yayımlanana kadar gizleniyordu; RED ise anında görünüyordu. Artık üçü de hakem kararı kesinleştiği anda aynı kaynaktan görünür; onay kutusu karar tarihi, yarışma, takım ve hakem notunu gösterir |
| 10 | AI uyarısı | `AI_DISCLAIMER` + `AiDisclaimer` bileşeni; hakem ve katılımcı ekranlarında AI sonucunun hemen altında |
| 11 | Silme ve denetim | Yarışma arşivleme (01) ve başvuru kaldırma (02) soft delete; 04 panosunda kim/ne zaman/gerekçe/önceki-yeni durum tablosu |
| 12 | Kaynak kilidi | Kaynak sayfa ve alıntı ilk yayımda kilitlenir; arayüzde salt okunur, sunucu elle değişikliği geri alır ve olayı kaydeder |

### Doğrulama (o gün ölçüldü; güncel sayılar için bölüm 1)

O günkü koşular: tsc/lint/repo-safety temiz · birim 76/76 · regresyon 6 blok ·
e2e 96/96 · dev_reset idempotent. Uçtan uca senaryo 1 Admin · 3 Yarışma
Yöneticisi · 3 Hakem · 1 Değerlendirme Yöneticisi · 9 Katılımcı · 3 yarışma ·
9 başvuru (kötü/orta/iyi) kurar ve RBAC, R2 yükleme/indirme, otomatik atama,
bütünlük kapıları, video kriteri, pasif yarışma, onay görünürlüğü, kaynak
kilidi ve arşiv denetimini sınar. Senaryo bugün 137 kontrole genişletildi.

**Ölçülmedi:** canlı Gemini analizi (ücretli çağrı; açık izin alınmadı).

---

## 1b. Önceki iş — Kalıcı analiz önbelleği ve aşama şeridi düzeltmesi

1. **Şartname analizleri kalıcı kayda alındı.** Daha önce analiz edilen belge tekrar
   analiz edildiğinde model **hiç çağrılmaz**: sonuç D1'deki `criteria_analysis_cache`
   tablosundan 0 token ve `apiCalls: 0` ile döner; sunucu yeniden başlasa da kayıt durur.
   Anahtar dosya adı değil **belge içeriğinin SHA-256'sı** + analiz yapılandırmasıdır;
   model/talimat/ayar değişirse eski kayıt doğal olarak eşleşmez. Arayüz isabette
   "Bu şartname daha önce analiz edilmişti (ilk analiz: …)" notunu gösterir.
   Sözleşme ve koruma kuralları: `docs/KALICI_ANALIZ_ONBELLEGI.md`;
   göç: `migrations/0007_analysis_cache.sql`.
2. **Değerlendirme Atölyesi dört aşama şeridi düzeltildi.** Kart içi metinler kutuların
   dışına taşıyordu: `evaluation.css`'teki kurallar eski işaretlemeye göre yazılmıştı ve
   kartı iki sütuna bölüp içerik sütununu sıfıra sıkıştırıyordu. Kurallar yeni
   `eval-stage-head` / `eval-stage-rows` yapısına göre yeniden yazıldı, `globals.css`
   ile özgüllük çakışması giderildi; metinler artık kartın içinde sarılıyor.

### Canlı doğrulama (İDA şartnamesi · 29 sayfa)

| Koşu | Süre | Token | apiCalls | Sonuç |
|---|---|---|---|---|
| İlk analiz | 28,4 sn | 14.055 | 1 | 26 kriter |
| Sunucu yeniden başlatıldıktan sonra | 1,5 sn | 0 | 0 | `cacheStore: "database"` · kriterler birebir aynı |
| Aynı süreçte ikinci istek | 0,4 sn | 0 | 0 | `cacheStore: "memory"` |

### Bağımsız inceleme sonrası düzeltmeler

Değişiklik 3 mercekli (eşzamanlılık, D1/SQL semantiği, UI sözleşmesi) incelemeden ve her
bulgu için çürütme doğrulamasından geçirildi; 4 doğrulanmış bulgu düzeltildi:

- Normalizasyondan 0 kriterle çıkan (veya nesne olmayan) model çıktısı **hiçbir önbellek
  katmanına yazılmaz**; okunan eski kayıt da aynı süzgeçten geçer. Aksi hâlde bozuk bir
  çıktı belgeyi kalıcı olarak boş sonuca kilitlerdi.
- Aynı belgeye eşzamanlı ikinci istek ilkinin sonucunu bekler; model iki kez çağrılmaz.
- Bellekten sunulan isabet D1 `last_used_at` değerini tazeler; 200 satırlık LRU budaması
  en sık kullanılan kaydı silemez.
- Önbellek notu yayımlanmış profil düzenlenirken gösterilmez; "yeni profil" sıfırlaması
  (`restart`) notu da temizler.

---

## 2. Aynı gün, önceki iş — Dört aşamalı prensip ve Admin kısıtı

İki ürün kararı birlikte uygulandı:

1. **Puanlama kriter sisteminden çıkarıldı.** Puan, ağırlık, ceza, baraj, puan grubu,
   normalizasyon ve karar kuralları yarışmanın **fiziksel aşamasına** aittir; sistem
   yalnızca **PDF (rapor) aşamasını** kontrol eder. Şartname analizi ve rapor değerlendirmesi
   aynı **dört aşamayı** kullanır: Dil ve Şablon Uygunluğu · Başlık ve İçerik Kontrolü ·
   Kategori Uygunluğu ve Benzerlik · Kriter Bazlı Kanıt Çıkarma. Her kural için sonuç
   **BAŞARILI / REVİZYON / KRİTİK HATA** + sayfa/paragraf alıntısı + gerekçedir.
2. **Admin (00) yalnızca yönetici ataması yapar.** Hesap açar, rol atar/kaldırır, atama
   geçmişini izler. Kriter, değerlendirme, operasyon ve başvuru uçlarına erişmez. İlk hakem
   atamasını artık **04 · Değerlendirme Yöneticisi** yapar.

3. **Değerlendirme Atölyesi Problem 4 akışına indirgendi.** Kitapçıktaki Problem 4 (dil/şablon,
   başlık/içerik, kategori/benzerlik, AI kriter değerlendirmesi + geri bildirim; nihai karar
   hakemde) esas alındı: hakem girişte atölye ya da geçmişi seçer; kriteri çıkarılmış yarışmalar
   → başvuru kutuları → **Yapay Zeka Analizi** (kriterlerin PDF ile karşılaştırılması) → uygun
   kriter ✓ / hatalı kriter sebebi + "Kaynağa git" → **ONAY / RED** → düzenlenebilir şablon →
   yarışmacıya iletim. Yerel rapor havuzu, profil JSON yükleme ve ayrı geri bildirim editörü
   gibi yükler kaldırıldı.

### Değişen kod

| Dosya | Değişiklik |
|---|---|
| `app/lib/types.ts` | `CheckStage`/`CHECK_STAGES`, `RuleVerdict`, puansız `Criterion` (`stage`, `required`, `sourcePage`), `ProfileExport` 2.0, `ReportEvaluation` 2.0 (`stages`, `findings.verdict`, `summary`), `JudgeDecision` (`accepted`/`adjusted`, `finalVerdict`) |
| `app/lib/criteria-extraction.ts` (yeni) | Tek çağrı şeması, sistem talimatı ve normalizasyon; `EXTRACTION_PROMPT_VERSION = v19-four-stage-single-call`; azami 400 kriter |
| `app/lib/profile-loader.ts` | 1.0 (puanlı) profiller okunurken 2.0'a yükseltilir (`upgradeLegacyCriterion`); puan alanları düşürülür |
| `app/lib/authorization.ts` | 00 yalnızca `manage_accounts`; `assign_judge` → 04 |
| `app/lib/admin-roles.ts` | Rol tanımları ve sınırları yeni yetkiye göre |
| `app/lib/workflow-db.ts` | `criteria` tablosunda `applicability` = aşama, `effect` = `required`/`other`, `max_score` = `NULL` |
| `app/api/analyze/route.ts` | Tek üretim çağrısı; sayfa aralığı, paralel çağrı, denetim turu, puan planı ve `EVIDENCE_VERIFICATION` kaldırıldı |
| `app/api/evaluate-report/route.ts` | Dört aşamalı sonuç; kural kararı ve alıntı; puan önerisi yok |
| `app/components/criteria-app.tsx` | Zorunlu / Diğer kriter listesi, kaynak sayfa, manuel düzenleme/ekleme/silme/pasifleştirme; ön kontrol şeridi, şablon önizleme, puan yapısı ve AI notları bölümleri kaldırıldı |
| `app/components/evaluation-app.tsx` | Problem 4 akışı: giriş seçimi (atölye / geçmiş) → kriteri çıkarılmış yarışmalar → başvuru kutuları → **Yapay Zeka Analizi** → ✓/✗ kriter sonuçları ve "Kaynağa git" → ONAY/RED → düzenlenebilir şablon → yarışmacıya iletim. Yerel rapor havuzu, profil JSON yükleme, üç görünümlü ray ve ayrı geri bildirim editörü kaldırıldı (`app/lib/report-pool.ts` silindi) |
| `app/components/operations-panel.tsx` | İlk hakem ataması 04'te |
| Belgeler | `README`, `GUIDE`, `NIHAI_SISTEM_AKISI`, `PRODUCT`, `DESIGN`, `docs/*`, `.env.example` yeni prensibe göre yeniden yazıldı |

### Bağımsız inceleme sonrası düzeltmeler

Değişiklik, 4 boyutta (atölye, değerlendirme, yetki, test/doküman) bağımsız inceleme ve her
bulgu için iki kuşkucu doğrulamasından geçirildi; 24 doğrulanmış bulgu düzeltildi. Öne çıkanlar:

- Kriter tekilleştirme yalnızca **aynı ad + aynı sayfa/alıntı** için çalışır; tek cümlede
  listelenen birden çok zorunlu başlık artık ayrı kriter olarak kalır.
- `criteria` tablosunda satır kimliği `profilId:kriterId`; farklı profillerin `criterion-1`
  kimlikleri çakışmaz.
- D1'deki eski (1.0) profiller `GET /api/profiles` içinde de 2.0'a yükseltilir; eski
  (puanlı) AI sonuçları taşıyan başvurular "analiz başarısız" olarak sunulur ve hakem /
  Değerlendirme Yöneticisi tarafından yeniden analiz edilebilir.
- Tamamlanmış hakem incelemesi salt okunur açılır; "İncelemeyi yeniden aç" denmeden nihai
  sonuç geri alınmaz. Sunucunun reddettiği kayıt (donmuş karar, atama) artık gerçek
  mesajıyla gösterilir ve ekran sonuç görünümüne geçmez.
- Dil uyuşmazlığı yalnızca profildeki `reportLanguage` ile hesaplanır; modelin tahmini
  deterministik sonuç üretmez. `save_evaluation` tam sözleşme doğrulamasından geçer.
- Operasyon (04) görünümünde benzerlik ayrıntısı ve en yakın takım adı da gizlenir.
- Yeniden yayımda aynı `profileId` korunur (ikinci "yürürlükte" satır oluşmaz); kaynak PDF
  tarayıcı deposundan gelmeyen taslak boş ekran yerine 1. adıma açıklamayla döner.

### Silinen modüller

`app/lib/evaluation-summary.ts`, `app/lib/score-coverage.ts`, `app/lib/criterion-dedupe.ts`,
`app/lib/document-analysis-strategy.ts`, `app/lib/demo-analyzer.ts`,
`app/components/template-preview.tsx`, `app/components/profile-review-panel.tsx` ve bunlara
bağlı `tools/*.test.ts` dosyaları. Eski puanlı çıktılar (`docs/corpus/*-analiz.json`,
`output/benchmarks/*.json`) **korundu** (korpus verisi silinmez); araçlar bunları "eski biçim"
olarak bildirir, canlı koşu üzerine yazar.

### Bilinçli olarak kaldırılan kavramlar (tekrar eklenmesin)

Puan planı ve puan grubu · kapsam daraltma ("bu grup değerlendirmeye dahil") · ceza/baraj
uygulaması ve normalizasyon · karar kuralı özeti · ikinci denetim turu
(`EVIDENCE_VERIFICATION`) · paralel sayfa aralığı ve belge haritası · güven seviyesi ·
"emin değilim" düğmesi · soluk gösterim · karar bekleyen kuyruk · otomatik pasifleştirme ·
görevli kararı (`human`/`hybrid`) ölçütü · sabit ön kontrol şeridi · şablon önizlemesi ·
AI notları · çevrimdışı kriter sağlayıcısı · Admin'in hakem ataması.

### Aynı gün, önceki iş — AI erişim hatası

"Belge analiz edilemedi" hatasının kök nedenleri faturalama (429 bakiye), yanıt vermeyen
birincil model (503) ve ince yeniden deneme bütçesiydi. O gün eklenen `GEMINI_MODEL_SWEEPS`,
`GEMINI_THIRD_MODEL`, `GEMINI_RETRY_BUDGET_MS`, `MODEL_COOLDOWN_MS` ayarları **kaldırıldı**:
"tek çağrı" denen işlem için altı isteğe kadar gönderiliyor, üstelik tanılamaya sabit
`apiCalls: 1` yazılıyordu. Yerine tek çağrı katmanı (`app/lib/gemini-generation.ts`), gerçek
çağrı sayacı ve kullanıcıya sunulan "Yeniden dene" seçeneği geldi. O günden kalan
ayrıştırılmış hata mesajları ve `npm run check:gemini` aracı geçerliliğini koruyor.
O gün alınan puan/kapsam ölçümleri eski prensibe ait olduğu için burada tutulmuyor
(bkz. A1, A2).

---

## 3. Doğrulanmış güncel durum

| Kontrol | Komut | Sonuç |
|---|---|---|
| Depo güvenliği | `npm run check:repo-safety` | ✅ PASS (bugün ölçüldü) |
| Tip kontrolü | `npx tsc --noEmit` | ✅ temiz (bugün ölçüldü) |
| Lint | `npm run lint` | ✅ temiz (bugün ölçüldü) |
| Birim testleri | `npm run test:unit` | ✅ 106/106 geçti (bugün ölçüldü) |
| Uçtan uca senaryo | `node tools/e2e_scenario.mjs` | ✅ 137/137 (bugün ölçüldü; ücretli AI/embedding çağrısı yapılmadı) |
| Üretim derlemesi | `npm run build` | ✅ tamam (bugün ölçüldü) |
| Geliştirme sıfırlaması | `node tools/dev_reset.mjs --apply` | ✅ idempotent (bugün ölçüldü) |
| Regresyon testleri | `npm run test:regressions` | ✅ PASS · 7 blok (bugün ölçüldü) |
| AI erişimi | `npm run check:gemini` | ✅ canlı üretim çağrısı başarılı — İDA analizi 28,4 sn · 14.055 token · 26 kriter (önbellek doğrulaması sırasında; `check:gemini` komutu ayrıca koşulmadı) |
| Doğruluk benchmarkı | `node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze` | ölçülmedi — referans dosyası yeni biçime çevrildi, canlı koşu gerekiyor (A1) |

---

## 4. Eksikler ve düzeltilmesi gerekenler

Sıra önem derecesine göre. "Dosya" sütunu işe nereden başlanacağını gösterir.

### A · Doğruluk (ürünün asıl değeri burada)

| # | İş | Bugünkü durum | Yapılması gereken | Dosya |
|---|---|---|---|---|
| **A1** | Yeni prensibin doğruluğu | Dört aşamalı tek çağrı çıkarımı ve dört aşamalı rapor değerlendirmesi **hiç ölçülmedi**. Şema ve normalizasyon kodla doğrulanıyor; kural kapsamı, aşama/zorunluluk isabeti ve kanıt doğruluğu gerçek belgede test edilmedi | Çelikkubbe ve İDA şartnameleriyle canlı koşu; recall/precision, aşama ve Zorunlu/Diğer isabeti, kapsam dışı doğruluğu (yasaklı ifade), alıntı doğruluğu ölçülmeli | `app/lib/criteria-extraction.ts`, `app/api/evaluate-report/route.ts` |
| **A2** | Benchmark canlı koşusu | `docs/benchmarks/celikkubbe-expected.json` ve `tools/run_celikkubbe_benchmark.mjs` yeni biçime çevrildi (kural kapsamı + aşama/zorunluluk + yasaklı ifade); eski çıktılar eski biçimde duruyor. **Canlı koşu yapılmadı**, beklenti dosyası model çıktısıyla kalibre edilmedi | Sunucu açıkken `node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze` çalıştırılıp eksik/yanlış eşleşen anahtar sözcükler ve aşama beklentileri düzeltilmeli | `docs/benchmarks/celikkubbe-expected.json`, `tools/run_celikkubbe_benchmark.mjs` |
| **A3** | İDA cevap anahtarı | `docs/benchmarks/ida-ground-truth.json` yalnızca şema + "nasıl doldurulur" notu — **içi boş** | Resmî İDA şartnamesinden yeni biçimde elle doldurulmalı. Tek belgeye aşırı uyum riski ikinci belge olmadan ölçülemez | `docs/benchmarks/ida-ground-truth.json` |
| **A4** | Eski 1.0 profiller yükseltilerek okunur | `upgradeLegacyCriterion` aşamayı eski `type` alanından tahmin ediyor; PDF aşaması dışı ve bilgi notu maddeleri **pasif** taşınıyor; `required` eski `effect`'ten türetiliyor. D1'deki eski kayıtlar `max_score` taşıyabilir | Yükseltilen profil yayımlanmadan önce yöneticinin gözden geçirmesi zorunlu tutulmalı; eski D1 kriter satırları için tek seferlik göç veya okuma anında yükseltme kararı verilmeli | `app/lib/profile-loader.ts`, `app/lib/workflow-db.ts` |
| **A5** | Benzerlik eşik kalibrasyonu + canlı embedding | Hibrit benzerlik canlıda hiç koşulmadı: embedding sözleşmesi mock ile doğrulandı, MinHash katmanı e2e'de canlı doğrulandı. Eşikler (0.55/0.30 · 0.90/0.82 · rapor %55/%30) başlangıç değeridir | Açık izinle canlı `gemini-embedding-001` koşusu; kontrollü rapor çiftleriyle (kopya / farklı kelimelerle aynı fikir / yalnız şablon ortak) eşik kalibrasyonu | `app/lib/similarity-text.ts`, `app/api/applications/[id]/similarity/route.ts` |

### B · Model ve maliyet

| # | İş | Bugünkü durum | Yapılması gereken |
|---|---|---|---|
| **B1** | Birincil model kararı | Önceki koşularda birincil model ağır PDF çağrılarında 503 dönüyor, **bütün gerçek işi yedek model yapıyordu** | `.env.local`'de `GEMINI_MODEL` doğrulanmış çalışan bir modele alınmalı; `npm run check:gemini` çalışan alternatifleri listeler. Kalite kararı ekibin |
| **B2** | Faturalama bakiyesi | Ön ödemeli kredi aralıklı tükeniyor | ai.dev/projects üzerinden bakiye ve uyarı eşiği ayarlanmalı. Kod bu durumu doğru mesajla bildiriyor ama çözemez |
| **B3** | Analiz süresi | Eski mimaride 185–294 s (25 sayfa, 5 çağrı). Tek çağrılık yeni mimarinin süresi **ölçülmedi** | Ölçülmeli. **Üretim riski:** Cloudflare Workers istek süre sınırı bu değerlerin altında olabilir; dağıtımdan önce doğrulanmalı. Çözüm yönü: analizi arka plan işine alıp istemciye iş kimliği döndürmek |

### C · Veri kalıcılığı

| # | İş | Bugünkü durum | Yapılması gereken |
|---|---|---|---|
| **C1** | Belge havuzu cihaza bağlı | Tarayıcı içi IndexedDB. `DocumentRepository` arayüzü hazır, sunucu uygulaması yok | R2 tabanlı sunucu uygulaması; ekip ortak havuzu ancak böyle mümkün. Bugün başka bilgisayardan aynı havuz görülmüyor |
| **C2** | Yarışma listesi kodda sabit | `COMPETITIONS` dizisi 40 kayıt; seçim `setup.competition` **ad dizgesiyle** taşınıyor | Kalıcı `competitionId`; ad değişirse eski profiller kopuyor. D1'de `competitions` tablosu ve `competitionId` akışı var, kriter tarafı bağlanmamış |
| **C3** | Cloudflare kaynakları | 8 göç dosyası hazır (`migrations/0001`–`0008`), üretime uygulanmadı; uygulama şeması tabloları çalışma anında da oluşturur | D1 ve R2 kaynaklarının oluşturulması, göçlerin uygulanması, sunucu sırlarının tanımlanması — dağıtım işi |
| **C4** | Üretimde bootstrap Admini | Geliştirme hesabı (`admin` / `1234`) yalnızca üretim DIŞI ortamda açılabilir; uç üretimde 404 döner | Üretimde `MODERATOR_BOOTSTRAP_TOKEN` ile gerçek Admin açılmalı; demo hesabı varsa kaldırılmalı |

### D · Arayüz

| # | İş | Bugünkü durum | Yapılması gereken |
|---|---|---|---|
| **D1** | Uygulama ikonu | `public/favicon.svg` hâlâ "Kriter Atölyesi" kimliğinde; sol rayda `KA` rozeti | AI-Gambit kimliğine uygun favicon, PNG/apple-touch/manifest |
| **D4** | Dar ekran | Media query kuralları **gerçek dar ekranda doğrulanmadı**; yeni Zorunlu/Diğer listesi ve dört aşamalı değerlendirme ekranı da dahil | 360/768/1024 px'de elle kontrol |
| **D5** | Ölü CSS | Kaldırılan bölümlerin (`.setup-preview`, şablon önizleme, puan yapısı) seçicileri `globals.css` içinde kalmış olabilir | Kullanılmayan seçiciler taranıp silinmeli |

### E · Geliştirme ortamı

| # | İş | Bugünkü durum | Yapılması gereken |
|---|---|---|---|
| **E1** | `test:unit` scripti | ✅ Çözüldü: `test:unit` = `node --experimental-strip-types --import ./tools/ts-resolve-hook.mjs --test tools/*.test.ts`. Uygulama kodu uzantısız göreli import (`./types`) kullandığı için Node tip sıyırıcısına küçük bir çözümleme kancası (`tools/ts-resolve-hook.mjs`) eklendi | Node ≥ 22.18 veya 24 ile çalıştırılmalı; kanca yalnızca test koşusunda etkindir |
| **E2** | Benchmark öntanımlı adresi | Öntanımlı `127.0.0.1:3000`, ama `vinext dev` bu makinede IPv6'ya bağlanıyor → `ECONNREFUSED` | `localhost` öntanımlı olmalı; şimdilik adres elle verilmeli |
| **E3** | Yerel D1 oturum testi | Windows'ta `workerd.exe` işletim sistemi politikasıyla engellenebiliyor | Uçtan uca oturum testi için dağıtım ortamı veya politika izni gerekiyor |

### F · Güvenlik

| # | İş | Yapılması gereken |
|---|---|---|
| **F1** | API anahtarı ifşası | Mevcut `GEMINI_API_KEY` sohbet ortamında düz metin paylaşıldı. AI Studio'dan **iptal edilip yenilenmeli** |
| **F2** | Üretim sırları | `MODERATOR_SECRET` üretimde uzun ve rastgele olmalı; `APP_ENV=production` doğrulanmalı (bu ortamda geliştirme bootstrap hesabı hiç açılamaz). `ALLOW_DEV_LOGIN` artık hiçbir kod tarafından okunmuyor |
| **F3** | Geliştirme bootstrap hesabı | `admin` / `1234` herkesçe bilinen geçici bir şifredir. Üretime çıkmadan önce bu hesap KALDIRILMALI; arayüz ve API yanıtı bunu açıkça uyarıyor |

---

## 5. Eski raporlardaki, artık geçerli olmayan maddeler

Aşağıdaki işler ya bugün **yapılmış** ya da yeni prensiple **anlamsız** hâle gelmiştir.
Tekrar yapılmasın:

- **Görevli kararı isabeti (eski A1)** ve **puan kapsamı (eski A2)** — `human`/`hybrid`
  işaretleme ve sayfa üst sınırı/ceza puanı çıkarımı ölçütleri puanlı modele aitti; puan ve
  görevli kararı kavramı kaldırıldı.
- **Nihai durum üretimi (eski A5)** — baraj + ceza + eleme'den durum türetme yok; hakemin
  genel sonucu `JudgeReview.outcome` (`accepted` / `rejected` / `revision_required`) olarak
  doğrudan kaydediliyor.
- **Denetim turu maliyeti ve değeri (eski B4, B5)** — denetim turu ve `EVIDENCE_VERIFICATION`
  kaldırıldı; tek çağrı var.
- **Değerlendirme kılavuzu puan tablosu (eski D2)** — puan, azami, baraj, ceza sütunları yok;
  kriter listesi Zorunlu / Diğer olarak iki bölümdür.
- **Kriter silme (eski D3)** — silme artık liste satırından yapılıyor.
- **`test:scoring` ortam sorunu (eski E1)** — puanlama testleri silindi; `test:unit`
  çalışıyor (bkz. E1).
- **Cezanın skora uygulanması** — puan yok; `applyPenalties` ve `evaluation-summary.ts`
  silindi.
- **İkinci AI aşamasının bağlanması** — `app/api/evaluate-report/route.ts` dört aşamalı
  sonuç üretiyor; eksik olan doğruluk **ölçümü** (A1), motorun kendisi değil.
- **API anahtarının tarayıcıya sızması** — anahtar yalnızca sunucu ortamında; analiz
  isteği sunucudan yapılıyor.
- **Admin'in ilk hakem ataması** — 04'e taşındı; Admin sürece katılmaz.

---

## 6. Silinen belgeler

Aşağıdaki 7 dosya daha önce kaldırıldı: hepsi tarihli, tek seferlik oturum raporuydu,
birbirini ve kalan belgeleri tekrar ediyordu, hiçbirine kod veya belge atıf yapmıyordu.
İçerdikleri güncel bilgi bu belgeye taşındı; değişiklik geçmişi zaten git'te.

| Silinen | Neden | İçeriği nerede |
|---|---|---|
| `DEGISIKLIK_RAPORU.md` (29.6 KB) | 24 Ağustos, `Deneme` dalı, "eskiden/şimdi" raporu | Eksik iş listesi → bölüm 4 |
| `SISTEM_OZETI_VE_SON_AI_PLANI.md` (15.6 KB) | Önerdiği A–J algoritması büyük ölçüde uygulandı, sonra dört aşamalı prensiple değiştirildi | Tamamlanma ölçütleri → A1, A3 |
| `NIHAI_ENTEGRASYON_RAPORU.md` (8.1 KB) | Silinen rapora atıf yapan birleştirme raporu | Dışarıda bırakılanlar → C3, A1 |
| `CHANGES.md` (7.7 KB) | Tek tarihli değişiklik kaydı; git geçmişiyle çakışıyor | — |
| `docs/SON_ENTEGRASYON_DUZELTMELERI.md` (4.4 KB) | 24 Ağustos düzeltme + test raporu | Test durumu → bölüm 3 |
| `docs/PDF_MERKEZLI_AKIS_GUNCELLEMESI.md` (3.9 KB) | Ürün kararı `README`/`NIHAI_SISTEM_AKISI`'nda zaten var | — |
| `PAYLASIM_NOTU.md` (1.0 KB) | Kurulum adımları `GUIDE.md`'de var; ayrıca **yanlış** (Node 20 diyor, `package.json` ≥22.13 istiyor) | `GUIDE.md` |

`NIHAI_SISTEM_AKISI.md` korundu (güncel mimari), ancak içindeki bayat test bölümü
kaldırılıp bu belgeye yönlendirildi.

---

## 7. Doğrulama komutları

```bash
# Uçtan uca senaryo (ücretli AI/embedding çağrısı YAPMAZ)
npm run dev                            # ayrı bir kabuk
node tools/dev_reset.mjs --apply       # temiz başlangıç (yalnızca yerel D1)
node tools/e2e_scenario.mjs            # 137 kontrol
#   Bootstrap admini yerine parolası değiştirilmiş gerçek Admin varsa:
#   E2E_ADMIN_IDENTIFIER=admin E2E_ADMIN_PASSWORD=... node tools/e2e_scenario.mjs

# Basit test kullanıcıları (yalnızca yerel; admin + projeyoneticisiN + hakemN +
# degerlendirmeyoneticisi1 + katilimciN · parola 1234)
node tools/seed_demo_users.mjs --apply

npm run check:gemini          # anahtar, model adları ve gerçek üretim çağrısı
npx tsc --noEmit              # tip kontrolü
npm run lint                  # lint
npm run check:repo-safety     # depoya sır kaçmış mı
npm run test:unit             # birim testleri (bkz. E1)
npm run test:regressions      # regresyon testleri
npm test                      # üçünü birlikte çalıştırır

# Doğruluk benchmarkı — sunucu ayakta olmalı, adres elle verilmeli (bkz. E2, A2)
npm run dev
node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze
```
