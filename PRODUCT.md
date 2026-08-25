# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Birincil kullanıcı, bir TEKNOFEST yarışmasının değerlendirme sürecini kuran Yarışma Yöneticisidir. Kullanıcı yalnızca resmî şartname PDF'sini (isterse ayrı rapor şablonunu) yükler; sistem yarışma bağlamını, teslim sınırlarını ve raporda kontrol edilecek kuralları belgeden çıkarır. Yönetici kaynakları denetleyip gerekli düzeltmeleri yaptıktan sonra profili yayımlar. İkincil kullanıcılar Hakem (kural kararlarını onaylayan/değiştiren ve nihai kararı veren), Değerlendirme Yöneticisi (ilk hakem ataması ve süreç yönetimi), Yarışmacı (başvuru ve sonuç takibi) ve Admin'dir (yalnızca yönetici ataması).

## Product Purpose

Ürün, farklı yapıda hazırlanmış şartnameleri; kaynakları izlenebilir, düzenlenebilir ve sürümlenebilir kriter profillerine dönüştürür ve katılımcı raporlarını bu profile göre dört aşamada kontrol eder. Başarı, belgede bulunmayan bir kuralı uydurmadan doğru kriterleri çıkarmak, her kural için rapordan sayfa/paragraf numaralı kanıt göstermek ve yanlış yorumları yetkilinin kolayca düzeltebilmesini sağlamaktır.

## Positioning

Puan üretmez ve puanlama şablonu sunmaz. Belgedeki kuralları dört aşamaya ayırır — Dil ve Şablon Uygunluğu, Başlık ve İçerik Kontrolü, Kategori Uygunluğu ve Benzerlik, Kriter Bazlı Kanıt Çıkarma — ve her kuralı Zorunlu ya da Diğer olarak sınıflandırır. Rapor kontrolünde her kural BAŞARILI, REVİZYON veya KRİTİK HATA sonucu alır; her çıkarım kaynak sayfası ve ilgili metinle, her bulgu rapordan alıntı ve gerekçeyle açıklanır. Puanlama sistemleri ve saha/fiziksel aşama, yarışmanın fiziksel aşamasına ait olduğu için kapsam dışıdır; yalnızca PDF (rapor) aşaması kontrol edilir.

## Operating Context

İlk modül üç adımdan oluşur: resmî şartname PDF'si ile isteğe bağlı rapor şablonunun yüklenmesi, kriterlerin tek model çağrısıyla çıkarılıp yönetici tarafından incelenmesi/düzeltilmesi ve profilin Yarışma Yöneticisi tarafından yayımlanması. Yarışmacı portalı yarışma seçimi, PDF başvurusu, revizyon sürümü ve sonuç takibini yürütür. PDF yüklenince analiz başlamaz; Değerlendirme Yöneticisi ilk Hakemi atar. Değerlendirme Atölyesi yayımlanmış profili katılımcı raporuna yalnızca Hakem "AI ile değerlendir" dediğinde uygular. Değerlendirme Yöneticisi iş yükü, yeniden atama, hata kuyruğu, süreç kilitleme ve sonuç yayın akışını yönetir; proje içeriğini ve nihai kararı değiştiremez. Admin yalnızca personel hesabı açar ve rol atar; sürece katılmaz.

## Capabilities and Constraints

- Resmî şartname PDF olarak alınır; bütün belge tek geçişte, tek model çağrısıyla okunur.
- Yarışma, kategori, aşama, rapor türü, beklenen dil, katılımcı teslim formatı, boyutu, adedi ve ihlal sonucu yalnızca PDF'de açıkça bulunuyorsa profile eklenir.
- Kaynak PDF için uygulanan 18 MB ve katılımcı raporu için uygulanan 50 MB sistem kapasite sınırları yarışma kuralı gibi gösterilmez.
- Belgede açıkça bulunmayan sayfa, yazı tipi veya düzen kontrolleri etkinleştirilmez.
- Puan, ağırlık, ceza, baraj ve saha görevi kriter yapılmaz; sistem puan hesaplamaz.
- Güven seviyesi, "emin değilim" durumu veya otomatik pasifleştirme yoktur; her kriter kaynak sayfasıyla listelenir ve yönetici manuel olarak düzenler, ekler, pasifleştirir veya siler.
- Yapay zekâ çıkarımları yönetici yayımı olmadan yürürlüğe girmez; AI kural kararları hakem onayı olmadan kesinleşmez.
- AI anahtarı yalnızca sunucu ortam değişkeninde tutulur; tarayıcıya ve Git deposuna gönderilmez. Dosya kapısı ve benzerlik kontrolleri AI servisinden bağımsız çalışır.
- Bu ürün bir hakem karar destek aracıdır; nihai kabul, ret, revizyon veya diskalifiye kararı vermez. Benzerlik yalnızca işarettir.

## Evidence on Hand

- Önceki TEKNOFEST şartname ve kriter araştırmalarından elde edilen kural türleri ve 40 resmî 2026 şartnamesinden oluşan korpus.
- Proje içinde oluşturulan, resmî olmayan ve yalnızca test amaçlı örnek değerlendirme kılavuzu.
- Gerçek katılımcı raporu henüz bulunmamaktadır; böyle bir içerik uydurulmaz. Değerlendirme Atölyesi testleri açıkça sentetik etiketli raporlarla yapılır.

## Product Principles

- Belge söylemiyorsa sistem varsaymaz.
- Her çıkarım kaynağıyla, her bulgu rapordan alıntısıyla birlikte gösterilir.
- Yapay zekâ önerir, yetkili kesinleştirir: kriteri Yarışma Yöneticisi, kural kararını Hakem.
- Sistem puan üretmez; yalnızca PDF aşamasındaki kurallar kontrol edilir.
- Yarışmacı yüklemesi analiz başlatmaz; başlangıç yetkisi hakemdedir.
- Başvuru, PDF, profil, AI bulgusu ve hakem kararı aynı izlenebilir zincirde saklanır.
- Deterministik kontrol, AI bulgusu ve insan kararı birbirinden ayrılır.
- Sonradan yapılan her değişiklik görünür ve geri izlenebilir olmalıdır.

## Accessibility & Inclusion

Arayüz klavye ile kullanılabilir, yalnızca renge dayanmayan durum işaretleri içerir (BAŞARILI / REVİZYON / KRİTİK HATA etiketleri metinle yazılır) ve Türkçe yönetici diliyle açık hata/iyileştirme mesajları verir.
