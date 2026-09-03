# Bugfix Raporu — 4 Eylül 2026

**Dal:** `furkan_faruk_v1_bugfixing` · **Commit / push / merge YAPILMADI**; değişiklikler
çalışma ağacında incelemeye bırakıldı.

Kapsam: benzerlik motorunun filtreleme/sunum katmanı, hakem ekranındaki düzenleme formu ve
kayıt güvenilirliği. **Kriter çıkarımı ve hakem AI değerlendirme mantığına dokunulmadı**
(diff kontrolü: §7).

---

## 1. Yeniden doğrulanan ve düzeltilen buglar

Raporlardaki "düzeltildi" ifadeleri kanıt sayılmadı; her bulgu güncel kodda ve iki gerçek
PDF üzerinde yeniden üretildi.

### 1.1 Benzerlik filtresi — gerçek belge doğrulaması (madde 2)

Beş kusurun tamamı `HisarNova…BENZERLIK_A.pdf` ve `KalkanVizyon…BENZERLIK_B.pdf` üzerinde
**yeniden üretildi**, düzeltildi ve regresyonla kilitlendi.

| # | Bulgu | Kök neden | Düzeltme |
|---|---|---|---|
| 1 | Kapak künyesi ("Rapor kodu … Takım kaptanı … Sürüm 1.0") karşılaştırmaya giriyordu | Kapak kuralı `page === 1 && kelime < 8` idi; künye satırı 8 kelimeden uzun | Ölçüt KONUM oldu: numaralı ilk bölüm başlığına ("0.", "1.") kadar gelen 1. sayfa içeriği kapaktır |
| 2 | "0. İçindekiler ve Beyan" altındaki içindekiler tablosu karşılaştırılıyordu | `FRONT_MATTER_HEADINGS.has(fold)` tam metin eşleşmesi; "0. …" ve karma başlık eşleşmiyordu | Bölüm numarası sökülüyor; terim karma başlıkta bağımsız kelime olarak da aranıyor. **0.1 Özgünlük beyanı ve 0.3 Rapor kapsamı KORUNUYOR** |
| 3 | "8.3 Kaynakça" altındaki 4 kaynak satırı karşılaştırılıyordu | Aynı tam-metin eşleşmesi ("8 3 kaynakca" ≠ "kaynakca") | Aynı düzeltme. "8. Risk, Takvim ve Kaynakça" karma başlığı bölümün tamamını kaynakça YAPMAZ: her başlık durumu yeniden hesaplar, 8.1/8.2 anında geri alır |
| 4 | "Sentetik test raporu … Sayfa N" altbilgisi ve "… · Sürüm 1.0" bandı 10 sayfada da parçalara giriyordu | Tekrarlanan satır süzgeci yalnızca YEDEK (`normalizePages`) yolda vardı; yapısal yolda yoktu | Yapısal yola da eklendi (`tekrarlanan-altbilgi` gerekçesi). Anahtar sayfa numarasından arındırılıyor, yoksa "Sayfa 2" ile "Sayfa 3" farklı satır sayılırdı |
| 5 | Gövde cümlesi bölüm adı oluyordu (s. 9 "…yalnızca son geçerli kayıt rapora alınmıştır.", s. 4'te iki cümle daha) | `pdf-structure.classifyLine` yazı tipi sezgisi kaydırılmış paragraf satırlarını HEADING sayıyor | **Benzerlik tarafında** şekil denetimi: cümle sonu ile biten, içinde cümle kırılımı olan ya da 14 kelimeden uzun "başlık" başlık sayılmaz; normal içerik gibi işlenir ve kaynakça/içindekiler durumunu bozmaz. `pdf-structure.ts` DEĞİŞMEDİ (kriter çıkarımı etkilenmedi) |

Ayıklanan içerik silinmiyor; gerekçesiyle denetim listesinde ve R2 denetim nesnesinde duruyor.
İki PDF'in adına veya cümlelerine hiçbir yerde sabit değer yazılmadı.

**Önbellek sürümü artırıldı** — `SIMILARITY_PIPELINE_VERSION`:
`sim-v2:…` → `sim-v3-frontmatter-furniture:…`. Filtre değiştiği için eski temizlenmiş
metin/parça kayıtları yeni kurallarla üretilmiş parçalarla karşılaştırılamaz.

### 1.2 Benzerlik, hakem analizini artık bekletmiyor (madde 4)

`evaluation-app.tsx` içinde kriter analizi ile benzerlik `Promise.allSettled` ile
**birlikte** bekleniyordu: kriter analizi bitse bile benzerlik (12 devam turuna kadar
sürebilen tarama) bitmeden sonuç kaydedilmiyordu.

- İkisi hâlâ paralel başlar; **birlikte beklenmez**. Kriter sonucu kendi bütünlük
  kapılarından geçip hemen kaydedilir, hakem çalışmaya başlar.
- Benzerlik kendi hızında sürer, kendi kartını günceller (süren / kısmen / başarısız).
- Yeni sunucu eylemi `attach_similarity`: geç gelen sonucu kayda iliştirir.
  Yetkili sonuç yine **sunucudan** okunur (istemci rapor gönderemez), yalnızca
  `similarityReport` alanı yazılır ve yazma **CAS**'lidir — arada yeni analiz
  kaydedildiyse düşer. `review_json` (hakem kararları) bu yazmadan etkilenmez;
  kesinleşmiş karar ve dondurulmuş yarışma korumaları geçerlidir.
- Bağımsız **"Benzerliği yenile"** eylemi eklendi: kriter analizini yeniden başlatmaz,
  hakem kararlarını sıfırlamaz.
- Koşu sonuçlanmış biçimde taşınıyor: hiçbir aşamada sahipsiz reddedilmiş söz kalmıyor.

### 1.3 Hakem düzenleme formu (madde 5)

- `globals.css`'teki genel `input, select { width:100%; min-height:43px; padding… }` kuralı
  radyo düğmelerini de kapsıyordu (dev yuvarlaklar). **Genel kural değiştirilmedi**;
  sıfırlama yalnızca bu forma kapsamlandı — diğer formlar etkilenmedi.
- Dört seçenek tek soru gibi duruyordu; artık **iki ayrı soru**: "Kriter sonucu"
  (Uygun / Olumsuz) ve "Dayanak" (PDF'de bulunan bilgi / Raporda bulunmayan içerik).
  Kompakt, yan yana, seçili durumu açık; gerçek radio semantiği, klavye ve odak halkası korunur.
- Alıntı 160px'lik dar kolona düşüyordu; alıntı, aranan içerik ve gerekçe artık tam genişlikte,
  sayfa alanı dar. Mobil kırılımda tek kolona iner.
- Form her zaman kırmızıydı (yalnız açıklama düzeltmek reddetmek gibi görünüyordu);
  yüzey nötr, Kaydet birincil eylem. Kırmızı/yeşil yalnız gerçek sonucu ve hatayı temsil ediyor.
- Alan bazlı hata + `aria-invalid`/`aria-describedby`. Sayfa numarası **tam sayı ve belge
  aralığında** olmalı; ondalık sessizce yuvarlanmıyor (eskiden `Math.round` ediliyordu).
- Davranış korundu: AI bulgusunu aynen kullan / hakem değerlendirmesi gir, ön doldurma,
  AI'nin özgün analizinin üzerine yazılmaması, Vazgeç'in kararı bozmaması.

### 1.4 "Kaydet" gerçekten kalıcı (madde 6)

Kriter kararları yalnızca React durumundaydı; sunucuya ancak nihai işlemde yazılıyordu.

- Her karar sunucuya **`in_progress` taslak** olarak yazılır: `outcome: "pending"`,
  katılımcıya bildirim gitmez (`notifyOutcome` yalnızca `completed` için çalışır),
  nihai karar üretmez.
- "Kaydedildi" **yalnızca sunucu onayladıktan sonra** yazılır; kaydetme başarısızsa form
  kapanmaz, hata görünür ve kararlar ekranda kalır.
- Taslak; analiz künyesi (`analyzedAt`), PDF özeti ve kriter sürümüyle kapsamlanır.
  **Yeni analizden sonra eski taslak otomatik uygulanmaz** — kayıt silinmez, yalnızca
  geri yüklenmez.
- İki sekme koruması: taslak damgası sunucuda atılır; damga uyuşmazsa yazma reddedilir ve
  hakem ne olduğunu görür.

### 1.5 Sunum ve durum adlandırması (madde 3 ve 7)

- "ŞÜPHELİ" suçlayıcı ifadesi kaldırıldı → **"inceleme önerilir"**.
- Başarısız/eksik/yapılmamış karşılaştırmaya artık "Normal" denmiyor. Ayrı durumlar:
  karşılaştırılabilecek başka rapor yok · karşılaştırılabilir özgün içerik yok · karşılaştırma
  sürüyor · kısmen tamamlandı · yalnız doğrudan metin karşılaştırması · açıklama üretilemedi ·
  sonuç güncel değil · tamamlandı belirgin eşleşme yok · inceleme önerilir.
- Uyarı genişletildi: "Bu sonuç **intihal veya otomatik ret** kararı değildir."
- Tarama / kanıt seçimi / AI açıklaması **tek "incelendi" sayısında birleştirilmiyor**:
  "Matematiksel olarak karşılaştırılan rapor: N" ve "AI açıklaması için seçilen kanıt: M
  eşleşme · 1 rapor" ayrı satırlar.
- Dört kutunun **AI ön değerlendirmesi** olduğu görünür biçimde yazıldı; hakemin kesinleşen
  sayaçlarıyla karıştırılmıyor.
- 4. aşama kartı, doğrulayamadığı bir olguyu artık iddia etmiyor: "Bu profilde teknik kriter
  tanımlı değil" yerine, PDF dışı kriter varsa sayısıyla açıklama, yoksa temkinli ifade.
- Eski "Onayla/Ret düğmeleri" açıklaması mevcut eylem adlarıyla ("AI bulgusunu aynen kullan" /
  "Hakem değerlendirmesi gir") tutarlı hâle getirildi.

---

## 2. Zaten düzeltilmiş olanlar (madde 8) — yeniden yazılmadı

Güncel kodda ve geçen regresyon paketlerinde doğrulandı; hiçbiri yeniden üretilemedi:

| Bulgu | Kanıt |
|---|---|
| Hesap açıldıktan sonra e-posta/outbox/audit hatası parolayı kaybettirmiyor | `bootstrap-atomicity.test.ts` (7 test) |
| JSON/dosya gövde sınırları veri belleğe alınmadan uygulanıyor | `request-guard.test.ts` (12 test) |
| R2 yükleme başarısızlığında eski dosya korunuyor | `judge-flow-v2` #13 |
| Revizyon/çift tıklamada mükerrer başvuru oluşmuyor | `judge-flow-v2` #13, #14 |
| Başarısız yenilemede eski analiz ve hakem kararları korunuyor | `judge-flow-v2` #11, #11b |
| Pasifleştirilen hakemin açık dosyaları güvenle yeniden atanıyor | `judge-flow-v2` #15 |
| Kriter/PDF/analiz sürümü uyuşmazlığında eski sonuç yazılmıyor | `save_evaluation` bütünlük kapısı (kod okundu) + `judge-flow-v2` #10 |
| Onay/ret sonucu katılımcıda aynı kaynaktan görünüyor | `judge-flow-v2` #16 |
| Kanıt görüntüleyici doğru PDF sürümünü ve sayfayı açıyor | `judge-flow-v2` #9 |
| Benzerlikte diğer başvurulara erişim sınırlı | `peerFileAccessible = assignedJudgeId === hesap.id`; eş PDF'ine doğrudan bağlantı verilmiyor (kod okundu) |

Admin kolaylıkları kaldırılmadı, rol politikası değiştirilmedi, kaynak doğrulaması gevşetilmedi.

---

## 3. PDF karşılaştırmasının gerçek ölçümleri

**Test koşulu:** izole, yerel çalıştırma; aynı yarışma/yıl/aşama; **canlı Gemini çağrısı YOK**
(embedding = null, yalnız MinHash katmanı). Sayılar canlı uygulamanın hedefi veya referansı
değildir.

| Ölçüm | A (HisarNova) | B (KalkanVizyon) |
|---|---|---|
| ham blok | 178 | 181 |
| karşılaştırmaya giren blok | 92 | 93 |
| parça | 22 | 20 |
| karşılaştırılabilir kelime (aralık birleşimi) | 1151 | 1091 |

Ayıklanan kelime (gerekçesiyle, denetimde saklanır):

| Gerekçe | A | B |
|---|---|---|
| baslik | 236 | 250 |
| kapak-icindekiler | 96 | 96 |
| tekrarlanan-altbilgi | 154 | 154 |
| cok-kisa | 192 | 244 |
| kaynakca | 53 | 53 |

| Yön | Oran | Eşleşen / karşılaştırılabilir | Eşleşme türü |
|---|---|---|---|
| A→B | %94 | 1077 / 1151 | 20 doğrudan · 0 anlamsal |
| B→A | %99 | 1077 / 1091 | 20 doğrudan · 0 anlamsal |

**Yorum:** eşleşmelerin tamamı `lex 1.00`, yani **birebir aynı gövde metni**. Bu iki sentetik
rapor gerçekten büyük ölçüde aynı proje anlatımını taşıyor; oran filtre gürültüsünden değil,
gerçek örtüşmeden geliyor. Yön farkı beklenen davranıştır: payda her raporun **kendi**
karşılaştırılabilir içeriğidir.

Doğrulananlar:
- Kapak, içindekiler ve kaynakça **eşleşme kanıtı olarak sunulmuyor**; seçilen kanıtlar gerçek
  proje anlatımı (alt sistem tablosu, işlevsel akış, durum makinesi).
- Ayıklama denetim kaydında gerekçesiyle duruyor.
- Hiçbir eşik %93/%94 gibi bir sayıyı tutturmak için ayarlanmadı.

**Negatif kontroller** (mevcut birim testleri, hepsi geçiyor): aynı resmî şablonu paylaşan
bağımsız projeler %20 uyarı eşiğini aşamıyor · tamamen farklı iki rapor işaretlenmiyor ·
tek benzer paragraf bütün raporu %90 benzer göstermiyor · farklı kelimelerle yazılmış anlatım
anlamsal katmanla yakalanıyor · tek başına yüksek kosinüs doğrulama desteği olmadan orana
giremiyor.

---

## 4. Canlı / model-siz test ayrımı

- **Hiçbir ücretli çağrı yapılmadı.** Gemini'ye PDF metni gönderilmedi; anahtar açığa çıkmadı.
- Yukarıdaki bütün sayılar **yerel MinHash** katmanından; embedding kanalı çalıştırılmadı.
  Bu yüzden "0 anlamsal eşleşme" satırı, anlamsal kanalın başarısız olduğu anlamına gelmez —
  **hiç çalıştırılmadı**.
- **Kullanıcı kararı gerekiyor:** canlı doğrulama için iki PDF'in metni Gemini embedding
  API'sine gönderilecek ve ücretli çağrı üretecektir. İzin verilirse çağrı sayısı, model,
  boyut ve başarısızlık durumu ayrıca raporlanır.

---

## 5. Değiştirilen dosyalar

| Dosya | Değişiklik |
|---|---|
| `app/lib/similarity-text.ts` | Numaralı/karma başlık eşleşmesi, konuma dayalı kapak filtresi, tekrarlanan üstbilgi/altbilgi ayıklaması, başlık şekli denetimi, yeni `tekrarlanan-altbilgi` gerekçesi, sürüm damgası v3 |
| `app/lib/types.ts` | `SimilarityExclusionReason` + yeni gerekçe; `JudgeReview.draftScope` / `draftSavedAt` |
| `app/lib/workflow-db.ts` | `attachSimilarityToEvaluation` (CAS'li, yalnız `similarityReport`); taslak damgası ve iki-sekme çakışma kapısı |
| `app/api/applications/[id]/route.ts` | `attach_similarity` eylemi (yetki: `run_ai_prescreen`, `save_evaluation` ile aynı) |
| `app/components/evaluation-app.tsx` | Analiz/benzerlik ayrıştırması, bağımsız benzerlik takibi ve yenileme, taslak kaydı, form yeniden düzenlemesi ve alan denetimi, durum adlandırması, aşama şeridi sunumu |
| `app/evaluation.css` | Radyo sıfırlaması (forma kapsamlı), seçenek çipleri, nötr yüzey, tam genişlik alanlar, taslak durumu ve şerit üst satırı |
| `tools/similarity.test.ts` | 8 yeni test + üç pinin yeni davranışa göre genişletilmesi |
| `tools/judge-flow-v2.test.ts` | 5 yeni test (form ve taslak kaydı) |
| `tools/four-stage-ui.test.ts`, `tools/authorization.test.ts` | Değişmesi istenen davranışın pinleri güncellendi (test silinmedi, genişletildi) |

`app/globals.css` **değiştirilmedi**.

---

## 6. Doğrulama

| Kontrol | Sonuç |
|---|---|
| `npx tsc --noEmit` | 0 hata |
| `npm run lint` | 0 hata / 0 uyarı |
| `npm run test:unit` | **350 / 350** (öncesi 337; 13 yeni test) |
| `npm run test:regressions` | 9 paket PASS |
| `npm run check:repo-safety` | PASS |
| `npm run build` | başarılı |
| Gerçek PDF A/B karşılaştırması | §3 |

---

## 7. Dokunulmayan alanların diff kontrolü

`git diff --stat` **boş** (bayt bayt aynı):

`app/lib/criteria-extraction.ts` · `app/lib/criteria-candidates.ts` · `app/lib/criteria-dictionary.ts` ·
`app/lib/report-evaluator.ts` · `app/lib/pdf-structure.ts` · `app/lib/gemini-analyzer.ts` ·
`app/lib/gemini-generation.ts` · `app/lib/admin-roles.ts` · `app/lib/authorization.ts` ·
`app/api/analyze/route.ts` · `app/api/evaluate-report/route.ts` · `app/globals.css`

Yani kriter çıkarma promptu/sözlüğü/aday seçimi, hakem AI değerlendirme mantığı, model seçimi,
eşikler, rol/yetki politikası ve otomatik hakem atama ilkesi **değişmedi**. Ortak PDF
ayrıştırıcı (`pdf-structure.ts`) da değişmedi: §1.1'deki 5. kusur bilinçli olarak yalnızca
benzerlik katmanında uyarlandı.

---

## 8. Kalan sınırlar ve kullanıcı kararı gerektiren konular

1. **Canlı Gemini doğrulaması yapılmadı** (izin gerekiyor, §4).
2. **Tarayıcı ekran görüntüsü alınmadı.** Bu oturum etkileşimsizdir; geliştirme sunucusu
   başlatılıp gerçek tarayıcıda 360px / tablet / masaüstü / %200 yakınlaştırma ve klavye
   akışı **görsel olarak** doğrulanmadı. Form değişiklikleri kaynak ve CSS düzeyinde
   regresyonla kilitlendi; **görsel doğrulama sizin onayınızla yapılmalıdır.**
3. **`npm run test:e2e` çalıştırılmadı**: temiz veri tabanı istiyor, `dev_reset` mevcut
   gerçek hesap/başvuru/PDF'leri silecekti. Önceki iki raporda olduğu gibi karar sizde.
4. **Bölüm adı bozulması kısmen sürüyor (kozmetik).** `pdf-structure.buildPageBlocks`
   yanlış bir başlık ürettiğinde, o başlığın adı **sonraki bloklara da** yazılmış olarak
   geliyor; benzerlik katmanı kendi ayıklama kararlarını bundan bağımsız veriyor, ama denetim
   listesindeki "bölüm" etiketi bozuk görünebiliyor ve parçalar gereğinden fazla bölünebiliyor.
   Karşılaştırma doğruluğunu bozmuyor (yanlış eşleşme üretmiyor). Kalıcı çözüm ortak
   ayrıştırıcıya dokunmayı gerektirir — **kriter çıkarımını da etkiler, izin istiyorum.**
5. **Numaralı tablo satırları başlık sanılabiliyor** ("1 Dış ortam algılama testi …").
   `classifyLine` çıplak numaralı başlıkları bilinçli olarak kabul ediyor (TEKNOFEST
   şartnamelerindeki "2 YARIŞMA TAKVİMİ" gibi gerçek başlıklar için). Etkisi güvenli yönde:
   içerik karşılaştırma DIŞINDA kalır, yanlış benzerlik üretmez. Aynı ortak ayrıştırıcı
   sorusu.
6. **Sayfa bandı gövdeye karışmışsa** ("… · Sürüm 1.0 Bu proje, …") satır bazlı süzgeç
   yakalayamıyor; canlı akışta yarışma/takım adı temizliği bu kalıntının çoğunu siliyor.
7. **Taslak kaydı sunucuda alıntı doğrulamasından geçiyor.** Hakemin yazdığı alıntı belirttiği
   sayfada bulunamazsa taslak kaydı reddediliyor ve form açık kalıyor — istenen davranış bu,
   ama artık hata nihai işlemde değil, karar verilirken görünüyor.
8. **Benzerlik LLM kapsamı:** madde 3'ün "en fazla 5 farklı rapor" tavanı bir **üst sınırdır**;
   mevcut uygulama bundan daha dar — güçlü eşleşme yoksa **0**, varsa **tek** en yakın rapor
   ve en fazla 3 kanıt çifti ile **tek** yapılandırılmış çağrı. Havuz büyüdükçe çağrı sayısı
   artmıyor; embedding'ler yalnız değişen rapor için üretiliyor, havuzun tamamı matematiksel
   olarak taranıyor. Kapsamı 1'den 5 rapora çıkarmak maliyeti ve hakeme sunulan yüzeyi
   **artıran** bir ürün kararıdır; bug olmadığı için yapılmadı — **isterseniz ayrıca yaparım.**

---

**Commit / push / merge yapılmadı.** `git status`: 6 kaynak + 4 test dosyası değişik,
bu rapor yeni dosya olarak eklendi.
