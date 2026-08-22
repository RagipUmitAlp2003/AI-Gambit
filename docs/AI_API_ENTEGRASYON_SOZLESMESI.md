# Gemini API Entegrasyon Sözleşmesi

Bu belge, çalışan Gemini belge analizi akışının veri biçimini ve değişmez ilkelerini tanımlar.

## Güvenlik ilkesi

API anahtarı hiçbir zaman `app/components` veya tarayıcıya gönderilen başka bir dosyaya yazılmamalıdır. Anahtar yalnızca sunucu ortam değişkeninde tutulmalı ve analiz isteği sunucu üzerinden yapılmalıdır.

## Analiz isteği

Tarayıcı, sunucuya PDF dosyasını, sayfa sayısını ve şu profil bağlamını `multipart/form-data` olarak gönderir:

```json
{
  "profileContext": {
    "competition": "Akıllı Ulaşım Sistemleri Yarışması",
    "category": "Üniversite Seviyesi",
    "stage": "Ön değerlendirme",
    "reportType": "Ön Tasarım Raporu (ÖTR)",
    "year": "2026",
    "managerRules": {
      "allowedFormats": ["PDF"],
      "maxFileSizeMb": 25,
      "maxFileCount": 1,
      "defaultViolationAction": "block"
    }
  },
  "document": "degerlendirme-kilavuzu.pdf"
}
```

## Beklenen analiz cevabı

```json
{
  "criteria": [
    {
      "name": "Teknik Tasarım Yeterliliği",
      "type": "qualitative_score",
      "maxScore": 25,
      "weight": 25,
      "required": true,
      "violationOutcome": "Gerekçeli puan önerisi oluştur",
      "evaluationMethod": "hybrid",
      "sourcePage": 12,
      "sourceText": "Teknik Tasarım Yeterliliği - 25 puan...",
      "aiInterpretation": "Mimari, bileşen seçimi ve test edilebilirlik birlikte değerlendirilir.",
      "confidence": "high",
      "issue": null
    }
  ],
  "skippedChecks": ["Yazı tipi", "Punto"],
  "informationalNotes": [
    "Genel amaç cümlesi açık bir puan kriteri olmadığı için kriter yapılmadı."
  ],
  "conflicts": []
}
```

## İzin verilen türler

- `technical_upload`: Dosya biçimi, boyutu ve adedi
- `format_rule`: Sayfa sayısı, sayfa boyutu, kenar boşluğu gibi düzen kuralları
- `mandatory_content`: Raporda bulunması gereken bölüm veya açıklamalar
- `qualitative_score`: Puanlanan anlamsal kriterler
- `elimination_review`: Otomatik karar verilmeyen eleme incelemesi
- `formula`: Aşamaların veya puanların hesaplama formülü
- `human_only`: Belgeden ölçülemeyen, yalnızca jüriye ait kriter

## Yapay zekâ için değişmez kurallar

1. Belgede bulunmayan puan, ağırlık veya zorunluluk uydurulmaz.
2. “Belirtilmemiş” ile “uygun değil” birbirinden ayrılır.
3. Her belge kaynaklı kriterin sayfa numarası ve ilgili metni bulunur.
4. Genel açıklama ve temenniler, açık değerlendirme bağlantısı yoksa kriter yapılmaz.
5. Eleme maddeleri normal puan kriterine çevrilmez.
6. Fiziksel test, canlı sunum veya doğrulanamayan iddialar `human_only` ya da `hybrid` olarak işaretlenir.
7. Yönetici ayarı ile belge çelişirse sessiz seçim yapılmaz; `issue` alanı doldurulur.
8. Çıkarım kesin değilse güven seviyesi düşürülür ve yönetici onayı istenir.

## Çalışan sağlayıcı

`app/api/analyze/route.ts` PDF'yi Gemini'ye doğal belge girdisi olarak iletir, JSON şemasıyla sınırlandırılmış sonucu doğrular ve yöneticinin önceden verdiği teknik teslim kurallarıyla birleştirir. `app/lib/demo-analyzer.ts` yalnızca çevrimdışı karşılaştırma için korunur.
