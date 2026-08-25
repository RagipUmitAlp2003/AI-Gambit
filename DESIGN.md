---
name: Kriter Atölyesi
description: Resmî değerlendirme belgelerini izlenebilir kriter profillerine dönüştüren sakin yönetici çalışma alanı
colors:
  ink-navy: "#102a43"
  ink-soft: "#334e68"
  paper: "#ffffff"
  canvas: "#eef3f4"
  evidence-teal: "#0b6e69"
  evidence-teal-soft: "#def1ee"
  uncertainty-amber: "#9a5b00"
  issue-red: "#a53a32"
  success-green: "#18764d"
typography:
  headline:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Arial, system-ui, sans-serif"
    fontSize: "clamp(27px, 3vw, 42px)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Arial, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: "10px"
  panel: "14px"
  workspace: "20px"
spacing:
  compact: "8px"
  control: "12px"
  section: "24px"
  workspace: "38px"
components:
  button-primary:
    backgroundColor: "{colors.ink-navy}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "10px 17px"
  evidence-chip:
    backgroundColor: "{colors.evidence-teal-soft}"
    textColor: "{colors.evidence-teal}"
    rounded: "999px"
    padding: "5px 7px"
---

# Design System: Kriter Atölyesi

## Overview

**Creative North Star: "İnceleme Masası"**

Arayüz, bir jürinin önündeki düzenli dosya masasını dijital ortama taşır. Görsel ifade yarışmacı bir teknoloji panosu değil; yoğun belge işinde güven veren, kaynak ile karar arasındaki bağı sürekli görünür tutan bir çalışma yüzeyidir. Kullanıcının bakışı adım sırasından belge kanıtına, oradan onaya doğal biçimde ilerler.

## Colors

Soğuk beyaz çalışma zemini, koyu lacivert metin, ölçülü turkuaz eylem rengi ve yalnızca durumlarda kullanılan kehribar/kırmızı tonları temel paleti oluşturur.

**The Evidence Color Rule.** Vurgu rengi dekor için değil; aktif adım, kaynak bağlantısı ve birincil eylem için kullanılır.

## Typography

Arayüz, Türkçe karakterleri güçlü ve küçük boyutta okunaklı gösteren sistem sans-serif ailesini kullanır. Başlıklarda sıkı, içerikte rahat satır aralığı; veri değerlerinde tabular sayı davranışı tercih edilir.

## Layout

Masaüstünde sabit bir üst şerit, solda üç adımlı süreç izi ve ortada tek ana görev yüzeyi bulunur. İlk ekranda tek ana eylem resmî PDF yüklemektir. İnceleme aşamasında önce belgenin puan yapısı ve puan dışı sonuç kuralları açıklanır; ardından kriter listesi ile ayrıntı/kanıt paneli çalışır. Küçük ekranlarda süreç izi yatay özet hâline gelir ve paneller tek sütuna iner.

Giriş yüzeyi iki parçalıdır: koyu lacivert ürün anlatısı ve açık renkli, rol odaklı giriş alanı. Yönetim panelinde aynı görsel dil korunur; soldaki dar gezinme alanı yalnızca kullanıcının yetkili olduğu bölümleri, ana yüzey ise rolün karar sınırını ve erişebildiği çalışma alanlarını gösterir. Yarışmacı portalı aynı tipografi ve renklerle daha kısa, iki sekmeli bir akış kullanır: yarışma seçip PDF gönderme ve başvuru/sonuç takibi. Süreç izleme yüzeyi tablo yoğunluğunu korur; yalnızca hakem ataması, hata kurtarma ve yarışma aşaması gibi operasyonel eylemler düzenlenebilir, teknik değerlendirme alanları salt okunurdur.

## Elevation & Depth

Derinlik, geniş ve yumuşak bir ortam gölgesiyle yalnızca aktif çalışma yüzeyinde kullanılır. Liste satırları gölge yerine tonal zemin ve ayırıcılarla ayrılır.

## Shapes

Ana yüzeyler ölçülü yuvarlak köşelidir; küçük durum etiketleri kapsül biçimindedir. Form kontrolleri keskin olmayan ancak ciddi bir araç hissini koruyan 10-12px köşe dilini kullanır.

## Components

Birincil düğme koyu lacivert zeminde açık metindir; turkuaz yalnızca aktif ve kanıtla ilişkili durumlarda kullanılır. Kriter satırı seçildiğinde ayrıntı panelindeki kaynak sayfası, ilgili metin ve AI çıkarım açıklaması aynı anda görünür. Hata mesajları sorunu ve düzeltme yolunu birlikte söyler.

## Do's and Don'ts

- Kaynak sayfasını ve ilgili metni kriter adından koparma.
- Sistem önerisi ile yönetici değişikliğini aynı durum gibi gösterme.
- Belirsizliği saklama; güven seviyesini açıkça adlandır.
- Belgede olmayan bir kontrolü pasif listede bile “başarısız” gibi gösterme.
