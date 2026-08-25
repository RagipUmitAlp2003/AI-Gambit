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
| `templateFile` | File (isteğe bağlı) | Ayrı resmî rapor şablonu PDF'si. |
| `templatePageCount` | string (isteğe bağlı) | Şablonun sayfa sayısı. |

İstemci ayrı bir ayar formu göndermez; yarışma, kategori, aşama, rapor türü, dil ve teslim sınırları belgeden çıkarılır.

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
  "templateProfile": {
    "provided": true,
    "name": "KTR_Sablonu.pdf",
    "pages": 6,
    "requiredHeadings": ["Özet", "Sistem Mimarisi", "Test Planı"],
    "notes": ["Times New Roman 12 punto", "2,5 cm kenar boşluğu"]
  },
  "criteria": [
    {
      "name": "KTR azami 30 sayfa",
      "stage": "language_template",       // language_template | headings_content | category_similarity | criteria_evidence
      "required": true,                    // Zorunlu → true, Diğer → false
      "description": "Kritik Tasarım Raporu ekler hariç en fazla 30 sayfa olmalıdır; raporun sayfa sayısı kontrol edilir, aşılırsa değerlendirmeye alınmaz.",
      "violationOutcome": "Değerlendirmeye alınmaz",   // yoksa "Belgede belirtilmemiş"
      "sourcePage": 12,                    // PDF dosyasındaki 1 tabanlı sıra; basılı etiket değil
      "sourceText": "KTR en fazla 30 sayfa olmalıdır."
    }
  ],
  "excludedRules": [
    { "name": "Görev 2 seyir puanı", "reason": "Saha aşaması puanlaması", "sourcePage": 19 }
  ]
}
```

## Dört aşama

| `stage` | Aşama | Kriter olarak ne çıkarılır |
| --- | --- | --- |
| `language_template` | Dil ve Şablon Uygunluğu | Rapor dili; sayfa sınırı, punto, kenar boşluğu, kapak, dosya adı/türü/boyutu, sayfa düzeni. |
| `headings_content` | Başlık ve İçerik Kontrolü | Raporda bulunması zorunlu her başlık için ayrı kriter; açıklama altındaki içeriğin ne olması gerektiğini söyler. Şablon verildiyse başlıklar ondan alınır. |
| `category_similarity` | Kategori Uygunluğu ve Benzerlik | Konu, seviye ve kapsamın kategoriye uygun sayılması için belgede yazan koşullar; açık özgünlük/intihal kuralı. Benzerlik karşılaştırmasını sistem kendisi yapar. |
| `criteria_evidence` | Kriter Bazlı Kanıt Çıkarma | Raporda kanıtlanması gereken her teknik kural (tasarım kısıtı, zorunlu analiz/hesap/test planı, güvenlik ve sistem gereksinimi, teslim edilecek çizim/tablo). |

## Sunucu normalizasyonu ve uç nokta cevabı

`normalizeExtraction()` ham cevabı doğrular ve `AnalysisResult` üretir:

- Adı veya kaynak alıntısı boş kriter alınmaz; tanınmayan `stage` değeri `criteria_evidence`'a düşer.
- Aynı aşamada aynı ad + sayfa veya aynı alıntı metnine sahip tekrarlar birleştirilir.
- `sourcePage` PDF sınırı dışındaysa kriter silinmez; sayfa `null` yapılır ve uyarı yazılır (yönetici düzeltir).
- Liste aşama sırası ve kaynak sayfasına göre dizilir; kimlikler `criterion-1 … n` olarak yeniden verilir. Üst sınır 400 kriterdir.
- `excludedRules` sayısı ve boş kriter listesi `analysisWarnings` içinde raporlanır.

```jsonc
{
  "setup": { "competition": "…", "category": "…", "stage": "…", "reportType": "…", "year": "…",
             "allowedFormats": ["PDF"], "maxFileSizeMb": 25, "maxFileCount": 1,
             "defaultViolationAction": "block", "reportLanguage": "Türkçe" },
  "templateProfile": { "provided": true, "name": "…", "pages": 6, "requiredHeadings": ["…"], "notes": ["…"] },
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

Önbellek anahtarı `EXTRACTION_PROMPT_VERSION`, belge karması, şablon karması ve model adından türetilir; aynı belge aynı talimat sürümüyle tekrar analiz edilirse model çağrılmaz. Talimat veya şema değiştiğinde `EXTRACTION_PROMPT_VERSION` artırılır.

## Yapay zekâ için değişmez kurallar

1. Belgede açıkça bulunmayan kural, zorunluluk, istisna veya ihlal sonucu üretilmez.
2. "Belirtilmemiş" ile "uygun değil" birbirinden ayrılır; belge sessizse değer uydurulmaz.
3. Her kriterin PDF sayfa sırası ve özgün dilde birebir kısa alıntısı bulunur; çeviri, özet veya yorum `sourceText` olamaz.
4. Amaç, tanım, örnek, tavsiye ve genel açıklamalar açık bir rapor gerekliliği doğurmuyorsa kriter yapılmaz.
5. Puan tabloları, ağırlıklar, cezalar, barajlar, puanlama sistemleri ve saha/fiziksel aşama maddeleri kriter yapılmaz; `excludedRules` içinde kısaca listelenir. Aynı maddede hem rapor gerekliliği hem saha koşulu varsa yalnızca rapor gerekliliği kriter olur.
6. `required` yalnızca belge "zorunlu / olmalıdır / şarttır / gereklidir / aksi hâlde değerlendirilmez" diyorsa `true`; tavsiye veya beklenti `false`.
7. Tablo, açıklama ve dipnotta tekrarlanan kural bir kez çıkarılır; bağımsız sonuç doğuran maddeler tek kriterde eritilmez.
8. Güven seviyesi, olasılık veya "emin değilim" ifadesi üretilmez; dayanağı olmayan kural hiç yazılmaz.
9. Kriter sayısı yapay olarak sınırlanmaz; belgedeki bütün uygulanabilir rapor kuralları çıkarılır.

## Çalışan sağlayıcı

`app/api/analyze/route.ts` PDF'yi (ve varsa şablonu) Files API'ye yükler, `EXTRACTION_SYSTEM_INSTRUCTION` ile tek üretim çağrısı yapar, JSON şemasıyla sınırlandırılmış cevabı `normalizeExtraction()` ile doğrular ve `AnalysisResult` döndürür. Birincil/yedek/üçüncü model kademeleri ve yeniden deneme bütçesi `.env.example` içinde açıklanmıştır. Çevrimdışı sağlayıcı yoktur; anahtar yoksa uç `503` döner.
