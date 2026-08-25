---
name: Kriter Atölyesi
description: Resmî şartnameleri izlenebilir, dört aşamalı kriter profillerine dönüştüren ve raporları kanıtla kontrol eden sakin yönetici çalışma alanı
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

Soğuk beyaz çalışma zemini, koyu lacivert metin, ölçülü turkuaz eylem rengi ve yalnızca durumlarda kullanılan yeşil/kehribar/kırmızı tonları temel paleti oluşturur. Üç kural durumu üç renge sabitlenir: **BAŞARILI** yeşil, **REVİZYON** kehribar, **KRİTİK HATA** kırmızı; etiket metni her zaman renkle birlikte yazılır.

**The Evidence Color Rule.** Vurgu rengi dekor için değil; aktif adım, kaynak bağlantısı ve birincil eylem için kullanılır.

## Typography

Arayüz, Türkçe karakterleri güçlü ve küçük boyutta okunaklı gösteren sistem sans-serif ailesini kullanır. Başlıklarda sıkı, içerikte rahat satır aralığı; sayfa/paragraf numaralarında tabular sayı davranışı tercih edilir.

## Layout

Masaüstünde sabit bir üst şerit, solda üç adımlı süreç izi ve ortada tek ana görev yüzeyi bulunur. İlk ekranda tek ana eylem resmî PDF yüklemektir. İnceleme aşamasında yalnızca iki yüzey çalışır: **Zorunlu** ve **Diğer** olarak iki bölümde listelenen, aşama etiketi ve kaynak sayfası taşıyan kriter listesi ile seçili kriterin ayrıntı/kanıt paneli. Puan yapısı, sabit ön kontrol şeridi, şablon önizlemesi veya AI notları bölümü yoktur. Küçük ekranlarda süreç izi yatay özet hâline gelir ve paneller tek sütuna iner.

Giriş yüzeyi iki parçalıdır: koyu lacivert ürün anlatısı ve açık renkli, rol odaklı giriş alanı. Yönetim panelinde aynı görsel dil korunur; soldaki dar gezinme alanı yalnızca kullanıcının yetkili olduğu bölümleri, ana yüzey ise rolün karar sınırını ve erişebildiği çalışma alanlarını gösterir. Admin yalnızca yönetici atama panelini görür. Yarışmacı portalı aynı tipografi ve renklerle daha kısa, iki sekmeli bir akış kullanır: yarışma seçip PDF gönderme ve başvuru/sonuç takibi. Süreç izleme yüzeyi tablo yoğunluğunu korur; yalnızca ilk hakem ataması, yeniden atama, hata kurtarma ve yarışma aşaması gibi operasyonel eylemler düzenlenebilir, teknik değerlendirme alanları salt okunurdur.

Değerlendirme ekranı dört aşamayı sırayla gösterir; her aşamanın kararı başlıkta, kural bulguları aşamanın altında listelenir. Bulgu satırı seçildiğinde rapordan alınan sayfa/paragraf numaralı alıntı, gerekçe ve hakemin onayla/değiştir kararı aynı panelde görünür.

## Elevation & Depth

Derinlik, geniş ve yumuşak bir ortam gölgesiyle yalnızca aktif çalışma yüzeyinde kullanılır. Liste satırları gölge yerine tonal zemin ve ayırıcılarla ayrılır.

## Shapes

Ana yüzeyler ölçülü yuvarlak köşelidir; küçük durum etiketleri kapsül biçimindedir. Form kontrolleri keskin olmayan ancak ciddi bir araç hissini koruyan 10-12px köşe dilini kullanır.

## Components

Birincil düğme koyu lacivert zeminde açık metindir; turkuaz yalnızca aktif ve kanıtla ilişkili durumlarda kullanılır. Kriter satırı seçildiğinde ayrıntı panelindeki kaynak sayfası, birebir alıntı, kural açıklaması ve ihlal sonucu aynı anda görünür; Zorunlu/Diğer ayrımı ve aşama etiketi satırda okunur. Pasif kriter soluk değil, açık "pasif" etiketiyle gösterilir. Hata mesajları sorunu ve düzeltme yolunu birlikte söyler.

## Do's and Don'ts

- Kaynak sayfasını ve ilgili metni kriter adından koparma.
- Sistem önerisi ile yönetici değişikliğini aynı durum gibi gösterme.
- Kaynak sayfayı ve kuralın zorunluluğunu açıkça adlandır; güven seviyesi veya "emin değilim" işareti kullanma.
- Kural durumunu yalnızca renkle değil, her zaman BAŞARILI / REVİZYON / KRİTİK HATA metniyle göster.
- Puan, ağırlık veya toplam gösteren hiçbir yüzey ekleme; sistem puan üretmez.
- Belgede olmayan bir kontrolü pasif listede bile "başarısız" gibi gösterme.
