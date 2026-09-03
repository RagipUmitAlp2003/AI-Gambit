# Kriter çıkarma iyileştirmeleri — 4 Eylül 2026

## Son ek: şartname zaman aşımı

İnsansız Deniz Aracı denemesindeki zaman aşımı bildirimi üzerine yalnızca `/api/analyze` üretim bekleme sınırı 150 saniyeden 300 saniyeye çıkarıldı. Kriter talimatı, model, düşünme ayarı, OCR ve hakem analizi süreleri değiştirilmedi; otomatik yeniden deneme eklenmedi. Tarayıcı sarmalayıcısında daha kısa bir zamanlayıcı bulunmadığı kontrol edildi. Aşağıdaki gerçek API ölçümleri bu süre değişikliğinden önce yapılmıştır; bu ek için yeni ücretli API çağrısı yapılmadı. Süre artışı servis erişilebilirliğini garanti etmez.

Branch: `faruk_merge_ve_finalsonrasi_kriter`. Commit, push veya merge yapılmadı.

## Kapsam

Yalnızca şartnameden kriter çıkarma hattı, buna ait önbellek davranışı ve testler değiştirildi. Hakemin PDF değerlendirme mantığı, hakem arayüzü, embedding, hesaplar ve veritabanı şeması değiştirilmedi. Başka branch'teki çalışmalar bu göreve alınmadı.

## Yapılanlar

- Dil/şablon, başlık/içerik, kategori ve teknik tasarım alanlarının tamamı korundu. Belirli bir kriter sayısı hedeflenmiyor.
- Aday seçimine yarışmanın amaç/kapsam anlatımı, teknik beklentiler ve rapor listesinin kısa alt maddeleri için bağlam desteği eklendi. Türkçe bölüm başlıkları arama öncesi normalize ediliyor.
- Sayfa hesabı listeleri ve yarışma eylemleri için ilgili adayın yanına açıklayıcı yorumlama ipuçları eklendi. Bu ipuçları aday silmez; tüm aday metinleri ve kaynakları modele aynen gider. Girdi yanında açıklama ile model sonrası veto birbirinden ayrıldı.
- LLM'ye PDF yerine kaynak kimliği, sayfa, orijinal aday metni ve yakın bağlam gönderilmeye devam ediliyor. Seçilmeyen parçalar kayıtta korunuyor; ikinci bir model taraması eklenmedi.
- Talimat ön eleme proje yöneticisi rolüyle düzenlendi. Tasarımın boyut, güvenlik, donanım ve çalışma modu koşulları alınırken yarışma anındaki görevler, puanlar, cezalar, idari işlemler ve final sonrası sunumlar ayrıştırılıyor.
- Video süre/format/çözünürlük/boyut sınırları haricî kanıt niteliğiyle kriter olarak kalabilir. Video yüklenmesi, varlığı veya videoda gerçekleştirilecek hareketler kriter yapılmıyor. Katılımcı PDF'inde video arayan yeni bir kontrol eklenmedi.
- Şartnamedeki içindekiler veya bölüm başlığı raporun zorunlu başlığı sayılmıyor. “Kapak ve içindekiler dahil en fazla N sayfa” ifadesinden ayrıca zorunlu başlık çıkarılmıyor. Rapor dili açıkça belirtilmemişse tahmin edilmiyor.
- Model çıktısını sonradan kelime tabanlı kapsam/aşama vetosuyla eleyen filtreler kaldırıldı. Kaynak kimliği, geçerli aşama ve birebir kaynak alıntısı doğrulaması korundu. Kaynak doğrulaması semantik doğruluk garantisi değildir.
- Zorunlu olmayan somut gereksinimler korunuyor. Bir kaynaktaki bağımsız kurallar ayrı kimlik alıyor; aynı ada sahip farklı kurallar birleşip kaybolmuyor.
- Bilinmeyen karar türü adayın cevaplandığı kabul edilmiyor. Eksik aday cevapları için mevcut başarısızlık kapısı korunuyor.
- Bilinçli yeniden analiz başarısız olduğunda önceki başarılı önbellek kaydı silinmiyor. Talimat ve aday seçici sürümleri artırıldı; eski sürüm sonuçları yeni talimatın sonucu olarak kullanılmıyor.

## Doğrulama

- Birim testleri: 327/327 geçti, atlanan test yok.
- Regresyon testleri: 9 blok geçti.
- TypeScript, lint, depo güvenlik kontrolü ve üretim derlemesi geçti.
- Aynı kaydedilmiş ham model yanıtı tekrar normalleştirildi: kriterler ve kimlikleri birebir aynı.
- Eski davranışı şart koşan anlamsal veto testleri yeni sözleşmeye göre güncellendi. Birim testleri modelin anlam doğruluğunu kanıtlıyor diye sunulmadı; bunun için ayrıca gerçek API denemeleri yapıldı.

## Canlı testin sınırı

`tools/benchmark-criteria-extraction.mjs` yalnızca `--live` ile ücretli istek yapar. Uygulamayla aynı PDF ayrıştırıcı, aday seçici, talimat, şema, tek çağrı katmanı ve normalizasyonu kullanır; hesap oluşturmaz ve profil yayımlamaz. Her koşunun girdi/ham yanıt/sonuç dosyalarını kaydeder.

Bu test gerçek Gemini API çağrısıdır; uygulamanın oturum, D1/R2 ve HTTP `/api/analyze` akışının uçtan uca testi değildir. Eski yerel yönetici test hesabıyla giriş 401 döndü; hesap değiştirilmedi. Geçerli yönetici hesabıyla tarayıcı üzerinden kabul testi ayrıca yapılmalıdır.

Normal tekrarların kararlılığı sürümlü önbelleğe dayanır. Sıcaklık 0 olsa bile bilinçli yeni LLM çağrılarında birebir aynı kriter listesi garanti edilemez. Tek bir şartname testi diğer bütün şartnamelerde eksiksizlik garantisi değildir.

## Gerçek Çelikkubbe denemeleri

Belge: `public/samples/2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf` (25 sayfa).
SHA-256: `a6c81a29f3eafbb8e861cdff2490562f37b9b3236a218efc62f807af1d86ccb9`.

PDF'nin 10–13. sayfaları ayrıca görsel olarak incelendi; diğer ilgili maddelerin orijinal metinleri kaynaklarıyla kontrol edildi. Özellikle sayfa sınırına dahil edilen parçaların zorunlu başlık anlamına gelmediği bu incelemede doğrulandı.

Son sürüm: `v43-preliminary-local-context` / `candidate-selector-v4-local-context-hints`.

| Ölçüm | Sonuç |
| --- | --- |
| Ayrıştırılan blok | 367 |
| LLM'ye gönderilen aday | 105 |
| Seçilmeyen ve kayıtta tutulan blok | 262 |
| Ham model kriteri / kabul edilen kriter | 16 / 16 |
| Kapsam dışı aday | 90 |
| Cevapsız aday / reddedilen kaynak | 0 / 0 |
| Zorunlu / zorunlu olmayan | 14 / 2 |
| Dil-şablon / başlık-içerik / kategori / teknik | 5 / 0 / 1 / 10 |
| Haricî video dosya koşulu | 2 |
| Süre / üretim isteği | 89 saniye / 1 |
| Model / düşünme düzeyi | gemini-3-flash-preview / HIGH |
| Son çağrı toplam token | 61.630 (API kullanım verisi) |

Bir aday iki video dosya kriteri ürettiği için 16 kriter 15 farklı kabul edilmiş adaydan geliyor; 15 + 90 = 105. **16 sayısı sunucunun daha fazla kriteri elemesinden kaynaklanmıyor: model 16 üretti ve 16'sı da doğrulandı.**

Kontrol edilen sonuçlar:

- ÖTR 10 sayfa ve KTR 30 sayfa kuralları ayrı kaldı.
- Sayfa sayımındaki kapak/içindekiler listesinden zorunlu başlık üretilmedi. Bu belgede açık ön eleme raporu başlık listesi bulunmadığı için başlık/içerik sayısının 0 olması tek başına eksiklik değildir; ileride yayımlanacağı belirtilen ayrı şablonun içeriği uydurulmadı.
- Açık rapor dili şartı olmadığı için dil tahmin edilmedi (`reportLanguage: null`).
- 100 cm sınırı **dış kablaj hariç** istisnasıyla korundu; kablo/elektrik yalıtımı, yasak alan fonksiyonu, gövde güvenliği, EMI, otonomluk, mod geçişi, acil durdurma ve patlayıcı yasağı kaldı.
- Video çözünürlüğü ve süresi iki haricî kanıt kriteri; video varlığı/içeriği şartı yok.
- `SAYFA-14-BLOK-018`, `SAYFA-14-BLOK-020`, `SAYFA-17-BLOK-002` yarışma eylemleri olarak gerekçeli biçimde kapsam dışı kaldı. `SAYFA-12-BLOK-009` final sonrası sunum olduğu için alınmadı.
- Son yanıtta inceleme sırasında tespit edilen önceki kapsam ve sahte başlık hataları görülmedi. Bu bir koşunun sonucudur; gelecekteki taze üretimler veya diğer yarışmalar için mutlak garanti değildir.

### İterasyon kaydı

Bu çalışma sırasında toplam **9 gerçek üretim isteği** başlatıldı; her koşu tek istektir, gizli yeniden deneme döngüsü yoktur. İki koşu 150 saniyelik zaman aşımıyla sonuçlandı. Başarısız isteklerin sağlayıcı tarafında ücretlendirilip ücretlendirilmediği bu testten anlaşılamaz.

| Sürüm/ayar | Gözlem ve sonraki düzeltme |
| --- | --- |
| v37 | 44 ham / 41 kabul; kapsam ve 3 alıntı hatası. |
| v38 | 20 ham / 18 kabul; 2 alıntı hatası ve video/final bağlamı sorunları. |
| v39 HIGH | 18/18, kaynak hatası yok; sayım listesinden yanlış başlıklar ve bir aşama sınıflandırması sorunu. |
| v40 HIGH, iki deneme | İkisi de zaman aşımı; başarı sayılmadı. |
| v40 MEDIUM | 63 saniye; 18 ham / 17 kabul. Görevden teknik kural türetme ve bir kesintili alıntı sorunu sürdü. |
| v41 HIGH | 19/19; alıntılar doğru fakat yarışma eylemlerinden üç tasarım şartı türetildi. |
| v42 HIGH | 20/20; genel talimatın uzun girdide bazı maddelerde yine uygulanmadığı görüldü. |
| v43 HIGH | 16/16; ilgili metnin yanındaki bağlam ipuçlarıyla incelenen hatalar görülmedi. |

HIGH ayarı, daha düşük ayarda görülen kapsam hataları nedeniyle korundu; 10 sayfadan kısa belgelerde varsayılan MEDIUM. Mevcut `GEMINI_THINKING_LEVEL` ortam geçersiz kılması korunuyor. 89 saniyelik son başarı gecikmenin her zaman düşük olacağını kanıtlamaz; önceki zaman aşımları bu yüzden rapordan çıkarılmadı.

Son koşunun `input.json`, `raw.json`, `result.json` dosyaları: `C:/Users/faruk/Desktop/t3/tmp/celikkubbe-v43/`. Bunlar yerel deneme çıktılarıdır; repoya commit edilmedi. Yeniden üretim: depo kökünde `node --experimental-strip-types --import ./tools/ts-resolve-hook.mjs tools/benchmark-criteria-extraction.mjs --live` (ücretli API çağrısı yapar).

Yayımlanmış kullanıcı profilleri veya eski değerlendirmeler otomatik değiştirilmedi. Yeni talimatın sonucu için yeni kriter analizi yapılmalı; mevcut profili yayımlama kararı kullanıcıya aittir.
