# Kriter önceliği, kontenjan ve hız — 4 Eylül 2026

## Sonuç

Temel gereklilikleri önce çıkaran, teknik üretimi kalan kontenjanla sınırlayan akış uygulandı. Son sürümle gerçek Gemini çağrıları Çelikkubbe için **22,239 saniye**, Deniz Aracı için **43,236 saniye** sürdü. Bu ölçümler başarılı tekil denemelerdir; sağlayıcı gecikmesi için süre garantisi değildir. **Kapsam doğruluğunda kalan hatalar var; bütün kriterlerin doğru olduğu veya işin bu yönünün tamamlandığı iddia edilmiyor.**

Çalışılan depo: `C:\Projects\AI-Gambit`, branch: `faruk_merge_ve_finalsonrasi_kriter`. Commit, push ve merge yapılmadı. Önceden bulunan arkadaş entegrasyonu ve diğer çalışma ağacı değişiklikleri korundu.

## Uygulanan akış

1. Mevcut PDF ayrıştırma, sözlük/regex/sayı-birim taraması ve aday seçimi korunur. Adayların özgün metni, kimliği ve kaynak bağlamı modele gönderilir; PDF'yi yeniden okuması istenmez.
2. Seçilmiş **bütün adaylar** önce dil/şablon, beklenen başlık/içerik ve kategori gereklilikleri için incelenir. Kaynakta olmayan dil, başlık veya kategori koşulu uydurulmaması istenir. Her alanın mutlaka dolu olması garanti edilmez.
3. Bu geçiş ayrıca teknik koşul içeren kaynak kimliklerini kısa bir listede döndürür; teknik kriterlerin uzun açıklamalarını henüz üretmez.
4. Temel kriterler kaynak doğrulaması ve mevcut tekrar temizliğinden geçirilir. Teknik kontenjan `max(0, 28 - temel kriter sayısı)` olarak hesaplanır.
5. Teknik adaylar en fazla iki küçük grup halinde paralel işlenir; kalan kontenjan çağrılara başlamadan paylaştırılır. Örneğin 6 temel kriter varsa iki gruba 11'er teknik kriter kontenjanı verilebilir. Geçerli toplam 28'e ulaştığında sonraki teknik gruplar çağrılmaz.
6. 28 hedef değildir. Gerçek koşullar daha azsa daha az kriter döner. Normalleştirici de teknik taşmayı sınırlar. **Temel kriterler tek başına 28'i aşarsa temel koşulları kaybetmemek için korunur, teknik üretim yapılmaz**; bu durum uyarıyla bildirilir.
7. Kontenjan nedeniyle ayrıntısı üretilmeyen kaynaklar `TEKNIK_LIMIT` ile ayrılır. Gerçek kapsam dışı olanlarla karıştırılmaz. `KAPSAM_DISI` için açıklama üretilmez.
8. Kesilmiş JSON, cevapsız aday, yabancı kaynak kimliği veya başarısız çağrı tamamlanmış analiz olarak kaydedilmez. Kaynak alıntısı doğrulanamayan kriterler mevcut korumayla elenir ve uyarı verilir.

Bu mekanizma tek bir LLM yanıtını 28'inci kriterde dışarıdan kesmez. Erken durma, **sonraki teknik API çağrılarını başlatmayarak** uygulanır. Bütün temel adayların taranması yine yapılır.

## Süre ve model ayarları

- Önceki toplam **80 saniyelik uygulama kesmesi kaldırıldı**. Tek ağ isteği için 180 saniyelik sonlu güvenlik zaman aşımı durur; bu, normal hedef süre değildir.
- Temel çıkarım/yönlendirme **LOW**, teknik üretim **MEDIUM** kullanır. Önceki her geçiş MEDIUM yaklaşımından bilinçli ayrılıştır: gerçek MEDIUM denemeleri 109–155 saniyeye uzadı, bir deneme de geçersiz API yanıtıyla başarısız oldu. Bu ayar değişikliği kullanıcıya çalışma sırasında bildirildi.
- Model sağlayıcısı ve `GEMINI_MODEL` değiştirilmedi; denemelerde `gemini-3-flash-preview` kullanıldı. Hakem ve embedding ayarlarına bu görevde dokunulmadı.
- Gemini 3 için sıcaklık 1 kullanılır; `topP` zorlanmaz. Google, 1'in altındaki sıcaklığın döngü ve performans sorunlarına yol açabileceğini belirtiyor: [resmî Gemini 3 kılavuzu](https://ai.google.dev/gemini-api/docs/generate-content/gemini-3). Önceki yavaşlığın tek nedeni sıcaklıktı denemez; grup boyutu, yanıt yapısı ve düşünme yükü de değişti.
- Temel gruplar en fazla 32 aday / 24.000 karakter, üç eşzamanlı işçi ile çalışır. Biten işçi bir sonrakini hemen alır; yavaş kardeşin bitmesini beklemez. Teknik gruplar en fazla 12 aday / 12.000 karakterdir. Tek büyük kaynak metni sessizce kesilmez.
- `MAX_TOKENS` olursa yalnızca ilgili grup bölünür. 429/503 için gizli tekrarlı çağrı zinciri yoktur. Çağrı/çıktı güvenlik bütçeleri korunur.
- Yeni yürütme sürümü: `core-first-v7-low-core-medium-technical`; prompt sürümü: `v45-core-first-total-28`. Önbellek anahtarı sürüm ve düşünme/sıcaklık ayarlarını içerir. Eski ayarlı sonuç yeni sürümün sonucuymuş gibi kullanılmaz. Aynı yeni sürümün başarılı kaydı daha sonra 0 model çağrısıyla kullanılabilir.

## Gerçek belge denemeleri — teslim edilen v7

| Belge | Sayfa | Seçilmiş aday | Süre | Kriter | API çağrısı |
| --- | ---: | ---: | ---: | ---: | ---: |
| Çelikkubbe | 25 | 105 | 22,239 sn | 19 | 7 |
| İnsansız Deniz Aracı | 29 | 166 | 43,236 sn | 28 | 10 |

- İkisinde de cevapsız aday sayısı **0**. İkisinde de birer kaynak alıntısı doğrulanamadığı için ilgili sonuç elendi; sessizce kabul edilmedi.
- Deniz Aracı'nda 34 kaynak maddesinin teknik ayrıntısı kontenjan nedeniyle tamamlanmadı. Çelikkubbe 28'e tamamlanmadı.
- Ölçülen toplam token kullanımı: Çelikkubbe 83.152; Deniz Aracı 123.499. Bunlar birden fazla çağrının toplamıdır; hız kazanımı ücretsiz değildir. Parçalarda talimat ve bağlam tekrar gönderilir.
- Önceki ara sürümlerde 120 saniyeyi aşan denemeler ve başarısız API yanıtı görüldü. Bu rapor bunları nihai sürümün başarılı örnekleriyle gizlemiyor. İki son deneme p95/yoğunluk testi değildir.
- Test, uygulamanın kullandığı aynı `generatePrioritizedCriteria` hattını gerçek PDF ve gerçek Gemini API'siyle çalıştırır. Tarayıcı, oturum, HTTP rotası ve D1/R2 üzerinden tam uçtan uca kullanıcı simülasyonu değildir. Test kullanıcıları, profiller veya başvurular oluşturulmadı.
- Ham yanıt ve normalize sonuçlar: `outputs/criteria-priority-celikkubbe-v7/result.json` ve `outputs/criteria-priority-deniz-v7/result.json`. Bu çıktılar Git dışında bırakılan yerel test artefaktlarıdır.
- Yeniden üretim: `node --experimental-strip-types --import ./tools/ts-resolve-hook.mjs tools/benchmark-criteria-priority.mjs --live --out outputs/yeni-deneme`. Deniz Aracı için ayrıca `--pdf output/pdf/official/2026_Insansiz_Deniz_Araci_Sartnamesi.pdf` verilir. `--live` gerçek ve ücretli model çağrısıdır.

## Sonuç okumasında kalan hatalar

**Bunlar hız testi veya birim testinin geçtiği söylenerek kapanmış sayılmadı:**

- Çelikkubbe'de ÖTR sayfa sınırı komşu iki kaynaktan farklı açıklamayla iki kez çıktı. Mevcut birebir tekrar temizliği anlamsal tekrarları bütünüyle yakalamıyor.
- Çelikkubbe'de “Yarışma Görev Kapsamı” kategoriye, boyut puan tablosundaki 60 cm avantajı teknik koşula taşındı. Gerçek 100 cm boyut şartıyla puan avantajı ayrı şeylerdir.
- Deniz Aracı'nda video yayın platformu, final sunumu içeriği ve bazı yarışma görevleri hâlâ temel kriterlere girebildi. Bunlar talimatta dışlandığı halde model her zaman uymuyor.
- Kaynak alıntısının doğru olması, kriterin kapsam/sınıflandırma kararının doğru olduğunu garanti etmiyor. Sonuçların yönetici tarafından doğrulanması gerekmeye devam ediyor.
- Düşük düşünme ve kısıtlı teknik üretim kalite/hız ödünleşimidir. Tüm temel kriterlerin anlamsal olarak eksiksiz bulunması LLM talimatıyla kesin garanti edilemez; kod, seçilmiş her aday için yanıt ve temel-geçiş önceliğini denetler.
- Mevcut otomatik seçicinin hiç aday seçmediği parçalar için yeni bir LLM kurtarma taraması eklenmedi. Bu görevde seçicinin kapsamı değiştirilmedi.

## Kod doğrulaması

- `npx tsc --noEmit`: geçti.
- `npm run lint`: geçti.
- `npm run test:unit`: **366/366** geçti.
- `npm run test:regressions`: 9 blok geçti. Buradaki `test-model` 503 satırı kasıtlı hata senaryosudur.
- `npm run build`: üretim derlemesi tamamlandı; repo güvenliği kontrolü geçti.
- `git diff --check`: geçti (mevcut LF/CRLF bilgilendirmeleri var).
- Yeni testler: son sayfadaki temel kriter önceliği, 6+22 kontenjan paylaşımı, 15 sonucu 28'e tamamlamama, temel >28 istisnası, karma aday, geçersiz alıntı/tekrar, eksik veya yanlış alanlı model yanıtı, kısmi başarının saklanmaması, paralel havuz sırası ve başlamış çağrıların hesaplanması.

Ana uygulama dosyaları: `app/lib/criteria-priority.ts`, `app/lib/criteria-generation.ts`, `app/lib/criteria-extraction.ts`, `app/api/analyze/route.ts`. Hakem değerlendirme mantığı, embedding, arayüz, giriş kolaylıkları ve veritabanı mimarisi bu hız/öncelik görevi için değiştirilmedi. Sites yönergeleri yerel uygulama sınırını korumak için kullanıldı; yayınlama yapılmadı.
