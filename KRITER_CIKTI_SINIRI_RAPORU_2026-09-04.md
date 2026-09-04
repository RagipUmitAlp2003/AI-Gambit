# Kriter üretiminde çıktı sınırı düzeltmesi

> Bu belge tarihsel ara sürüm raporudur. Aşağıdaki 80 saniye ve her geçiş MEDIUM ayarları artık kullanılmıyor. Geçerli akış, canlı ölçümler ve kalan sorunlar için [Kriter önceliği ve hız raporuna](KRITER_ONCELIK_VE_HIZ_RAPORU_2026-09-04.md) bakın.

## Önceki hız güncellemesi — artık geçerli olmayan ayarlar

Aşağıdaki ilk sürüm açıklamasındaki sıralı çalışma ve 10 dakika bütçesi artık geçerli değildir.

- Şartname çıkarımı daima `MEDIUM` kullanır; eski `GEMINI_THINKING_LEVEL=HIGH` bunu değiştirmez. Hakem ve embedding model ayarları değişmez.
- En fazla iki grup aynı anda çalışır. Başlamış iki çağrının kullanım bilgileri, biri başarısız olsa bile birlikte toplanır.
- Gruplar ters sırada bitse veya bölünse de kararlar orijinal kaynak sırasına göre birleştirilir.
- Model işlem bütçesi toplam 80 saniyedir; PDF çıkarımı, OCR ve kayıt süreleri bu bütçeye dahil değildir. Süre sınırı, 80 saniyede başarılı sonuç garantisi değildir. Süre dolarsa eksik sonuç kaydedilmeden hata döner.
- Yürütme sürümü `bounded-batches-v2-medium-parallel`; başarılı tekrarlar sürümlü önbelleği kullanmaya devam eder.
- Aday seçimi, kriter kapsamı ve kaynak doğrulaması değiştirilmedi. Daha düşük düşünme düzeyinin kalite/süre etkisi canlı modelle bu oturumda ölçülmedi.
- Paralellik, kararlı sonuç sırası ve sabit MEDIUM ayarı için testler eklendi.

## Neden kısa belge de başarısız olabiliyordu?

Önceki akış seçilen bütün adayların kararlarını tek `generateContent` cevabına sığdırıyordu. PDF sayfa sayısı çıktı uzunluğunu belirlemez: adayların yoğunluğu, bir adaydan çıkan bağımsız kriterler ve modelin ürettiği cevabın uzunluğu farklı olabilir. `MAX_TOKENS` dosyanın bozuk olduğunu veya ağ zaman aşımını değil, modelin çıktı sınırında durduğunu bildirir.

Önceki hata yolunda sınıflandırma çağrısının tokenları kayda eklenmiyor, yalnız OCR tokenları yazılıyordu. Bu nedenle kullanıcının son başarısız denemesinin ayrıntılı token dağılımı mevcut kayıtlarla kesinleştirilemedi. Yeni yürütücü her cevabın bitiş nedenini, aday sayısını, çıktı ve düşünme tokenlarını içerik/anahtar sızdırmadan kaydeder; başarısız çağrılar da toplama dahildir.

## Değişen: üretimin yürütülmesi

- Adaylar en fazla 24 aday ve yaklaşık 24.000 karakterlik gruplara ayrılır. Tek başına büyük bir aday kesilmez veya atılmaz.
- Aynı model, düşünme ayarı, sistem talimatı, belge bağlamı ve adayın mevcut yakın/liste/bölüm bağlamı kullanılır. Gruplar sırayla çalışır.
- `MAX_TOKENS` alınırsa yalnız başarısız grup ikiye ayrılır. Kesik cevap kullanılmaz, başarılı gruplar aynı işlem içinde tekrar çağrılmaz.
- Tek aday da taşarsa işlem açık hatayla durur; sonsuz bölme/yeniden deneme yoktur. Ağ, 429 veya 503 hatasında otomatik tekrar yoktur.
- Grup başına en fazla 5 dakika; tüm işlem için 10 dakika, 32 çağrı ve sonraki çağrıyı başlatmadan denetlenen 262.144 toplam çıktı/düşünme tokenı bütçesi bulunur.
- Her grubun kaynak kimliği ve tam kapsamı kontrol edilir. Ardından mevcut belge geneli kaynak doğrulaması ve tekrar temizleme çalışır.
- Bütün gruplar tamamlanmadan nihai sonuç veya tamamlanmış analiz önbelleği yazılmaz.
- Yeni yürütme sürümü önbellek anahtarına eklenir. Eski kayıtlar silinmez; aynı yeni sürümün başarılı tekrarları sıfır yeni model çağrısıyla çalışır.

Bu sınırlar kriter sayısı kotası değildir. Bir aday birden fazla kriter üretebilir. Değişen eski **tek API çağrısı zorunluluğudur**; tek model korunur. İlk analizde ortak talimatların tekrar gönderilmesi maliyeti artırabilir. Kullanım sayacı gerçek toplamı gösterir.

## Değişmeyenler

Regex/sözlük/sayı-birim/yapısal tarama, aday seçimi, dört kriter alanı, teknik kriterlere yaklaşım, ön eleme kapsamı, video istisnası, zorunlu olmayan kriterler ve kısa `KAPSAM_DISI` sözleşmesi korunmuştur. Hakem, embedding, arayüz, admin, veritabanı şeması ve önceki birleştirme değişikliklerine dokunulmamıştır.

## Doğrulama ve sınırlar

- TypeScript: PASS.
- Lint: PASS.
- Birim testleri: 355/355 PASS.
- Regresyonlar: 9 blok PASS.
- Üretim derlemesi ve depo güvenlik kontrolü: PASS.
- Yeni testler 129 adayın eksiksiz işlenmesini, taşan grubun bölünmesini, kesik JSON'un reddini, yabancı/eksik kararları, maliyet/süre sınırlarını ve başarısız çağrıların ölçümünü doğrular.

Canlı Gemini/PDF analizi yapılmadı; testlerde kontrollü model cevapları kullanıldı. Dolayısıyla gerçek belgelerin kalite ve süre karşılaştırması henüz ölçülmedi. Grup çalışması generatif sonuçların birebir aynı olmasını garanti etmez; tekrar tutarlılığı mevcut sürümlü önbelleğe dayanır. Servis yoğunluğu, tek dev maddenin taşması veya toplam bütçenin tükenmesi hâlâ açık hata üretebilir. Bu durumlarda kısmi sonucu tam başarı gibi sunmaz.

Bu sürümde grup ara sonuçları yalnız devam eden istekte tutulur; istek tamamen başarısız olursa sonraki kullanıcı denemesi yeniden başlar. Kalıcı grup bazlı devam ettirme ayrı bir geliştirmedir.

Commit, push ve yayınlama yapılmadı.
