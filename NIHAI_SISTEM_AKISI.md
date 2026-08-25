# AI-Gambit — Nihai Sistem Akışı

**Dal:** `faruk_deneme`  
**Amaç:** Şartname kurallarını güvenilir biçimde çıkarmak, katılımcı raporlarını toplamak ve Hakeme kanıtlı karar desteği sunmak.

## Roller

| Kod | Rol | Ana işi | Sınırı |
|---|---|---|---|
| 00 | Genel Yönetici / Admin | Personel hesabı ve rol oluşturur, ilk Hakem atamasını yapar, bütün çalışma alanlarına süper yetkiyle erişir. | Katılımcının yüklediği PDF'i değiştiremez. |
| 01 | Yarışma Yöneticisi | Şartnameyi ve varsa rapor şablonunu yükler, AI kriter taslağını düzenler ve yayımlar. | Katılımcı raporuna nihai karar veremez. |
| 02 | Hakem | Kendisine atanmış raporda AI analizini başlatır; kabul, ret veya gerekçeli revizyon kararı verir. | Şartname veya kriter seti oluşturamaz. |
| 03 | Yarışmacı | Yarışma seçer, takım bilgileri ve PDF ile başvurur; kendi durumunu ve yayımlanan sonucunu görür. | Yönetim alanlarını ve başka takımların verilerini göremez. |
| 04 | Değerlendirme Yöneticisi | İş yükü ve hataları izler; yeniden atama, hatırlatma, yeniden analiz ve sonuç yayın akışını yönetir. | Rapor puanlayamaz, kriter değiştiremez, nihai karar veya diskalifiye kararı veremez. |

İlk Hakem atamasını yalnızca Admin yapar. Daha sonra operasyonel bir sorun olursa Değerlendirme Yöneticisi raporu başka Hakeme aktarabilir.

## Birinci AI aşaması — şartnameden kriter çıkarma

1. Yarışma Yöneticisi resmî şartname PDF'ini seçer.
2. İsterse ayrı resmî rapor şablonunu ekler. Şablon yalnızca zorunlu başlıkları ve biçim yapısını anlamak için kullanılır; ondan puan veya yeni yarışma kuralı üretilmez.
3. Uzun şartname bir sayfa örtüşmeli en fazla dört dengeli aralığa ayrılır. Harita ve aralık analizleri paralel çalışır.
4. Çıktılar birleştirilir, tekrarlar temizlenir ve ikinci turda kaynak sayfası, alıntı, sayı, kapsam ve ihlal sonucu doğrulanır.
5. Kriterler rapor, dosya yüklemesi, fiziksel aşama, haricî onay ve bilgi notu olarak ayrılır.
6. Fiziksel aşama puanları kaynakta korunur fakat katılımcı PDF puanına otomatik eklenmez. Karma madde varsa rapor ve saha koşulu ayrı kriterlere bölünür.
7. Kaynağı kesinleşmeyen kriter “karar bekliyor” işaretiyle listede kalır. Yönetici kaynağı doğrular ya da kriteri siler.
8. Kriter listesinde aktif/pasif anahtarı yoktur: analiz çıktısı olduğu gibi durur. İstenmeyen kriter **silinir**. Bir kriterin PDF puanına girip girmeyeceği elle değil, kapsam sınıfından türer — rapor ve dosya kapsamlı maddeler puana girer; fiziksel, haricî ve bilgi notu maddeleri kaynak olarak korunur ama PDF puanına eklenmez.
9. Yönetici puanlamayı kapatabilir; kriter ekleyebilir, düzenleyebilir veya silebilir.
10. Yönetici “Başvuruyu onayla” dediğinde ikinci bir doğrulama penceresi açılır: kriter sayısı, kapsam ve puan ölçeği özetlenir ve “emin misiniz?” sorusu sorulur. Yönetici evet derse kriterler yayımlanır ve yarışma başvuruya açılır. Hakem kriter oluşturma veya yayımlama aşamasına katılmaz.

Kriter ekranının en üstünde altı sabit ön kontrol bulunur: PDF/dosya, dil, şablon, başlık ve içerik, kategori, benzerlik. Bunlar şartnamedeki puan satırlarıyla karıştırılmaz.

## Başvuru ve Hakem akışı

1. Yarışmacı açık yarışmayı seçer; adı-soyadı, takım adı, ekip üyeleri ve PDF'i gönderir.
2. Başvuru D1'e, PDF özel R2 deposuna yazılır. Yükleme AI analizini başlatmaz.
3. Başvuru anında Hakem paneline düşer. Hakem kendisine atanmış başvuruların yanında **henüz hiçbir hakeme atanmamış** başvuruları da görür; başka bir hakeme atanmış dosya bu hesaba hiç gönderilmez.
4. Hakem “AI analizini başlat” dediğinde ikinci aşama çalışır ve dosyayı üstlenir (atama kaydı denetim izine yazılır). Admin dilerse dosyayı baştan belirli bir Hakeme atayabilir; Değerlendirme Yöneticisi tıkanıklıkta yeniden atar.
5. AI, yalnızca Yarışma Yöneticisinin yayımladığı kriterleri kullanarak raporu değerlendirir ve gerekçeli bir **uygunluk önerisi** üretir: uygun · uygun değil · hakem kararı gerekli. Karşılanmayan zorunlu koşullar, kaynak sayfasıyla birlikte listelenir ve doğrudan ret gerekçesi taslağına dönüşür.
6. Hakem kanıtları inceler; başvuruyu onaylar veya reddeder. Ret gerekçesi AI taslağı olarak gelir; Hakem taslağı olduğu gibi bırakabilir ya da kendi metnini yazabilir. Gerekçesiz ret kaydedilmez.
7. Reddedilen başvuru puanlanmaz; kabul kararında bütün puan kriterleri karara bağlanmadan inceleme tamamlanamaz.
8. Karar kesinleşince yarışmacıya e-posta gönderilir ve sonuç “Başvurularım” ekranında görünür.
9. Revizyon verilirse yarışmacı yeni PDF sürümü yükler. Eski sürüm silinmez.
10. **Kabul** sonucu, sonuçlar yayımlanana kadar yarışmacıya açılmaz. **Ret** ve **revizyon** kararları ise gerekçesiyle birlikte anında görünür: yarışmacı neden elendiğini bilmeden düzeltme hakkını kullanamaz.

## İkinci AI aşaması — rapor değerlendirme

Önce PDF imzası ve okunabilirlik, şartnamedeki format/boyut sınırları, rapor dili, resmî şablon, zorunlu başlıklar, kategori uyumu ve aynı yarışma havuzundaki benzerlik kontrol edilir.

AI yalnızca yayımlanmış, PDF kapsamındaki kriterleri kullanır; yeni kriter uyduramaz. Her kriter için durum, kısa gerekçe, uygunsa puan önerisi, güven seviyesi ve sayfa + bölüm + doğrudan alıntı döndürür. Fiziksel, haricî, ceza, baraj ve insan kararı gerektiren maddelerde nihai karar vermez.

Modelin alıntısı tarayıcıda çıkarılmış gerçek sayfa metniyle tekrar karşılaştırılır. Alıntı belirtilen sayfada bulunamazsa kanıt çıkarılır, puan önerisi iptal edilir ve kriter Hakem incelemesine bırakılır. Böylece uydurulmuş kanıt sessizce kullanılamaz.

### Benzerlik

Ham rapor metni benzerlik veritabanında saklanmaz. Metinden geri döndürülemez, 64 parçalı MinHash izi çıkarılır. Yalnızca aynı yarışma + yıl + aşamadaki izlerle karşılaştırılır. Sonuç Hakeme yüzde ve en yakın takım adıyla işaret olarak sunulur; otomatik intihal, ret veya diskalifiye kararı verilmez.

Anlamsal embedding katmanı bu sürümde dış servise ayrıca rapor metni göndermemek için etkin değildir. Daha sonra açık veri aktarım onayı, gizlilik politikası ve maliyet ölçümüyle eklenebilir.

## Değerlendirme Yöneticisi

- Hakem başına aktif, tamamlanan ve hatalı dosya sayılarını görür.
- Atanmış raporu başka Hakeme aktarabilir ve sistem içi hatırlatma oluşturabilir.
- Başarısız AI analizini yeniden sıraya alabilir veya yarışmacıdan yeni PDF isteyebilir.
- Başvuruları kapatır, değerlendirmeyi başlatır, kararları dondurur, sonuçları yayımlar ve yarışmayı arşivler.
- Katılımcı PDF'ini, kanıt alıntılarını ve özel proje içeriğini göremez.

## Yarışma durumları

`Kriter taslağı → AI kriter işlemi → Kriter inceleme → Başvuruya açık → Başvurular kapalı → Değerlendiriliyor → Kararlar donduruldu → Sonuçlar yayımlandı → Arşiv`

Kararlar dondurulmadan önce bütün başvurular tamamlanmış olmalıdır. Admin dışındaki roller geçersiz bir aşamayı atlayamaz.

## Veritabanı

Cloudflare D1 içinde hesaplar, oturumlar, roller, yarışmalar, kriterler, başvurular, PDF sürüm kayıtları, Hakem atamaları, AI çıktıları, nihai kararlar, MinHash izleri ve işlem geçmişi saklanır. JSON alanları D1 uyumu için `TEXT` tutulur. Katılımcı PDF dosyaları özel Cloudflare R2 deposundadır.

SQL sırası:

1. `migrations/0001_admin.sql`
2. `migrations/0002_competition_workflow.sql`
3. `migrations/0003_application_teams_and_history.sql`
4. `migrations/0004_roles_v2.sql`
5. `migrations/0005_final_workflow.sql`

## Kontrol sonucu

Güncel test ve ölçüm sonuçları bu belgede tutulmaz; tek kaynak `PROJE_DURUMU.md`
dosyasıdır. Bu belge sistemin **ne yaptığını** anlatır, **hangi durumda olduğunu**
anlatmaz.

Canlı uçtan uca test için Cloudflare D1 ve R2 bağlarının çalıştığı `vinext dev` veya dağıtım ortamı gerekir. Bu Windows cihazında `workerd.exe` işletim sistemi politikası tarafından engellendiği için yerel D1 oturum testi açılamamaktadır; bu durum üretim derlemesindeki kod hatası değildir.
