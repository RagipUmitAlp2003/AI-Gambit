# PDF Merkezli Akış Güncellemesi

**Tarih:** 2026-08-25  
**Dal:** `Deneme`  
**Durum:** Değişiklikler çalışma alanında hazır; commit ve push kullanıcıya bırakıldı.

## Yeni ürün kararı

Kriter Atölyesi artık üç adımdır:

1. Yarışma organizatörünün resmî kriter/şartname PDF'si yüklenir.
2. AI; yarışma bağlamını, teslim sınırlarını, puan planını ve kriterleri yalnızca bu PDF'den çıkarır. Görevli kaynak sayfası ve ilgili metinle birlikte taslağı düzeltir.
3. Görevli profili onaylar ve değerlendirme aşamasında kullanılacak JSON'u oluşturur.

Yarışma adı, kategori, aşama, rapor türü, katılımcı dosya formatı, azami MB, dosya adedi ve ihlal sonucu için ayrı bir “Temel ayarlar” formu yoktur. PDF'de bulunmayan bilgi profile eklenmez ve otomatik kural yapılmaz.

## Çakışma yaklaşımının kaldırılması

Eski sürüm, yöneticinin başlangıç ayarlarını PDF'den çıkarılan kurallarla birleştiriyor ve iki değer farklıysa “çakışma” üretiyordu. Başlangıç ayarları tamamen kaldırıldığı için bu birleştirme katmanı da kaldırıldı.

Puan tarafında:

- Açık alt kriterlerin toplamı grup azamisinden düşükse yalnızca matematiksel kalan kadar, hakem kontrollü bütüncül kriter eklenir.
- Aynı puan satırı tekrar çıkarılıp grup azamisi aşılırsa tekrarlar açıklayıcı bilgiye çevrilir ve resmî grup azamisi tek bütüncül hakem kriteriyle korunur.
- Kullanıcıya “çakışma çöz” eylemi gösterilmez; kaynak ve puan denetimi açık biçimde sunulur.

## Arayüz dili

- `Geçiş` → `Sağlanması gereken uygunluk koşulu`
- `Baraj` → `Devam etmek için gereken en düşük sonuç`
- `Ceza` → `Toplam puandan yapılacak kesinti`
- `Eleme` → `Eleme veya diskalifiye incelemesi`

Bu dört grup “Puan dışında sonucu etkileyen kurallar” başlığında gösterilir. Sistem bulgu ve kanıt sunar; insan kararı gereken maddelerde son karar görevli/hakemdedir.

## Kod incelemesindeki 10 sorunun sonucu

| Sorun | Çözüm |
|---|---|
| Offline puanlama, puan olmayan kriterde azami puan gösteriyordu | Yalnızca `score` etkili kriterler puan alanı alıyor |
| Profil onayı yerel depolama hatasında sessiz kalıyordu | Kayıt `try/catch` ile korunuyor ve düzeltme mesajı gösteriliyor |
| API anahtarı yokken offline değerlendirme çalışmıyordu | 503 cevabı kesin kontrollere dayalı offline değerlendirmeye düşüyor |
| `gateChecks` gönderilmezse dosya kontrolleri kayboluyordu | Kontroller dosya ve PDF profili üzerinden yeniden oluşturuluyor |
| Yarışma arama alanı odak sonrası yanlış listeyi kullanabiliyordu | Serbest metin varsa odakta ve klavye açılışında filtre yeniden etkinleşiyor |
| Arayüz ve motor boyut sınırı farklıydı | Kaynak PDF sınırı 18 MB; katılımcı analiz motoru 50 MB. Bunlar yarışma kuralından ayrı gösteriliyor |
| ZIP, Türkçe büyük harfle `ZİP` oluyordu | Dosya uzantısı dil bağımsız `toUpperCase()` ile gösteriliyor |
| Uzantısız dosya adı tür etiketi oluyordu | Son nokta/uzantı doğrulanıyor; uzantısız kayıt `DOSYA` oluyor |
| Bozuk AI JSON'u zaman aşımı sayılıp tekrar gönderiliyordu | Ağ zaman aşımı ile JSON ayrıştırma hatası ayrıldı; bozuk JSON büyük isteği ikinci modele göndermiyor |
| `score-coverage.ts` çalışma zamanı `.ts` uzantılı import kullanıyordu | Yerel etki çözümleyicisi kullanıldı; uyumsuz import kaldırıldı |

## Doğrulama

- Depo güvenlik kontrolü: başarılı
- ESLint: başarılı
- Regresyon ve puanlama testleri: 22/22 başarılı
- Üretim derlemesi: başarılı
- Masaüstü ve üç adımlı başlangıç ekranı tarayıcı kontrolü: başarılı

## Commit için öneri

`feat: kriter atölyesini PDF merkezli üç adımlı akışa geçir`

