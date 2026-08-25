# Kurulum ve Çalıştırma Rehberi

Bu depoyu ilk kez kuran biri için baştan sona kurulum, çalıştırma ve sorun giderme
adımları. Ürünün ne yaptığını öğrenmek için `README.md`, tasarım kurallarını
görmek için `DESIGN.md`, kapsam ve ilkeler için `PRODUCT.md` dosyalarına bakın.

Proje iki modülden oluşur ve ikisi de aynı uygulama içinde çalışır:

| Adres | Modül | İşi |
| --- | --- | --- |
| `/` | Kriter Atölyesi | Resmî şartname PDF'sini onaylı, sürümlü bir değerlendirme profiline dönüştürür |
| `/degerlendirme` | Değerlendirme Atölyesi | Katılımcı raporlarını bu profile göre inceler; hakem kararıyla sonuçlandırır |

---

## 1. Gereksinimler

- **Node.js 22.13 veya üzeri.** `package.json` içindeki `engines` alanı bunu şart koşar.
  Sürümünüzü `node --version` ile kontrol edin. Node 24 ile de sorunsuz çalışır.
- **Git.**
- **Google AI Studio API anahtarı.** Yalnızca Kriter Atölyesi'ndeki belge analizi için
  gereklidir. Anahtar yoksa uygulama açılır ama analiz adımı `503` döner.
  Değerlendirme Atölyesi'ndeki kesin kontroller anahtarsız da çalışır.

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
GEMINI_MODEL=gemini-3.7-flash
GEMINI_FALLBACK_MODEL=gemini-3.5-flash
```

Birkaç önemli nokta:

- `.env.local` git'e **girmez** (`.gitignore` içinde `.env*` kuralı var). Her makinede
  ayrıca oluşturmanız gerekir. Anahtarı asla commit etmeyin, sohbet veya ekran
  görüntüsüyle paylaşmayın.
- Anahtar yalnızca sunucu tarafında okunur; tarayıcıya hiçbir zaman gönderilmez.
- Dosyayı kaydettikten sonra **dev sunucusunu yeniden başlatın** — ortam değişkenleri
  yalnızca açılışta okunur.

### Kanıt doğrulama (önerilen)

Sistem çıkarılan kriterleri ikinci turda PDF'ye karşı doğrular, atlanan açık
kuralları işaretler ve puan toplamını yeniden okur. Üretimde açık tutun. Yalnızca
kontrollü hız/maliyet karşılaştırmasında kapatmak için `.env.local` içine ekleyin:

```
EVIDENCE_VERIFICATION=off
```

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

---

## 6. İlk deneme

Değerlendirme Atölyesi onaylı bir profil olmadan çalışmaz; bu yüzden sıra önemlidir.

1. `http://localhost:3000` adresini açın.
2. **1. adım — Temel ayarlar:** Varsayılanlarla devam edebilirsiniz. Buradaki dosya
   kapısı ayarları (format, boyut, dosya sayısı, ihlal davranışı) katılımcı
   yüklemelerinde fiilen uygulanacaktır.
3. **2. adım — Kaynak belge:** "Hazır test belgeleri" bölümünden birini seçin.
   İlk deneme için *Akıllı Ulaşım — kısa test kılavuzu* (3 sayfa) en hızlısıdır;
   yaklaşık bir dakika sürer. Resmî şartnameler 25-35 sayfadır ve daha uzun sürer.
4. **3. adım — Kriter inceleme:** AI çıkarımlarını kaynaklarıyla karşılaştırın.
   Çok aşamalı şartnamelerde (rapor + saha görevleri aynı belgede) her puan grubunun
   altındaki "Bu grup değerlendirmeye dahil" kutusundan kapsamı daraltabilirsiniz.
   Alttaki onay kutusunu işaretleyip **Profili onayla** deyin.
5. **4. adım — Profil onayı:** Buradaki **"Değerlendirme Atölyesi'ni aç →"**
   bağlantısı sizi ikinci modüle götürür; profil otomatik taşınır.
6. **Rapor havuzu:** Takım adı girip bir PDF yükleyin, **Analiz et** deyin.
7. **Hakem incelemesi:** Bulguları karara bağlayın, geri bildirimi düzenleyip onaylayın,
   **Değerlendirmeyi tamamla** deyin.
8. **Yarışmacı görünümü:** Sonuç ve hakem onaylı geri bildirim burada görünür.

> Gerçek katılımcı raporu deposunda bulunmaz ve uydurulmaz. Deneme yaparken
> `public/samples/` altındaki şartnameleri vekil "rapor" olarak kullanabilirsiniz;
> puanlar anlamlı olmaz, yalnızca akışı gösterir.

---

## 7. Veriler nerede duruyor?

Çok kullanıcılı iş akışının kalıcı kayıtları sunucu tarafında tutulur:

- **Cloudflare D1:** yönetici/yarışmacı hesapları, oturumlar, onaylı kriter profilleri,
  kriter ayıklama geçmişi, başvurular, takım ve ekip üyesi bilgileri, AI çıktısı ve hakem sonucu
- **Cloudflare R2 (`REPORTS`):** katılımcıların değiştirilmeyen başvuru PDF'leri

Yalnızca henüz onaylanmamış cihaz taslakları tarayıcıda tutulur:

- **localStorage:** `kriter-atolyesi:draft-v1` (sihirbaz taslağı),
  `kriter-atolyesi:last-profile` (son onaylı profil),
  `kriter-atolyesi:degerlendirme-profili` (değerlendirmede seçili profil)
- **IndexedDB:** `kriter-atolyesi` veritabanı (sürüm 3) — `draft-files` (kaynak PDF),
  `library-documents` (görevli belge havuzu), `report-pool` (katılımcı raporları)

Bu nedenle farklı cihazlardaki yarışmacı, hakem ve yöneticiler aynı kalıcı başvuru
kaydını görür. Tarayıcı temizlendiğinde yalnızca onaylanmamış yerel taslaklar silinir;
D1/R2 kayıtları etkilenmez.

**Sıfırlamak için** tarayıcı konsolunda:

```js
localStorage.clear();
indexedDB.deleteDatabase("kriter-atolyesi");
location.reload();
```

---

## 8. Kalite ve doğruluk testleri

Depoda birim test çerçevesi yoktur; kalite, canlı API'ye istek atan betiklerle ve
elle doğrulanmış referans çıktılarla ölçülür. **Bu betikler dev sunucusu açıkken
çalıştırılır** ve gerçek model çağrısı yaparlar (token harcarlar).

```bash
# Korpus çıktılarını yeniden üretir (docs/corpus altına yazar)
node tools/run_quality_test.mjs

# Çelikkubbe şartnamesini elle doğrulanmış referansla karşılaştırır
node tools/run_celikkubbe_benchmark.mjs

# Bir PDF'nin metnini sayfa sayfa çıkarır
node tools/extract_pdf_text.mjs girdi.pdf cikti.txt
```

Karşılaştırma sonucu `output/benchmarks/celikkubbe-latest.json` dosyasına yazılır.
Analiz motoru üzerinde çalışıyorsanız kendi sözleşme testinizi bu kalıba göre yazın:
`docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md`.

---

## 9. Sık karşılaşılan sorunlar

**`npm install` ERESOLVE hatasıyla duruyor.**
`--legacy-peer-deps` ekleyin (bkz. 3. adım).

**Analiz "Belge analiz edilemedi" diyor, sunucu 503 dönüyor.**
`.env.local` yok, anahtar yazılmamış ya da dosya kaydedilmemiş. Kaydettikten sonra
dev sunucusunu yeniden başlatın. Anahtarın gerçekten diske yazıldığını doğrulamak
için dosyayı yeniden açıp bakın; editörde kaydedilmemiş sekme kalmış olabilir.

**"Kaynak belge 18 MB'den büyük" hatası.**
Bu sürüm PDF'yi doğrudan modele gönderdiği için 18 MB sınırı vardır. Daha küçük veya
sıkıştırılmış bir PDF kullanın.

**Analiz çok uzun sürüyor.**
Uzun belgeler kapsam için paralel sayfa aralıklarına ayrılır ve ardından kanıt
doğrulaması yapılır. Süre ayrıca API kotası ve yedek modele düşülmesinden
etkilenebilir; arayüzdeki tanı bilgisini kontrol edin. Aynı belge aynı analiz
sürümüyle tekrar çalıştırılırsa sunucu içi önbellek sayesinde model çağrılmaz.

**"Tarayıcı deposu güncellenemedi" uyarısı.**
Uygulamanın açık olduğu başka sekmeler veritabanı yükseltmesini engelliyor. Diğer
sekmeleri kapatıp sayfayı yenileyin.

**Değerlendirme Atölyesi "Onaylı değerlendirme profili gerekli" diyor.**
Önce Kriter Atölyesi'nden bir profil onaylayın; ya da daha önce indirdiğiniz profil
JSON'unu "Profil JSON'u yükle" ile verin.

**Port 3000 meşgul.**
`npx vinext dev -p 4000` ile başka bir port kullanın.

---

## 10. Dizin haritası

```
app/
  page.tsx                    Kriter Atölyesi girişi
  degerlendirme/page.tsx      Değerlendirme Atölyesi girişi
  components/
    criteria-app.tsx          Dört adımlı profil oluşturma sihirbazı
    evaluation-app.tsx        Rapor havuzu, hakem incelemesi, yarışmacı görünümü
  api/
    analyze/route.ts          Şartname analizi (Gemini)
    evaluate-report/route.ts  Rapor analiz motoru — İSKELET, motor buraya yazılacak
    metrics/route.ts          Oturum token/süre sayaçları
  lib/                        Tipler, kesin kontroller, depolar, yardımcılar
docs/
  RAPOR_DEGERLENDIRME_SOZLESMESI.md   Analiz motorunun giriş/çıkış sözleşmesi
  AI_API_ENTEGRASYON_SOZLESMESI.md    Şartname analizi sözleşmesi
  corpus/, benchmarks/                Kalite ölçüm çıktıları ve referanslar
public/samples/               Uygulamadaki hazır test şartnameleri
corpus/                       40 resmî 2026 şartnamesi (kalite ölçümü için)
tools/                        Kalite ve karşılaştırma betikleri
```

---

## 11. Dağıtım hakkında

`.openai/hosting.json` içinde D1 `DB` ve R2 `REPORTS` bağlamaları tanımlıdır.
Dağıtım öncesinde `migrations/0001_admin.sql`, `0002_competition_workflow.sql`
ve `0003_application_teams_and_history.sql` sırasıyla uygulanmalı; `GEMINI_API_KEY`,
`MODERATOR_SECRET` ve üretim e-posta değişkenleri sunucu sırrı olarak tanımlanmalıdır.

Proje Cloudflare Workers/Sites çalışma modeline hazırdır; gerçek ortamda D1/R2
kaynaklarının oluşturulması, bağlanması ve göçlerin uygulanması dağıtım adımıdır.
