# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Birincil kullanıcı, bir TEKNOFEST yarışmasının değerlendirme sürecini kuran yarışma yöneticisi veya yetkilidir. Kullanıcı yalnızca resmî değerlendirme PDF'sini yükler; sistem yarışma bağlamını, teslim sınırlarını ve değerlendirme kurallarını belgeden çıkarır. Yetkili kaynakları denetleyip gerekli düzeltmeleri yaptıktan sonra onaylı değerlendirme profilini oluşturur.

## Product Purpose

Ürün, farklı yapıda hazırlanmış değerlendirme belgelerini; kaynakları izlenebilir, düzenlenebilir ve sürümlenebilir kriter profillerine dönüştürür. Başarı, belgede bulunmayan bir kuralı uydurmadan doğru kriterleri çıkarmak ve yanlış yorumları yetkilinin kolayca düzeltebilmesini sağlamaktır.

## Positioning

Sabit bir puanlama şablonu sunmaz. Belgedeki biçim kurallarını, zorunlu içerikleri, nitel kriterleri, eleme koşullarını ve yalnızca jüri tarafından değerlendirilebilecek maddeleri ayrı türler olarak sınıflandırır; her çıkarımı kaynak sayfası ve ilgili metinle açıklar.

## Operating Context

İlk modül üç adımdan oluşur: resmî kriter PDF'si ile isteğe bağlı rapor şablonunun yüklenmesi, kriterlerin dinamik inceleme/düzeltmesi ve profilin Yarışma Yöneticisi tarafından yayımlanması. Yarışmacı portalı yarışma seçimi, PDF başvurusu, revizyon sürümü ve sonuç takibini yürütür. PDF yüklenince analiz başlamaz; Admin ilk Hakemi atar. Değerlendirme Atölyesi yayımlanmış profili katılımcı raporuna yalnızca Hakem “AI ile değerlendir” dediğinde uygular. Değerlendirme Yöneticisi iş yükü, yeniden atama, hata kuyruğu, süreç kilitleme ve sonuç yayın akışını yönetir; proje içeriğini ve nihai kararı değiştiremez.

## Capabilities and Constraints

- Resmî kriter belgesi PDF olarak alınır.
- Yarışma, kategori, aşama, rapor türü, katılımcı teslim formatı, boyutu, adedi ve ihlal sonucu yalnızca PDF'de açıkça bulunuyorsa profile eklenir.
- Kaynak PDF için uygulanan 18 MB ve katılımcı raporu için uygulanan 50 MB sistem kapasite sınırları yarışma kuralı gibi gösterilmez.
- Belgede açıkça bulunmayan sayfa, yazı tipi veya düzen kontrolleri etkinleştirilmez.
- Yapay zekâ çıkarımları yönetici onayı olmadan yürürlüğe girmez.
- AI anahtarı yalnızca sunucu ortam değişkeninde tutulur; tarayıcıya ve Git deposuna gönderilmez. Kesin kontroller AI servisinden bağımsız çalışır.
- Bu ürün bir jüri karar destek aracıdır; nihai eleme veya jüri kararı vermez.

## Evidence on Hand

- Önceki TEKNOFEST şartname ve kriter araştırmalarından elde edilen kriter türleri.
- Proje içinde oluşturulan, resmî olmayan ve yalnızca test amaçlı örnek değerlendirme kılavuzu.
- Gerçek katılımcı raporu henüz bulunmamaktadır; böyle bir içerik uydurulmaz. Değerlendirme Atölyesi testleri açıkça sentetik etiketli raporlarla yapılır.

## Product Principles

- Belge söylemiyorsa sistem varsaymaz.
- Her çıkarım kaynağıyla birlikte gösterilir.
- Yapay zekâ önerir, yetkili kesinleştirir.
- Yarışmacı yüklemesi analiz başlatmaz; başlangıç yetkisi hakemdedir.
- Başvuru, PDF, profil, AI bulgusu ve hakem kararı aynı izlenebilir zincirde saklanır.
- Kesin kontrol, anlamsal değerlendirme ve insan kararı birbirinden ayrılır.
- Sonradan yapılan her değişiklik görünür ve geri izlenebilir olmalıdır.

## Accessibility & Inclusion

Arayüz klavye ile kullanılabilir, yalnızca renge dayanmayan durum işaretleri içerir ve Türkçe yönetici diliyle açık hata/iyileştirme mesajları verir.
