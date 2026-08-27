# Kalıcı analiz önbelleği

**Eklendi:** 26 Ağustos 2026 · **Uç:** `POST /api/analyze` · **Göç:** `migrations/0007_analysis_cache.sql`

Daha önce analiz edilmiş bir şartname yeniden analiz edildiğinde model **hiç çağrılmaz**:
kayıtlı sonuç 0 token ve `apiCalls: 0` ile anında döner, kriterler ekranda aynen gösterilir.
Kayıt Cloudflare D1'de durduğu için sunucu yeniden başlatılsa, dağıtım yenilense veya süreç
belleği boşalsa bile kaybolmaz. Yalnızca şartname analizi (Kriter Atölyesi) kapsamdadır;
rapor değerlendirmesi (`/api/evaluate-report`) bu belgeyi etkilemez — hakemdeki
"Analizi yenile" bilinçli bir yeniden çalıştırmadır.

## İki katman

| Katman | Yer | Ömür | Sınır |
|---|---|---|---|
| Süreç belleği | `globalThis` içindeki `Map` | Süreç yaşadıkça | 12 kayıt (FIFO) |
| Kalıcı kayıt | D1 · `criteria_analysis_cache` | Süresiz | 200 satır (LRU, `last_used_at`) |

Okuma sırası: bellek → D1 → uçuş içi istek → taze analiz. D1 isabeti belleğe de yazılır;
bellekten sunulan her isabet D1'deki `last_used_at`/`use_count` değerini tazeler ki satır
sınırı budaması en sık kullanılan belgeyi silemesin.

## Önbellek anahtarı

Anahtar, şu bağlamın SHA-256 özetidir; **dosya adı değil belge içeriği** esastır:

```
{ promptVersion: EXTRACTION_PROMPT_VERSION,   // istem sürümü
  document:      sha256(PDF baytları),        // şartnamenin GERÇEK içerik özeti
  model:         GEMINI_MODEL,                // kullanılan model
  mediaResolution,                            // medya/çözünürlük ayarı
  thinking,                                   // düşünme bütçesi
  maxOutputTokens, temperature,               // analiz yapılandırması
  pageCount }                                 // sayfa sayısı
```

Aynı PDF farklı adla yüklense de isabet eder. Talimat/şema (`EXTRACTION_PROMPT_VERSION`),
model, görüntü çözünürlüğü, düşünme kademesi veya sayfa sınırı değişirse anahtar doğal
olarak eşleşmez ve belge **bir kez** yeniden analiz edilip yeni ayarla kaydedilir; ayrı bir
temizleme adımı gerekmez.

## Tablo

```sql
CREATE TABLE IF NOT EXISTS criteria_analysis_cache (
  cache_key            TEXT PRIMARY KEY,  -- yukarıdaki bağlam özeti
  document_hash        TEXT NOT NULL,     -- belge içeriğinin SHA-256'sı
  source_document_name TEXT NOT NULL,
  model                TEXT NOT NULL,
  page_count           INTEGER NOT NULL,
  raw_json             TEXT NOT NULL,     -- modelin şemalı HAM çıktısı
  created_at           TEXT NOT NULL,     -- ilk analiz zamanı
  last_used_at         TEXT NOT NULL,
  use_count            INTEGER NOT NULL DEFAULT 1
);
```

Ham çıktı saklanır; **normalizasyon her okumada yeniden çalışır**. Böylece normalizasyon
iyileştirmeleri eski kayıtlara da geriye dönük uygulanır. Uygulama şeması
`app/lib/workflow-db.ts · WORKFLOW_SCHEMA` üzerinden aynı tabloyu tembel oluşturur;
göç dosyası kayıt ve elle çalıştırma içindir.

## Cevap sözleşmesi (isabet)

İsabette `AnalysisResult` normal biçimiyle döner; fark yalnızca tanılamadadır:

```json
"diagnostics": { "totalMs": 71, "modelMs": 0, "promptTokens": 0, "outputTokens": 0,
                 "cached": true, "apiCalls": 0, "documentTransfers": 0,
                 "cacheStore": "database", "firstAnalyzedAt": "2026-08-26T15:31:53.652Z" }
```

- `cacheStore`: `"memory"` (süreç içi) veya `"database"` (D1 kaydı).
- `firstAnalyzedAt`: belgenin modelle İLK analiz edildiği an; arayüz notunda gösterilir.
- Kullanım ölçümüne (`recordUsage`) isabet `cached: true, apiCalls: 0` olarak yazılır; sayı uydurulmaz.

Arayüz (Kriter Atölyesi, 2. adım) isabette şu notu gösterir:
*"Bu şartname daha önce analiz edilmişti (ilk analiz: …). Kayıtlı sonuç gösterildi;
yapay zekâ yeniden çalıştırılmadı ve token harcanmadı."* Not, yayımlanmış profil
düzenlenirken gösterilmez ve yeni belge seçiminde sıfırlanır.

## Koruma kuralları

1. **Boş sonuç kalıcılaşmaz.** Normalizasyon en az bir kriter üretmeyen (ya da nesne
   olmayan) çıktı hiçbir katmana yazılmaz; sonuç yine döner ama "Yeniden dene" dendiğinde
   model gerçekten yeniden çalışır. Aksi hâlde bozuk bir çıktı belgeyi kalıcı olarak
   0 kritere kilitlerdi.
2. **Okunan kayıt da süzülür.** D1'den gelen kayıt çözümlenemiyorsa veya 0 kriter
   üretiyorsa isabet sayılmaz; belge yeniden analiz edilir ve kayıt üzerine yazılır.
3. **Uçuş içi birleştirme.** Aynı belge şu anda başka bir istekte analiz ediliyorsa ikinci
   istek modele gitmez; ilkinin sonucunu bekler ve önbellek gibi sunulur. İlk istek
   başarısız biterse bekleyen istek kendi analizini başlatır. Kayıt izolat yereldir;
   izolatlar arası eşzamanlılıkta D1 `ON CONFLICT` verinin bozulmamasını garanti eder
   (yalnızca çift maliyet olasılığı kalır).
4. **`JSON.parse("null")` kapanı.** Nesne olmayan gövde 502 ile reddedilir; önbelleğe
   giremez.
5. **"Yeniden analiz et".** Yarışma Yöneticisi hem 1. adımda hem de önbellek notunun
   yanında bu seçeneği görür. İstek `refresh=1` ile gider; bellek kaydı silinir, D1
   kaydı `deleteStoredAnalysis` ile kaldırılır, uçuş içi birleştirme atlanır ve model
   GERÇEKTEN yeniden çalışır. Yeni sonuç eski kaydın üzerine yazılır. Böylece eski ama
   hatalı bir sonuç sistemde sonsuza kadar kalamaz.
6. **Ayar değişikliği eski kaydı geçersiz kılar.** İstem sürümü, model, çözünürlük,
   düşünme bütçesi, çıktı tavanı, sıcaklık veya sayfa sayısı değişirse anahtar
   eşleşmez; belge bir kez yeniden analiz edilir. Ayrı bir temizleme adımı gerekmez.
7. **Aynı veri şeması.** Önbellekten dönen sonuç ile taze sonuç BİREBİR aynı
   `AnalysisResult` şemasını kullanır; yalnızca `diagnostics` alanları farklıdır
   (`cached: true`, `apiCalls: 0`, `cacheStore`, `firstAnalyzedAt`). Normalizasyon her
   okumada yeniden çalıştığı için ham çıktı saklanır, işlenmiş sonuç değil.

## Canlı doğrulama (İDA şartnamesi · 29 sayfa · 1,8 MB)

| Koşu | Süre | Token | apiCalls | Sonuç |
|---|---|---|---|---|
| İlk analiz | 28,4 sn | 14.055 | 1 | 26 kriter |
| Sunucu yeniden başlatıldıktan sonra aynı belge | 1,5 sn | 0 | 0 | `cacheStore: "database"` · kriterler birebir aynı |
| Aynı süreçte ikinci istek | 0,4 sn | 0 | 0 | `cacheStore: "memory"` |

Arayüz notu tarayıcıda doğrulandı. Değişiklik ayrıca 3 mercekli (eşzamanlılık, D1/SQL,
UI sözleşmesi) bağımsız incelemeden geçirildi; 4 doğrulanmış bulgunun tamamı düzeltildi
(yukarıdaki koruma kuralları 1–3 ve arayüz notu kapılaması bu incelemenin sonucudur).

## Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `app/api/analyze/route.ts` | İki katmanlı okuma, `cacheableExtraction` süzgeci, uçuş içi birleştirme, bellek isabetinde D1 tazeleme, `cacheStore`/`firstAnalyzedAt` tanılaması |
| `app/lib/workflow-db.ts` | `criteria_analysis_cache` şeması; `findStoredAnalysis`, `saveStoredAnalysis`, `touchStoredAnalysis` |
| `app/lib/types.ts` | `AnalysisDiagnostics.cacheStore` ve `firstAnalyzedAt` alanları |
| `app/components/criteria-app.tsx` | İsabet notu (`cacheNotice`), sıfırlama ve kapılama kuralları |
| `migrations/0007_analysis_cache.sql` | Tablo + tazelik indeksi (kayıt ve elle çalıştırma için) |
