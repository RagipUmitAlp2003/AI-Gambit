# Şartname Analizi API Sözleşmesi

Bu belge, şartname PDF'sinden dört aşamalı kriter setini **tek model çağrısıyla** çıkaran analiz akışının veri biçimini ve değişmez ilkelerini tanımlar.

Tip tanımlarının tek kaynağı `app/lib/types.ts` (`AnalysisResult`, `Criterion`, `CHECK_STAGES`), şema ve talimatın tek kaynağı `app/lib/criteria-extraction.ts`'tir. Bu belge ile kod çelişirse kod geçerlidir.

## Güvenlik ilkesi

API anahtarı hiçbir zaman `app/components` veya tarayıcıya gönderilen başka bir dosyaya yazılmamalıdır. Anahtar yalnızca sunucu ortam değişkeninde tutulur ve analiz isteği `app/api/analyze/route.ts` üzerinden yapılır. PDF içeriği talimat enjeksiyonu kaynağıdır; belge içindeki model yönlendirmeleri komut olarak uygulanmaz.

## Analiz isteği

`POST /api/analyze` — `multipart/form-data`. Yalnızca `author_criteria` izni (01) çağırabilir.

| Alan | Tür | Açıklama |
| --- | --- | --- |
| `file` | File | Şartname PDF'si. En fazla 18 MB. |
| `pageCount` | string | İstemcinin pdfjs ile saydığı sayfa sayısı; kaynak sayfa doğrulamasında üst sınır olarak kullanılır. |

**Üretim ayarları:** `temperature: 0`, `topP: 1`, `maxOutputTokens: 24576`. Kural çıkarımı yaratıcı bir görev değildir; sıfır sıcaklık aynı belgede aynı kriterleri üretir ve örnekleme adımını kısaltır.

**Görüntü çözünürlüğü** `MEDIA_RESOLUTION_LOW`'dur (`GEMINI_MEDIA_RESOLUTION` ile değiştirilebilir). `MEDIUM` ile çok sayfalı şartnameler Gemini tarafında yüksek kapasiteli istek sayılıp **503 "high demand"** ile reddedilir; ölçüm (29 sayfa · 1,8 MB, aynı gövde): `MEDIUM` 4/4 kez 503, `LOW` 3/3 kez başarılı — aynı 14 kriter, aynı 14/14 kaynak sayfa. Kural ve kanıt metinleri PDF'in metin katmanından okunduğu için düşük çözünürlük kaliteyi düşürmez. Ayar önbellek anahtarına dahildir.

**Düşünme bütçesi** analiz süresinin ikinci belirleyicisidir ve belge uzunluğuna göre seçilir: `< 40 sayfa → LOW`, `40–79 → MEDIUM`, `80+ → HIGH`. `GEMINI_THINKING_LEVEL` ile sabitlenebilir. Çelikkubbe şartnamesi (25 sayfa · 1,75 MB) ölçümü: LOW 47,6 sn / 13 kriter, MEDIUM 73,6 sn / 16 kriter — her ikisinde de kaynak sayfa doluluğu %100.

İstemci ayrı bir ayar formu göndermez; yarışma, kategori, aşama, rapor türü, dil ve teslim sınırları belgeden çıkarılır.

**Tek belge:** Yarışma Yöneticisi yalnızca şartname PDF'sini yükler. Ayrı resmî rapor şablonu yükleme alanı kaldırıldı; `templateFile` ve `templatePageCount` alanları artık kabul edilmez. Zorunlu başlıklar 2. aşama (`headings_content`) kriterlerinden okunur.

**Tek çağrı:** Bir "Belgeyi analiz et" işlemi modele **tam olarak bir** `generateContent` isteği gönderir. Yedek model kademesi, model tarama turu ve gizli yeniden deneme döngüsü yoktur. 429/503/zaman aşımında uç `{ "error": "...", "retryable": true, "apiCalls": 1 }` döndürür ve arayüz kullanıcıya "Yeniden dene" sunar. `diagnostics.apiCalls` gerçekten yapılan istek sayısıdır (önbellek isabetinde 0).

## Modelden istenen ham cevap

Model, `EXTRACTION_SCHEMA` ile sınırlandırılmış tek bir JSON döndürür:

```jsonc
{
  "documentProfile": {
    "competition": "İnsansız Deniz Aracı Yarışması",   // yoksa null
    "category": "Üniversite Seviyesi",
    "stage": "Kritik tasarım değerlendirmesi",
    "reportType": "Kritik Tasarım Raporu (KTR)",
    "year": "2026",
    "reportLanguage": "Türkçe",                         // belge sessizse null
    "allowedFormats": ["PDF"],
    "maxFileSizeMb": 25,                                // yoksa null
    "maxFileCount": 1,
    "defaultViolationAction": "block"                   // block | warn | jury | unspecified
  },
  // templateProfile ve excludedRules ŞEMADAN ÇIKARILDI: ayrı rapor şablonu
  // yüklenmiyor ve kapsam dışı madde listesi yalnızca bir sayaç uyarısı
  // üretiyordu. İkisi de çıktı token maliyeti ve yanıt süresi demekti.
  "criteria": [
    {
      "name": "KTR azami 30 sayfa",
      "stage": "language_template",       // language_template | headings_content | category_similarity | criteria_evidence
      "required": true,                    // Zorunlu → true, Diğer → false
      "description": "KTR ekler hariç en fazla 30 sayfa olmalıdır.",  // tek cümle, en fazla 300 karakter
      "violationOutcome": "Değerlendirmeye alınmaz",   // yoksa "Belgede belirtilmemiş"
      "sourcePage": 12,                    // ZORUNLU · PDF dosyasındaki 1 tabanlı sıra; basılı etiket değil
      "sourceText": "KTR en fazla 30 sayfa olmalıdır." // tek cümle, en fazla 320 karakter
    }
  ]
}
```

### Kaynak sayfa zorunludur

`sourcePage` şemada `minimum: 1` ile zorunlu alandır ve sistem istemi bunu ayrıca vurgular: kuralın geçtiği sayfanın **PDF dosyasındaki** 1 tabanlı sırasıdır, belgenin altındaki basılı etiket değildir. Model sayfadan emin değilse o kuralı hiç yazmamalıdır.

## Dört aşama

| `stage` | Aşama | Kriter olarak ne çıkarılır |
| --- | --- | --- |
| `language_template` | Dil ve Şablon Uygunluğu | Rapor dili; sayfa sınırı, punto, kenar boşluğu, kapak, dosya adı/türü/boyutu, sayfa düzeni. |
| `headings_content` | Başlık ve İçerik Kontrolü | Raporda bulunması zorunlu her başlık için ayrı kriter; açıklama altındaki içeriğin ne olması gerektiğini söyler. |
| `category_similarity` | Kategori Uygunluğu ve Benzerlik | Konu, seviye ve kapsamın kategoriye uygun sayılması için belgede yazan koşullar; açık özgünlük/intihal kuralı. Benzerlik karşılaştırmasını sistem kendisi yapar. |
| `criteria_evidence` | Kriter Bazlı Kanıt Çıkarma | Raporda kanıtlanması gereken her teknik kural (tasarım kısıtı, zorunlu analiz/hesap/test planı, güvenlik ve sistem gereksinimi, teslim edilecek çizim/tablo). |

## Sunucu normalizasyonu ve uç nokta cevabı

`normalizeExtraction()` ham cevabı doğrular ve `AnalysisResult` üretir:

- Adı veya kaynak alıntısı boş kriter alınmaz; tanınmayan `stage` değeri `criteria_evidence`'a düşer.
- Aynı aşamada aynı ad + sayfa veya aynı alıntı metnine sahip tekrarlar birleştirilir.
- **`sourcePage` doğrulanmadan kaydedilmez.** 1 ile belgenin sayfa sayısı arasında tam sayı değilse kriter listeye alınmaz; düşen kriterlerin adları `analysisWarnings` içinde tek tek yazılır. Böylece "kaynak sayfa girilmedi" durumundaki bir profil hiç oluşmaz.
- Doğrulamanın üst sınırı olan sayfa sayısı **sunucuda belgenin kendisinden** okunur (`app/lib/pdf-page-count.ts`); istemciden gelen değerle karşılaştırılıp büyüğü alınır. Eskiden yalnızca istemci değeri kullanılıyordu ve alan eksik geldiğinde sınır 1'e düşüp bütün kaynak sayfaları siliniyordu.
- **Yapısal aday akışında (`decisions`) doğrulama kaynağı kaynak kimliği + birebir alıntıdır.** `sourceId` sunucunun seçtiği bir adaya karşılık gelmeli ve `sourceText` o bloğun özgün metninde birebir bulunmalıdır. Alıntısı doğrulanan bir karar, modelin `sourcePage` değeri bloğun sayfasıyla uyuşmasa bile düşürülmez: kritere **sunucu doğrulamalı blok sayfası** yazılır, düzeltme `diagnostics.correctedPages` ve `analysisWarnings` içinde raporlanır. Alıntısı doğrulanamayan karar ise sayfası doğru olsa bile reddedilir.
- `description` en fazla 300, `sourceText` en fazla 320 karakterde kırpılır.
- Liste aşama sırası ve kaynak sayfasına göre dizilir; kimlikler `criterion-1 … n` olarak yeniden verilir. Üst sınır 400 kriterdir.
- Boş kriter listesi `analysisWarnings` içinde raporlanır.

```jsonc
{
  "setup": { "competition": "…", "category": "…", "stage": "…", "reportType": "…", "year": "…",
             "allowedFormats": ["PDF"], "maxFileSizeMb": 25, "maxFileCount": 1,
             "defaultViolationAction": "block", "reportLanguage": "Türkçe" },
  "templateProfile": { "provided": false, "name": "", "pages": 0, "requiredHeadings": [], "notes": [] },
  "criteria": [ { "id": "criterion-1", "name": "…", "stage": "language_template", "required": true,
                  "description": "…", "violationOutcome": "…", "sourcePage": 12, "sourceText": "…",
                  "active": true, "origin": "document" } ],
  "pageCount": 25,
  "provider": "api",
  "model": "…",                       // arayüze sızmaz
  "analyzedAt": "2026-08-26T09:00:00.000Z",
  "analysisWarnings": ["7 madde (saha/fiziksel aşama, puanlama veya haricî onay) PDF aşaması dışında olduğu için kriter yapılmadı."],
  "diagnostics": { "totalMs": 91000, "modelMs": 86000, "uploadMs": 4000, "promptTokens": 38000,
                   "outputTokens": 9000, "cached": false, "apiCalls": 1, "documentTransfers": 1,
                   "documentDelivery": "file_uri" }
}
```

Hata cevabı her zaman `{ "error": string }` + anlamlı HTTP durumu: `400` eksik/bozuk alan, `413` boyut, `415` tür, `502/504` sağlayıcı, `503` anahtar yok, `429` hız sınırı.

**Önbellek iki katmanlı ve kalıcıdır.** Anahtar `EXTRACTION_PROMPT_VERSION`, belge içeriğinin SHA-256'sı, model adı, görüntü çözünürlüğü, düşünme kademesi ve sayfa sayısından türetilir; dosya adı anahtara girmez. İsabet önce süreç belleğinde, yoksa D1'deki `criteria_analysis_cache` tablosunda aranır; bulunursa model **hiç çağrılmaz** ve cevap `diagnostics` içinde `cached: true`, `cacheStore: "memory" | "database"`, `firstAnalyzedAt` (belgenin ilk analiz zamanı), `promptTokens/outputTokens: 0`, `apiCalls: 0` taşır. Kalıcı kayıt sunucu yeniden başlatıldığında da durur. Normalizasyondan 0 kriterle çıkan çıktı hiçbir katmana yazılmaz; aynı belgeye eşzamanlı ikinci istek ilkinin sonucunu bekler. Talimat veya şema değiştiğinde `EXTRACTION_PROMPT_VERSION` artırılır ve eski kayıtlar doğal olarak eşleşmez. Ayrıntı: `docs/KALICI_ANALIZ_ONBELLEGI.md`.

## Yapay zekâ için değişmez kurallar

1. Belgede açıkça bulunmayan kural, zorunluluk, istisna veya ihlal sonucu üretilmez.
2. "Belirtilmemiş" ile "uygun değil" birbirinden ayrılır; belge sessizse değer uydurulmaz.
3. Her kriterin PDF sayfa sırası ve özgün dilde birebir kısa alıntısı bulunur; çeviri, özet veya yorum `sourceText` olamaz.
4. Amaç, tanım, örnek, tavsiye ve genel açıklamalar açık bir rapor gerekliliği doğurmuyorsa kriter yapılmaz.
5. Puan tabloları, ağırlıklar, cezalar, barajlar, puanlama sistemleri ve saha/fiziksel aşama maddeleri kriter yapılmaz ve çıktıya hiç yazılmaz. Aynı maddede hem rapor gerekliliği hem saha koşulu varsa yalnızca rapor gerekliliği kriter olur.
6. `required` yalnızca belge "zorunlu / olmalıdır / şarttır / gereklidir / aksi hâlde değerlendirilmez" diyorsa `true`; tavsiye veya beklenti `false`.
7. Tablo, açıklama ve dipnotta tekrarlanan kural bir kez çıkarılır; bağımsız sonuç doğuran maddeler tek kriterde eritilmez.
8. Güven seviyesi, olasılık veya "emin değilim" ifadesi üretilmez; dayanağı olmayan kural hiç yazılmaz.
9. Kriter sayısı yapay olarak sınırlanmaz; belgedeki bütün uygulanabilir rapor kuralları çıkarılır.

## Çalışan sağlayıcı

`app/api/analyze/route.ts` PDF'yi (ve varsa şablonu) Files API'ye yükler, `EXTRACTION_SYSTEM_INSTRUCTION` ile tek üretim çağrısı yapar, JSON şemasıyla sınırlandırılmış cevabı `normalizeExtraction()` ile doğrular ve `AnalysisResult` döndürür. Birincil/yedek/üçüncü model kademeleri ve yeniden deneme bütçesi `.env.example` içinde açıklanmıştır. Çevrimdışı sağlayıcı yoktur; anahtar yoksa uç `503` döner.
