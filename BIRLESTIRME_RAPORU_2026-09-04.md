# Dosya bazlı birleştirme — 4 Eylül 2026

## Kapsam ve kaynaklar

- Çalışılan dal: `faruk_merge_ve_finalsonrasi_kriter`; başlangıç kaydı: `3450b43`.
- Aktarılan dal: `origin/furkan_faruk_v1_bugfixing`; sabit kaynak: `8895f191c936ebb17338153b554d700a0bed408d`.
- Ortak taban: `d6b43ebecd9642d65386bb06d01a91acaab3c388`.
- Git merge/cherry-pick/checkout kullanılmadı. Değişiklikler dosya yamalarıyla aktarıldı; commit/push yapılmadı.
- Ortak değişen `tools/authorization.test.ts` dosyasında iki dalın ilgili testleri korundu.

## Aktarılan işlevler

- Hakem düzenleme formu: ayrı sonuç/dayanak grupları, küçük ve klavyeyle kullanılabilir seçenekler, tam genişlikte açıklama/alıntı, sayfa aralığı kontrolü.
- Kriter kararlarının sunucuda taslak kaydı; kesin karar ile taslak ayrımı.
- Kriter analizi benzerliği beklemeden kaydediliyor; benzerlik sonradan ayrı işlemle iliştiriliyor. Benzerlik hata/kısmi/boş havuz durumları ayrı gösteriliyor.
- Benzerlik metninde kapak, numaralı kaynakça/içindekiler ve tekrarlanan altbilgi ayıklaması; işlem sürümü güncellemesi.
- Kaynak dalın testleri, README değişiklikleri ve iki değişiklik raporu aktarıldı. Bu raporlardaki önceki deneyler bu oturumda yeniden yapılmış sayılmaz.

## Kriter çıktısındaki sınırlı değişiklik

`EXTRACTION_PROMPT_VERSION` artık `v44-compact-exclusions`.

Kapsam dışı karar yalnızca şu iki alanı içerir:

```json
{"sourceId":"SAYFA-05-BLOK-001","result":"KAPSAM_DISI"}
```

Gerekçe ve boş kriter alanları istenmez. KRITER kararında mevcut kaynak sayfası, birebir alıntı, açıklama, aşama, zorunluluk ve diğer alanlar zorunlu kalır. İki karar türü JSON Schema `anyOf` ile ayrılır; kapsam dışı tür ek alan kabul etmez. Bu yapı [Gemini yapılandırılmış çıktı belgelerindeki koşullu şema yaklaşımıyla](https://ai.google.dev/gemini-api/docs/structured-output) uyumludur.

Aday seçimi, dört alanın kapsam kuralları, teknik kriterlerin korunması, isteğe bağlı kriterler, video dosya özelliği istisnası ve kaynak doğrulaması değiştirilmedi. Her aday yine cevaplanmalıdır; eksik kapsam başarı sayılmaz. Eski gerekçeli cevapların okunması korunur.

Eski kalıcı önbellekler silinmedi. Sürüm anahtarı değiştiği için yeni istemle ilk analiz tekrar hesaplanabilir; aynı sürümde sonraki tekrarlar mevcut önbellek mekanizmasını kullanır. Çıktının küçülmesi token taşması riskini azaltmayı amaçlar; canlı model denenmediği için belirli bir belgenin artık kesin tamamlanacağı iddia edilmez.

## Birleştirme sırasında eklenen korumalar

- Hızlı hakem kararları istemcide sıraya alınır; nihai karar taslak kayıtlarını bekler.
- Taslak damgası nihai kararda da kontrol edilir. Sunucu taslağın analiz/PDF/kriter sürümünü doğrular ve kendi kapsam bilgisini yazar.
- SQL yazımı eski taslağı karşılaştırarak günceller; iki sekmenin aynı eski kaydı okuması halinde ikinci yazım reddedilir. Başarısız yazım sonuç tablosunu da değiştiremez.
- Yazım anında atama, belge/analiz sürümü ve yarışma kilidi tekrar kontrol edilir.
- Geç gelen benzerlik yanıtı istemcide tüm başvuruyu değiştirmez; yalnız aynı analizin benzerlik alanını günceller. Hakem taslağı ve başvuru durumu korunur.
- İlk taslak kaydındaki durum değişimi formu yeniden oluşturup açık çalışmayı sıfırlamaz.

Hakem AI kriter–PDF değerlendirme mantığı, admin kolaylıkları, hesaplar, kayıtlı veriler, model sağlayıcısı ve mimari değiştirilmedi. `app/api/analyze/route.ts`, `app/lib/criteria-candidates.ts` ve `app/api/evaluate-report/route.ts` başlangıç kaydına göre aynıdır.

## Bu oturumdaki doğrulama

| Kontrol | Sonuç |
|---|---|
| `npx.cmd tsc --noEmit --incremental false` | PASS |
| `npm.cmd run lint` | PASS |
| `npm.cmd run test:unit` | 347/347 PASS |
| `npm.cmd run test:regressions` | 9 blok PASS |
| `npm.cmd run build` | PASS; öncesindeki depo güvenlik kontrolü de PASS |
| `git diff --check` | PASS |

Yeni 4 birleştirme regresyonu bellek içi SQLite üzerinde üretimde kullanılan SQL'i çalıştırır. Gerçek uygulama veritabanı kullanılmaz. Birim testlerinin model yanıtları sahtedir; gerçek API çağrısı yapılmaz.

Impeccable yönergeleri doğrultusunda arayüz değişiklikleri mevcut tasarıma kapsamlı tutuldu. Statik tasarım taraması mevcut renk/punto/kenar vurguları için uyarılar verdi; bu görev bağımsız yeniden tasarım olmadığı için bunlar değiştirilmedi. Tarayıcı görsel testi, uçtan uca simülasyon, canlı Gemini/embedding analizi, veri sıfırlama ve yayınlama yapılmadı.
