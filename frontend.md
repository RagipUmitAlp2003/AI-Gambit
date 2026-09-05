# Ön yüz sadeleştirme — 5 Eylül 2026

**Dal:** `Frontenf` · **Commit / push yapılmadı.** Değişiklikler çalışma ağacında duruyor.

Bu dosya, bu oturumda yapılan üç ön yüz düzenlemesini anlatır: yönetici paneli, hakem paneli
ve Yarışma Yöneticisi kriter listesi. Hepsi tasarımsal değişikliktir; sunucu tarafı, veri
modeli, yetki politikası ve yapay zekâ akışlarına dokunulmadı.

## Bir bakışta

| Ekran | Önce | Sonra |
|---|---|---|
| Yönetici paneli | Form, hesap listesi ve bildirimler alt alta tek uzun sayfa | Üç sekme kutucuğu; aynı anda yalnızca biri açık |
| Hakem paneli | Yarışmalar yan sütunda tek tek kart olarak dizili | Tek arama kutusu; yazarak filtreleme, öncelikliler sabit kart |
| Kriter listesi | Kritere tıklayınca sayfanın en altındaki editöre atlıyordu | Editör tıklanan satırın hemen altında açılır, tekrar tıklayınca kapanır |

**Dokunulmayanlar:** `app/api/**`, `app/lib/**`, operasyon paneli (`operations-panel.tsx`),
hesap oluşturma / rol değiştirme / bildirim mantığı, kriter çıkarma ve yayımlama akışı.

---

## 1. Yönetici paneli — sekmeli düzen

**Dosyalar:** `app/components/admin-accounts-panel.tsx`, `app/globals.css`

### Sorun

"Yetkili hesap yönetimi" ekranında hesap oluşturma formu, kayıtlı yönetici listesi ve bildirim
kayıtları alt alta duruyordu. Otuz kayıtlık liste ve açılmış bildirimlerle sayfa çok uzuyor,
forma dönmek için sürekli yukarı kaydırmak gerekiyordu.

### Çözüm

- Panel artık tek bir görünüm gösterir: `create` (form), `accounts` (hesap listesi) veya
  `outbox` (bildirimler). Görünüm `PanelView` tipiyle tutulur, ilk açılışta `create` gelir.
- Başlığın hemen altına üç kutucuk eklendi (`.admin-view-nav`):
  - **Yeni hesap ata** · "Form ve tek kullanımlık şifre"
  - **Kayıtlı yönetici hesapları** · "N kayıt · N aktif"
  - **Bildirim kayıtları** · "N bildirim"
- Kutucuklar formdaki radyo kartlarıyla aynı görsel dili kullanır; aktif olan teal kenarlıkla
  vurgulanır. Tablet ve mobilde alt alta dizilir.
- Bildirim kayıtlarındaki eski "Göster / Gizle" düğmesi kaldırıldı; sekme zaten açma işini
  üstlendiği için liste doğrudan görünür.
- Formdaki bilgi notu güncellendi: bildirimin "aşağıda görüneceği" yerine "Bildirim kayıtları
  sekmesinden görüleceği" yazıyor.

### Neden üç kutucuk

İstek iki kutucuk içindi. Diğer sekmelerden forma geri dönebilmek için üçüncü bir kutucuk
("Yeni hesap ata") eklendi. İstenirse aktif sekmeye tekrar tıklayınca forma dönen bir davranışla
ikiye indirilebilir.

---

## 2. Hakem paneli — yarışma arama kutusu

**Dosyalar:** `app/components/competition-picker.tsx`, `app/components/evaluation-app.tsx`,
`app/evaluation.css`, `app/globals.css`

### Sorun

Hem "Değerlendirme atölyesi" hem "Geçmiş değerlendirmeler" ekranında yayımlanmış her yarışma
sol sütunda ayrı bir kart olarak listeleniyordu. Yarışma sayısı arttıkça ekran kalabalıklaşıyor,
öncelikli yarışma listenin içinde kayboluyordu.

### Çözüm

- Yan sütun kaldırıldı; atölye düzeni tek sütuna geçti (`.eval-workshop-layout`). Ana alan tüm
  genişliği kullanır.
- Yerine `CompetitionPicker` bileşeni geldi: "Yarışma ara" etiketli bir açılır arama kutusu.
  - Yazdıkça liste Türkçe aksana ve büyük/küçük harfe duyarsız daralır
    (`fold` yardımcısı, boşlukla ayrılan her parça ayrı aranır).
  - Ok tuşları, Enter ve Escape ile klavyeden kullanılabilir; `role="combobox"` /
    `role="listbox"` işaretleri var.
  - Açılır listede en fazla 50 sonuç gösterilir; fazlası alt bilgide sayıyla bildirilir.
  - Alt bilgi: "N başvuruya açık yarışma · yazmaya başlayın".
- Her satırda **başvuru sayısı** ayrı ve koyu bir satırda yazılır (`.combo-option-count`):
  atölyede "N bekleyen başvuru", geçmişte "N tamamlanan başvuru". Sayı sıfırsa soluk kalır.
  Durum ve kriter sayısı altında küçük yazıyla durur.
- **Öncelikli yarışmalar** iki yerde görünür:
  - Açılır listede en üstte, kırmızı sol şeritli ve "🔥 ACİL / ÖNCELİKLİ" rozetli.
  - Kutu kapalıyken de arama kutusunun hemen altında sabit kırmızı kart olarak
    (`.eval-priority-pins` / `.eval-priority-card`). Karta tıklamak yarışmayı seçer.
- Seçili yarışmanın özet satırında bekleyen başvuru sayısı sarı rozetle öne çıkar; öncelik
  gerekçesi varsa altında yazar.
- Boş durum metni "Soldan bir yarışma seçin" yerine "Yukarıdaki kutudan bir yarışma seçin" oldu.

### Geçmiş notu

Bu oturumda hakem paneli önce bir önceki commit'teki (`57fee7b`) sol liste düzenine geri
alındı, ardından aynı istek yeniden geldiği için arama kutusu düzeni son hâliyle kuruldu.
`competition-picker.tsx` bu yüzden `2cd382d` commit'indeki sürümün üzerine yapılan
değişiklikleri içerir.

---

## 3. Kriter listesi — satır altında açılan editör

**Dosyalar:** `app/components/criteria-app.tsx`, `app/globals.css`

### Sorun

Yarışma Yöneticisi kriterler çıkarıldıktan sonra listeden bir kritere tıkladığında sayfa en
alttaki "Seçili kriter" bölümüne kaydırılıyordu. Listeye dönmek için "Kriter listesine dön"
bağlantısı gerekiyordu; yanlışlıkla tıklamak bile sayfayı aşağı sürüklüyordu.

### Çözüm

- "Seçili kriter" bölümü sayfa altından kaldırıldı. Aynı editör (`renderInspector`) tıklanan
  satırın hemen altında, satırla birlikte tek bir kutu içinde açılır (`.criterion-entry.open`).
- **Aynı satıra ikinci tıklama editörü kapatır.** Editörün sağ üstünde ayrıca "Kapat" düğmesi
  var.
- Tıklamada artık kaydırma yapılmaz; sayfa olduğu yerde kalır.
- İlk açılışta hiçbir kriter otomatik seçilmez (`selectedId` boş başlar, `selected` null
  olabilir).
- Kriter silindiğinde editör kapanır; eskiden listedeki ilk kriter kendiliğinden açılıyordu.
- Yeni kriter eklendiğinde davranış korundu: eklenen kriter listede açılır ve ekran ona kayar.
- Her satırın sağında açık/kapalı durumunu gösteren küçük bir ok var (`.criterion-chevron`).
- Editör alanları, belgedeki dayanak (salt okunur kaynak sayfa / alıntı) ve kriteri kaldırma
  akışı aynen korundu; yalnızca yeri değişti.

---

## Doğrulama

Her adımdan sonra çalıştırıldı, hepsi temiz:

```
npx tsc --noEmit -p tsconfig.json
npx eslint app/components/admin-accounts-panel.tsx app/components/competition-picker.tsx app/components/evaluation-app.tsx app/components/criteria-app.tsx
```

Elle kontrol için:

1. Genel Yönetici ile girin → "Yetkili hesap yönetimi": ilk açılışta yalnızca form görünmeli;
   üç kutucuk arasında geçiş sayfa uzunluğunu değiştirmemeli.
2. Hakem ile girin → atölye ve geçmiş: arama kutusuna "deniz" yazınca yalnızca eşleşen
   yarışmalar kalmalı; öncelikli yarışma listenin başında ve kutunun altında kart olarak
   durmalı; her satırda başvuru sayısı koyu görünmeli.
3. Yarışma Yöneticisi ile kriter çıkarın → bir kritere tıklayın: editör hemen altında açılmalı,
   tekrar tıklayınca kapanmalı, sayfa kaymamalı.

## Değişen dosyalar

| Dosya | Ne değişti |
|---|---|
| `app/components/admin-accounts-panel.tsx` | Sekme durumu, üç kutucuk, üç ayrı görünüm; bildirim göster/gizle kaldırıldı |
| `app/components/competition-picker.tsx` | "Yarışma ara" etiketi, koyu başvuru sayısı, sabit öncelik kartları, sarı sayı rozeti |
| `app/components/criteria-app.tsx` | `renderInspector` satır altına taşındı, tıkla-aç/tıkla-kapat, kaydırma kaldırıldı |
| `app/evaluation.css` | `.combo-option-count`, `.eval-priority-pins`, `.eval-priority-card` |
| `app/globals.css` | `.admin-view-nav`, `.criterion-entry.open`, `.criterion-chevron` ve mobil kuralları |
