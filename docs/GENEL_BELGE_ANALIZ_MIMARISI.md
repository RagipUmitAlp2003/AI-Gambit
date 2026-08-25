# Genel belge analiz mimarisi

Bu sistem belirli bir yarışma veya örnek PDF için kural listesi ezberlemez. Her yüklemede belge yapısını yeniden keşfeder.

## İşlem sırası

1. **Belge haritası:** Bölümler, puan tabloları, teslim kuralları, ekler ve referans sayfaları belirlenir.
2. **Uyarlanabilir çıkarım:** 30 sayfaya kadar belge tek kapsamlı geçişte; daha uzun belgeler 2–4 eksiksiz sayfa aralığında ve paralel işlenir.
3. **Tipli sonuç:** Kural, puan, uygunluk şartı, baraj, ceza ve yalnızca bilgi olan metinler ayrı alanlara yazılır.
4. **Kaynak bağı:** Her kriter PDF'nin 1 tabanlı gerçek sayfa sırasına ve özgün dilde birebir kısa alıntıya bağlanır.
5. **Bağımsız doğrulama:** Koşul, sayı, kapsam ve sonuç PDF'ye karşı ikinci kez kontrol edilir. İlk geçişte atlanan açık kurallar ayrıca işaretlenir.
6. **Deterministik güvenlik:** Sayfa sınırı, puan toplamı, grup çakışması, bağlantısız puan ve tekrar kriterler kodla denetlenir.
7. **İnsan onayı:** Kısmi kanıt, bulunamayan kaynak, çelişki veya yalnızca ikinci turda bulunan kriter otomatik kesinleştirilmez.

## Belge uzunluğuna göre strateji

| PDF uzunluğu | Kural çıkarma aralığı |
|---|---:|
| 1–30 sayfa | 1 bütünsel geçiş |
| 31–80 sayfa | 2 paralel aralık |
| 81–160 sayfa | 3 paralel aralık |
| 161–1000 sayfa | 4 paralel aralık |

Harita ve çıkarımın ardından kanıt doğrulaması çalışır. Büyük PDF bir kez Files API'ye yüklenir; geçişler aynı dosya referansını kullanır.

## Halüsinasyon önleme kuralları

- Belgede olmayan sayı, ağırlık, zorunluluk ve ihlal sonucu oluşturulmaz.
- Çeviri veya özet, kaynak alıntısı olarak kabul edilmez.
- Basılı sayfa etiketi yerine PDF dosyasındaki gerçek sıra kullanılır.
- "Zorunlu", "0 puan", "başarısız" ve "diskalifiye" aynı etki sayılmaz.
- Tablo üst grubu ile alt satırları ikinci kez toplanmaz.
- İstisna, dipnot, çapraz referans, ek ve sürüm öncelikleri korunur.
- Çelişki belge içinde çözülemiyorsa sistem kendi kararını vermez.

## Kalite ölçümü

Tek örnek PDF başarı ölçütü değildir. Test kümesi farklı uzunluk, tablo yapısı, puansız kılavuz, birden çok aşama, ek/dipnot ve çelişki senaryoları içermelidir. Ölçümler:

- **Recall:** Gerçek kuralların ne kadarı bulundu?
- **Precision:** Üretilen kriterlerin ne kadarı gerçekten belgede var?
- **Puan doğruluğu:** İlan edilen toplam, üst gruplar ve alt kalemler doğru mu?
- **Kanıt doğruluğu:** Sayfa ve alıntı gerçek mi, kuralın bütün anlamını destekliyor mu?
- **İnsan inceleme oranı:** Sistem kaç kriteri haklı gerekçeyle görevliye bıraktı?
- **Süre:** Normal koşullarda hedef 60 saniyenin altıdır; kota/yedek model kullanımı ayrıca raporlanır.
