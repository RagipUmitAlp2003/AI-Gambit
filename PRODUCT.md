# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Birincil kullanıcı, bir TEKNOFEST yarışmasının değerlendirme sürecini kuran yarışma yöneticisi veya yetkilidir. Kullanıcı; yarışma, kategori, aşama ve rapor türünü tanımlar, resmî değerlendirme PDF'sini yükler, yapay zekânın çıkardığı kuralları denetler ve onaylı bir değerlendirme profili oluşturur.

## Product Purpose

Ürün, farklı yapıda hazırlanmış değerlendirme belgelerini; kaynakları izlenebilir, düzenlenebilir ve sürümlenebilir kriter profillerine dönüştürür. Başarı, belgede bulunmayan bir kuralı uydurmadan doğru kriterleri çıkarmak ve yanlış yorumları yetkilinin kolayca düzeltebilmesini sağlamaktır.

## Positioning

Sabit bir puanlama şablonu sunmaz. Belgedeki biçim kurallarını, zorunlu içerikleri, nitel kriterleri, eleme koşullarını ve yalnızca jüri tarafından değerlendirilebilecek maddeleri ayrı türler olarak sınıflandırır; her çıkarımı kaynak sayfası ve ilgili metinle açıklar.

## Operating Context

İlk modül dört adımdan oluşur: temel yarışma ve dosya ayarları, resmî kriter PDF'sinin yüklenmesi, dinamik kriter inceleme/düzeltme, profil onayı. İkinci modül (Değerlendirme Atölyesi, `/degerlendirme`) onaylı profili katılımcı raporlarına uygular: rapor havuzu ve kesin ön kontroller (dosya kapısı, dil, şablon/başlık, benzerlik), hakem inceleme ekranı ve hakem onaylı yarışmacı geri bildirimi. Anlamsal kriter analizi motoru ayrı geliştirilir; sözleşmesi `docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md` dosyasındadır ve motor bağlanana kadar yalnızca kesin kontroller çalışır.

## Capabilities and Constraints

- Resmî kriter belgesi PDF olarak alınır.
- Organizatör, katılımcı teslim dosyasının format, boyut ve dosya sayısı gibi belgeden bağımsız teknik kurallarını önceden tanımlar.
- Belgede açıkça bulunmayan sayfa, yazı tipi veya düzen kontrolleri etkinleştirilmez.
- Yapay zekâ çıkarımları yönetici onayı olmadan yürürlüğe girmez.
- API bilgisi henüz verilmemiştir. İlk sürüm, değiştirilebilir bir analiz sağlayıcısı ve yerel demo motoruyla çalışır.
- Bu ürün bir jüri karar destek aracıdır; nihai eleme veya jüri kararı vermez.

## Evidence on Hand

- Önceki TEKNOFEST şartname ve kriter araştırmalarından elde edilen kriter türleri.
- Proje içinde oluşturulan, resmî olmayan ve yalnızca test amaçlı örnek değerlendirme kılavuzu.
- Gerçek katılımcı raporu henüz bulunmamaktadır; böyle bir içerik uydurulmaz. Değerlendirme Atölyesi testleri açıkça sentetik etiketli raporlarla yapılır.

## Product Principles

- Belge söylemiyorsa sistem varsaymaz.
- Her çıkarım kaynağıyla birlikte gösterilir.
- Yapay zekâ önerir, yetkili kesinleştirir.
- Kesin kontrol, anlamsal değerlendirme ve insan kararı birbirinden ayrılır.
- Sonradan yapılan her değişiklik görünür ve geri izlenebilir olmalıdır.

## Accessibility & Inclusion

Arayüz klavye ile kullanılabilir, yalnızca renge dayanmayan durum işaretleri içerir ve Türkçe yönetici diliyle açık hata/iyileştirme mesajları verir.
