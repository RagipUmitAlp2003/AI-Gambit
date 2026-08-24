# Durum Raporu — Moderatör Paneli ve Güvenlik Sertleştirme

**Dal:** `Login_branch` · **Tarih:** 25 Ağustos 2026 · **Durum:** Çalışıyor, commit edilmedi

Bu belge iki turluk çalışmanın sonucudur:

1. **Tur 1 —** Rol 00 (moderatör) panelinin sıfırdan kurulması: yönetici atama, D1 kaydı, e-posta bildirimi, belge devir zinciri.
2. **Tur 2 —** Güvenlik sertleştirme: kimlik doğrulama, rol bazlı yetkilendirme, secret temizliği, fail-safe davranış ve çoklu dosya yükleme hatasının giderilmesi.

Çalışmanın tamamı `Login_branch` üzerinde ve **henüz commit edilmedi**. `main`'e göre 8 dosya değişti (+498/−51), 18 yeni dosya eklendi.

---

## 1. Yapılanlar

### 1.1 Moderatör paneli (`/moderator`)

Üç bölümlü panel. Bölüm görünürlüğü role göre değişir; asıl yetki kararı sunucudadır.

| Bölüm | Kim görür | Ne yapar |
|---|---|---|
| Kısım 1 — Yönetici atama | Yalnızca Rol 00 | Hesap açma, rol atama/değiştirme/kaldırma, kalıcı silme, bildirim kayıtları |
| Kısım 2 — Belge akışı | 00 yazar, 01–04 okur | Yarışma bazlı belge künyesi ve `oluşturan → 01 → 02 → 03 → 04` devir zinciri |
| Kısım 3 — Denetim izi | Yalnızca Rol 00 | Kritik işlemlerin kim/ne zaman/ne kaydı |

### 1.2 Kimlik doğrulama ve oturum

- **Giriş akışı:** e-posta + şifre → hesap D1'den bulunur → `status === "active"` kontrol edilir → PBKDF2 özeti sabit sürede karşılaştırılır → imzalı oturum çerezi verilir.
- **Oturum jetonu:** 32 bayt rastgele. Çerezde `MODERATOR_SECRET` ile HMAC-SHA256 imzalanır; veri tabanında yalnızca SHA-256 özeti tutulur. Ham jeton hiçbir yerde saklanmaz.
- **Çerez:** `HttpOnly`, `SameSite=Strict`, üretimde `Secure`. Ömrü 8 saat, yenileme yok.
- **Her istekte** imza, veri tabanı kaydı, süre ve hesabın hâlâ aktif olduğu yeniden denetlenir. Rolü kaldırılan hesabın açık oturumu anında geçersizdir.
- **Çıkış** oturum kaydını siler; aynı çerez bir daha kabul edilmez.
- **İlk kurulum:** veri tabanında hiç hesap yokken `MODERATOR_BOOTSTRAP_TOKEN` ile ilk Rol 00 hesabı açılır. Hesap oluştuğu an uç kapanır (sonraki çağrılar 409).

### 1.3 Yetkilendirme

- Oturum yoksa `401`, oturum var ama rol yetmiyorsa `403`.
- `/api/admin/accounts`, `/api/admin/outbox`, `/api/admin/audit` ve belge akışı **yazma** uçları yalnızca aktif Rol 00'a açık.
- Rol 01–04 belge akışını okuyabilir, değiştiremez.
- Arayüzde bölüm gizlemek güvenlik olarak sayılmadı; her uç kendi kontrolünü yapıyor.

### 1.4 Fail-safe davranış

`MODERATOR_SECRET` tanımlı değilse **hiçbir yönetici ucu açık kalmaz**. Giriş dâhil tüm istekler `503 — Kimlik doğrulama yapılandırması eksik` döner. Daha önce geçerli olan bir çerezle bile 503 alınır.

### 1.5 Parola güvenliği

- 8 haneli tek kullanımlık şifre; `0/O`, `1/I/l` gibi karışabilen karakterler alfabeden çıkarıldı, modulo sapması reddetme örneklemesiyle önlendi.
- PBKDF2-SHA256, 150.000 tur, hesaba özel 16 baytlık rastgele tuz. Doğrulama sabit sürede; bozuk/eksik özet kaydı istisna fırlatmaz, `false` döner.
- Açık şifre **yalnızca** hesap oluşturma yanıtında bir kez döner ve ekranda bir kez gösterilir.
- Bildirim kaydındaki gövdede şifre maskelidir (`••••••••`). Hesap listesi, giden kutusu ve denetim izi hiçbir zaman açık şifre veya özet döndürmez.

### 1.6 Son aktif Rol 00 koruması

Koruma veri tabanında **tek bir SQL ifadesinin `WHERE` koşulunda** uygulanır:

```sql
AND (role_code <> '00' OR (SELECT COUNT(*) FROM admin_accounts
     WHERE role_code = '00' AND status = 'active') > 1)
```

Bu nedenle istemciden gelen bir bayrakla atlatılamaz ve eşzamanlı iki istek sistemi sıfır moderatörle bırakamaz. Son 00 hesabı pasife alınamaz, silinemez ve rolü düşürülemez.

> **Not:** İlk turda bulunan `force=1` bayrağı kaldırıldı. Artık son 00 hesabını kaldırmak için önce başka bir hesaba 00 rolü verilmesi gerekiyor.

### 1.7 Belge devir yetkilendirmesi

- Devirde alıcı ve (oluşturan dışındaki) gönderen, sistemde **kayıtlı ve aktif** bir hesapla eşleşmelidir. Olmayan veya pasif kullanıcıya devir reddedilir.
- **Devir geçmişi değiştirilemez:** güncelleme künyeyi değiştirir ve yalnızca yeni devirleri ekler; kimliği olan satırlar sunucuda yok sayılır. Panelde bu satırlar kilitli görünür.

### 1.8 Denetim izi

Giriş, çıkış, pasif hesapla giriş denemesi, hesap oluşturma, rol değişimi, rol kaldırma, yeniden aktifleştirme, kalıcı silme, belge akışı oluşturma/güncelleme/silme ve devir ekleme kayıtlanır. İşlemi yapan hesap, hedef kayıt, işlem türü, zaman damgası ve gerekçe tutulur. Kayıtlarda parola, oturum jetonu veya API anahtarı **bulunmaz**.

### 1.9 E-posta

Çift modlu: `RESEND_API_KEY` + `MAIL_FROM` tanımlıysa gerçek gönderim, değilse panel içi giden kutusu. **Üretimde** (`APP_ENV=production`) giden kutusu yedeği kapalıdır — gönderilemeyen bildirim "başarısız" işaretlenir ve panelde uyarı çıkar, sessizce "bekliyor" görünmez. Sağlayıcı hata gövdesi istemciye gitmez, yalnızca sunucu logunda kalır.

### 1.10 Veri tabanı

Cloudflare D1. Şema uygulama tarafından ilk istekte kurulur; referans SQL `migrations/0001_admin.sql`.

| Tablo | İçerik |
|---|---|
| `admin_accounts` | Hesap, rol, parola özeti, durum, kaldırma gerekçesi |
| `admin_sessions` | Oturum jetonu özeti, hesap, süre |
| `admin_audit_log` | Denetim izi |
| `admin_mail_outbox` | Gönderilen/bekleyen bildirimler (şifre maskeli) |
| `document_flows` | Belge künyesi ve nihai belge |
| `document_handoffs` | Devir zinciri (append-only) |

Bağlama yoksa uçlar kısa bir `503` döndürür; bağlama adı, yapılandırma yolu ve yığın izi istemciye gitmez.

### 1.11 Girdi doğrulama (tamamı sunucu tarafında)

- E-posta normalize edilir: baştaki/sondaki boşluk ve büyük/küçük harf farkı yeni hesap açtırmaz.
- Rol kodu allowlist ile doğrulanır; `05`, `admin`, `-1` reddedilir.
- Elle girilen şifre en az 8 karakter.
- Zorunlu alanlar, e-posta biçimi, alan uzunlukları ve devir listesi uzunluğu (en fazla 12) kontrol edilir.
- Doğrulama hatası `400`, çakışma `409` döner.
- "Atamayı yapan" alanı oturumdaki hesaptan alınır; istemciden gelen değer kabul edilmez.

### 1.12 Çoklu dosya yükleme

**Bulunan hata:** Görevli belge havuzunda dosya girişinde `multiple` yoktu ve yalnızca `files[0]` okunuyordu — birden fazla dosya seçildiğinde fazlası sessizce atılıyordu.

**Yapılan:**

- Havuz girişi çoklu seçime açıldı. Her dosya kendi düzenlenebilir başlığıyla ayrı kayıt olur.
- Tek partide en fazla 20 belge; fazlası uyarıyla dışarıda bırakılır.
- Uzantı allowlist'i sunucu tarafı mantığıyla değil ama `accept` ipucundan bağımsız olarak ayrıca doğrulanır (sürükle-bırak `accept`'i atlayabilir).
- Boş dosya reddedilir, 18 MB üzerindeki dosya uyarıyla saklanır.
- Bir dosya kaydedilemezse diğerleri eklenir; hangilerinin başarısız olduğu söylenir ve konsola yazılır.
- Aynı isimli iki dosya ayrı kayıt olur, üzerine yazılmaz (kimlik `crypto.randomUUID` ile üretiliyor).
- **Kaynak belge adımı bilinçli olarak tek dosya alır** (analiz hattı tek PDF üzerinden çalışıyor). Ancak artık birden fazla dosya bırakıldığında hangisinin kullanıldığı açıkça söyleniyor.

### 1.13 Yol boyunca çıkan ve düzeltilen hata: IndexedDB `VersionError`

`openDraftDatabase()` sabit sürümle (`indexedDB.open(DB_NAME, 2)`) açıyordu. Tarayıcıdaki kayıt daha yeni bir sürümdeyse — ör. başka bir dal ek depo oluşturmuşsa — `VersionError` alınıyor, `listLibraryDocuments()` bunu yutuyor ve **belge havuzu sessizce çalışmaz** hâle geliyordu. Test sırasında gerçekten bu duruma düşüldü (tarayıcıda sürüm 3, `report-pool` deposuyla).

Açılış sürümden bağımsız hâle getirildi: mevcut sürüm okunur, eksik depo varsa sürüm bir artırılarak yalnızca eksikler oluşturulur. Hatalar artık konsola yazılıyor.

### 1.14 Secret temizliği

`.env.example` içindeki gerçek `GEMINI_API_KEY` değeri kaldırıldı; dosya artık yalnızca değişken adları içeriyor. Kod içinde hardcoded secret taraması temiz.

---

## 2. Test sonuçları

### 2.1 Otomatik güvenlik koşusu — 54/54 geçti

Temiz veri tabanında koşuldu. Bölümler:

| Bölüm | Kapsam |
|---|---|
| A. Authentication | Oturumsuz 7 uç → hepsi 401 |
| B. Bootstrap | Durum sorgusu, yanlış anahtar 401, doğru anahtar 201, ikinci deneme 409 |
| C. Login | Yanlış şifre 401, olmayan hesap 401, büyük harfli e-posta ile doğru giriş 200, `HttpOnly` çerez |
| D. Rol 00 işlemleri | Liste 200, listede parola alanı yok, hesap oluşturma 201, bildirim gövdesinde açık şifre yok |
| E. Girdi doğrulama | Aynı e-posta 409, farklı büyük/küçük harf + boşluk 409, rol `05`/`admin`/`-1` 400, kısa şifre 400, boş isim 400, geçersiz e-posta 400 |
| F. Son 00 koruması | Pasife alma/silme/rol düşürme 409; iki 00 varken izin verilir; tekrar teke düşünce koruma geri gelir |
| G. Rol 01 yetkisi | Giriş 200; `accounts`/`outbox`/`audit`/hesap oluşturma/hesap silme/akış yazma → 403; akış okuma 200 |
| H. Belge devri | Olmayan kullanıcı 400, yanlış rol 400, geçerli devir 201, geçmiş değiştirme denemesi sonrası kayıt değişmedi |
| I. Pasif hesap | Rol kaldırma 200, giriş 403 "Hesap aktif değil.", eski oturum 401, pasif kullanıcıya devir 400 |
| J. Oturum | Çıkış 200, sonrasında 401 |

### 2.2 Ek olarak geçen manuel testler

- **Fail-safe:** `MODERATOR_SECRET` kaldırılıp sunucu yeniden başlatıldı → 4 uç + giriş + geçerli çerez, hepsi 503.
- **Kanarya şifre taraması:** bilinen bir şifreyle hesap açıldı; sqlite dosyasında, sunucu logunda, `/accounts`, `/outbox` ve `/audit` yanıtlarında **bulunamadı**.
- **PBKDF2 doğrulaması:** sqlite üzerinden — her hesapta farklı 16 baytlık tuz, 150.000 tur, 32 baytlık özet. Oturum jetonu 43 karakterlik SHA-256 özeti olarak saklanıyor (ham jeton yok).
- **Race condition:** iki paralel rol kaldırma isteği → biri 200, diğeri 409; bir aktif 00 kaldı.
- **Tarayıcı:** giriş ekranı, Rol 00 paneli, denetim izi görünümü, çıkış.
- **Çoklu dosya yükleme:** 6 dosya (biri geçersiz `.exe`, ikisi aynı isimli) → 5 kayıt, `.exe` gerekçesiyle reddedildi, aynı isimliler ayrı kayıt oldu; 22 dosya → 20'de kesildi + uyarı; 19 MB → uyarıyla saklandı; 0 bayt → reddedildi; tek dosya → çalışıyor.

### 2.3 Derleme

`tsc --noEmit`, `eslint` ve `npm run build` — üçü de temiz.

### 2.4 İlk koşudaki 10 hata (giderildi)

İlk güvenlik koşusunda 10 test kalmıştı. Nedeni kod hatası değildi: test betiği oturumdaki moderatörün **kendi** rolünü 01'e düşürüyor, sonraki adımlarda haklı olarak 403 alıyordu. Bu aslında yetkinin her istekte veri tabanından yeniden okunduğunu kanıtladı. Betik düzeltilip temiz veri tabanıyla yeniden koşuldu.

---

## 3. Hatalı / riskli olanlar

| # | Konu | Önem | Açıklama |
|---|---|---|---|
| 1 | **Sızmış Gemini API anahtarı** | Kritik | `.env.example` içindeki gerçek anahtar `472ebe0` commit'ine girmiş; `main` ve `Login_branch` dal uçlarında hâlâ mevcut ve uzak depoya push edilmiş. Çalışma ağacından kaldırıldı ama **geçmiş temizlenmedi**. Anahtar şu an itibarıyla geçerli kabul edilmelidir. **Google AI Studio üzerinden iptal edilip yenilenmeli.** Dış serviste iptali ben yapamam. |
| 2 | **`/api/analyze` korumasız** | Yüksek | Kimlik doğrulaması istemiyor ve her istek ücretli Gemini çağrısı üretiyor. Sertleştirme kapsamı `/api/admin/*` ile sınırlı tutulduğu için dokunulmadı. Public deploy'da maliyet ve kötüye kullanım riski. |
| 3 | Kaba kuvvet sayacı izolat başına | Orta | Giriş ucundaki 8 deneme/10 dakika limiti Worker belleğinde. Çok izolatlı üretimde kesin sınır değil; kalıcı sınır için D1 veya KV tabanlı sayaç gerekir. |
| 4 | Şifre değiştirme akışı yok | Orta | `mustChangePassword` alanı tutuluyor ama kullanıcıyı zorlayan bir ekran yok. Tek kullanımlık şifre süresiz geçerli. |
| 5 | CSRF token yok | Düşük | `SameSite=Strict` + JSON gövde zorunluluğu pratikte koruma sağlıyor (siteler arası form POST `application/json` gönderemez, çerez zaten iletilmez). Bilinçli tercih, ayrı token eklenmedi. |
| 6 | `tsconfig.tsbuildinfo` izleniyor | Düşük | Derleme çıktısı repoda takip ediliyor, her derlemede diff üretiyor. `.gitignore`'a alınmalı. |

---

## 4. Yapılmayanlar / eksikler

### 4.1 Bilinçli olarak kapsam dışı bırakılanlar

- **Rol 01–04 için iş kuralı yetki matrisi.** Görev tanımında "yetki matrisi tanımlı değilse uydurma" dendiği için altyapı kuruldu (`requireRoles`), aşama bazlı kurallar tanımlanmadı. Şu an geçerli tek kural: 00 yönetir, 01–04 belge akışını okur.
- **Rol 01–04 için kendi ekranları.** "Bana gelen / devret" akışı yok; belge akışı kayıtlarını moderatör elle giriyor. Bu, ilk turda sizinle birlikte alınan karardı.
- **Belge dosyasının kendisi akışta saklanmıyor.** `document_flows.final_document` yalnızca dosya adı veya bağlantı metni tutuyor; gerçek dosya yüklemesi (R2) yok.
- **Kriter Atölyesi'nde çoklu kaynak belge.** Analiz hattı tek PDF üzerinden çalıştığı için tek dosya kısıtı korundu; yalnızca sessiz atma davranışı açık mesaja çevrildi.
- **Rol başlıkları placeholder.** 01–04 için yazdığım başlıklar (`Birinci aşama yöneticisi` vb.) `app/lib/admin-roles.ts` içinden değiştirilebilir. Kodlar (00–04) veri tabanında sabit.

### 4.2 Test edilemeyenler

- **Gerçek e-posta gönderimi** — Resend anahtarı yok. Kod yolu yazıldı, çalıştırılmadı.
- **`APP_ENV=production` uçtan uca davranışı** — üretim mail fail-safe'i ve `Secure` çerez bayrağı yerelde doğrulanmadı.
- **Cloudflare üzerinde gerçek D1** — yalnızca yerel Miniflare ile test edildi.

### 4.3 Repoya girmeyenler

- **Güvenlik test betiği commit edilmedi.** 54 testlik koşu geçici klasörde kaldı; repoda kalıcı bir test paketi yok. İsterseniz `tools/` altına alınabilir.
- **Otomatik test altyapısı yok** — projede test runner (vitest/jest) tanımlı değil, testler curl betiğiyle yapıldı.

### 4.4 Diğer daldaki açık bulgular

Oturumun başındaki `/code-review` **`Deneme` dalı** üzerinde koşuldu ve 10 bulgu üretti (`demo-report-evaluator`, `report-evaluator`, `evaluation-app`, `competition-select`, `file-kind`, `score-coverage` vb.). **Bu bulguların hiçbiri bu çalışmada ele alınmadı** — ilgili dosyaların çoğu `Login_branch`'te mevcut değil, `Deneme` dalına ait. Dallar birleştirilirse o bulgular ayrıca kapatılmalı.

---

## 5. Production'a çıkmadan önce zorunlu işler

1. **Gemini API anahtarını iptal edip yenile** (geçmişe girmiş, hâlâ geçerli).
2. **`MODERATOR_SECRET` tanımla** — en az 32 karakter rastgele (`openssl rand -base64 48`).
3. **`MODERATOR_BOOTSTRAP_TOKEN` ile ilk 00 hesabını aç, sonra değişkeni boşalt.**
4. **`APP_ENV=production` ayarla** — `Secure` çerez ve mail fail-safe davranışı buna bağlı.
5. **Cloudflare D1 veri tabanını sağla** ve şemayı kur:
   ```bash
   npx wrangler d1 execute <veritabani-adi> --file=migrations/0001_admin.sql
   ```
6. **`/api/analyze` için erişim kararı ver** — kimlik doğrulama, oran sınırı veya ağ seviyesinde kısıt.

### Mevcut haliyle public production'a güvenli deploy edilebilir mi?

**HAYIR.**

Yönetim katmanı artık güvenli. Ancak sızmış Gemini anahtarı hâlâ geçerli ve `main` dalında duruyor, `/api/analyze` de kimlik doğrulaması olmadan ücretli model çağrısı yapıyor. Yukarıdaki maddelerden en az **1, 2 ve 6** tamamlanmadan public deploy edilmemeli. Bunlar kapatıldığında `/moderator` ve `/api/admin/*` tarafı için engel görmüyorum.

---

## 6. Dosya envanteri

### Yeni dosyalar (18)

| Dosya | Satır | İçerik |
|---|---|---|
| `app/lib/admin-db.ts` | 806 | D1 şeması, sorgular, atomik son-00 koruması, oturum ve denetim kayıtları |
| `app/lib/admin-guard.ts` | 161 | Kimlik/rol kontrolü, girdi doğrulama, güvenli hata yanıtları |
| `app/lib/admin-client.ts` | 164 | Panelin uçlara bağlantısı |
| `app/lib/admin-types.ts` | 113 | Veri modeli |
| `app/lib/admin-roles.ts` | 66 | Rol katalogu (00–04) |
| `app/lib/admin-flow-input.ts` | 91 | Belge akışı gövde doğrulaması ve devir taraf kontrolü |
| `app/lib/session.ts` | 149 | Oturum jetonu, HMAC imzası, çerez biçimi |
| `app/lib/password.ts` | 102 | Şifre üretimi ve PBKDF2 özeti |
| `app/lib/mailer.ts` | 153 | Resend gönderimi ve ortam duyarlı giden kutusu |
| `app/components/moderator-app.tsx` | 245 | Panel kabuğu, oturum durumu, bölüm geçişi |
| `app/components/moderator-login.tsx` | 178 | Giriş ve ilk kurulum ekranı |
| `app/components/admin-accounts-panel.tsx` | 443 | Kısım 1 |
| `app/components/document-flow-panel.tsx` | 558 | Kısım 2 (salt-okunur mod dâhil) |
| `app/components/audit-panel.tsx` | 64 | Kısım 3 |
| `app/moderator/page.tsx` | — | Sayfa girişi |
| `app/api/admin/*` | 675 | 6 uç: `session`, `bootstrap`, `accounts`, `accounts/[id]`, `flows`, `flows/[id]`, `outbox`, `audit` |
| `cloudflare-env.d.ts` | — | Worker bağlama ve ortam değişkeni tipleri |
| `migrations/0001_admin.sql` | 94 | Referans şema |

### Değişen dosyalar (8)

| Dosya | Değişiklik |
|---|---|
| `.env.example` | Gerçek secret kaldırıldı, yeni değişkenler eklendi |
| `.openai/hosting.json` | D1 bağlaması açıldı (`"d1": "DB"`) |
| `README.md` | Moderatör paneli bölümü ve çoklu yükleme davranışı |
| `app/globals.css` | Panel, giriş, denetim izi ve çoklu yükleme stilleri |
| `app/components/criteria-app.tsx` | Moderatör paneli bağlantısı; çoklu dosya bırakıldığında açık mesaj |
| `app/components/document-library-panel.tsx` | Çoklu dosya seçimi, doğrulama, parti ekleme |
| `app/lib/document-library.ts` | Çakışmasız kimlik, hata loglama |
| `app/lib/draft-store.ts` | Sürümden bağımsız IndexedDB açılışı |
