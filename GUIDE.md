# Kurulum ve Çalıştırma Rehberi

Bu depoyu ilk kez kuran biri için baştan sona kurulum, çalıştırma ve sorun giderme
adımları. Ürünün ne yaptığını öğrenmek için `README.md`, tasarım kurallarını
görmek için `DESIGN.md`, kapsam ve ilkeler için `PRODUCT.md` dosyalarına bakın.

Proje üç yüzeyden oluşur ve hepsi aynı uygulama içinde çalışır:

| Adres | Yüzey | İşi |
| --- | --- | --- |
| `/` | Giriş ve yönetim paneli | Rol bazlı giriş; 00 için yönetici atama paneli, 04 için operasyon panosu |
| `/kriter-atolyesi` | Kriter Atölyesi | Resmî şartname PDF'sini dört aşamalı, yayımlanabilir bir kriter profiline dönüştürür (01) |
| `/degerlendirme` | Değerlendirme Atölyesi | Katılımcı raporlarını bu profile göre dört aşamada kontrol eder; hakem kararıyla sonuçlandırır (02) |

Rol notları:

- **00 · Admin** yalnızca yönetici ataması yapar: hesap açar, rol atar/kaldırır, atama
  geçmişini izler. Kriter, değerlendirme, operasyon ve başvuru ekranlarına giremez.
- **04 · Değerlendirme Yöneticisi** başvuruya ilk hakemi atar ve süreci yönetir; kriter
  değiştiremez, rapor değerlendiremez.

---

## 1. Gereksinimler

- **Node.js 22.13 veya üzeri.** `package.json` içindeki `engines` alanı bunu şart koşar.
  Sürümünüzü `node --version` ile kontrol edin. Node 24 ile de sorunsuz çalışır.
- **Git.**
- **Google AI Studio API anahtarı.** Kriter Atölyesi'ndeki şartname analizi ve
  Değerlendirme Atölyesi'ndeki AI rapor kontrolü için gereklidir. Anahtar yoksa uygulama
  açılır ama analiz adımı `503` döner. Dosya kapısı ve benzerlik kontrolleri anahtarsız
  da çalışır.

---

## 2. Depoyu alın

```bash
git clone https://github.com/RagipUmitAlp2003/AI-Gambit.git
cd AI-Gambit
```

---

## 3. Bağımlılıkları kurun

```bash
npm install --legacy-peer-deps
```

`--legacy-peer-deps` **zorunludur.** Düz `npm install` şu hatayla durur:

```
npm error code ERESOLVE
npm error Conflicting peer dependency: react@19.2.8
```

Sebebi şu: proje `react` sürümünü 19.2.6'ya sabitlemişken geliştirme bağımlılığı olan
`react-server-dom-webpack` en az 19.2.8 istiyor. Bu, npm'in kendi çözümleyicisinin
takıldığı bir sürüm çakışması; uygulamanın çalışmasını etkilemiyor. `--legacy-peer-deps`
npm'e bu kontrolü atlamasını söyler.

Kurulum sırasında birkaç paketin kurulum betiği (`esbuild`, `workerd`, `sharp`)
için uyarı görebilirsiniz; bu normaldir.

---

## 4. API anahtarını tanımlayın

Örnek dosyayı kopyalayın:

```bash
cp .env.example .env.local
```

`.env.local` dosyasını bir editörle açın ve ilk satırdaki `your_api_key_here`
yerine kendi anahtarınızı yazıp **kaydedin**:

```
GEMINI_API_KEY=buraya_kendi_anahtariniz
GEMINI_MODEL=gemini-3-flash-preview
GEMINI_FALLBACK_MODEL=gemini-3.1-flash-lite
```

Birkaç önemli nokta:

- `.env.local` git'e **girmez** (`.gitignore` içinde `.env*` kuralı var). Her makinede
  ayrıca oluşturmanız gerekir. Anahtarı asla commit etmeyin, sohbet veya ekran
  görüntüsüyle paylaşmayın.
- Anahtar yalnızca sunucu tarafında okunur; tarayıcıya hiçbir zaman gönderilmez.
- Dosyayı kaydettikten sonra **dev sunucusunu yeniden başlatın** — ortam değişkenleri
  yalnızca açılışta okunur.
- Şartname analizi **tek model çağrısıyla** yapılır. Ek bir doğrulama turu veya bunu
  açıp kapatan bir ayar yoktur; `.env.example` içindeki `GEMINI_*` ve yeniden deneme
  ayarları bu tek çağrının model kademelerini yönetir.

---

## 5. Çalıştırın

```bash
npm run dev
```

Uygulama `http://localhost:3000` adresinde açılır. Port meşgulse:

```bash
npx vinext dev -p 4000
```

Kullanılabilir komutlar:

| Komut | Ne yapar |
| --- | --- |
| `npm run dev` | Geliştirme sunucusu (varsayılan port 3000) |
| `npm run build` | Üretim derlemesi |
| `npm start` | Derlenmiş sürümü çalıştırır (`npm run build` sonrası) |
| `npm run lint` | ESLint denetimi |
| `npx tsc --noEmit` | Tip kontrolü |
| `npm test` | Depo güvenliği + birim testleri + regresyon testleri (model çağrısı yapmaz) |
| `npm run test:unit` | Şema, normalizasyon ve profil yükseltme birim testleri |
| `npm run test:regressions` | İstek koruması (hız sınırı / eşzamanlılık) regresyonları |

---

## 6. İlk deneme

Değerlendirme Atölyesi yayımlı bir profil olmadan çalışmaz; bu yüzden sıra önemlidir.
Yerel geliştirmede `.env.local` içine `ALLOW_DEV_LOGIN=on` yazarsanız giriş ekranında
şifresiz rol kısayolları görünür; aşağıdaki adımlarda rol değiştirmek için bunları kullanın.

1. `http://localhost:3000` adresini açın ve **01 · Yarışma Yöneticisi** olarak girin.
2. **1. adım — Kaynak belge:** "Hazır test belgeleri" bölümünden birini seçin; isterseniz
   ayrı rapor şablonu ekleyin. İlk deneme için *Akıllı Ulaşım — kısa test kılavuzu*
   (3 sayfa) en hızlısıdır. Resmî şartnameler 25-35 sayfadır ve daha uzun sürer. Ayrı bir
   ayar formu yoktur; yarışma bilgileri ve teslim sınırları belgeden çıkarılır.
3. **2. adım — Kriter inceleme:** Kriterler **Zorunlu** ve **Diğer** olarak iki bölümde,
   aşama etiketi ve kaynak sayfasıyla listelenir. Satırı seçince kaynak alıntısı, açıklama
   ve ihlal sonucu görünür. Gerekirse düzenleyin, ekleyin, pasifleştirin veya silin.
   Puan alanı yoktur; puanlama ve saha maddeleri belgeden bilinçli olarak dışarıda
   bırakılır ve sayısı uyarı olarak gösterilir.
4. **3. adım — Yayım:** Onay kutusunu işaretleyip **Kriter profilini yayımla** deyin. Profil D1'e
   yazılır ve yarışma başvuruya açılır.
5. **Başvuru:** **03 · Yarışmacı** olarak yarışmayı seçip bir PDF gönderin. Yükleme analiz
   başlatmaz.
6. **Hakem ataması:** **04 · Değerlendirme Yöneticisi** olarak operasyon panosundan
   başvuruya ilk hakemi atayın.
7. **Hakem değerlendirmesi:** **02 · Hakem** olarak `/degerlendirme` adresinde
   **Değerlendirme Atölyesi**'ni seçin, soldan yarışmayı, ardından başvuru kutusunu açın ve
   **Yapay Zeka Analizi** deyin. Uygun kriterler ✓, hatalı kriterler sebebi ve
   **Kaynağa git** (PDF sayfası) düğmesiyle listelenir. **ONAY** veya **RED**'e basın;
   açılan şablonda kriter durumlarını ve hata sebeplerini isterseniz elle değiştirip
   **kesinleştirin**. Şablon yarışmacıya iletilir.
8. **Yarışmacı görünümü:** Portalda ONAY/RED, açıklama, karşılanan/hatalı kriterler ve
   revizyon önerileri görünür. Hakem tarafında tamamlanan karar **Geçmiş değerlendirmeler**'e düşer.

> Gerçek katılımcı raporu depoda bulunmaz ve uydurulmaz. Deneme yaparken
> `public/samples/` altındaki şartnameleri vekil "rapor" olarak kullanabilirsiniz;
> kural kararları anlamlı olmaz, yalnızca akışı gösterir.

---

## 7. Veriler nerede duruyor?

Çok kullanıcılı iş akışının kalıcı kayıtları sunucu tarafında tutulur:

- **Cloudflare D1:** yönetici/yarışmacı hesapları, oturumlar, yayımlı kriter profilleri
  ve kriterleri, kriter ayıklama geçmişi, başvurular, takım ve ekip üyesi bilgileri,
  hakem atamaları, AI çıktısı ve hakem sonucu
- **Cloudflare R2 (`REPORTS`):** katılımcıların değiştirilmeyen başvuru PDF'leri

Yalnızca henüz yayımlanmamış cihaz taslakları tarayıcıda tutulur:

- **localStorage:** `kriter-atolyesi:draft-v2` (sihirbaz taslağı),
  `kriter-atolyesi:last-profile` (son yayımlı profil)
- **IndexedDB:** `kriter-atolyesi` veritabanı (sürüm 3) — `draft-files` (kaynak PDF),
  `library-documents` (görevli belge havuzu); `report-pool` deposu eski sürümden kalır,
  artık kullanılmaz (Değerlendirme Atölyesi yalnızca D1/R2 kaydıyla çalışır)

Bu nedenle farklı cihazlardaki yarışmacı, hakem ve yöneticiler aynı kalıcı başvuru
kaydını görür. Tarayıcı temizlendiğinde yalnızca yayımlanmamış yerel taslaklar silinir;
D1/R2 kayıtları etkilenmez. Eski (1.0, puanlı) profil JSON'ları yüklenirken 2.0 şekline
yükseltilir; puan alanları düşürülür, PDF aşamasında kontrol edilemeyen maddeler pasif
taşınır.

**Sıfırlamak için** tarayıcı konsolunda:

```js
localStorage.clear();
indexedDB.deleteDatabase("kriter-atolyesi");
location.reload();
```

---

## 8. Kalite ve doğruluk testleri

İki tür test vardır. Birinciler model çağrısı yapmaz ve her değişiklikte çalıştırılır:

```bash
npm test                    # check:repo-safety + test:unit + test:regressions
npm run test:unit           # tek çağrı şeması, normalizasyon, profil yükseltme, PDF bütünlüğü
npm run test:regressions    # istek koruması regresyonları
```

İkinciler canlı API'ye istek atar ve elle doğrulanmış referans çıktılarla ölçüm yapar.
**Bu betikler dev sunucusu açıkken çalıştırılır** ve gerçek model çağrısı yaparlar
(token harcarlar):

```bash
# Korpus çıktılarını yeniden üretir (docs/corpus altına yazar)
node tools/run_quality_test.mjs

# Çelikkubbe şartnamesini elle doğrulanmış kural kapsamı referansıyla karşılaştırır
node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze

# Bir PDF'nin metnini sayfa sayfa çıkarır
node tools/extract_pdf_text.mjs girdi.pdf cikti.txt
```

Karşılaştırma sonucu `output/benchmarks/celikkubbe-latest.json` dosyasına yazılır;
canlı bir koşudan sonra `npm run test:benchmark:celikkubbe` bu son çıktıyı model
çağırmadan yeniden ölçer.
Benchmark puan beklemez: kural kapsamı (beklenen her kuralın tek bir kriterle eşleşmesi)
ve yasaklı ifade denetimi (puan, ceza, baraj, güven seviyesi, saha görevi ifadelerinin
kriter setinde bulunmaması) ölçülür. Rapor değerlendirme motoru için sözleşme testinizi
`docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md` kalıbına göre yazın.

---

## 9. Sık karşılaşılan sorunlar

**`npm install` ERESOLVE hatasıyla duruyor.**
`--legacy-peer-deps` ekleyin (bkz. 3. adım).

**Analiz "Belge analiz edilemedi" diyor, sunucu 503 dönüyor.**
`.env.local` yok, anahtar yazılmamış ya da dosya kaydedilmemiş. Kaydettikten sonra
dev sunucusunu yeniden başlatın. Anahtarın gerçekten diske yazıldığını doğrulamak
için dosyayı yeniden açıp bakın; editörde kaydedilmemiş sekme kalmış olabilir.
`npm run check:gemini` anahtarı, model adlarını ve gerçek üretim çağrısını tek komutta
doğrular; 429'un bakiye mi hız sınırı mı olduğunu ayırt eder.

**"Kaynak belge 18 MB'den büyük" hatası.**
Bu sürüm PDF'yi doğrudan modele gönderdiği için 18 MB sınırı vardır. Daha küçük veya
sıkıştırılmış bir PDF kullanın.

**Analiz çok uzun sürüyor.**
Bütün belge tek çağrıda okunur; süre belge uzunluğuna, API kotasına ve yedek modele
düşülmesine bağlıdır. Arayüzdeki tanı bilgisini (süre, token, kullanılan kademe) kontrol
edin. Aynı belge aynı talimat sürümüyle tekrar çalıştırılırsa sunucu içi önbellek
sayesinde model çağrılmaz.

**"Tarayıcı deposu güncellenemedi" uyarısı.**
Uygulamanın açık olduğu başka sekmeler veritabanı yükseltmesini engelliyor. Diğer
sekmeleri kapatıp sayfayı yenileyin.

**Değerlendirme Atölyesi'nde yarışma listesi boş.**
Atölye yalnızca Kriter Atölyesi'nden yayımlanmış (kriteri çıkarılmış) yarışmaları listeler.
Önce 01 · Yarışma Yöneticisi olarak bir profil yayımlayın. Eski 1.0 profiller okunurken
yükseltilir.

**Hakem başvuruyu görmüyor.**
Hakem yalnızca kendisine atanmış başvuruları görür. Değerlendirme Yöneticisi (04)
operasyon panosundan ilk atamayı yapmalıdır; Admin (00) atama yapamaz.

**Port 3000 meşgul.**
`npx vinext dev -p 4000` ile başka bir port kullanın.

---

## 10. Dizin haritası

```
app/
  page.tsx                    Giriş ve yönetim paneli (00 atama paneli, 04 operasyon)
  kriter-atolyesi/page.tsx    Kriter Atölyesi girişi
  degerlendirme/page.tsx      Değerlendirme Atölyesi girişi
  components/
    management-app.tsx        Rol bazlı giriş ve panel kabuğu
    admin-accounts-panel.tsx  00: hesap açma, rol atama/kaldırma, atama geçmişi
    criteria-app.tsx          Üç adımlı profil oluşturma sihirbazı (Zorunlu / Diğer kriterler)
    evaluation-app.tsx        Başvuru havuzu, dört aşamalı hakem incelemesi, yarışmacı görünümü
    operations-panel.tsx      04: ilk hakem ataması, yeniden atama, hata kuyruğu, yarışma aşaması
  api/
    analyze/route.ts          Şartname analizi — tek model çağrısı
    evaluate-report/route.ts  Dört aşamalı rapor değerlendirme motoru
    metrics/route.ts          Oturum token/süre sayaçları
  lib/
    types.ts                  Dört aşama, kural durumu, kriter, profil 2.0, değerlendirme modeli
    criteria-extraction.ts    Çıkarım şeması, sistem talimatı, normalizasyon
    profile-loader.ts         Profil doğrulama; 1.0 → 2.0 yükseltme
    authorization.ts          Yetki matrisi
    …                         Kesin kontroller, depolar, yardımcılar
  globals.css, evaluation.css Tasarım sistemi ve değerlendirme ekranı stilleri
docs/
  RAPOR_DEGERLENDIRME_SOZLESMESI.md   Rapor değerlendirme motorunun giriş/çıkış sözleşmesi
  AI_API_ENTEGRASYON_SOZLESMESI.md    Şartname analizi (tek çağrı) sözleşmesi
  GENEL_BELGE_ANALIZ_MIMARISI.md      Dört aşamalı analiz mimarisi
  corpus/, benchmarks/                Kalite ölçüm çıktıları ve referanslar
public/samples/               Uygulamadaki hazır test şartnameleri
corpus/                       40 resmî 2026 şartnamesi (kalite ölçümü için)
migrations/                   D1 şema geçmişi (0001–0005)
tools/                        Birim testleri, kalite ve karşılaştırma betikleri
```

---

## 11. Dağıtım hakkında

`.openai/hosting.json` içinde D1 `DB` ve R2 `REPORTS` bağlamaları tanımlıdır.
Dağıtım öncesinde `migrations/0001_admin.sql` … `0005_final_workflow.sql` sırasıyla
uygulanmalı; `GEMINI_API_KEY`, `MODERATOR_SECRET` ve üretim e-posta değişkenleri sunucu
sırrı olarak tanımlanmalıdır. `ALLOW_DEV_LOGIN=off` ve `APP_ENV=production` doğrulanmalıdır.

Proje Cloudflare Workers/Sites çalışma modeline hazırdır; gerçek ortamda D1/R2
kaynaklarının oluşturulması, bağlanması ve göçlerin uygulanması dağıtım adımıdır.
