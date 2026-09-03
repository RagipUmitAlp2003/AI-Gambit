# Entegrasyon Raporu — 3 Eylül 2026

**Entegrasyon dalı:** `entegrasyon/umit-umut-2026-09-03` · **Commit/push/merge YAPILMADI**
(birleştirme çözülmüş hâlde bekliyor: `MERGE_HEAD` = `b7cc296`, mesaj `.git/MERGE_MSG`'de hazır).

İki iş tek dalda birleştirildi:

1. **Güvenli birleştirme** — benzerlik motoru hattı ile PDF.js/hakem/katılımcı hattı.
2. **Teknik kriter aşamasının yeniden açılması** — yeni şartname çıkarımı üç değil **dört** aşama üretir;
   `criteria_evidence` yalnızca katılımcı PDF raporundan metinsel veya sayısal olarak
   denetlenebilen teknik tasarım kurallarını taşır. Yarışma anı, saha, parkur, ceza/puan,
   video, portal, takım ve iletişim kuralları hiçbir aşamada kriter olmaz.

---

## 1. Dallar

| Rol | Dal | İşleme | İçerik |
|---|---|---|---|
| Görevdeki "main" (benzerlik motoru) | `umit_finalsonrasi_main1` | `466e1f3` "Görev 3" | similarity-config/corroboration/llm/text, source-lock, OCR yedeği, kimlik doğrulama sertleştirme, migration 0010–0014 |
| Diğer geliştirme dalı | `umutun_buglarını_düzeltme_final_sonrasi` | `b7cc296` | PDF.js Workers çalışma zamanı, kanıt görüntüleyici, hakem akışı v2, katılımcı yükleme/revizyon bütünlüğü, v35 üç aşamalı çıkarım |
| Ortak ata | — | `eead40e` "prompt 1 sonuç" | yapısal PDF ayrıştırma + sözlük tabanlı aday seçimi |
| Gerçek `main` | `main` | `01b67f3` | her iki dalın gerisinde; dokunulmadı |

Uzak ve yerel dallar birebir aynıydı (`git fetch --prune` sonrası fark yok).

## 2. Entegrasyon dalı

`umit_finalsonrasi_main1` üzerinden açıldı; `git merge --no-ff --no-commit umutun_buglarını_düzeltme_final_sonrasi`
ile diğer dal alındı. Hiçbir taraf diğerinin üzerine yazılmadı; çakışmalar dosya değil davranış bazında çözüldü.

## 3. İki tarafta da değişen dosyalar (21)

`app/api/admin/accounts/[id]/route.ts` · `app/api/analyze/route.ts` · `app/api/applications/[id]/route.ts` ·
`app/api/applications/[id]/versions/route.ts` · `app/api/applications/route.ts` · `app/api/evaluate-report/route.ts` ·
`app/components/evaluation-app.tsx` · `app/components/participant-portal.tsx` · `app/evaluation.css` ·
`app/lib/admin-roles.ts` · `app/lib/admin-types.ts` · `app/lib/criteria-candidates.ts` · `app/lib/criteria-extraction.ts` ·
`app/lib/pdf-structure.ts` · `app/lib/report-prechecks.ts` · `app/lib/types.ts` · `app/lib/workflow-client.ts` ·
`app/lib/workflow-db.ts` · `tools/authorization.test.ts` · `tools/criteria-pipeline.test.ts` · `migrations/0010_*.sql` (ad çakışması)

## 4. Çakışmalar ve seçilen davranışlar

| Dosya | Çözüm |
|---|---|
| `app/lib/criteria-extraction.ts` | cur'un v35 akışı (aday kimliği şeması, alıntı penceresi, kapsam kapıları, `outsidePdfScope`) + umit'in sayfa düzeltmesi (`correctedPages`), `MAX_CRITERIA` üstünde `continue` + `droppedCriteria`, `resolveControlType` |
| `app/lib/pdf-structure.ts` | umit'in madde numarası makullüğü + OCR blokları + cur'un `loadPdfJs()` (DOMMatrix/Path2D) + tampon kopyası + kaydırılmış satır birleştirme; `PDF_STRUCTURE_VERSION` → `pdf-structure-v3-clauses-wrapped-lines` |
| `app/lib/workflow-db.ts` | iki tarafın sütun listeleri ve yardımcıları birleştirildi: benzerlik v3 + `pdf_hash`/`byte_length` + `reassignApplicationsFromJudge` + başarısız yenilemede eski analizi koruma + `verifyJudgeQuotes` |
| `app/api/analyze/route.ts` | OCR yedeği + seçilmeyen blok özeti (umit) + 65 536 çıktı tavanı, kesilme tespiti, cevapsız adayda kaydetmeme (cur) |
| `app/api/evaluate-report/route.ts` | yapılandırılmış benzerlik alanı (umit) + kriter kapsam sayaçları, OCR_REQUIRED, sürüm kapsamlı önbellek anahtarı, `categoryFit` (cur); `PROMPT_VERSION` → `report-v7-controltype-defaults-scope-category-fit` |
| `app/components/evaluation-app.tsx` | benzerlik aşama kartlarından ÇIKARILDI (cur), kendi notunda umit'in zengin içeriği; kanıt görüntüleyici ve AI-bulgusu/hakem-değerlendirmesi ayrımı korundu |
| `app/api/applications/route.ts`, `…/versions/route.ts` | `storeReportPdf()` R2 doğrulaması + çift başvuru koruması (cur) ile havuz sonuçlarını eskitme ve gövde sınırları (umit) birlikte |
| `tools/authorization.test.ts` | iki tarafın testleri birlikte; eski "Kaynak Satıra Git" pini cur'un görüntüleyici davranışıyla değiştirildi |
| `migrations/0010_submission_integrity.sql` | `0015_submission_integrity.sql` olarak taşındı (umit tarafındaki `0014_auth_hardening` emsaliyle aynı yöntem; `schema_migrations` kaydı tarihsel adıyla) |
| `app/lib/pdfjs-worker.d.ts` | kaldırıldı; kök `pdfjs-worker.d.ts` (cur) aynı modülü daha kesin türle bildiriyor |

Her çözüm bağımsız bir doğrulayıcı ajan tarafından iki ebeveyne karşı denetlendi; bir test dosyasında düşen bir doğrulama yerinde tamamlandı.

## 5. Dört aşamalı çıkarım — gerçek belge sonuçları (canlı model ÇAĞRILMADI)

Teknik kriterler üç noktada engelleniyordu; her birine en küçük değişiklik yapıldı:

| Nokta | Engel | Değişiklik |
|---|---|---|
| Aday seçici | açık zorunluluk/yasak/sınır, teknik terim+sayı ve yapısal kural satırı seçimleri kaldırılmıştı | üç kural geri getirildi; `candidate-selector-v2-technical-restored` |
| İstem/şema | "YALNIZCA ÜÇ KAPSAM", `EXTRACTION_STAGE_IDS` üç değer | "DÖRT KAPSAM", `criteria_evidence` tanımı ve örnekleri; `v36-four-stages-pdf-verifiable-technical` |
| Sunucu kapısı | teknik aşama tanınmıyordu | `sourceSupportsExtractionStage` teknik dalı: yalnızca PDF'den doğrulanmış kaynak metin; bağlayıcı sinyal + fiziksel/haricî/idari kalıp yok; `sozluk-v6-four-stages-scope-gates` |

Deterministik seçim (LLM'siz), `public/samples/…Celikkubbe…pdf` ve `output/pdf/official/…Deniz_Araci…pdf`:

| Ölçüm | Çelikkubbe eski → yeni | İDA eski → yeni |
|---|---|---|
| aday sayısı | 32 → 96 | 43 → 145 |
| teknik terim veya sayı-birim taşıyan aday | 8 → 28 | 18 → 66 |

Önbellekteki **gerçek** Çelikkubbe model çıktısı (3 Eylül 09:58, dört aşamalı istem, 87 karar / 14 KRITER)
güncel yapıya eşlenip yeni sunucu kapılarından geçirildi: **3 dil/şablon + 6 teknik** kriter kaldı
(boyut 100 cm, kablo izolasyonu, yasak alan fonksiyonu, elektrik yalıtımı, acil durdurma butonu, patlayıcı yasağı);
puan tablosu ("Ebat Puanlama"), saha güç tedariki (220 VAC), görev tanımları ve "…" içeren alıntı dışlandı.
İDA eski kayıt: teknik geri çağırma 11/16 → 15/16 (video doğru biçimde dışarıda).

Sınır cümleleri (sunucu kapısı, model KRITER dese bile):

| Cümle | Sonuç |
|---|---|
| Motor gücü en fazla 5 kW olmalıdır. | criteria_evidence KRITER |
| Araç 50 kg'dan ağır olmamalıdır. | criteria_evidence KRITER |
| Yarışma ortamında yer alacak sistemin her boyutu 100 cm'den küçük olacaktır. | criteria_evidence KRITER |
| Motor seçimi ve güç hesabı raporda açıklanmalıdır. | headings_content KRITER |
| Yarışma başlamadan önce … 30 dakika süre verilecektir. | KAPSAM_DISI |
| Takım yarışma günü parkuru üç dakikada tamamlamalıdır. | KAPSAM_DISI |
| Tanıtım videosu … / KYS'ye yüklenmelidir / 60 puan altı elenir / takım en az 3 üye | KAPSAM_DISI |

## 6. Doğrulanmış buglar

| # | Durum | Yapılan |
|---|---|---|
| 9.1 Bootstrap kısmi hesap | Birleşik kodda **yeniden üretilemedi**: `recordAudit` kendi hatasını yutar, parola `insertAccount` sonrasında fırlatabilen hiçbir adım olmadan döner | `tools/bootstrap-atomicity.test.ts` (7 test; kaynak sözleşmesi + gerçek `recordAudit` gövdesinin fırlatan veri tabanıyla çalıştırılması) |
| 9.2 Benzerlik gövdesi | umit tarafında zaten düzeltilmiş: `readJson` → `readBodyWithLimit` parse'tan ÖNCE bayt sınırı, Content-Length'e güvenilmez, 413; karakter sınırı ikinci koruma | `tools/request-guard.test.ts` mevcut; birleşik kodda geçiyor |
| 9.3 Boş teknik aşama kartı | `StageStrip` teknik bulgusu olmayan değerlendirmede 4. kartı "Bu profilde teknik kriter tanımlı değil; aşama uygulanmıyor" olarak rozetsiz gösterir; eski teknik kriterli profiller aynı çizimi korur | `tools/four-stage-ui.test.ts` |
| 9.4 Eski profil/önbellek | Eski kriterler silinmez; sürüm etiketleri değişti (önbellek anahtarı istem+sözlük+seçici+yapı sürümünü taşır); sunucu yanıta `diagnostics.promptVersion` yazar; Kriter Atölyesi eski sürümlü sonuç veya taslakta "şartnameyi yeniden analiz edin" uyarısı gösterir | `tools/four-stage-ui.test.ts` |

## 7. Benzerlik motorunun korunduğuna dair doğrulama

`git diff HEAD -- app/lib/similarity-*.ts app/lib/source-lock.ts app/api/applications/[id]/similarity/route.ts
app/api/competitions/[id]/similarity-template/route.ts migrations/0010_similarity_v3.sql …0013 tools/similarity*.test.ts`
→ **boş** (umit dalıyla bayt bayt aynı, çalışma ağacında ve indekste). Şablon/kapak/içindekiler/kaynakça filtresi,
MinHash + embedding, ayırt edicilik ağırlığı, aynı yarışma-güncel başvuru havuzu, sürümlü önbellek, eskime bayrağı,
"Bu sonuç intihal kararı değildir" uyarısı ve kriter/karar üretmeme davranışı `tools/similarity*.test.ts` ve
`tools/four-stage-ui.test.ts` (madde 17) ile pinli. Diğer daldaki ilkel benzerlik kodu geri getirilmedi.

## 8. Çalıştırılan komutlar (son kod)

| Komut | Sonuç |
|---|---|
| `npx tsc --noEmit --incremental false` | 0 hata |
| `npm run lint` | 0 hata |
| `npm run test:unit` | **337 / 337** (yeni: `four-stage-extraction` 33, `four-stage-ui` 6, `bootstrap-atomicity` 7) |
| `npm run test:regressions` | 9 paket PASS |
| `npm run check:repo-safety` | PASS |
| `npm run build` | başarılı |

Regresyon maddeleri 1–21 (`tools/four-stage-extraction.test.ts`, `tools/four-stage-ui.test.ts`,
`tools/bootstrap-atomicity.test.ts`, mevcut `criteria-coverage`, `criteria-pipeline`, `request-guard`) karşılandı;
9 ve 10 numaralı maddeler kullanıcı kararı gereği "kriter olur" yönünde yazıldı.

## 9. Bilinen sınırlar

- **Canlı Gemini çağrısı yapılmadı.** Kalibrasyon önbellekteki gerçek model çıktısının yeniden oynatılmasıyla ve
  deterministik seçimle yapıldı; ilk gerçek analiz yeni sürüm etiketleriyle modeli çağıracak.
- `derece` puan ailesinde olduğu için "360 derece dönebilmelidir" gibi açı limitleri dışlanıyor (önceden de böyleydi).
- "Yarışma sırasında/esnasında …" ile başlayan tasarım limitleri, raporda açıkça istenmiyorsa yarışma-anı kuralı sayılıp
  dışlanıyor (Çelikkubbe'de 87 adayın 2'si).
- "Takımlar ancak güvenlik kurallarını tatbik ettikten sonra sistemlerine enerji sağlayabilirler" gibi işaretsiz saha
  prosedürlerinde son karar modelin KAPSAM_DISI sınıflamasına kalıyor.
- Yayımlanmış eski profillerde sürüm işareti yok; yeniden analiz uyarısı taslak ve analiz sonuçları için üretiliyor.
- `npm run test:e2e` temiz veri tabanı istediği için çalıştırılmadı (mevcut veriyi silen reset yapılmadı).
- Umit tarafının dağıtım notu geçerli: `APP_ENV` tanımsız ortam production sayılır.

## 10. Commit / push / merge durumu

Hiçbiri yapılmadı. `git status`: indekste birleştirme sonucu (33 dosya), çalışma ağacında ikinci aşama düzenlemeleri
ve üç yeni test dosyası (izlenmiyor). Kapatmak için: değişiklikleri gözden geçirip `git add -A` ve `git commit`
(mesaj `.git/MERGE_MSG`'de). `main`'e alma kararı kullanıcıya bırakıldı.
