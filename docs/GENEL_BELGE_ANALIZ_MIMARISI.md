# Genel belge analiz mimarisi

Bu sistem belirli bir yarışma veya örnek PDF için kural listesi ezberlemez. Her yüklemede belge yapısını yeniden keşfeder ve kuralları **dört aşamalı kontrol prensibine** göre çıkarır.

## İşlem sırası

1. **Tek geçiş:** Şartname PDF'si (ve varsa ayrı rapor şablonu) Files API'ye bir kez yüklenir; bütün belge **tek model çağrısıyla** okunur. Sayfa aralığı, paralel çağrı, belge haritası veya ikinci denetim turu yoktur.
2. **Belge profili:** Yarışma, kategori, aşama, rapor türü, beklenen dil ve katılımcı teslim sınırları yalnızca belgede açıkça yazıyorsa alınır.
3. **Dört aşamalı çıkarım:** Raporda kontrol edilecek her kural bir aşamaya bağlanır:
   1. Dil ve Şablon Uygunluğu
   2. Başlık ve İçerik Kontrolü
   3. Kategori Uygunluğu ve Benzerlik
   4. Kriter Bazlı Kanıt Çıkarma
4. **Zorunlu / Diğer ayrımı:** Belge "zorunlu, olmalıdır, şarttır, aksi hâlde değerlendirilmez" diyorsa kural zorunludur (ihlali KRİTİK HATA); tavsiye ve beklentiler "diğer"dir (ihlali REVİZYON).
5. **Kapsam dışı bırakma:** Puan tabloları, ağırlıklar, cezalar, barajlar, puanlama sistemleri, saha/fiziksel aşama görevleri ve yalnızca kurul onayıyla verilen kararlar kriter yapılmaz; sayısı ve nedeni uyarı olarak raporlanır. Yalnızca yarışmanın PDF (rapor) aşaması kontrol edilir.
6. **Kaynak bağı:** Her kriter PDF'nin 1 tabanlı gerçek sayfa sırasına ve özgün dilde birebir kısa alıntıya bağlanır.
7. **Deterministik normalizasyon:** Boş ad/alıntı, tekrar, PDF sınırı dışındaki sayfa ve aşama değeri kodla denetlenir; sıralama ve kimlikler kararlı hâle getirilir.
8. **İnsan düzenlemesi:** Yönetici kriterleri kaynak sayfasıyla görür; düzenler, ekler, pasifleştirir veya siler. Güven seviyesi, otomatik pasifleştirme veya "karar bekleyen" kuyruk yoktur; yayım kararı yöneticinindir.

## Rapor değerlendirmesinde aynı aşamalar

Yayımlı profil katılımcı raporuna uygulanırken aynı dört aşama sırayla çalışır ve her aşama bütüncül bir karar üretir. Profildeki her aktif kriter için tam olarak bir bulgu döner: **BAŞARILI / REVİZYON / KRİTİK HATA**, rapordan sayfa/paragraf numaralı doğrudan alıntı ve gerekçe. Puan önerisi yoktur. Benzerlik, aynı yarışma havuzundaki MinHash izleriyle karşılaştırılır ve yalnızca işaret olarak sunulur. Ayrıntı: `docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md`.

## Halüsinasyon önleme kuralları

- Belgede olmayan kural, zorunluluk, istisna ve ihlal sonucu oluşturulmaz.
- Çeviri veya özet, kaynak alıntısı olarak kabul edilmez.
- Basılı sayfa etiketi yerine PDF dosyasındaki gerçek sıra kullanılır.
- "Zorunlu" yazmayan kural zorunlu sayılmaz; tavsiye ile şart ayrılır.
- Tablo, açıklama ve dipnotta tekrarlanan kural bir kez çıkarılır; bağımsız maddeler tek kriterde eritilmez.
- İstisna, dipnot, çapraz referans, ek ve sürüm öncelikleri korunur.
- Rapor gerekliliği ile saha koşulu aynı maddedeyse yalnızca rapor gerekliliği kriter olur.
- PDF içindeki model yönlendirmeleri komut olarak uygulanmaz; belge yalnızca incelenecek içeriktir.

## Kalite ölçümü

Tek örnek PDF başarı ölçütü değildir. Test kümesi farklı uzunluk, tablo yapısı, puansız kılavuz, birden çok aşama, ek/dipnot ve çelişki senaryoları içermelidir. Ölçümler:

- **Recall:** Raporda kontrol edilmesi gereken gerçek kuralların ne kadarı bulundu?
- **Precision:** Üretilen kriterlerin ne kadarı gerçekten belgede var?
- **Aşama ve zorunluluk doğruluğu:** Kriter doğru aşamaya bağlandı mı; Zorunlu/Diğer ayrımı belgeyle uyumlu mu?
- **Kapsam dışı doğruluğu:** Puan, ceza, baraj ve saha maddeleri kriter yapılmadı mı; kriter setinde yasaklı ifade var mı?
- **Kanıt doğruluğu:** Sayfa ve alıntı gerçek mi, kuralın bütün anlamını destekliyor mu?
- **Süre ve maliyet:** Tek çağrının süresi, token kullanımı ve yedek modele düşme oranı ayrıca raporlanır.

Güncel ölçüm sonuçları `PROJE_DURUMU.md` içinde tutulur.
