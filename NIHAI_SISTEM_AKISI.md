# AI-Gambit — Nihai Sistem Akışı

**Dal:** `faruk_deneme`  
**Amaç:** Şartname kurallarını dört aşamalı prensiple güvenilir biçimde çıkarmak, katılımcı raporlarını toplamak ve Hakeme kanıtlı, puansız karar desteği sunmak.

## Roller

| Kod | Rol | Ana işi | Sınırı |
|---|---|---|---|
| 00 | Genel Yönetici / Admin | Yalnızca yönetici ataması yapar: personel hesabı açar, rol atar/kaldırır, atama geçmişini izler. | Kriter hazırlayamaz, rapor değerlendiremez, hakem atayamaz, yarışma sürecine müdahale edemez. Kriter, değerlendirme, operasyon ve başvuru uçlarına erişimi yoktur. |
| 01 | Yarışma Yöneticisi | Şartnameyi ve varsa rapor şablonunu yükler, AI kriter taslağını düzenler ve yayımlar. | Katılımcı raporuna nihai karar veremez. |
| 02 | Hakem | Kendisine atanmış raporda AI ön değerlendirmesini başlatır; her kuralın kararını onaylar veya değiştirir; kabul, ret veya gerekçeli revizyon kararı verir. | Şartname veya kriter seti oluşturamaz. |
| 03 | Yarışmacı | Yarışma seçer, takım bilgileri ve PDF ile başvurur; kendi durumunu ve yayımlanan sonucunu görür. | Yönetim alanlarını ve başka takımların verilerini göremez. |
| 04 | Değerlendirme Yöneticisi | Başvuruya **ilk Hakemi atar**; iş yükü ve hataları izler; yeniden atama, hatırlatma, yeniden analiz ve sonuç yayın akışını yönetir. | Kriter değiştiremez, rapor değerlendiremez, nihai karar veya diskalifiye kararı veremez. |

Yetki matrisi `app/lib/authorization.ts` içindedir ve tek doğruluk kaynağıdır: 00 yalnızca `manage_accounts`; 01 kriter/profil yazma ve yayımlama; 02 AI ön değerlendirme ve nihai karar; 04 operasyon panosu, ilk hakem ataması (`assign_judge`), yeniden atama ve yarışma aşaması yönetimi. Bir rol matriste yoksa uç ona 403 döner.

## Dört aşamalı kontrol prensibi

Şartname analizi (birinci AI aşaması) ve rapor değerlendirmesi (ikinci AI aşaması) aynı dört aşamayı kullanır:

1. **Dil ve Şablon Uygunluğu** — tespit edilen dil ve şablon/biçim uyumu.
2. **Başlık ve İçerik Kontrolü** — zorunlu başlıkların raporda varlığı ve altındaki içeriğin doluluğu.
3. **Kategori Uygunluğu ve Benzerlik** — kategoriye uygunluk skoru ve başvurular arası benzerlik durumu.
4. **Kriter Bazlı Kanıt Çıkarma** — her teknik kural için BAŞARILI / REVİZYON / KRİTİK HATA, rapordan sayfa/paragraf numaralı doğrudan alıntı ve gerekçe.

Yalnızca yarışmanın PDF (rapor) aşaması kontrol edilir. Puanlama sistemleri (puan, ağırlık, ceza, baraj, puan grubu, normalizasyon, karar kuralları) ve saha/fiziksel aşama maddeleri yarışmanın fiziksel aşamasına ait olduğu için kriter sistemine dahil değildir. Kriterler **Zorunlu** (ihlali KRİTİK HATA) ve **Diğer** (ihlali REVİZYON) olarak ayrılır. Güven seviyesi, "emin değilim" durumu ve otomatik pasifleştirme yoktur.

## Birinci AI aşaması — şartnameden kriter çıkarma

1. Yarışma Yöneticisi resmî şartname PDF'ini seçer.
2. İsterse ayrı resmî rapor şablonunu ekler. Şablon yalnızca zorunlu başlıkları (2. aşama) ve biçim notlarını anlamak için kullanılır; ondan yeni yarışma kuralı üretilmez.
3. Belge Files API'ye bir kez yüklenir ve **tek model çağrısıyla** bütünüyle okunur. Sayfa aralığı, paralel çağrı veya ikinci denetim turu yoktur. Model tek cevapta belge profili (yarışma, kategori, aşama, rapor türü, dil, teslim sınırları), şablon yapısı, dört aşamaya ayrılmış kriterler ve kapsam dışı bırakılan maddeleri döndürür.
4. Sunucu cevabı doğrular: aşaması tanınmayan kriter 4. aşamaya düşer, tekrarlar birleştirilir, PDF sınırı dışındaki kaynak sayfası boşaltılıp uyarı yazılır, liste aşama ve sayfa sırasına göre dizilir. Kapsam dışı madde sayısı (saha/fiziksel aşama, puanlama, haricî onay) uyarı olarak gösterilir.
5. Her kriter ad, aşama, Zorunlu/Diğer, tek anlamlı açıklama, belgede yazan ihlal sonucu, kaynak sayfa ve özgün dilde birebir alıntıyla ekrana gelir. Belgede olmayan kural, zorunluluk veya sonuç üretilmez.
6. Yönetici kriter ekleyebilir, düzenleyebilir, pasifleştirebilir veya silebilir. Kriter bölümü dışındaki bölümler (sabit ön kontroller, şablon önizleme, puan yapısı, AI notları) ekranda yoktur.
7. Yönetici profili yayımladığında yarışma başvuruya açılır. Profil sürümü 2.0'dır; eski 1.0 profiller okunurken yükseltilir. Hakem kriter oluşturma veya yayımlama aşamasına katılmaz.

**Kalıcı analiz kaydı:** her başarılı analizin ham çıktısı, belge içeriği + analiz yapılandırması anahtarıyla D1'e yazılır (`criteria_analysis_cache`). Aynı şartname yeniden analiz edildiğinde model çağrılmaz; kayıtlı sonuç 0 token ile döner ve arayüz bunu açıkça bildirir. Sunucu yeniden başlasa da kayıt durur (bkz. `docs/KALICI_ANALIZ_ONBELLEGI.md`).

## Başvuru ve Hakem akışı

1. Yarışmacı açık yarışmayı seçer; adı-soyadı, takım adı, ekip üyeleri ve PDF'i gönderir.
2. Başvuru D1'e, PDF özel R2 deposuna yazılır. Yükleme AI analizini başlatmaz.
3. **Sistem** başvuruyu otomatik atar: aktif Hakemler arasından, mümkünse aynı yarışmada görevli olan, en az açık dosyası bulunan Hakem seçilir; eşit yükte sıra deterministiktir (en eski hesap, sonra kimlik). Atama transaction koşuluyla yapılır: aynı başvuru iki Hakeme birden atanamaz. Atama denetim izine ve süreç zaman çizelgesine yazılır. Aktif Hakem yoksa başvuru atanmamış kalır ve 04 panosunda kırmızı uyarı olarak görünür; Değerlendirme Yöneticisi elle atar veya sonradan yeniden atar (geçmiş kaybolmaz). Hakem yalnızca kendisine atanmış başvuruları görür.
4. Hakem Değerlendirme Atölyesi'nde kriteri çıkarılmış yarışmayı, ardından başvuru kutusunu açar ve "Yapay Zeka Analizi" der; ikinci aşama başlar. **Analiz bağlamı tamamen sunucuda kurulur:** istemci kriter seti veya PDF gönderemez; sunucu başvurudan yarışmayı, yarışmadan SON yayımlanmış kriter sürümünü ve başvurudan geçerli PDF sürümünü çözer.
5. Uygun kriterler ✓ ile, hatalı kriterler hata sebebi ve kaynak sayfaya giden düğmeyle listelenir. Hakem ONAY veya RED kararını verir; karar düğmesi, yarışmacıya iletilecek düzenlenebilir şablonu açar (kriter durumu ve hata sebebi elle değiştirilebilir).
6. RED'de AI'nin adım adım hata analizi şablon olarak yarışmacıya iletilir; ekstra analiz yapılmaz. Kararı verilen başvuru "Geçmiş değerlendirmeler"e düşer, gerekirse yeniden açılır.
7. Sonuç, **hakem kararı kesinleştirdiği anda** yarışmacıya açılır. ONAY, RED ve REVİZYON aynı veri kaynağından okunur ve aynı ayrıntıyı taşır: karar tarihi, yarışma, takım, hakem ve varsa hakem notu. Tamamlanmamış hakem taslağı yarışmacıya gösterilmez. Değerlendirme Yöneticisi yeni belge isteyebilir; yeni PDF sürümü eskiyi silmez.

## İkinci AI aşaması — rapor değerlendirme

Önce deterministik dosya kapısı çalışır: PDF imzası ve okunabilirlik, profildeki format/boyut/adet sınırları. Ardından AI yalnızca yayımlanmış aktif kriterleri kullanır; yeni kriter uyduramaz ve puan üretmez.

Sonuç dört aşama hâlinde döner:

- **1. Dil ve Şablon Uygunluğu:** tespit edilen dil, beklenen dil ve şablon/biçim uyumu; aşama kararı.
- **2. Başlık ve İçerik Kontrolü:** her zorunlu başlık için varlık, içerik doluluğu ve sayfa; aşama kararı.
- **3. Kategori Uygunluğu ve Benzerlik:** 0–100 kategori uygunluk skoru ve havuz benzerlik durumu; aşama kararı.
- **4. Kriter Bazlı Kanıt Çıkarma:** profildeki her aktif kural için tam olarak bir bulgu.

Her bulgu kriter kimliği, aşama, zorunluluk, kanıt yeri, **BAŞARILI / REVİZYON / KRİTİK HATA** kararı, gerekçe ve rapordan sayfa/paragraf numaralı doğrudan alıntı taşır. Alıntı gösterilemediyse bulgu `evidenceMissing` ile işaretlenir; hakem kaynağı kendisi doğrular. Özet, kararların sayımını ve bütüncül sonucu verir. Hakem ekranında her kural için karar onaylanır ya da değiştirilir; hakemin nihai kural durumu AI bulgusundan ayrı saklanır.

### PDF dışından doğrulanacak kriterler

Şartname analizi tanıtım videosu, saha teslimi, portal yüklemesi veya kurul kararı
gerektiren kuralları da kriter olarak çıkarabilir. Rapor analizi YALNIZCA PDF üzerinde
çalıştığı için bu kurallar modele hiç gönderilmez ve "PDF'de yok" diye ihlal sayılmaz.
Her kriter kanıtının nerede olduğunu söyleyen bir alan taşır:

| Değer | Rapor analizindeki davranış |
| --- | --- |
| `PDF_DENETLENEBILIR` | AI kriteri rapor PDF'i üzerinde değerlendirir. |
| `HARICI_KANIT_GEREKLI` | "PDF üzerinden değerlendirilemez; harici kanıt kontrol edilmeli" olarak işaretlenir. |
| `HAKEM_KONTROLU_GEREKLI` | Karar hakeme bırakılır. |

Son iki tür hata sayaçlarına girmez, aşama sonucunu kötüleştirmez, zorunlu olsa bile
kritik hata doğurmaz ve yarışmacı geri bildirimine "eksik" olarak yazılmaz. Hakem
ekranında AYRI ve açık bir bölümde listelenir. Yarışma Yöneticisi kriterin bu türünü
Kriter Atölyesi'nden değiştirebilir.

### Kriter sürümleri ve değerlendirme bütünlüğü

Yarışma Yöneticisi kriterleri her yayımladığında `criteria_profile_versions` tablosuna
**yeni ve değişmez** bir satır yazılır (`criteria_version`, `criteria_hash`,
`published_at`, `published_by`). Var olan satır asla güncellenmez.

- Hakem analizi DAİMA son yayımlanan sürümü kullanır.
- Kaydedilen sonuç, üretildiği kriter sürümüne ve katılımcı PDF'inin SHA-256'sına
  bağlanır. Sunucu kaydetmeden önce bu bağı yeniden çözüp karşılaştırır; uyuşmazlıkta
  kayıt yapılmaz ve anlaşılır bir hata döner.
- Kriterler analizden sonra değişirse eski analiz "eskimiş" sayılır: ekranda
  **"Kriterler güncellendi, yeniden analiz gerekli"** uyarısı çıkar ve sunucu bu analiz
  üzerine nihai karar verilmesini reddeder.
- Geçmiş değerlendirmeler kendi sürümleriyle korunur; yeni kriterlerle sessizce değişmez.

Kriterin **kaynak sayfası ve kaynak alıntısı** ilk yayımda kilitlenir. Arayüzde salt
okunurdur; istek elle düzenlense bile sunucu ilk değeri geri koyar ve işlemi denetim
izine yazar. Kaynak yanlışsa çözüm elle düzeltmek değil, **"Yeniden analiz et"** ya da
kriteri silip yerine yenisini oluşturmaktır. Elle eklenen kriterlerde kaynak boş kalır
ve "Manuel kriter" olarak işaretlenir.

### Benzerlik

Ham rapor metni benzerlik veritabanında saklanmaz. Metinden geri döndürülemez, 64 parçalı MinHash izi çıkarılır. Yalnızca aynı yarışma + yıl + aşamadaki izlerle karşılaştırılır. Sonuç Hakeme yüzde ve en yakın takım adıyla **yalnızca işaret** olarak sunulur; otomatik intihal, ret veya diskalifiye kararı verilmez.

Anlamsal embedding katmanı bu sürümde dış servise ayrıca rapor metni göndermemek için etkin değildir. Daha sonra açık veri aktarım onayı, gizlilik politikası ve maliyet ölçümüyle eklenebilir.

## Değerlendirme Yöneticisi

- İlk atamayı sistem yapar; 04 atanamayan başvuruları görür ve elle atar.
- Hakem başına aktif, tamamlanan ve hatalı dosya sayılarını görür.
- Atanmış raporu başka Hakeme aktarabilir ve sistem içi hatırlatma oluşturabilir.
- Başarısız AI analizini yeniden sıraya alabilir veya yarışmacıdan yeni PDF isteyebilir.
- Yarışmayı **aktif/pasif** yapabilir ve ÖNCELİKLİ işaretleyebilir.
- Her yayımlanmış yarışma için aktif/pasif durumu, toplam başvuru, analizi tamamlanan,
  analiz bekleyen, onaylanan, reddedilen sayılarını ve hakemlere göre iş yükünü görür.
- Arşivleme kayıtlarını (hangi yarışma/başvuru, kim, ne zaman, hangi gerekçe, önceki ve
  yeni durum) **yalnızca görüntüler**; kayıtları değiştiremez.
- Katılımcı PDF'ini, kanıt alıntılarını ve özel proje içeriğini göremez.

## Aktif / pasif yarışma ve arşivleme

**Aktif/pasif** süreç aşamasından bağımsız bir anahtardır ve hem Yarışma Yöneticisi
(kendi yarışmasında) hem Değerlendirme Yöneticisi tarafından çevrilebilir.

| | Aktif | Pasif |
| --- | --- | --- |
| Yarışmacı listesi | görünür | görünmez |
| Yeni başvuru | kabul edilir | kabul edilmez |
| Hakem geçmiş başvuruları | görünür | görünür |
| İzin verilen karar düzeltmeleri | yapılabilir | yapılabilir |
| Yeni değerlendirme kuyruğu | oluşur | oluşmaz |

Değişiklik ilgili bütün panellere aynı sorgudan yansır. Pasifleştirme hiçbir kaydı
silmez ve aşamayı geri almaz.

**Arşivleme soft delete'tir.** Yarışma Yöneticisi kendi eski yarışmalarını, Hakem ise
kendisine atanmış bir başvuruyu aktif listesinden kaldırabilir. Hiçbiri fiziksel silme
değildir: kayıt, PDF ve değerlendirme geçmişi yerinde kalır; `deleted_at`, `deleted_by`
ve gerekçe yazılır, işlem denetim izine düşer ve Değerlendirme Yöneticisi panosunda
görünür.

## Admin ve giriş

- Personel hesabı açar; 01, 02 ve 04 rollerini atar veya kaldırır; hesabı pasife alır.
- Her atama denetim izine yazılır; atama geçmişini izler.
- Yarışma sürecine, kriterlere, başvurulara ve değerlendirmeye erişmez.

**Giriş** tek formdur: kullanıcı adı (veya e-posta) + şifre. Rol SEÇİLMEZ; sistem
hesabı D1'den doğrular ve rolüne göre doğru paneli açar. Parolalar PBKDF2-SHA256 ile
özetlenir, açık metin saklanmaz. Şifresiz rol kısayolları kaldırılmıştır.

Sistemde hiç Admin yokken ve ortam üretim DIŞI iken giriş ekranında tek seferlik
**Kurulum Admini** (`admin` / `1234`) açılabilir. İşlem idempotenttir: ikinci çağrı
ikinci bir Admin üretmez. Bu hesap yalnızca geliştirme ve demo içindir; üretimde uç
404 döner.

## Yarışma durumları

`Kriter taslağı → AI kriter işlemi → Kriter inceleme → Başvuruya açık → Başvurular kapalı → Değerlendiriliyor → Kararlar donduruldu → Sonuçlar yayımlandı → Arşiv`

Kararlar dondurulmadan önce bütün başvurular tamamlanmış olmalıdır. Aşama geçişlerini
yarışmanın SAHİBİ olan Yarışma Yöneticisi yapar; hiçbir rol geçersiz bir aşamayı
atlayamaz. Aktif/pasif anahtarı bu zincirden ayrıdır ve aşamayı değiştirmez.

## Veritabanı

Cloudflare D1 içinde hesaplar, oturumlar, roller, yarışmalar, kriterler, başvurular, PDF sürüm kayıtları, Hakem atamaları, AI çıktıları, nihai kararlar, MinHash izleri ve işlem geçmişi saklanır. JSON alanları D1 uyumu için `TEXT` tutulur. Katılımcı PDF dosyaları özel Cloudflare R2 deposundadır.

`criteria` tablosunda dört aşamalı model şu şekilde tutulur: `applicability` sütunu kriterin **aşamasını** (`language_template`, `headings_content`, `category_similarity`, `criteria_evidence`), `effect` sütunu zorunluluğu (`required` / `other`) taşır; `max_score` her zaman `NULL` yazılır. Kriterin tam hâli `criterion_json` içindedir. Sütun adları eski şemadan korunmuştur; anlamları yukarıdaki gibidir.

`criteria_analysis_cache` tablosu şartname analizlerinin ham model çıktısını belge içeriği + analiz yapılandırması karmasıyla saklar; aynı belgenin yeniden analizi modele gitmeden bu kayıttan yanıtlanır (`docs/KALICI_ANALIZ_ONBELLEGI.md`).

SQL sırası:

1. `migrations/0001_admin.sql`
2. `migrations/0002_competition_workflow.sql`
3. `migrations/0003_application_teams_and_history.sql`
4. `migrations/0004_roles_v2.sql`
5. `migrations/0005_final_workflow.sql`
6. `migrations/0006_competition_priority.sql`
7. `migrations/0007_analysis_cache.sql`
8. `migrations/0008_integrity_and_lifecycle.sql`

`0008` eklemelidir ve hiçbir satır silmez: değişmez kriter sürümleri tablosu
(`criteria_profile_versions`), kriterin PDF'den denetlenebilirlik alanı, değerlendirme
sonucunun kriter sürümü ve PDF özeti bağı, yarışmanın aktif/pasif anahtarı, yarışma ve
başvuru için soft delete sütunları ve hesapların kullanıcı adı sütunu.

## Kontrol sonucu

Güncel test ve ölçüm sonuçları bu belgede tutulmaz; tek kaynak `PROJE_DURUMU.md`
dosyasıdır. Bu belge sistemin **ne yaptığını** anlatır, **hangi durumda olduğunu**
anlatmaz.

Canlı uçtan uca test için Cloudflare D1 ve R2 bağlarının çalıştığı `vinext dev` veya dağıtım ortamı gerekir. Bu Windows cihazında `workerd.exe` işletim sistemi politikası tarafından engellendiği için yerel D1 oturum testi açılamamaktadır; bu durum üretim derlemesindeki kod hatası değildir.
