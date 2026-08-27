# Teslim Raporu — Nihai Hakem Akışı, Sade Kriter Görünümü ve Benzerlik Analizi

**Tarih:** 26 Ağustos 2026 · **Dal:** `son_merge_deneme_2` · **Temel işleme:** `abe1c4d`
**Kapsam:** Görev maddeleri 1–16 (kriter sadeleştirme · PDF dışı kriter filtresi ·
kriter bazlı hakem kararı · nihai karar · AI analizi silme · iki bölümlü katılımcı
geri bildirimi · tam otomatik hakem ataması · hibrit benzerlik · basit test
kullanıcıları · testler ve temizlik).

Bu rapordaki her test sonucu bu makinede GERÇEKTEN çalıştırılmıştır; çalıştırılmayan
hiçbir şey "çalıştı" olarak yazılmadı. Ölçülemeyenler 13. bölümde açıkça listelidir.

---

## 1. İlk code review'da bulunan sorunlar

Değişiklik öncesi mevcut kod incelendi; göreve konu olan şu davranışlar doğrulandı:

1. **Hakem kararı AI sonucuyla otomatik başlıyordu.** `evaluation-app.tsx ·
   draftDecisions` her kriteri AI kararıyla "accepted" olarak başlatıyor, hakem
   yalnızca isterse değiştiriyordu (görevin kaldırılmasını istediği davranış).
2. **Genel ONAY/RED kararı kriter kararlarından ÖNCE veriliyordu**; kriter
   düzenleme ekranı karardan sonra açılıyordu.
3. **PDF dışı kurallar hakem ekranına gidiyordu:** `DEGERLENDIRILEMEDI` bulgusu
   üretilip "PDF üzerinden değerlendirilemeyen kurallar" bölümünde listeleniyor ve
   `summary.total` / `disiKanit` sayaçlarına giriyordu.
4. **Kriter Atölyesi'nde denetlenebilirlik seçimi ve rozeti kullanıcıya açıktı**
   ("PDF'den denetlenebilirlik" select'i, "Harici kanıt gerekli" rozeti,
   "Karşılanmazsa KRİTİK HATA" metinleri).
5. **Manuel hakem atama yüzeyi açıktı:** operasyon panelinde hakem seçim kutusu +
   "İlk atamayı yap / Yeniden ata" düğmeleri; API'de `assign_judge` eylemi ve yetkisi.
6. **Otomatik atama yalnızca `status='submitted'` başvuruları kapsıyordu**;
   yeniden gönderilmiş ama hakemsiz kalmış başvuru ve "sonradan hakem açıldı"
   durumu için otomatik yeniden deneme yoktu.
7. **"Kararı yeniden aç" yalnızca istemci tarafındaydı** (sunucu durumu
   değişmiyordu); AI analizi silme özelliği hiç yoktu.
8. **Benzerlik metni PDF'e bağlanmıyordu:** istemcinin gönderdiği serbest metin
   `submission_fingerprints`'e yazılıyordu; PDF hash doğrulaması, parça/embedding
   katmanı ve rapor düzeyi oran yoktu (yalnızca belge düzeyi MinHash yüzdesi).
9. **Katılımcı ekranında üç kart** vardı (Gelişim Önerileri dahil) ve öneriler AI
   taslağından üretilebiliyordu.
10. `demo-report-evaluator.ts` hiçbir yerden referans almayan ölü modül (bkz. 13).

## 2. Değiştirilen dosyalar

**Yeni dosyalar**

| Dosya | İçerik |
|---|---|
| `app/lib/judge-review.ts` | Kriter bazlı hakem kararının ortak kuralları: boş karar üretimi, geri yükleme, doğrulama, sayaçlar, geri bildirim ve deterministik RET şablonu |
| `app/lib/similarity-text.ts` | Normalizasyon (üstbilgi/sayfa no/ad temizliği), şablon parça tespiti, 300–500 kelimelik çakışmalı parçalama, eşikler ve kapsama tabanlı rapor oranı |
| `app/lib/similarity-embedding.ts` | `gemini-embedding-001` istemcisi: 16'lık partiler, 429'da tek sınırlı geri çekilme, bozuk vektör reddi |
| `migrations/0009_similarity_v2.sql` | `similarity_chunks` + `similarity_results` (eklemeli) |
| `tools/judge-review.test.ts` · `tools/similarity.test.ts` | Yeni birim testleri (aşağıda) |
| `tools/seed_demo_users.mjs` | Basit test kullanıcıları (yalnızca yerel; üretim reddi) |

**Değiştirilen dosyalar** (git durumundan): `app/lib/types.ts`,
`app/lib/workflow-db.ts`, `app/lib/workflow-client.ts`, `app/lib/authorization.ts`,
`app/lib/admin-roles.ts`, `app/lib/admin-types.ts`,
`app/api/evaluate-report/route.ts`, `app/api/applications/[id]/route.ts`,
`app/api/applications/[id]/similarity/route.ts`, `app/api/operations/route.ts`,
`app/api/admin/accounts/route.ts`, `app/api/admin/accounts/[id]/route.ts`,
`app/api/participant/register/route.ts`, `app/components/evaluation-app.tsx`,
`app/components/criteria-app.tsx`, `app/components/participant-portal.tsx`,
`app/components/operations-panel.tsx`, `app/components/management-app.tsx`,
`app/evaluation.css`, `docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md`,
`tools/e2e_scenario.mjs`, `tools/regression-tests.mjs`,
`tools/authorization.test.ts`, `tools/migrations.test.ts`, `tools/dev_reset.mjs`.

## 3. Oluşturulan migration'lar

Tek yeni göç: **`migrations/0009_similarity_v2.sql`** — eklemeli ve geriye uyumlu:

- `similarity_chunks`: parça kimliği, sayfa aralığı, kelime sayısı, metin özeti
  (SHA-256), MinHash izi, embedding vektörü + modeli + boyutu, boru hattı sürümü.
  `UNIQUE (submission_version_id, pipeline_version, chunk_index)` — embedding
  önbelleği tekilliği. Ham metin D1'e YAZILMAZ (özel R2 nesnesi:
  `similarity/<başvuru>/<sürüm>.json`).
- `similarity_results`: başvuru + PDF sürümü + SHA-256 + yarışma anahtarı +
  MinHash/embedding/boru hattı sürümleri + yaklaşık oran + en yakın başvuru +
  durum + analiz zamanı.

Hakem kriter kararları için ŞEMA DEĞİŞMEDİ: kararlar `review_json` içindeki
`criterionDecisions` alanında saklanır (eski kayıtlar alansız okunur, çökme yok).
AI silme durumu denetim izi + süreç olaylarıyla tutulur (`ai_analysis_deleted`).
Eski göç dosyalarına dokunulmadı; uygulama şeması aynı tabloları çalışma anında da kurar.

## 4. Kriter ekranında kaldırılan alanlar

- "PDF'den denetlenebilirlik" seçim kutusu (hem manuel ekleme formunda hem kriter
  ayrıntısında) ve `verifiabilityBadge` rozeti ("Harici kanıt gerekli" /
  "PDF'den denetlenebilir" / "Hakem kontrolü gerekli").
- "Karşılanmaması KRİTİK HATA doğurur" / "Karşılanmaması REVİZYON önerisi doğurur" /
  "Karşılanmazsa …" metinlerinin tamamı.
- Güven seviyesi / soluk-pasif kriter görünümü zaten önceki refaktörde kaldırılmıştı;
  regresyon testi artık bu ifadelerin arayüzde bulunmadığını da doğruluyor.
- "Diğer kriterler" başlığı **"Zorunlu olmayan kriterler"** oldu; ekleme düğmesi
  "Zorunlu Olmayan Kriter Ekle". Satırda yalnızca: kriter adı · analiz aşaması ·
  kaynak sayfa bağlantısı · zorunlu/zorunlu olmayan bilgisi.
- `verifiability` alanı SİSTEMDE korunur: manuel kriterde ve manuel metin
  düzenlemesinde `resolveVerifiability` (video/portal/saha işaret taraması) ile
  otomatik belirlenir; AI kriterlerinde modelin değeri korunur. Tek amacı PDF
  dışı kuralların hakem rapor analizine gönderilmemesidir.
- Kriter silme korunup doğrulandı; yayımda içerik değiştiyse yeni değişmez kriter
  sürümü açılır, eski analiz "eskimiş" olur, sunucu eski analizle nihai kararı
  reddeder ve hakem "Kriterler güncellendi, yeniden analiz yapın" uyarısı görür
  (e2e bölüm 9). Kaynak sayfa/alıntı kilidi UI + API'de korunuyor (e2e bölüm 5).

## 5. Yeni hakem kriter karar akışı

1. "**Yapay Zekâ Analizi Yap**" → kriter analizi + benzerlik paralel başlar.
2. Her kriter kartında **AI ön değerlendirmesi**: `Uygun` / `Olumsuz`
   (BASARILI → Uygun; REVİZYON/KRİTİK_HATA → Olumsuz). Değiştirilemez; gerekçe ve
   alıntı ile "Kaynak Satıra Git" bağlantısı korunur.
3. **Hakem kararı** ayrı alandır ve **AI bulgusunun kabulünü** ifade eder
   (27 Ağustos güncellemesi — bkz. `SIMULASYON_RAPORU_CELIKKUBBE.md`):
   `Karar bekliyor` → `AI bulgusu onaylandı` / `AI bulgusu reddedildi`.
   Başlangıçta ASLA otomatik doldurulmaz (eski `draftDecisions` kabulü kaldırıldı).
4. **Onayla**: AI'nin sonucu kesinleşir — AI `Olumsuz` dediyse kesin sonuç da
   **Olumsuz** olur; ek açıklama istemez.
   **Ret**: bulgu kesin sonuç olarak kullanılamaz; hakem **kendi sonucunu
   (UYGUN veya OLUMSUZ)** + gerekçe + dayanak girmek zorundadır.
   `PDF_KONUMU`: katılımcı PDF sayfası + kaynak bölüm/madde + alıntı zorunlu.
   `RAPORDA_BULUNAMADI`: aranan başlık/içerik + gerekçe zorunlu; sahte sayfa
   İSTENMEZ; kriterin şartnamedeki sabit kaynak sayfası bilgi olarak gösterilir.
   Kesin sonuç: `approved → aiVerdict`, `rejected → judgeResult`
   (`effectiveVerdictOf`, `app/lib/judge-review.ts`).
5. Sayaçlar anlık ve **kesinleşmiş sonuçlardan**: uygun (kesinleşmiş) · olumsuz
   (kesinleşmiş) · karar bekleyen · toplam PDF kriteri. AI bulgu onay/ret sayısı
   ayrı bir bilgi satırıdır; ikisi karışmaz.
6. **Bütün kriterler sonuçlanmadan genel karar bölümü açılmaz** (düğmeler kapalı;
   sunucu da 409 ile reddeder). Sistem "öneriliyor" dahi demez; zorunlu kriter
   reddedildi diye rapor otomatik reddedilmez.
7. Nihai karar yalnızca **ONAY / RET** (butonlar: Onayla / Reddet; durum adı RET —
   arayüzde "RED" durum adı kullanılmıyor). RET açıklaması, reddedilen kriter ve
   gerekçelerinden **deterministik şablonla** üretilir; ikinci AI çağrısı yok.

**Veri modeli** (`JudgeCriterionDecision`, `review_json.criterionDecisions`):
`criterionId · criterionName · aiVerdict(UYGUN/OLUMSUZ) · judgeVerdict
(pending/approved/rejected) · judgeResult(ret durumunda hakemin kendi
UYGUN/OLUMSUZ sonucu) · rejectionReason · evidenceMode(PDF_KONUMU/
RAPORDA_BULUNAMADI) · evidencePage · evidenceSection · evidenceQuote ·
missingContent · decidedBy · decidedAt`. **Sunucu doğrular:** kararlar başvurunun KAYITLI son AI analizindeki
görünür kriterlerle birebir eşleşmeli (başka başvurunun/eski sürümün kararı
reddedilir — kriter tazeliği zaten ayrıca doğrulanıyor), ret alanları tam olmalı,
karar damgası (`decidedBy/decidedAt`) sunucuda atılır, tamamlanan karar
`judge_criterion_decisions` denetim kaydına ve AI'dan sapmalar
`judge_score_adjusted` olayına yazılır.

## 6. PDF dışı kriterlerin nasıl filtrelendiği

- `evaluate-report`: bulgular yalnızca `active && !verifiedOutsidePdf(verifiability)`
  kriterlerden üretilir; `normalizeFinding` artık `DEGERLENDIRILEMEDI` üretmez.
  İstem sürümü `report-v6-pdf-only-judge-decisions` (eski önbellek doğal düşer).
- Bu kriterler modele gönderilmez, bulgu/sayaç üretmez, hakem ekranında görünmez,
  "PDF dışı kanıt" bölümü kaldırıldı, katılımcı geri bildirimine taşınmaz, PDF'de
  bulunmadığı için hata sayılmaz. Yarışma Yöneticisinin listesinde zorunlu /
  zorunlu olmayan olarak durmaya devam eder.
- Geriye uyum: eski kayıtlardaki `DEGERLENDIRILEMEDI` bulguları okunabilir ama
  `visibleFindingsOf` görünür listeden süzer; `save_evaluation` yolu da
  (`sanitizeEvaluation`) böyle bir bulgu gönderilse bile kayıttan süzüp sayaçları
  düzeltir (e2e bölüm 8'de canlı doğrulandı).

## 7. AI analizi silme davranışı

- Hakem ekranında "**AI analizini sil**" + açık onay penceresi (neyin
  silinmediğini madde madde sayar: başvuru, PDF, takım bilgileri, hakem ataması,
  yarışma).
- Sunucu (`delete_analysis` → `deleteApplicationEvaluation`):
  - yalnızca ATANMIŞ hakem silebilir; başkası 404/403 alır,
  - nihai karar kesinleşmişse 409: önce sunucu taraflı **`reopen_review`**
    ("Kararı yeniden aç" artık gerçek bir sunucu işlemi; sonuç yarışmacıya
    kapanır, durum `judge_in_review` olur),
  - `evaluation_json`, `review_json` (tamamlanmamış kriter kararları) ve bütünlük
    bağları temizlenir; başvuru `assigned` ("AI analizi bekliyor") durumuna döner,
  - bu PDF sürümünün **benzerlik sonucu silinir** (`similarity_results`);
    embedding önbelleği (`similarity_chunks`) korunur — yeniden analizde API
    tekrar çağrılmaz ama eski benzerlik sonucu yeni sonuç olarak KULLANILMAZ,
  - "Yapay Zekâ Analizi Yap" yeniden kullanılabilir (e2e'de doğrulandı),
  - denetim izi yalnızca kim/tarih/başvuru/işlem türü taşır; silinen AI metni
    denetim kaydına yazılmaz. Değerlendirme Yöneticisi olayı süreç geçmişinde
    (`ai_analysis_deleted`) ve denetim tablosunda görür.

## 8. Otomatik hakem atamasının son durumu

- Arayüzden hakem seçme / ilk atama / yeniden atama / seçim kutusu KALDIRILDI
  (operasyon paneli hakem sütunu salt okunur). API'de `assign_judge` eylemi hangi
  rol çağırırsa çağırsın 403 döner; `assign_judge` yetkisi matristen silindi ve
  `assignApplication` işlevi kaldırıldı.
- Atama kuralları (korunup genişletildi): yalnızca aktif 02 hesapları; aynı
  yarışmada daha önce dosya almış hakem tercih edilir; açık dosya sayısı en az
  olan seçilir; eşitlikte deterministik sıra (hesap yaşı + kimlik); koşullu
  `UPDATE` ile çift atama engellenir (`assigned_judge_id IS NULL` WHERE'de);
  atama denetim izine ve süreç olayına yazılır; atama başarısız olsa da başvuru
  düşmez.
- Yeni: `assignPendingApplications()` — bekleyen (hakemsiz, arşivsiz,
  `submitted/resubmitted`) başvuruları otomatik dağıtır. Tetikleyiciler: yeni
  aktif Hakem hesabı açılması, bir hesabın 02 rolüne alınması/geri getirilmesi ve
  operasyon panosunun her yüklenişi. Hiçbir tetikleyici hakem SEÇTİRMEZ.
- Değerlendirme Yöneticisi izlemeye devam eder: hakem açık/tamamlanan dosya
  sayıları, atanamayan başvurular, analiz bekleyen/tamamlanan, aktif/pasif
  yarışmalar, katılımcı sayıları, onay/ret sayıları, audit ve silme kayıtları.

## 9. Benzerlik algoritmasının gerçek mimarisi

Mevcut MinHash motoru, `submission_fingerprints`, beş kelimelik shingle yapısı ve
ham metni D1'e yazmama yaklaşımı KORUNDU; üzerine şu zincir eklendi:

1. **Çalışma zamanı:** "Yapay Zekâ Analizi Yap" → PDF metni İSTEMCİDE BİR KEZ
   çıkarılır (`extractPdfText`); kriter analizi ve benzerlik `Promise.allSettled`
   ile paralel yürür. Benzerlik düşerse kriter analizi etkilenmez (uyarı satırı
   eklenir). 429'da benzerlik, kriter analizinin hemen arkasından 2,5 sn
   gecikmeyle EN FAZLA BİR KEZ yeniden denenir. İlerleme mesajları: "Rapor
   kriterlere göre analiz ediliyor…", "Aynı yarışmadaki başvurularla benzerlik
   karşılaştırılıyor…", "AI analizi ve benzerlik sonucu kaydediliyor…".
2. **Bütünlük (sunucu):** istek yalnızca `applicationId` + sayfa metni +
   `pdfHash` taşır. Sunucu zinciri kendisi kurar: `applicationId →
   competitionKey (ad+yıl+aşama) → currentSubmissionVersion → currentPdfHash`.
   İstemcinin bildirdiği hash, R2'deki geçerli PDF'in SHA-256'sıyla eşleşmezse
   istek 409 ile reddedilir ve hiçbir iz yazılmaz (e2e'de doğrulandı). Kapsam
   istemcinin yarışma adına göre ASLA belirlenmez.
3. **Temizlik (madde 9.4):** yarışma adı, takım/katılımcı adları, tek başına
   sayfa numaraları ve sayfaların ≥%60'ında tekrarlanan üstbilgi/altbilgi
   satırları silinir. Havuzdaki başvuruların ≥%50'sinde birebir bulunan parça
   resmî şablon sayılır ve karşılaştırma dışıdır.
4. **Parçalama:** 300–500 kelime, ~50 kelime çakışma, <40 kelime atlanır; sayfa
   aralığı korunur. Parça başına SHA-256 + MinHash; metinler ÖZEL R2 nesnesinde.
5. **Embedding:** `gemini-embedding-001` · `SEMANTIC_SIMILARITY` · 768 boyut ·
   mevcut `GEMINI_API_KEY`. 16'lık partiler; 429'da tek sınırlı geri çekilme;
   boş/bozuk vektör kaydedilmez; model adı + boyut kayıtla saklanır ve farklı
   modellerin vektörleri karşılaştırılmaz. **Önbellek anahtarı:** başvuru + PDF
   sürüm kimliği + PDF SHA-256 + model + boyut + boru hattı (normalizasyon/
   parçalama) sürümü — aynı PDF için embedding bir kez üretilir; yeni PDF
   sürümünde eski satırlar silinir.
6. **Hibrit karşılaştırma:** doğrudan katman MinHash (≥0.55 yüksek · 0.30–0.55
   incelenmeli); anlamsal katman cosine (≥0.90 yüksek · 0.82–0.90 incelenmeli).
   Bunlar kalibre edilebilir başlangıç eşikleridir, otomatik ihlal sınırı
   değildir. **Rapor oranı** ham cosine DEĞİLDİR: her parçanın en yakın parça
   eşleşmesi bulunur, eşik altı eşleşme sayılmaz, eşleşen parça kelimeleri
   eşleşme kuvvetiyle ağırlıklanır ve karşılaştırılabilir (şablon dışı) toplam
   kelimeye bölünür → 0–100 yaklaşık oran. Tek benzer paragraf raporu %90
   gösteremez (birim testte beşte biri eşleşen rapor ≈ %20 doğrulandı).
7. **Gösterim:** kriter analizlerinin EN ALTINDA tek notluk "Benzerlik kontrolü"
   (boş havuz / normal / incelenmeli / yüksek metinleri görevdeki örneklerle
   uyumlu; embedding düşmüşse "Anlamsal karşılaştırma tamamlanamadı. Yalnızca
   doğrudan metin benzerliği kontrol edildi."). İnceleme/yüksek seviyede
   açılabilir ayrıntı: en fazla ÜÇ eşleşme (takım etiketi, tür, iki taraftan
   sayfa+alıntı, kendi PDF'ini sayfada açma; diğer PDF bağlantısı yalnızca o
   başvuru da bu hakeme atanmışsa). Değerlendirme Yöneticisine yalnızca
   tamamlandı/inceleme-işareti bilgisi gider (redaksiyon `redactEvaluation`);
   katılımcıya hiçbir benzerlik ayrıntısı gitmez. Sonuç sayaçlara katılmaz ve
   ONAY/RET'i otomatik değiştirmez.
8. **Maliyet kapısı:** `skipEmbedding` bayrağı YALNIZCA test/geliştirme içindir
   (e2e ücretli çağrı yapmaz); sonuç `minhash-only` işaretlenir ve hakem bunu görür.

## 10. Çalıştırılan testlerin gerçek sonuçları (bu makinede, bugün)

| Kontrol | Komut | Sonuç |
|---|---|---|
| Tip kontrolü | `npx tsc --noEmit` | ✅ temiz |
| Lint | `npm run lint` | ✅ temiz |
| Depo güvenliği / secret taraması | `npm run check:repo-safety` | ✅ PASS |
| Birim testleri (RBAC + göç + doğrulanabilirlik + **hakem kararı** + **benzerlik**) | `npm run test:unit` | ✅ **106/106** |
| Regresyon testleri (yeni "Judge-decision flow" bloğu dahil) | `npm run test:regressions` | ✅ PASS (7 blok) |
| Üretim derlemesi | `npm run build` | ✅ tamam |
| Uçtan uca senaryo (canlı sunucu; 1 Admin · 3 Yön. · 3 Hakem · 1 Değ. Yön. · 9 Katılımcı · 3 yarışma · 9 başvuru) | `E2E_ADMIN_PASSWORD=… node tools/e2e_scenario.mjs` | ✅ **137/137** — ücretli AI/embedding çağrısı YAPILMADI |
| Test temizliği idempotency | `node tools/dev_reset.mjs --apply` (2 koşu) | ✅ ikinci koşu 0 kayıt (idempotent) |
| Basit test kullanıcıları | `node tools/seed_demo_users.mjs --apply` | ✅ 16 hesap + mevcut admin korundu |

e2e yeni kapsam: basit kullanıcı adlarıyla giriş (projeyoneticisiN/hakemN/
degerlendirmeyoneticisi1/katilimciN) · video kriterinin bulgu/sayaç/ekran
dışında kalması ve sunucu süzgeci · benzerlik (boş havuz notu, yanlış PDF hash
409, doğrudan kopyanın MinHash ile "yüksek" yakalanması, ≤3 eşleşme + sayfa/
alıntı, farklı yarışmanın karşılaştırılmaması, minhash-only işareti, "otomatik
karar değildir" notu) · kriter kararları (bekleyen kriterle genel karar 409,
kararsız eski biçim 409, gerekçesiz ret 409, sayfasız PDF_KONUMU 409,
RAPORDA_BULUNAMADI sahte sayfasız kabul, kendi-sonuçsuz (`judgeResult`) ret 409,
AI-olumsuz bulgunun onayı → kesin sonuç olumsuz, AI-olumsuz bulgunun
`judgeResult: UYGUN` ile reddi → kesin sonuç uygun, karar damgası) · manuel
`assign_judge` 403 · analiz silme/karar yeniden açma zinciri · silme olayının
04 panosunda görünmesi. **27 Ağustos:** e2e, bulgu-doğrulama anlamıyla
güncellenip temiz veritabanında yeniden koşuldu: **139/139**.

## 10b. Çekişmeli çok-ajanlı inceleme ve yapılan düzeltmeler

Uygulama bittikten sonra değişikliklerin tamamı 5 boyutlu (sunucu mantığı ·
benzerlik hattı · React bileşenleri · gizlilik/RBAC · geriye uyum) paralel bir
kod incelemesinden geçirildi; her bulgu bağımsız bir "çürütücü" ajan tarafından
kodda doğrulandı. Sonuç: **25 bulgu → 23 doğrulandı, 2 çürütüldü.** Doğrulanan
bulguların tamamı ya DÜZELTİLDİ ya da bilinçli sınırlama olarak 13. bölümde
bırakıldı. Düzeltilenler:

| Bulgu | Düzeltme |
|---|---|
| `analysis_failed`/`save_evaluation` kesinleşmiş veya dondurulmuş kararı bozabiliyordu (yüksek) | `saveApplicationEvaluation` artık completed/decisions_locked durumunda açık 409 verir; UPDATE `status <> 'completed'` koşulunu WHERE'de tutar ve yarışta geçmiş satırını geri alır |
| Nihai karar yazımı koşulsuz `WHERE id = ?` idi (TOCTOU): araya giren belge talebi/yeniden gönderim ezilebiliyordu | Yazma `status IN ('awaiting_judge','judge_in_review','completed')` koşuluyla; değişiklik yoksa açık 409 ("durum bu sırada değişti") |
| `decidedAt` istemciden sahtelenebiliyor, `aiVerdict` istemciden kabul ediliyordu (sapma denetimi bastırılabilirdi) | Damga tamamen sunucuda: `decidedAt = sunucu saati`, `decidedBy = oturum`, `aiVerdict` KAYITLI bulgudan yeniden türetilir |
| Ret gerekçesindeki katılımcı PDF alıntıları `outcome_note` ile Rol 01/04'e ve giden kutusu kaydına sızıyordu (yüksek) | Operasyon görünümünde `outcomeNote` maskelenir; giden kutusuna yazılan e-posta gövdesinde gerekçe maskelenir (katılımcıya giden gerçek e-posta değişmez) |
| 04'e 3. aşama benzerlik YÜZDESİ gidiyordu | `redactEvaluation` yüzdeyi de siler; 04 yalnızca durum/işaret görür |
| Katılımcıya tamamlanan incelemede `criterionDecisions` (AI'nin ilk sonucu dâhil) dönüyordu | Katılımcı görünümünde review; kararlar, eski karar listesi ve iç not soyularak servis edilir |
| `similarityReport` tamamen istemci verisiydi (işaret silinebilir/sahtelenebilirdi) | Kaydedilen analizdeki benzerlik raporu SUNUCUNUN `similarity_results` kaydından yazılır (`findSimilarityResult`); silinmiş sonuç yeniden kullanılamaz |
| `skipEmbedding` geçerli embedding önbelleğini silip havuzu köreltiyordu (yüksek) | Geçerli önbellek ASLA yeniden yazılmaz; kayıt yalnızca metin değiştiğinde veya YENİ embedding üretildiğinde tazelenir; önbellekteki embedding ücretsiz olduğu için skip bayrağında da kullanılır |
| Dağıtım ÖNCESİ analiz edilmiş eşler (yalnız parmak izi) havuzdan düşüyordu; doğrudan kopya "karşılaştırılacak başvuru yok" olabiliyordu (yüksek) | Havuz iki katmanlı: parça eşleri + parmak-izi-yalnız eşler; sayaç, seviye ve en yakın etiket ikisini birlikte değerlendirir |
| `current_version_id` NULL eski başvurularda "v1" yedeği parça anahtarını başvurular ARASINDA çakıştırıyordu (500) | Yedek başvuru kimliğiyle nitelenir (`eski-<id>`) |
| Belge düzeyi MinHash şablon dışlamasını atlıyordu: tamamı şablon raporlar %0 oranla "yüksek" işaretlenebiliyordu | Belge düzeyi yükseltme yalnızca ŞABLON DIŞI en az bir parça eşleşmesi varken uygulanır |
| `assignPendingApplications` pasif/arşivli yarışmaların başvurularını dağıtıyordu | Dağıtım `competitions` ile birleştirilip `is_active=1 AND deleted_at IS NULL` süzgecinden geçer |
| Takılan `analyzing` başvurusu kurtarılamıyordu | `delete_analysis` artık `analyzing` durumunu da temizleyip başvuruyu yeniden analiz bekler duruma alır |
| `deleteApplicationEvaluation` yarışta benzerlik sonucunu silip "deleted" diyebiliyordu | Durum koşullu UPDATE önce çalışır; değişiklik yoksa hiçbir silme/denetim kaydı yapılmaz |
| UI: Ret formundaki "Vazgeç" verilmiş kararı sıfırlıyordu (yüksek) | Vazgeç yalnızca formu kapatır; karar sıfırlama ayrı ve açık bir düğmedir |
| UI: PDF'den değerlendirilebilir kriter yoksa nihai karar sonsuza dek kilitliydi (yüksek) | Kapı `pending === 0` oldu; sıfır kriterli analizde karar doğrudan verilebilir (sunucu da aynı kuralda) |
| UI: Onayla↔Reddet geçişinde bayat otomatik açıklama korunuyordu (RET kararı ONAY metniyle gidebilirdi) | Dokunulmamış şablon, karar değişince yeni kararın şablonuyla değiştirilir; elle yazılmış metin korunur |
| UI: analiz bitince zorla gezinme başka başvurudaki kaydedilmemiş kararları silebiliyordu | Gezinme yalnızca hakem hâlâ aynı başvurudayken (veya listedeyken) yapılır |
| UI: eski akışla tamamlanmış kayıtlar "Karar bekliyor" görünüyordu | Kilitli eski kayıtta açıklayıcı not gösterilir; yeniden kesinleştirme yeni akışın kriter kararlarını gerektirir (bilinçli) |

Bu düzeltmelerin ardından bütün doğrulamalar YENİDEN koşuldu: tsc/lint temiz,
birim 106/106, regresyon 7 blok (yeni güvence assert'leriyle genişletildi),
üretim derlemesi tamam, canlı e2e **137/137** (ikinci tam koşu). Çürütülen 2
bulgu: benzerlik takım etiketi (HEAD'deki kanonik davranış) ve operations
`teamName` geriye-uyum senaryosu (ön koşulu bu şemada oluşamaz).

## 11. Test sonrasında temizlenen veriler

e2e sonrası `node tools/dev_reset.mjs --apply` çalıştırıldı ve şunlar silindi:
test başvuruları + sürümleri + takım üyeleri + atamaları, test AI analizleri
(`evaluation_results`), test hakem kararları (review_json satırlarıyla birlikte),
**benzerlik izleri** (`similarity_results`, `similarity_chunks`,
`submission_fingerprints`), test yarışmaları/profilleri/kriter sürümleri, süreç
olayları, test bildirimleri (silinen hesapların `admin_mail_outbox` kayıtları),
test hesapları ve oturumları, ve YALNIZCA yarışma/başvuru akışına ait denetim
kayıtları (hesap yönetimi denetimi korunur). R2 test nesnelerinin anahtarları
(başvuru PDF'leri + `similarity/...` parça dosyaları) betik tarafından raporlanır;
yerel R2 dizini `.wrangler/state/v3/r2` elle silinebilir (betik dosya silmez —
bilinçli). İkinci koşu 0 kayıt sildi (idempotent). Dokunulmayanlar: `corpus/`,
kaynak kod, göç dosyaları, Admin hesabı, kalıcı analiz önbelleği. Temizlikten
sonra sade test hesapları `seed_demo_users.mjs` ile yeniden açıldı (admin/1234
DEĞİL — mevcut Admin hesabınız ve parolası aynen korunmuştur; seed hesaplarının
parolası 1234'tür).

## 12. Canlı ortamda yapılması gereken adımlar

1. `migrations/0009_similarity_v2.sql` üretim D1'ine uygulanmalı
   (`npx wrangler d1 execute <db> --file=...`). Uygulama şeması aynı tabloları
   çalışma anında da kurar; göç kaydı yine de önerilir.
2. `GEMINI_API_KEY` üretimde tanımlı olmalı (embedding aynı anahtarı kullanır).
   Anahtarın daha önce sohbet ortamında paylaşılan kopyası hâlâ İPTAL EDİLMELİ
   (PROJE_DURUMU F1 — bu görevden bağımsız, açık risk).
3. Gerçek ücretli doğrulama (açık izinle): canlı kriter analizi + canlı
   `gemini-embedding-001` çağrısı; benzerlik eşiklerinin (0.55/0.30 ·
   0.90/0.82 · %55/%30) gerçek raporlarla kalibrasyonu (bkz. 13).
4. Üretimde bekleyen atama tetikleyicisi operasyon panosunun açılması ve hakem
   hesabı işlemleridir; tamamen boş kalan sistemde ilk hakem açılana kadar
   başvurular "atanamadı" olarak izlenir (tasarım gereği).
5. `tools/seed_demo_users.mjs` ÜRETİMDE ÇALIŞTIRILMAZ (zaten reddeder).

## 13. Kalan riskler ve eksikler

1. **Gerçek Gemini embedding doğruluğu HENÜZ ÖLÇÜLMEDİ.** Ücretli çağrı için
   açık izin istenmedi/alınmadı; embedding API sözleşmesi (model, görev türü,
   boyut, parti, 429 davranışı, bozuk vektör reddi) mock fetch ile doğrulandı.
   "Farklı kelimelerle yazılmış benzer bölümün embedding ile yakalanması" ancak
   canlı çağrıyla ölçülebilir; eşikler kalibre edilebilir başlangıç değerleridir.
2. **Canlı kriter analizi (report-v6) ölçülmedi** — istem sürümü değişti; PDF
   dışı kriterlerin listeden çıkarılması modele giden içerik setini değiştirmedi
   (zaten gönderilmiyordu) ama uçtan uca canlı koşu yapılmadı (PROJE_DURUMU A1
   ile aynı sınıf).
3. **Benzerlik metni istemcide çıkarılıyor.** PDF hash bağı, metnin geçerli
   PDF'in indirilmesiyle üretildiğini garantiler; ancak sunucu, metnin o PDF'in
   GERÇEK metni olduğunu birebir doğrulayamaz (Workers ortamında PDF metin
   çıkarımı yok). Görev 9.12'nin istediği güçlendirme (hash bağlama + sürüm
   reddi + yalnızca destek bilgisi) uygulandı; tam sunucu tarafı çıkarım ileriye
   dönük iş.
4. **`skipEmbedding` bayrağı** istemciden gelebilir; kötüye kullanım YALNIZCA
   yeni embedding çağrısını atlatır (geçerli önbellek korunur ve kullanılır),
   sonuç "minhash-only" olarak açıkça işaretlenir ve hiçbir sonuç olduğundan
   güçlü görünmez (bilinçli, düşük riskli ödünleşim).
5. **`demo-report-evaluator.ts` ölü modül** (hiçbir referansı yok) ve eski
   `DEGERLENDIRILEMEDI` üretimini içeriyor; çalışan davranışı etkilemediği için
   "geniş refactor yapma" kuralı gereği SİLİNMEDİ. Ayrı bir temizlik işi.
6. **Eski tamamlanmış kararlar** (criterionDecisions'sız) salt okunur açılır ve
   ekranda açıklayıcı bir notla işaretlenir; yeniden açılıp KAPATILMAK
   istenirse yeni kural gereği kriter kararları girilmek zorundadır (bilinçli:
   eski karar yeniden kesinleştirilecekse yeni akışın kalitesinden geçmelidir).
7. Ekranların dar-ekran (360/768/1024) elle kontrolü yapılmadı (PROJE_DURUMU D4
   ile aynı sınıf); yeni kriter kartı ve benzerlik notu için medya kuralları
   eklendi ama gerçek cihazda doğrulanmadı.
8. **D1'de gerçek transaction yok:** yarış korumaları koşullu UPDATE +
   değişiklik doğrulamasıyla sağlandı (10b'deki düzeltmeler); çok adımlı
   akışlarda (örn. karar + e-posta) tam atomiklik altyapı gereği mümkün değil,
   davranış "karar kaydedildi, bildirim ayrı raporlanır" olarak korunuyor.
