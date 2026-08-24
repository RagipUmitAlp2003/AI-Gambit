# Kriter Atölyesi

TEKNOFEST benzeri yarışmalarda organizatörün yüklediği değerlendirme PDF'sini; kaynakları gösterilen, düzenlenebilir ve onaylanabilir bir kriter profiline dönüştüren ilk modül prototipidir.

## Bu sürümde çalışan akış

1. Görevli yarışmayı arama destekli listeden seçer (serbest metin de girilebilir); aşama, rapor türü ve katılımcı teslim sınırlarını tanımlar. Sağ paneldeki canlı önizleme her seçimde anında güncellenir.
2. Organizatörün kriter/şartname PDF'si yüklenir.
3. PDF, tablo ve sayfa yapısı korunarak sunucu üzerinden Gemini'ye gönderilir. Uzun şartnamelerde ilk çıkarımdan sonra bağımsız bir eksik-kural denetimi daha çalışır.
4. İlan edilen puan toplamı ve birbirini örtmeyen puan grupları ayrıca çıkarılır; grup toplamı ile PDF toplamı otomatik karşılaştırılır.
5. Kriter adı, kapsam/aşama, etki türü, puanı, zorunluluğu, ihlal sonucu, değerlendirme yöntemi, kaynak sayfası, ilgili metin ve sistem önerisi yöneticiye gösterilir.
6. Fiziksel güvenlik ve hakem uygunluğu maddelerinde sistem nihai karar vermez; bulgu üretir ve insan onayı ister.
7. Yönetici kriterleri düzenleyebilir, pasifleştirebilir, yenisini ekleyebilir veya manuel eklediği kriteri onaylı bir silme akışıyla kaldırabilir. Geçiş koşulları, barajlar, cezalar ve eleme maddeleri "Karar kuralları" bölümünde ayrıca gösterilir. İlan edilen toplam puan varsa sonuçların 100 üzerinden gösterimi için normalizasyon formülü profile eklenir (orijinal puan sistemi korunur).
8. Yönetici kaynakları ve çakışmaları doğruladıktan sonra profil onaylanır ve JSON olarak indirilebilir. Ayrı aşamalara ait puanlar bulunan şartnamelerde toplamın 100 olması zorunlu tutulmaz.

Seçilen PDF, analiz taslağı ve kriter düzenlemeleri tarayıcıda yerel olarak saklanır. Yönetici önceki adımlara dönebilir veya sayfayı yenileyebilir; yalnızca yeni bir belge seçmesi ya da “Taslağı sıfırla” işlemi mevcut analizi temizler.
## Moderatör paneli (Rol 00)

`/moderator` adresindeki panel oturum açmayı zorunlu kılar. Veriler Cloudflare D1 üzerindeki yönetici veri tabanına yazılır; şema uygulama tarafından ilk istekte kurulur (`app/lib/admin-db.ts`, referans SQL: `migrations/0001_admin.sql`).

### Kimlik doğrulama ve yetkilendirme

Yetki kararı tamamen sunucudadır; arayüzde bir bölümü gizlemek güvenlik sayılmaz.

- Giriş: e-posta + şifre → hesap D1'den bulunur → `status === "active"` doğrulanır → PBKDF2 özeti sabit sürede karşılaştırılır → imzalı oturum çerezi verilir.
- Oturum jetonu rastgele üretilir, çerezde `MODERATOR_SECRET` ile HMAC-SHA256 imzalanır ve veri tabanında yalnızca SHA-256 özeti tutulur. Çerez `HttpOnly`, `SameSite=Strict` ve üretimde `Secure` işaretlidir; ömrü 8 saattir.
- Her istekte imza, veri tabanı kaydı, süre ve hesabın hâlâ aktif olduğu yeniden denetlenir. Rolü kaldırılan bir hesabın açık oturumu anında geçersizdir.
- Oturum yoksa `401`, oturum var ama rol yetmiyorsa `403` döner.
- `/api/admin/accounts`, `/api/admin/outbox`, `/api/admin/audit` ve belge akışı yazma uçları yalnızca **aktif Rol 00** hesabına açıktır. Rol 01-04 belge akışını okuyabilir, değiştiremez.
- Çıkış oturum kaydını siler; aynı çerez bir daha kabul edilmez.

**Fail-closed:** `MODERATOR_SECRET` tanımlı değilse hiçbir yönetici ucu açık kalmaz; giriş dâhil tüm istekler `503 — Kimlik doğrulama yapılandırması eksik` döner.

### İlk kurulum

Veri tabanında hiç hesap yokken `MODERATOR_BOOTSTRAP_TOKEN` ile ilk Rol 00 hesabı açılır (`/moderator` ekranındaki kurulum sekmesi). Hesap oluştuğu anda uç kapanır ve sonraki çağrılar `409` döner; kurulumdan sonra token değişkenini boşaltın.

### Kısım 1 — Yönetici atama paneli

1. Atanacak kişinin **İsim Soyisim**, **e-posta** ve **rol numarası** (00-04) girilir. Rol allowlist ile doğrulanır; `05`, `admin`, `-1` gibi değerler reddedilir.
2. Şifre ya sistem tarafından üretilir (8 hane; `0/O`, `1/I/l` gibi karışabilen karakterler dışarıda bırakılır) ya da elle girilir (en az 8 karakter).
3. Hesap veri tabanına kaydedilir ve rol bilgisini içeren bildirim e-posta adresine gönderilir. "Atamayı yapan" alanı oturumdaki hesaptan alınır; istemciden gelen değer kabul edilmez.
4. Tek kullanımlık şifre yalnızca oluşturma yanıtında bir kez döner ve ekranda bir kez gösterilir. Veri tabanında sadece PBKDF2-SHA256 özeti (150.000 tur, hesaba özel 16 baytlık tuz) tutulur; bildirim kaydındaki gövdede şifre maskelidir. Hesap listesi, giden kutusu ve denetim izi hiçbir zaman açık şifre döndürmez.
5. E-posta karşılaştırması normalize edilir: baştaki/sondaki boşluk ve büyük/küçük harf farkı yeni hesap açtırmaz.
6. Rol çıkarma iki aşamalıdır: **Rolü kaldır** hesabı pasife alır, gerekçeyi saklar, açık oturumlarını düşürür; **Kalıcı sil** kaydı tamamen kaldırır.
7. **Son aktif 00 koruması** veri tabanında tek bir SQL ifadesinin `WHERE` koşulunda uygulanır — istemciden gelen bir bayrakla atlatılamaz ve eşzamanlı iki istek sistemi sıfır moderatörle bırakamaz. Son 00 hesabı pasife alınamaz, silinemez ve rolü düşürülemez; önce başka bir hesaba 00 rolü verilmelidir.

### Kısım 2 — Yarışma bazlı belge akışı

Her kayıt bir yarışmaya bağlıdır: yarışma adı, belge başlığı, **belgeyi oluşturan**, **belgenin özeti**, devir zinciri ve 04 sonrası nihai belge.

- Devirde alıcı ve (oluşturan dışındaki) gönderen, sistemde **kayıtlı ve aktif** bir hesapla eşleşmelidir. Olmayan veya pasif bir kullanıcıya devir reddedilir.
- Kaydedilmiş devir geçmişi değiştirilemez: güncelleme künyeyi değiştirir ve yalnızca yeni devirleri ekler; kimliği olan satırlar sunucuda yok sayılır. Panelde bu satırlar kilitli görünür.

### Kısım 3 — Denetim izi

Giriş/çıkış, pasif hesapla giriş denemesi, hesap oluşturma, rol değişimi, rol kaldırma, yeniden aktifleştirme, kalıcı silme ve belge akışı işlemleri; işlemi yapan hesap, hedef kayıt ve zaman damgasıyla saklanır. Kayıtlarda parola, oturum jetonu veya API anahtarı bulunmaz.

### Mail yapılandırması

`RESEND_API_KEY` ve `MAIL_FROM` tanımlıysa bildirim Resend üzerinden gönderilir. Geliştirmede tanımlı değilse bildirim panel içindeki giden kutusuna alınır. **Üretimde** (`APP_ENV=production`) bu yedek kapalıdır: gönderilemeyen bildirim "başarısız" olarak işaretlenir ve panelde uyarı gösterilir, sessizce bekliyor gibi görünmez.

### Veri tabanı

`.openai/hosting.json` içindeki `d1` alanı bağlama adını verir (`DB`). Bağlama yoksa yönetici uçları kısa bir `503` döndürür; bağlama adı, yapılandırma yolu ve yığın izi istemciye gitmez, yalnızca sunucu logunda kalır. Şemayı elle kurmak için:

```bash
npx wrangler d1 execute <veritabani-adi> --file=migrations/0001_admin.sql
```

### Yönetici sistemi dosyaları

- `app/moderator/page.tsx` + `app/components/moderator-app.tsx`: panel kabuğu, oturum durumu ve bölüm geçişi
- `app/components/moderator-login.tsx`: giriş ve ilk kurulum ekranı
- `app/components/admin-accounts-panel.tsx`: Kısım 1 (hesap açma, rol değiştirme/kaldırma, bildirim kayıtları)
- `app/components/document-flow-panel.tsx`: Kısım 2 (belge akışı, devir zinciri, salt-okunur mod)
- `app/components/audit-panel.tsx`: Kısım 3 (denetim izi)
- `app/lib/session.ts`: oturum jetonu, HMAC imzası ve çerez biçimi
- `app/lib/admin-guard.ts`: kimlik/rol kontrolü, girdi doğrulama ve güvenli hata yanıtları
- `app/lib/admin-db.ts`: D1 şeması, sorgular, atomik son-00 koruması, oturum ve denetim kayıtları
- `app/lib/password.ts`: şifre üretimi ve PBKDF2 özeti
- `app/lib/mailer.ts`: Resend gönderimi ve ortam duyarlı giden kutusu
- `app/api/admin/session`: giriş, çıkış, mevcut oturum
- `app/api/admin/bootstrap`: ilk 00 hesabının kurulumu
- `app/api/admin/*`: hesap, belge akışı, giden kutusu ve denetim uçları

## Gemini yapılandırması

Gerçek sağlayıcı sunucu tarafındaki `app/api/analyze/route.ts` uç noktasıdır. API anahtarı yalnızca `.env.local` içinde tutulur; tarayıcı koduna ve Git'e dahil edilmez. Birincil model `gemini-3.7-flash`, geçici yoğunluk halinde yedek model `gemini-3.5-flash` olarak ayarlanmıştır.

Yerel ortam değişkenleri `.env.example` örneğine göre tanımlanır. Bu prototip doğrudan PDF aktarımında 18 MB sınırı uygular. Daha büyük kaynaklar için Gemini Files API akışı eklenmelidir. `app/lib/demo-analyzer.ts` çevrimdışı geliştirme ve karşılaştırma için korunmuştur; normal arayüz akışında kullanılmaz.

Aynı belge + aynı bağlam yeniden analiz edilirse sunucu içi önbellek (SHA-256 hash) sayesinde model tekrar çağrılmaz. Her analiz için süre ve token kullanımı `diagnostics` alanında döner; oturum toplamları (istek sayısı, giriş/çıkış token, ortalama süre, hata oranı) `GET /api/metrics` ucundan okunur. Resmî kota takibi Google AI Studio üzerinden yapılır. Kullanıcı arayüzünde model/sağlayıcı adı gösterilmez.

## Yerel çalıştırma

```bash
npm install
npm run dev
```

Uygulama varsayılan olarak `http://localhost:3000` adresinde açılır.

## Test belgeleri

- `output/pdf/Ornek_Akilli_Ulasim_OTR_Degerlendirme_Kilavuzu.pdf`: sentetik, kısa karşılaştırma belgesi.
- `output/pdf/official/2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf`: resmî 2026 TEKNOFEST şartnamesi.
- `output/pdf/official/2026_Insansiz_Deniz_Araci_Sartnamesi.pdf`: resmî 2026 TEKNOFEST şartnamesi.
- `output/pdf/official/2026_Insansiz_Su_Alti_Sistemleri_Sartnamesi.pdf`: resmî 2026 TEKNOFEST şartnamesi.

Belgelerin tümü uygulamadaki “Hazır test belgeleri” bölümünden seçilebilir. Resmî PDF'ler değiştirilmeden yerel test kütüphanesine alınmıştır. Görevli, “Görevli belge havuzu” panelinden kendi şartname/kılavuz/ek kriter dokümanlarını da ekleyebilir, görüntüleyebilir, analiz için seçebilir ve silebilir; bu belgeler tarayıcı deposunda saklanır. Havuza tek seferde en fazla 20 belge birlikte eklenebilir: her dosya kendi başlığıyla ayrı kayıt olur, desteklenmeyen tür veya boş dosya listede gerekçesiyle işaretlenip dışarıda bırakılır, 18 MB üzerindeki belgeler uyarıyla saklanır. Kaynak belge adımı ise tek PDF alır; birden fazla dosya bırakıldığında hangisinin kullanıldığı açıkça söylenir.

## Ana dosyalar

- `app/components/criteria-app.tsx`: dört adımlı yönetici akışı
- `app/components/competition-select.tsx`: arama destekli yarışma seçici
- `app/components/template-preview.tsx`: sağ panel canlı şablon önizlemesi
- `app/components/document-library-panel.tsx`: görevli belge havuzu yönetimi
- `app/components/file-badge.tsx`: dosya türüne göre renkli ikon
- `app/lib/competitions.ts`: kayıtlı yarışma listesi ve filtreleme
- `app/lib/evaluation-summary.ts`: 100'e normalizasyon ve geçiş/baraj/ceza/eleme kural çıkarımı
- `app/lib/document-library.ts`: tarayıcı içi belge havuzu deposu
- `app/lib/usage-metrics.ts` + `app/api/metrics/route.ts`: API kullanım sayaçları
- `app/api/analyze/route.ts`: güvenli Gemini çağrısı, yapılandırılmış çıktı, önbellek ve yönetici kuralı birleştirme
- `app/lib/gemini-analyzer.ts`: tarayıcıdan sunucu analiz uç noktasına bağlantı
- `app/lib/pdf-reader.ts`: tarayıcı içi PDF doğrulama ve sayfa sayısı
- `app/lib/draft-store.ts`: adımlar arası ve sayfa yenileme sonrası taslak kalıcılığı
- `app/lib/demo-analyzer.ts`: çevrimdışı karşılaştırma sağlayıcısı
- `app/lib/types.ts`: kriter ve profil veri modeli
- `tools/create_sample_pdf.py`: sentetik PDF üreticisi
- `DESIGN.md`: arayüz tasarım sistemi
- `PRODUCT.md`: ürün kapsamı ve değişmez ilkeler

## Karşılaştırma testi

`docs/benchmarks/celikkubbe-expected.json`, Çelikkubbe şartnamesi için PDF'den elle doğrulanmış beklenen puan planı ve kritik bulguları içerir. Yerel uygulama çalışırken aşağıdaki komut gerçek Gemini çıktısını bu referansla karşılaştırır:

```bash
node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze
```

Sonuç `output/benchmarks/celikkubbe-latest.json` dosyasına yazılır.
