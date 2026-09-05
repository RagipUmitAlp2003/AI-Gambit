# Tasarım Değişiklikleri (`tasarım_final` branch'i)

Bu belge, `tasarım_final` branch'inde `08114d8 — TASARIM` commit'i ile yapılan
arayüz/tasarım değişikliklerini özetler. Commit notunda da belirtildiği gibi bu
çalışma **yalnızca görsel katmanı** kapsar; iş mantığı, API ve veri akışı
incelenmemiş ve değiştirilmemiştir.

Dokunulan dosyalar:

| Dosya | Durum | Kapsam |
| --- | --- | --- |
| `app/components/t3-lockup.tsx` | **yeni** | Türkiye Teknoloji Takımı marka kilidi bileşeni |
| `app/components/access-login.tsx` | değişti | Giriş ekranına logo + form etiketi |
| `app/components/management-app.tsx` | değişti | Yan menüye logo |
| `app/components/password-change-gate.tsx` | değişti | Şifre değişim ekranı yeniden düzenlendi |
| `app/globals.css` | değişti | Logo, şifre kapısı ve hero tipografisi stilleri |
| `tools/regression-tests.mjs` | değişti | Değişen etikete göre regresyon iddiası güncellendi |

---

## 1. Yeni bileşen: `T3Lockup` (`app/components/t3-lockup.tsx`)

Türkiye Teknoloji Takımı marka kilidi, tekrar kullanılabilir tek bir React
bileşeni olarak eklendi. Harici bir görsel dosyası yerine **inline SVG** tercih
edildi; böylece her ekranda ölçeklenebilir ve tema rengine uyum sağlar.

- Tek bir kol yolu (`ARM` path sabiti) tanımlanır, `rotate(120)` ve
  `rotate(240)` dönüşleriyle üç kol elde edilir.
- Her kola ayrı bir `linearGradient` verilir:
  - kırmızı: `#c1272d → #e8391a`
  - amber: `#fbba00 → #ee7203`
  - mavi: `#2ba7e0 → #17357d`
- Şekil **transparandır**; arka planı çağıran ekran belirler.
- Yazı rengi `currentColor` üzerinden gelir; bu sayede aynı bileşen hem lacivert
  (koyu) hem açık zeminde doğru okunur — sarmalayıcıya `color` vermek yeterlidir.
- Erişilebilirlik: kapsayıcıya `role="img"` ve
  `aria-label="Türkiye Teknoloji Takımı"` verilir; SVG ve tekrar eden metin
  `aria-hidden` ile ekran okuyucudan gizlenir (çift okuma önlenir).
- Dışarıdan `className` alır; konumlandırma/boyut her ekranın kendi sınıfıyla
  yapılır (`access-hero-logo`, `management-sidebar-logo`, `password-gate-logo`).

## 2. Giriş ekranı (`access-login.tsx`)

- Hikâye (sol) sütununa `T3Lockup` eklendi: `.access-hero-logo`, başlık metni ile
  ilke bloğu arasında, beyaz renkte.
- Giriş formundaki alan etiketi **“Kullanıcı adı veya e-posta” → “Kullanıcı
  E-Postası”** olarak değiştirildi.
- Hero tipografisi küçültülüp sıkılaştırıldı, böylece logo için dikey alan açıldı:
  - başlık: `clamp(42px, 5vw, 76px)` → `clamp(34px, 3.9vw, 58px)`, `line-height`
    `.98 → 1`, `max-width` `11ch → 12ch`
  - paragraf: `16px/1.7`, `62ch` → `14px/1.65`, `54ch`
  - blok genişliği `620px → 560px`, üst/alt boşluklar `80px → 44px 0 0`
  - `.section-kicker` `9.5px` sabitlendi

## 3. Yönetim paneli yan menüsü (`management-app.tsx`)

- Navigasyonun altına, hesap bilgisi (`.signed-user`) kartının **üstüne**
  `T3Lockup` yerleştirildi (`.management-sidebar-logo`) — tüm paneller için ortak.
- `margin-top: auto` ile menünün en altına itilir; logo varken
  `.signed-user`'ın kendi `margin-top: auto` değeri `0`'a çekilir, böylece ikisi
  birlikte alta yaslanır.
- Küçük ölçek: işaret `56px`, yazı `13px`.

## 4. Zorunlu şifre değişim ekranı (`password-change-gate.tsx`)

Ekran, giriş sayfasının iki sütunlu `access-page` düzeninden çıkarılıp **tek
panelli, ekranın tam ortasında** duran bir kart hâline getirildi:

- `<main className="access-page">` → `<main className="password-gate-page">`
- Yeni sarmalayıcı `.password-gate-shell` içinde: üstte `T3Lockup`
  (`.password-gate-logo`, koyu `--ink` renginde), altında `.password-gate-card`.
- Form alanları, hata mesajı ve “çıkış yapın” notu aynen korundu; yalnızca
  sarmalayıcı yapı ve stil değişti — davranış/doğrulama aynı.

## 5. Stil eklemeleri (`app/globals.css`)

Yeni sınıflar:

- `.t3-lockup`, `.t3-lockup-mark`, `.t3-lockup-word` — logonun ortak yerleşimi;
  boyutlar `clamp()` ile akışkan.
- `.access-hero-logo` — giriş ekranı hero logosu (beyaz).
- `.password-gate-page`, `.password-gate-shell`, `.password-gate-logo`,
  `.password-gate-card` — ortalanmış şifre kapısı düzeni; `18px` köşe yarıçapı,
  `1px solid var(--line)` kenar ve `0 18px 46px rgba(16,42,67,.10)` gölge.
  Kart içinde başlık, buton (tam genişlik, `min-height: 46px`) ve alt not
  ortalanacak şekilde ayarlandı.
- `.management-sidebar-logo` — yan menü logosu ve `+ .signed-user` düzeltmesi.

Duyarlılık (responsive) ayarları:

- **≤ 920px**: hero metni küçültüldü, hero logosu sola yaslandı; yan menü logosu
  `display: none` (mobilde `.signed-user` zaten gizli).
- **≤ 800px yükseklik & ≥ 921px genişlik**: alçak ekranlarda hero başlığı ve logo
  daha da küçültülerek her şeyin katlama üstünde kalması sağlandı.
- **≤ 620px**: hero başlığı `34px`, logo işareti `66px`, yazı `17px`.

## 6. Regresyon testi güncellemesi (`tools/regression-tests.mjs`)

Giriş formundaki etiket değiştiği için ilgili iddia güncellendi:

```diff
-  assert(/Kullanıcı adı veya e-posta/.test(login), ...);
+  assert(/Kullanıcı E-Postası/.test(login), ...);
```

Şifresiz rol kısayolunun ve rol seçiminin bulunmadığını doğrulayan diğer
iddialar aynen korundu.

---

## Kapsam dışı / notlar

- Bu branch'te **iş mantığı, API sözleşmesi, veritabanı şeması veya yetkilendirme
  akışı değişmedi**; tüm değişiklikler sunum katmanındadır.
- Marka kilidi bileşeni renk almak için sarmalayıcının `color` değerini kullanır;
  yeni bir ekrana eklerken sınıfa uygun `color` verilmesi yeterlidir.
- Commit notu: “Farukun last branch üzerine tasarımlar ve değişiklikler yapıldı,
  sistem incelenmedi.” — işlevsel doğrulama ayrıca yapılmalıdır.
