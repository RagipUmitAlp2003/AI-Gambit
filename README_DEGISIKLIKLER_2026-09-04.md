# Ne değişti? — 4 Eylül 2026

**Dal:** `furkan_faruk_v1_bugfixing` · **Commit / push / merge yapılmadı.**

Bu dosya, bu oturumda **ne bozuktu, ne yaptım, nasıl doğrularsınız** sorularını sırayla
anlatır. Ölçüm tabloları ve resmî teslim metni ayrı dosyadadır:
[`BUGFIX_RAPORU_2026-09-04.md`](BUGFIX_RAPORU_2026-09-04.md).

## Bir bakışta

| Alan | Önce | Sonra |
|---|---|---|
| Benzerlik filtresi | Kapak künyesi, içindekiler tablosu, kaynakça ve her sayfadaki altbilgi karşılaştırmaya giriyordu | Beşi de ayıklanıyor; gerekçesiyle denetimde duruyor |
| Bölüm tespiti | Kaydırılmış gövde cümlesi "bölüm adı" olabiliyordu | Şekli başlığa benzemeyen blok başlık sayılmıyor |
| Hakem analizi | Benzerlik bitene kadar sonuç kaydedilmiyordu | Kriter analizi hemen kaydediliyor, benzerlik kendi kartında ilerliyor |
| Düzenleme formu | Dört dev yuvarlak, dar kolona düşen alıntı, hep kırmızı yüzey | İki ayrı soru, kompakt seçenekler, tam genişlik alanlar, nötr yüzey |
| "Kaydet" | Yalnızca React durumunu güncelliyordu | Sunucuya taslak yazıyor; "kaydedildi" ancak kalıcılaşınca deniyor |
| Durum adlandırması | Başarısız/eksik koşu da "Normal" görünüyordu | Dokuz ayrı durum; "ŞÜPHELİ" yerine "inceleme önerilir" |

**Dokunulmayanlar:** kriter çıkarma promptu/sözlüğü/aday seçimi, hakem AI değerlendirme
mantığı, model seçimi, eşikler, rol/yetki politikası, otomatik hakem atama, `app/globals.css`
ve ortak PDF ayrıştırıcı `app/lib/pdf-structure.ts`. Diff kontrolü raporun §7'sinde.

---

## 1. Benzerlik filtresi — gerçek PDF'lerle bulunup düzeltildi

İki sentetik test raporu (`HisarNova…BENZERLIK_A.pdf`, `KalkanVizyon…BENZERLIK_B.pdf`)
gerçekten çalıştırıldı ve beş kusur da **yeniden üretildi**. Sorunlar tahmin edilmedi;
blok blok döküldü.

**Ne bozuktu:**

- Kapaktaki "Rapor kodu … Takım kaptanı … Danışman … Sürüm 1.0" satırı karşılaştırılıyordu.
  Kapak kuralı "1. sayfada 8 kelimeden kısa blok" idi, künye satırı bundan uzundu.
- "0. İçindekiler ve Beyan" başlığı tanınmıyordu, çünkü filtre **tam metin** eşleşmesine
  bakıyordu: `"0 icindekiler ve beyan" ≠ "icindekiler"`. Sonuç: 9 satırlık içindekiler
  tablosu iki raporda da karşılaştırmaya giriyordu (ve tabii ki birebir eşleşiyordu).
- Aynı sebeple "8.3 Kaynakça" da tanınmıyordu; altındaki dört kaynak satırı (IEC 60204-1,
  ISO 13850, şartname, üretici veri sayfaları) karşılaştırılıyordu.
- "Sentetik test raporu · … Sayfa 3" altbilgisi ve "… · Kritik Tasarım Raporu · Sürüm 1.0"
  bandı 10 sayfanın hepsinde parçalara giriyordu. Tekrarlanan satır süzgeci yalnızca
  **yedek** yolda (`normalizePages`) vardı; yapısal yolda hiç yoktu.
- 4. ve 9. sayfada birer gövde cümlesi "başlık" sanılıp bölüm adı oluyordu
  (ör. *"…yalnızca son geçerli kayıt rapora alınmıştır."*).

**Ne yaptım** ([`app/lib/similarity-text.ts`](app/lib/similarity-text.ts)):

- `stripLeadingSectionNumber()` — başlık eşleşmesi artık bölüm numarasını yok sayıyor:
  "8.3 Kaynakça" → "kaynakca". Numara sökme, şekil denetiminden **önce** yapılıyor, yoksa
  "1. Yönetici Özeti" içindeki nokta cümle sonu sanılıyordu.
- `headingMatchesKnownSection()` — karma başlıkta terim bağımsız kelime olarak da aranıyor.
  **"Risk, Takvim ve Kaynakça" bölümün tamamını kaynakça yapmaz:** her başlık durumu
  yeniden hesapladığı için "8.1 Başlıca riskler" işareti anında geri alır. Aynı şekilde
  "0. İçindekiler ve Beyan" altında yalnızca içindekiler tablosu ayıklanır;
  **0.1 Özgünlük beyanı ve 0.3 Rapor kapsamı karşılaştırmada kalır.**
- Kapak ölçütü kelime sayısından **konuma** geçti: numaralı ilk bölüm başlığına ("0.", "1.")
  kadar gelen 1. sayfa içeriği kapaktır.
- `repeatedPageFurniture()` + `furnitureKey()` — sayfaların çoğunda tekrarlanan kısa satır
  yeni `tekrarlanan-altbilgi` gerekçesiyle ayıklanıyor. Anahtar sayfa numarasından
  arındırılıyor; yoksa "Sayfa 2" ile "Sayfa 3" farklı satır sayılır ve hiçbiri yakalanmazdı.
- `isPlausibleHeadingText()` — cümle sonuyla biten, içinde cümle kırılımı olan ya da 14
  kelimeden uzun "başlık" başlık sayılmaz; normal içerik gibi işlenir ve kaynakça/içindekiler
  durumunu bozmaz.

> **Neden `pdf-structure.ts` değişmedi?** Başlık yanlış tespiti aslında ortak PDF
> ayrıştırıcının yazı-tipi sezgisinden geliyor; ama o modül kriter çıkarımıyla ortaktır.
> Görev tanımı "mümkünse benzerlik tarafında sınırlı bir uyarlama yap" dediği için düzeltme
> yalnızca benzerlik katmanına konuldu. Kriter ekibinin çalışması etkilenmedi.

Hiçbir yere bu iki PDF'in adı veya cümlesi sabit değer olarak yazılmadı.

**Önbellek:** `SIMILARITY_PIPELINE_VERSION` → `sim-v3-frontmatter-furniture:…`.
Filtre kuralı değiştiği için eski temizlenmiş metin/parça kayıtları yeni parçalarla
karşılaştırılamaz — damga bunu kendiliğinden sağlar.

**Ölçüm (canlı model çağrısı yok, yalnız yerel MinHash):**

| | A (HisarNova) | B (KalkanVizyon) |
|---|---|---|
| ham blok → karşılaştırılan blok | 178 → 92 | 181 → 93 |
| parça | 22 | 20 |
| karşılaştırılabilir kelime | 1151 | 1091 |
| ayıklanan (kapak / altbilgi / kaynakça) | 96 / 154 / 53 kelime | 96 / 154 / 53 kelime |

A→B **%94** (1077/1151), B→A **%99** (1077/1091), 20 doğrudan eşleşme.
Eşleşmelerin tamamı `lex 1.00`, yani **birebir aynı gövde metni** — oran filtre
gürültüsünden değil, iki raporun gerçekten aynı proje anlatımını taşımasından geliyor.
Kanıt olarak kapak/içindekiler/kaynakça değil, alt sistem tablosu ve durum makinesi gibi
gerçek anlatım seçiliyor.

---

## 2. Benzerlik artık hakemi bekletmiyor

**Ne bozuktu:** `evaluation-app.tsx` içinde kriter analizi ile benzerlik `Promise.allSettled`
ile birlikte bekleniyordu. Kriter analizi bitse bile, 12 devam turuna kadar sürebilen havuz
taraması bitmeden sonuç kaydedilmiyor ve hakem hiçbir şey göremiyordu.

**Ne yaptım:**

- İkisi hâlâ paralel başlıyor ama **birlikte beklenmiyor**. Kriter sonucu kendi bütünlük
  kapılarından geçip hemen kaydediliyor.
- Benzerlik kendi hızında sürüyor ve kendi kartını güncelliyor: *sürüyor / kısmen tamamlandı /
  tamamlanamadı*.
- Yeni sunucu eylemi **`attach_similarity`**
  ([`route.ts`](app/api/applications/[id]/route.ts), [`workflow-db.ts`](app/lib/workflow-db.ts)):
  geç gelen sonucu kayda iliştirir. Yetkili sonuç yine **sunucudan** okunuyor (istemci rapor
  gönderemez), yalnızca `similarityReport` alanı yazılıyor ve yazma **karşılaştırmalı (CAS)**:
  arada yeni analiz kaydedildiyse düşer. `review_json` (hakem kararları) bu yazmadan
  etkilenmez; kesinleşmiş karar ve dondurulmuş yarışma korumaları geçerlidir.
- Bağımsız **"Benzerliği yenile"** düğmesi: kriter analizini yeniden başlatmaz, hakem
  kararlarını sıfırlamaz.
- Koşu sonuçlanmış biçimde taşınıyor, böylece hiçbir aşamada sahipsiz reddedilmiş söz
  (unhandled rejection) kalmıyor.

---

## 3. Hakem düzenleme formu

**Ne bozuktu:** `globals.css`'teki genel `input, select { width:100%; min-height:43px; … }`
kuralı radyo düğmelerini de kapsıyordu; `evaluation.css` yalnızca `margin` ayarlıyordu.
Sonuç: dört dev yuvarlak. Alıntı alanı `160px + esnek` grid'in dar ilk kolonuna düşüyordu.
Form her zaman kırmızıydı — yalnız açıklamayı düzeltmek bile katılımcıyı reddetmek gibi
görünüyordu.

**Ne yaptım** ([`evaluation.css`](app/evaluation.css), [`evaluation-app.tsx`](app/components/evaluation-app.tsx)):

- **Genel kural değiştirilmedi**; sıfırlama yalnızca bu forma kapsamlandı
  (`.eval-choice-options input[type="radio"]`). Diğer formlar etkilenmedi.
- Dört seçenek **iki ayrı soruya** bölündü: *Kriter sonucu* (Uygun / Olumsuz) ve
  *Dayanak* (PDF'de bulunan bilgi / Raporda bulunmayan içerik). Seçenekler kompakt, yan yana
  çipler; gerçek radio semantiği, klavye ve `:focus-within` odak halkası korunuyor.
- Alıntı, aranan içerik ve gerekçe **tam genişlikte**; sayfa alanı dar. Mobilde tek kolon.
- Yüzey nötr, **Kaydet birincil eylem**. Kırmızı/yeşil yalnız gerçek sonucu ve hatayı
  temsil ediyor.
- Alan bazlı hata + `aria-invalid` / `aria-describedby`.
- Sayfa numarası **tam sayı ve belge aralığında** olmalı; ondalık artık sessizce
  yuvarlanmıyor (eskiden `Math.round` ediliyordu).

Davranış aynen korundu: "AI bulgusunu aynen kullan" / "Hakem değerlendirmesi gir", AI
verileriyle ön doldurma, AI'nin özgün analizinin üzerine yazılmaması, Vazgeç'in kararı
bozmaması, nihai ONAY/RET işleminin ayrı kalması.

---

## 4. "Kaydet" gerçekten kalıcı

**Ne bozuktu:** kriter kararları yalnızca React durumundaydı; sunucuya ancak nihai işlemde
yazılıyordu. Geri dönmek, başvuru değiştirmek veya sayfayı yenilemek çalışmayı sessizce
siliyordu.

**Ne yaptım:**

- Her karar sunucuya **`in_progress` taslak** olarak yazılıyor: `outcome: "pending"`,
  katılımcıya bildirim gitmiyor (`notifyOutcome` yalnızca `completed` için çalışır),
  nihai karar üretmiyor.
- **"Kaydedildi" yalnızca sunucu onayladıktan sonra** yazılıyor. Kaydetme başarısızsa form
  kapanmıyor, hata görünüyor ve kararlar ekranda kalıyor.
- Taslak; analiz künyesi (`analyzedAt`), PDF özeti ve kriter sürümüyle kapsamlanıyor
  (`JudgeReview.draftScope`). **Yeni analizden sonra eski taslak otomatik uygulanmıyor** —
  kayıt silinmiyor, yalnızca geri yüklenmiyor.
- İki sekme koruması: taslak damgası (`draftSavedAt`) **sunucuda** atılıyor; damga uyuşmazsa
  yazma reddediliyor ve hakem ne olduğunu görüyor.

> Yan etki: taslak da sunucudaki alıntı doğrulamasından geçiyor. Hakemin yazdığı alıntı
> belirttiği sayfada bulunamazsa taslak reddediliyor ve form açık kalıyor. İstenen davranış
> bu; ama artık hata nihai işlemde değil, karar verilirken görünüyor.

---

## 5. Durum adlandırması ve özet kutuları

- "ŞÜPHELİ" suçlayıcı ifadesi kaldırıldı → **"inceleme önerilir"**.
- Başarısız/eksik/yapılmamış karşılaştırmaya artık **"Normal" denmiyor**. Ayrı durumlar:
  karşılaştırılabilecek başka rapor yok · karşılaştırılabilir özgün içerik yok · karşılaştırma
  sürüyor · kısmen tamamlandı · yalnız doğrudan metin karşılaştırması · açıklama üretilemedi ·
  sonuç güncel değil · tamamlandı belirgin eşleşme yok · inceleme önerilir.
- Uyarı genişletildi: "Bu sonuç **intihal veya otomatik ret** kararı değildir."
- Tarama / kanıt seçimi / AI açıklaması **tek "incelendi" sayısında birleştirilmiyor**:
  "Matematiksel olarak karşılaştırılan rapor: N" ve "AI açıklaması için seçilen kanıt:
  M eşleşme · 1 rapor" ayrı satırlar.
- Dört kutunun **AI ön değerlendirmesi** olduğu görünür biçimde yazıldı.
- 4. aşama kartı doğrulayamadığı bir olguyu artık iddia etmiyor: "Bu profilde teknik kriter
  tanımlı değil" yerine, PDF dışı kriter varsa sayısıyla açıklama, yoksa temkinli ifade.
- Eski "Onayla/Ret düğmeleri" açıklaması mevcut eylem adlarıyla tutarlı hâle getirildi.

---

## 6. Zaten düzeltilmiş olanlar (yeniden yazılmadı)

Raporlardaki "düzeltildi" ifadeleri kanıt sayılmadı; on maddenin hepsi güncel kodda ve geçen
regresyon paketlerinde kontrol edildi, hiçbiri yeniden üretilemedi: bootstrap parola kaybı,
gövde sınırları, R2 yükleme hatası, mükerrer başvuru, başarısız yenilemede analiz kaybı,
pasifleştirilen hakem, sürüm uyuşmazlığı, katılımcı sonucu, kanıt görüntüleyici sayfası,
benzerlikte erişim sınırları. Eşleştirme tablosu raporun §2'sinde.

---

## 7. Doğrulama

```bash
npm install --legacy-peer-deps
npx tsc --noEmit --incremental false   # 0 hata
npm run lint                            # 0 hata / 0 uyarı
npm run test:unit                       # 350 / 350  (öncesi 337; 13 yeni test)
npm run test:regressions                # 9 paket PASS
npm run check:repo-safety               # PASS
npm run build                           # başarılı
```

Yeni testler:

| Dosya | Neyi kilitliyor |
|---|---|
| `tools/similarity.test.ts` | Numaralı kaynakça/içindekiler başlığı · karma başlığın bölümü yutmaması · sayfa numarası değişen altbilgi · konuma dayalı kapak · sahte başlık · durum adlandırması · LLM maliyet kapısı · analiz/benzerlik ayrışması · geç gelen sonucun ezmemesi |
| `tools/judge-flow-v2.test.ts` | Radyo sıfırlamasının forma kapsamlı olması · iki ayrı soru · sayfa numarası denetimi · taslak kaydı ve "kaydedildi" sözleşmesi · iki sekme çakışması |

Değişmesi **istenen** davranışı koruyan üç pin silinmedi, yeni davranışa göre genişletildi
(`four-stage-ui.test.ts`, `authorization.test.ts`, `similarity.test.ts`).

---

## 8. Yapılmayanlar — sizin kararınız gerekiyor

1. **Canlı Gemini doğrulaması yapılmadı.** Bütün sayılar yerel MinHash katmanından;
   embedding kanalı hiç çalıştırılmadı ("0 anlamsal eşleşme" satırı başarısızlık değil,
   *çalıştırılmadı* demektir). Canlı koşu iki PDF'in metnini embedding API'sine gönderir ve
   ücretli çağrı üretir — **izin verirseniz** çağrı sayısı, model, boyut ve hata durumuyla
   ayrıca raporlarım.
2. **Tarayıcı ekran görüntüsü alınmadı.** Bu oturum etkileşimsiz; form değişiklikleri kaynak
   ve CSS düzeyinde regresyonla kilitlendi, ama 360px / tablet / masaüstü / %200 yakınlaştırma
   ve klavye akışı **görsel olarak** doğrulanmadı.
3. **`npm run test:e2e` çalıştırılmadı**: temiz veri tabanı istiyor, `dev_reset` mevcut gerçek
   hesap/başvuru/PDF'leri silecekti.
4. **Bölüm adı bozulması kısmen sürüyor (kozmetik).** Ortak ayrıştırıcı yanlış bir başlık
   ürettiğinde o ad sonraki bloklara da yazılmış geliyor; denetim listesindeki "bölüm" etiketi
   bozuk görünebiliyor. Karşılaştırma doğruluğunu bozmuyor. Kalıcı çözüm `pdf-structure.ts`'e
   dokunmayı gerektirir — **kriter çıkarımını da etkiler, izin istiyorum.**
5. **Benzerlik LLM kapsamı.** Görev tanımındaki "en fazla 5 farklı rapor" bir **üst sınırdır**;
   mevcut uygulama bundan dar: güçlü eşleşme yoksa **0**, varsa **tek** en yakın rapor ve en
   fazla 3 kanıt çiftiyle **tek** çağrı. Havuz büyüdükçe çağrı sayısı artmıyor. 1'den 5 rapora
   çıkarmak maliyeti ve hakeme sunulan yüzeyi **artıran bir ürün kararıdır**; bug olmadığı
   için yapılmadı — isterseniz ayrıca yaparım.

---

## Değişen dosyalar

**Kaynak (6):** `app/lib/similarity-text.ts` · `app/lib/types.ts` · `app/lib/workflow-db.ts` ·
`app/api/applications/[id]/route.ts` · `app/components/evaluation-app.tsx` · `app/evaluation.css`

**Test (4):** `tools/similarity.test.ts` · `tools/judge-flow-v2.test.ts` ·
`tools/four-stage-ui.test.ts` · `tools/authorization.test.ts`

**Yeni:** `BUGFIX_RAPORU_2026-09-04.md` · bu dosya
