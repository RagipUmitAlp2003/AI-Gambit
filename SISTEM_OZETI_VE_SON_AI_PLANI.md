# AI-Gambit — Sistem Özeti ve Son AI Aşaması Planı

**Dal:** `Deneme`

**Durum:** İkinci AI değerlendirme algoritması dışında sistem tamamlandı.

**Amaç:** TEKNOFEST benzeri yarışmalarda kriter belgesini yapılandırmak, katılımcı başvurularını toplamak ve hakeme güvenilir bir karar desteği sunmak.

## 1. Sistem ne yapıyor?

Sistem iki yapay zekâ aşamasından oluşur:

1. **Kriter çıkarma:** Yarışma yöneticisinin yüklediği resmî PDF analiz edilir. Yarışma bilgileri, teslim kuralları, kriterler, puanlar, cezalar ve eleme koşulları kaynak sayfalarıyla çıkarılır. Yönetici sonucu düzenleyip onaylar.
2. **Katılımcı raporu değerlendirme:** Katılımcının PDF'i, onaylanan kriterlere göre incelenir. Bu işlem yalnızca hakem istediğinde başlar. Bu ikinci aşamanın arayüzü ve veri akışı hazırdır; doğruluk algoritmasının son geliştirmesi aşağıda planlanmıştır.

Yapay zekâ hiçbir aşamada nihai karar vermez. Kriterleri yarışma yöneticisi, değerlendirme sonucunu hakem kesinleştirir.

## 2. Kullanıcılar ve yetkileri

### Baş Yönetici — Rol 00

- Yönetici hesaplarını oluşturur, rollerini değiştirir ve pasifleştirir.
- Kriter Atölyesi, Değerlendirme Atölyesi ve süreç görünümüne erişebilir.
- Yarışma yöneticisi ve hakemin yapabildiği işlemleri yapabilir.
- Katılımcının yüklediği PDF'i değiştiremez; sistemde böyle bir dosya değiştirme ucu yoktur.

### Yarışma Yöneticisi — Rol 01

- Resmî kriter PDF'ini yükler ve AI analizini başlatır.
- Çıkarılan kriterleri ekleyebilir, düzenleyebilir, pasifleştirebilir veya kaldırabilir.
- Kaynak sayfasını ve PDF'deki dayanak metni kontrol eder.
- Profili onaylayarak hakem değerlendirmesine açar.
- `Geçmiş ayıklamalar` bölümünde önceki analizlerini görür.
- `Onayladığı projeler` bölümünde kesinleştirdiği kriter profillerini topluca görür.
- Katılımcı başvurularına ve hakem kararlarına erişemez.

### Hakem / Değerlendirici — Rol 02

- Başvuru bulunan yarışmaları görür.
- Yarışmaya tıklayarak incelenmeyi bekleyen takımları açar.
- Takım veya ekip üyesi adıyla arama yapabilir.
- Katılımcı PDF'ini görüntüleyebilir.
- `AI ile değerlendir` düğmesine basarak ikinci AI aşamasını kendisi başlatır.
- AI bulgularını, kanıtları ve puan önerilerini inceler.
- Nihai puanı ve sonucu kendisi belirler.
- Sonuç olarak `Kabul`, `Ret` veya `Düzeltme gerekli` seçeneklerinden birini verir.
- Yarışmacıya gösterilecek açıklama ve geri bildirimi onaylar.

### Yarışmacı — Rol 03

- Kendi hesabını oluşturur ve giriş yapar.
- Listeden yarışma arar ve başvuru yapar.
- Başvuru sahibi adı, takım adı ve ekip üyelerini girer.
- Proje PDF'ini yükler. Bu yükleme AI analizini otomatik başlatmaz.
- Yalnızca kendi başvurularını ve PDF'lerini görebilir.
- Başvurusu önce `Gönderildi`, inceleme tamamlandıktan sonra `İnceleme sonucu` olarak görünür.
- Hakem kararını, sonuç açıklamasını ve onaylanmış geri bildirimi görür.

### Değerlendirme Yöneticisi — Rol 04

- Süreci salt okunur biçimde izler.
- Her yarışmanın başvuru, kabul, ret ve düzeltme sayılarını görür.
- Hangi takımın hangi yarışmada hangi sonucu aldığını görebilir.
- Onaylanan kaynak PDF'leri ve oluşturulan kriterleri görebilir.
- Katılımcı PDF'ini, e-posta adresini, ekip üyelerini veya proje içeriğini göremez.
- Hakem puanını ve sonucunu değiştiremez.

## 3. Başvuru ve değerlendirme akışı

1. Yarışma yöneticisi resmî kriter PDF'ini yükler.
2. Birinci AI aşaması PDF'den kriterleri çıkarır.
3. Yönetici kriterleri düzeltir ve profili onaylar.
4. Yarışmacı yarışmayı seçer, takım bilgilerini girer ve PDF'ini gönderir.
5. Başvuru hakem havuzunda ilgili yarışmanın altında görünür.
6. Hakem başvuruyu seçer ve isterse `AI ile değerlendir` düğmesine basar.
7. İkinci AI aşaması raporu onaylı kriter profiline göre inceler.
8. Hakem AI bulgularını kontrol eder, nihai puanı ve sonucu verir.
9. Sonuç yarışmacının panelinde görünür.
10. Değerlendirme yöneticisi sürecin sayılarını ve durumunu izler.

## 4. Veriler nerede saklanıyor?

### Cloudflare D1 — SQL veritabanı

D1 içinde şunlar saklanır:

- yönetici ve yarışmacı hesapları;
- oturumlar ve roller;
- onaylı kriter profilleri;
- kriter ayıklama geçmişi;
- başvuru sahibi ve takım bilgileri;
- ekip üyeleri;
- başvuru durumu;
- AI değerlendirme çıktısı;
- hakem kararı, sonuç ve geri bildirim;
- işlem geçmişi.

SQL göçleri sırayla uygulanmalıdır:

1. `migrations/0001_admin.sql`
2. `migrations/0002_competition_workflow.sql`
3. `migrations/0003_application_teams_and_history.sql`

### Cloudflare R2 — Özel dosya deposu

- Katılımcı PDF'lerinin gerçek dosya içeriği `REPORTS` adlı özel R2 deposunda saklanır.
- D1 yalnızca dosyanın kimliğini, sahibini, adını, boyutunu ve durumunu tutar.
- Katılımcı PDF'ini değiştiren bir API bulunmaz.
- PDF erişimi sunucu tarafında role ve sahipliğe göre kontrol edilir.

## 5. Eksik kalan ikinci AI aşaması

Eksik olan bölüm, katılımcı raporunun onaylı kriterlere göre **doğru, kanıtlı ve genellenebilir** biçimde değerlendirilmesidir. Arayüz, hakem düğmesi, PDF aktarımı, profil bağlantısı, kayıt sözleşmesi ve sonuç saklama sistemi hazırdır. Tamamlanması gereken bölüm analiz motorunun doğruluk katmanıdır.

Bu aşama tek bir büyük modele “PDF'i değerlendir” diyerek yapılmamalıdır. En güvenli yaklaşım, kesin kontroller ile yapay zekâyı ayıran çok aşamalı bir algoritmadır.

## 6. Önerilen değerlendirme algoritması

### Aşama A — Başvuru paketini doğrula

Analiz başlamadan önce sistem şunları yükler:

- katılımcı PDF'i;
- başvurunun bağlı olduğu yarışma;
- yarışma yöneticisinin onayladığı kriter profili;
- profil sürümü ve kaynak PDF bilgisi.

Başvuru ile kriter profilinin yarışma kimliği eşleşmiyorsa analiz başlamaz. Böylece yanlış yarışmanın kriterleri yanlış rapora uygulanmaz.

### Aşama B — Kesin dosya kontrolleri

Yapay zekâ kullanılmadan yapılabilecek kontroller önce çalışır:

- gerçek PDF imzası;
- dosya formatı;
- dosya boyutu;
- sayfa sayısı;
- PDF'de açıkça belirtilmiş dosya ve sayfa sınırları;
- metnin okunabilir olup olmadığı;
- parola koruması veya bozuk dosya durumu.

Bir kontrol kriter PDF'inde tanımlanmamışsa yarışma kuralı olarak uygulanmaz. Sistemin teknik kapasite sınırı ile yarışmanın resmî kuralı birbirine karıştırılmaz.

### Aşama C — PDF'i sayfa ve bölüm yapısına ayır

1. Her sayfanın metni çıkarılır.
2. Metin çok azsa sayfanın taranmış görüntü olabileceği anlaşılır ve OCR uygulanır.
3. Başlıklar, tablolar, görseller, ekler ve ana bölümler belirlenir.
4. Her metin parçası için sayfa numarası ve konum bilgisi korunur.

Çıktı, örneğin şu bölümlere ayrılır:

- problem tanımı;
- çözüm önerisi;
- yöntem;
- özgünlük;
- teknik tasarım;
- iş planı;
- riskler;
- bütçe;
- kaynakça.

Belgede bu başlıklar yoksa sistem başlık uydurmaz; yalnızca bulunan yapıyı kaydeder.

### Aşama D — Her kriter için ilgili kanıtı bul

Her kriter bütün PDF'e tek seferde sorulmaz. Bunun yerine:

1. Kriterin adı, açıklaması, kapsamı ve kaynak metni okunur.
2. Katılımcı PDF'indeki en ilgili bölümler anahtar kelime ve anlamsal benzerlikle bulunur.
3. En güçlü kanıt parçaları sayfa numaralarıyla seçilir.
4. Yeterli kanıt bulunamazsa kriter `Kanıt bulunamadı` veya `İnsan incelemesi gerekli` olarak işaretlenir.

Bu yaklaşım küçük bir RAG sistemi gibidir: model yalnızca ilgili sayfaları ve kriteri görür. Böylece token maliyeti ve ilgisiz yorum riski azalır.

### Aşama E — Kriter türüne uygun değerlendirme yap

Her kriter aynı yöntemle değerlendirilmez:

- **Kesin uygunluk kriteri:** Kural motoru kontrol eder; AI yalnızca açıklama sağlar.
- **Puan kriteri:** AI kanıt ve puan önerisi verir, nihai puanı hakem girer.
- **Ceza kriteri:** İhlalin oluşup oluşmadığı belirlenir; cezanın uygulanmasına hakem karar verir.
- **Baraj kriteri:** Eşik kontrol edilir; eksik veya belirsiz kanıt varsa otomatik elenmez.
- **Eleme kriteri:** Yalnızca PDF'de açık eleme sonucu varsa aday ihlal olarak gösterilir; nihai eleme hakeme aittir.
- **Fiziksel/saha kriteri:** PDF'den kesin doğrulanamayacağı için `İnsan veya saha kontrolü gerekli` denir.

AI her kriter için yapılandırılmış şu çıktıyı üretmelidir:

- kriter kimliği;
- durum: karşılandı, kısmen karşılandı, karşılanmadı, bulunamadı veya insan incelemesi gerekli;
- önerilen puan;
- kısa gerekçe;
- kanıt sayfası ve alıntısı;
- güven seviyesi;
- insan kontrolü gerekip gerekmediği.

### Aşama F — İkinci doğrulama turu

İlk model çıktısı doğrudan hakeme gönderilmez. Ayrı bir doğrulama katmanı şunları denetler:

- gösterilen alıntı gerçekten belirtilen sayfada var mı;
- model belgede olmayan bir bilgi eklemiş mi;
- önerilen puan 0 ile kriterin azami puanı arasında mı;
- aynı kanıt ilgisiz birden fazla kriter için kullanılmış mı;
- birbiriyle çelişen bulgular var mı;
- kesin kontrol ile AI yorumu çelişiyor mu;
- bütün aktif puan kriterleri değerlendirildi mi;
- toplam puan resmî ölçeği aşıyor mu;
- eleme, ceza ve baraj birbirine karıştırılmış mı.

Doğrulamadan geçmeyen bulgu pasifleştirilmez veya gizlenmez. Hakeme `Doğrulanamadı — manuel inceleme gerekli` şeklinde gösterilir.

### Aşama G — Benzerlik ve özgünlük kontrolü

Problem 4'teki başvurular arası benzerlik için iki yöntem birlikte kullanılmalıdır:

1. **Metinsel benzerlik:** n-gram, MinHash veya benzeri yöntemlerle aynı ya da çok yakın cümleler bulunur.
2. **Anlamsal benzerlik:** bölüm metinlerinin embedding değerleri karşılaştırılır.

Önce hızlı yöntem olası benzer başvuruları seçer, sonra yalnızca bu aday çiftlerde ayrıntılı karşılaştırma yapılır. Sistem benzer sayfaları ve ortak metinleri hakeme gösterir; otomatik intihal veya ret kararı vermez.

### Aşama H — Kategori uygunluğu

- Yarışmanın kategori tanımı ve katılımcının problem/çözüm bölümleri karşılaştırılır.
- Model kategoriyle ilgili bulunan ve ilgisiz görünen noktaları kaynaklarıyla listeler.
- Yalnızca bir benzerlik yüzdesi verilmez; gerekçe ve kanıt gösterilir.
- Nihai kategori uygunluğu hakem tarafından onaylanır.

### Aşama I — Hakem ekranına aktar

Hakem şu sırayla ilerler:

1. kesin dosya kontrolleri;
2. olası eleme, ceza ve baraj bulguları;
3. kriter bazlı AI değerlendirmeleri;
4. kaynak kanıtları;
5. benzerlik ve kategori uyarıları;
6. puan girişleri;
7. kabul, ret veya düzeltme kararı;
8. yarışmacı geri bildirimi.

Hakem bütün zorunlu kararları vermeden `Değerlendirmeyi tamamla` düğmesi aktif olmamalıdır.

### Aşama J — Sonucu kaydet

Tamamlandığında D1'e şunlar yazılır:

- kullanılan profil kimliği ve sürümü;
- AI değerlendirme çıktısı;
- model ve analiz zamanı;
- kanıt sayfaları;
- hakemin AI önerilerinde yaptığı değişiklikler;
- nihai puan;
- kabul, ret veya düzeltme sonucu;
- yarışmacı geri bildirimi;
- işlemi yapan hakem ve zaman bilgisi.

Bu kayıt sonradan değişirse işlem geçmişine yeni bir kayıt eklenmelidir.

## 7. Model ve çağrı stratejisi

En güvenli ve ekonomik yöntem:

1. PDF metnini ve bölüm haritasını uygulama kodu hazırlar.
2. Kriterler benzer konu ve sayfa kapsamına göre küçük gruplara ayrılır.
3. Hızlı model kriter değerlendirmesini yapar.
4. Yalnızca düşük güvenli, çelişkili veya yüksek etkili kriterler güçlü yedek modele gönderilir.
5. Kaynak doğrulaması kodla ve gerekirse ayrı kısa model çağrısıyla yapılır.

Böylece her rapor için onlarca gereksiz tam-PDF çağrısı yapılmaz. Aynı PDF tekrar değerlendirildiğinde dosya özeti ve bölüm indeksleri önbellekten kullanılabilir; ancak profil sürümü değişirse değerlendirme önbelleği geçersiz sayılmalıdır.

## 8. Hata ve halüsinasyonu azaltan değişmez kurallar

- Kanıt yoksa puan veya kesin karar uydurma.
- Her AI bulgusunu sayfa ve metinle ilişkilendir.
- Fiziksel olarak doğrulanması gereken bir şeyi PDF'den kesinleşmiş gösterme.
- PDF'de açıkça yazmayan eleme veya ceza sonucu üretme.
- Düşük güveni gizleme; hakeme açıkça göster.
- AI puanını nihai puan olarak kaydetme; hakem onayı iste.
- Profil ve başvuru yarışması eşleşmeden analiz başlatma.
- Bozuk model çıktısını zaman aşımı gibi göstermeme; hata türlerini ayır.
- Aynı istek başarısız olduğunda kontrolsüz biçimde tekrar çağrı yapma.
- API anahtarını tarayıcıya, rapora veya Git deposuna yazma.

## 9. İkinci AI aşamasının tamamlanma ölçütleri

Algoritma tamamlandı denebilmesi için:

- farklı uzunluk ve yapıda en az 10 resmî kriter profiliyle çalışmalı;
- metin tabanlı ve taranmış PDF'leri ayırt edebilmeli;
- kriterlerin tamamını profil kimlikleriyle eşleştirmeli;
- her bulgu için doğrulanabilir sayfa kanıtı vermeli;
- kanıtsız bilgiyi kesin sonuç olarak göstermemeli;
- puan, ceza, baraj ve eleme türlerini karıştırmamalı;
- resmî puan toplamını aşmamalı;
- kategori ve benzerlik sonucunu otomatik ret kararına çevirmemeli;
- model/API hatasında başvuruyu kaybetmemeli;
- aynı başvuruda çift analiz başlatılmasını engellemeli;
- hakem tamamlamadan sonucu yarışmacıya göstermemeli;
- sonuç ve hakem değişikliklerini D1'e kaydetmeli.

Ölçüm için elle doğrulanmış bir cevap anahtarı hazırlanmalı ve her sürüm şu değerlerle karşılaştırılmalıdır:

- kriter yakalama oranı;
- yanlış kriter/bulgu oranı;
- doğru kaynak sayfası oranı;
- puan aralığı hatası;
- eleme/ceza/baraj sınıflandırma hatası;
- manuel inceleme gerektiren belirsiz bulgu oranı;
- ortalama analiz süresi ve API maliyeti.

## 10. Commit ve dağıtım öncesi kontrol listesi

- [x] TypeScript tip kontrolü başarılı.
- [x] ESLint başarılı.
- [x] Depo ve API anahtarı güvenlik kontrolü başarılı.
- [x] Regresyon testleri başarılı.
- [x] Toplam 33 test başarılı.
- [x] SQL takım, üye, sonuç ve analiz geçmişi testleri başarılı.
- [x] Üretim derlemesi başarılı.
- [x] D1 ve R2 bağlama adları tanımlı.
- [x] API anahtarı Git dışında tutuluyor.
- [ ] Gerçek Cloudflare ortamında D1 ve R2 kaynakları oluşturulmalı.
- [ ] Üç SQL migration sırasıyla uygulanmalı.
- [ ] Üretim sırları tanımlanmalı.
- [ ] İkinci AI algoritması gerçek ve sentetik raporlarla benchmark edilerek tamamlanmalı.

## 11. Önerilen commit mesajı

```text
feat: rol bazlı başvuru ve değerlendirme iş akışını tamamla
```

Bu committen sonra sistemin ana eksikliği yalnızca ikinci AI değerlendirme algoritmasının gerçek raporlarla doğruluk geliştirmesi ve benchmark sürecidir.
