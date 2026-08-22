from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "T3_Kriter_Atolyesi_Ekran_Kilavuzu.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

font_regular = Path(r"C:\Windows\Fonts\arial.ttf")
font_bold = Path(r"C:\Windows\Fonts\arialbd.ttf")
pdfmetrics.registerFont(TTFont("Guide", str(font_regular)))
pdfmetrics.registerFont(TTFont("GuideBold", str(font_bold)))

PAGE_W, PAGE_H = A4
NAVY = colors.HexColor("#18324B")
BLUE = colors.HexColor("#2F6F9F")
LIGHT = colors.HexColor("#F2F5F7")
MID = colors.HexColor("#D7E0E6")
TEXT = colors.HexColor("#1E2830")
MUTED = colors.HexColor("#56636D")
WHITE = colors.white

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="TitleGuide", fontName="GuideBold", fontSize=21, leading=26,
    textColor=NAVY, spaceAfter=8, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="SubtitleGuide", fontName="Guide", fontSize=10.5, leading=15,
    textColor=MUTED, spaceAfter=12,
))
styles.add(ParagraphStyle(
    name="H1Guide", fontName="GuideBold", fontSize=15, leading=19,
    textColor=NAVY, spaceBefore=2, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="H2Guide", fontName="GuideBold", fontSize=11.5, leading=15,
    textColor=BLUE, spaceBefore=7, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="BodyGuide", fontName="Guide", fontSize=9, leading=13,
    textColor=TEXT, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="SmallGuide", fontName="Guide", fontSize=7.8, leading=10.8,
    textColor=MUTED,
))
styles.add(ParagraphStyle(
    name="CellGuide", fontName="Guide", fontSize=7.8, leading=10.6,
    textColor=TEXT,
))
styles.add(ParagraphStyle(
    name="CellBoldGuide", fontName="GuideBold", fontSize=7.8, leading=10.6,
    textColor=NAVY,
))
styles.add(ParagraphStyle(
    name="CalloutGuide", fontName="Guide", fontSize=9, leading=13,
    textColor=NAVY, backColor=colors.HexColor("#EAF3F8"),
    borderColor=colors.HexColor("#B9D3E3"), borderWidth=0.7,
    borderPadding=8, spaceBefore=5, spaceAfter=8,
))


def p(text, style="BodyGuide"):
    return Paragraph(text, styles[style])


def clean(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def table(rows, widths, header=True):
    data = []
    for r_idx, row in enumerate(rows):
        data.append([
            p(clean(str(cell)), "CellBoldGuide" if header and r_idx == 0 else "CellGuide")
            for cell in row
        ])
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, MID),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, colors.HexColor("#FAFBFC")]),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ]
        for cell in data[0]:
            cell.style.textColor = WHITE
    t.setStyle(TableStyle(style))
    return t


def page_header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Guide", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 11 * mm, "T3 Kriter Atölyesi - Ekran Kılavuzu")
    canvas.drawRightString(PAGE_W - 18 * mm, 11 * mm, f"Sayfa {doc.page}")
    canvas.setStrokeColor(MID)
    canvas.setLineWidth(0.5)
    canvas.line(18 * mm, 15 * mm, PAGE_W - 18 * mm, 15 * mm)
    canvas.restoreState()


doc = SimpleDocTemplate(
    str(OUTPUT), pagesize=A4,
    leftMargin=18 * mm, rightMargin=18 * mm,
    topMargin=17 * mm, bottomMargin=21 * mm,
    title="T3 Kriter Atölyesi Ekran Kılavuzu",
    author="AI Gambit",
)

story = []

# Page 1
story += [
    p("T3 Kriter Atölyesi", "TitleGuide"),
    p("Kriter belgesini anlamlandırma ekranı için kısa kullanım kılavuzu", "SubtitleGuide"),
    p("Bu bölüm ne yapıyor?", "H1Guide"),
    p(
        "Bu modül, yarışma yöneticisinin yüklediği resmî kriter veya şartname PDF'sini okur. "
        "Belgedeki kuralları, puanları, barajları ve insan kararı gerektiren kontrolleri düzenlenebilir bir değerlendirme profiline dönüştürür. "
        "AI yalnızca taslak ve öneri üretir; profil yönetici onayı verilmeden kesinleşmez."
    ),
    p(
        "Önemli sınır: Bu ekran henüz katılımcı proje raporunu puanlamaz. Önce, daha sonra kullanılacak doğru değerlendirme kurallarını hazırlar.",
        "CalloutGuide",
    ),
    p("Dört adım", "H2Guide"),
    table([
        ["Adım", "Ekrandaki yazı", "Anlamı"],
        ["1", "Temel ayarlar", "Yarışma, kategori, aşama, rapor türü ve genel dosya kapısı tanımlanır."],
        ["2", "Kaynak belge", "Organizatörün resmî kriter PDF'si seçilir ve analiz başlatılır."],
        ["3", "Kriter inceleme", "AI çıkarımları kaynak sayfalarıyla kontrol edilir, düzeltilir, kapatılır veya yeni kriter eklenir."],
        ["4", "Profil onayı", "Doğrulanan kurallar sürümlü bir değerlendirme profili olarak kaydedilir."],
    ], [17 * mm, 42 * mm, 112 * mm]),
    Spacer(1, 6),
    p("Ekranın genel işaretleri", "H2Guide"),
    table([
        ["İşaret / yazı", "Anlamı"],
        ["KA", "Kriter Atölyesi'nin kısa adı; uygulama simgesidir."],
        ["PY", "Bu ekranı kullanan rolün Proje Yöneticisi olduğunu gösterir."],
        ["P4", "Projenin dördüncü problem başlığına ait karar destek modülü olduğunu belirtir."],
        ["Yerel prototip", "Uygulamanın deneme/geliştirme ortamında çalıştığını gösterir; canlı ürün anlamına gelmez."],
        ["1 / 4, 2 / 4...", "Toplam dört adımın hangisinde olduğunuzu gösterir."],
        ["Tik işareti", "Adımın tamamlandığını veya profilin onaylandığını gösterir."],
        ["→ / ←", "Sonraki adıma geçme / önceki adıma dönme işaretidir."],
        ["↑", "Dosya yükleme alanında yüklemeyi; bağlantıda listenin üstüne dönmeyi gösterir."],
        ["Yeni sekme oku", "Kaynak sayfanın yeni sekmede açılacağını belirtir."],
        ["i", "Karar vermeyen, açıklayıcı bilgi notudur."],
        ["!", "Kriterde çözülmesi gereken açık bir çakışma bulunduğunu gösterir."],
        ["Arama simgesi", "Kriter listesinde metin araması yapar."],
        ["+", "Yöneticinin yeni bir kriter eklemesini sağlar."],
        ["Yeşil durum noktası", "Gemini belge analiz motorunun kullanılan analiz hizmeti olduğunu anlatan durum göstergesidir."],
    ], [40 * mm, 131 * mm]),
]

story.append(PageBreak())

# Page 2
story += [
    p("1. Temel ayarlar ekranı", "H1Guide"),
    p("Bu ekran, PDF'de unutulabilecek en genel teslim kurallarını yöneticiden önceden alır.") ,
    table([
        ["Alan", "Ne anlama gelir?"],
        ["Yarışma adı", "Profilin hangi TEKNOFEST yarışmasına ait olduğunu belirtir."],
        ["Kategori / seviye", "Üniversite, lise, temel/ileri kategori gibi hangi katılımcı grubuna uygulanacağını belirtir."],
        ["Aşama", "Ön değerlendirme, KTR, final veya teknik kontrol gibi değerlendirme evresidir."],
        ["Rapor türü", "ÖTR, KTR, sunum ya da başka bir teslim türünün adıdır."],
        ["Yarışma yılı", "Kuralların hangi yılın sürümüne ait olduğunu belirtir."],
        ["İzin verilen format - PDF", "Katılımcının yükleyebileceği dosya türüdür. Bu prototipte PDF sabittir."],
        ["En büyük dosya boyutu", "Katılımcı dosyasının aşamayacağı MB sınırıdır."],
        ["En fazla dosya sayısı", "Aynı teslim için kabul edilecek azami dosya adedidir."],
        ["Yüklemeyi engelle", "Kesin teknik ihlalde dosya kabul edilmez."],
        ["Uyarı oluştur", "Dosya kabul edilir; yöneticiye görünür uyarı bırakılır."],
        ["Jüri incelemesine gönder", "Sistem otomatik son karar vermez; görevliye inceleme açar."],
    ], [50 * mm, 121 * mm]),
    p("Katılımcı yükleme kapısı", "H2Guide"),
    p(
        "Sağdaki özet kartı, girilen temel ayarların katılımcıya nasıl uygulanacağını gösterir. "
        "PDF simgesi dosya türünü; Format, Boyut, Dosya ve İhlal satırları geçerli kapı kurallarını gösterir. "
        "'Değiştirilemez' yazısı PDF formatının bu sürümde sabit olduğunu anlatır."
    ),
    p("2. Kaynak belge ekranı", "H1Guide"),
    table([
        ["Öğe", "Ne işe yarar?"],
        ["K simgesi", "Yüklenen dosyanın katılımcı raporu değil, kriter kaynağı olduğunu vurgular."],
        ["PDF'yi buraya bırakın", "Dosyayı sürükleyip bırakarak seçme alanıdır."],
        ["PDF seç", "Bilgisayardan resmî değerlendirme belgesi seçer."],
        ["PDF damgası", "Seçilen dosyanın PDF türünde olduğunu gösterir."],
        ["Analize hazır", "Dosyanın kabul edildiğini ve analiz başlatılabileceğini gösterir."],
        ["Değiştir", "Seçili PDF yerine başka bir belge seçer."],
        ["Hazır test belgeleri", "Farklı ve daha önce hazırlanmış yarışma şartnameleriyle sistemi denemeyi sağlar."],
        ["Belgeyi aç", "Test PDF'sini yalnızca görüntüler; analiz başlatmaz."],
        ["Bu belgeyi seç / Seçildi", "Test belgesini aktif analiz kaynağı yapar / zaten seçili olduğunu gösterir."],
        ["Belgeyi analiz et", "PDF'yi AI analizine gönderir ve kriter taslağı üretir."],
        ["Dönen çember ve ilerleme çizgisi", "Analizin sürdüğünü gösterir; işlem bitene kadar beklenir."],
        ["Belge analiz edilemedi", "Dosya türü, boyutu, bağlantı veya analiz cevabında sorun olduğunu belirten hata alanıdır."],
        ["Taslak korunur", "Geri dönüşte seçili belge ve mevcut analiz verilerinin silinmeyeceğini belirtir."],
    ], [54 * mm, 117 * mm]),
]

story.append(PageBreak())

# Page 3
story += [
    p("3. Kriter inceleme - üst bölüm", "H1Guide"),
    p("Bu ekran AI'nin çıkardığı taslaktır. Yönetici, her kuralı kaynağıyla karşılaştırarak kesinleştirir."),
    p("Analiz özeti", "H2Guide"),
    table([
        ["Sayaç", "Anlamı"],
        ["Aktif kural", "Nihai profile girmesi açık olan toplam kriter sayısıdır."],
        ["Puan grubu", "PDF'deki birbirini örtmeyen üst seviye puan bölümlerinin sayısıdır; tek tek her kural değildir."],
        ["Kesin kontrol", "Dosya türü, boyutu veya açık sayısal sınır gibi makine tarafından net kontrol edilebilen kurallardır."],
        ["İnsan onayı", "Hakem, jüri veya yetkili yöneticinin karar vermesi gereken kontrollerdir."],
        ["Açık çakışma", "Temel ayar ile PDF ya da farklı kaynaklar arasında çözülmemiş uyuşmazlık sayısıdır."],
        ["PDF toplam puanı", "Belgede açıkça ilan edilen genel puandır. Belgede yoksa çizgi görünür; sistem puan uydurmaz."],
    ], [48 * mm, 123 * mm]),
    p("Belgedeki puan yapısı", "H2Guide"),
    table([
        ["Yazı / durum", "Anlamı"],
        ["Toplam doğrulandı", "Üst seviye puan gruplarının toplamı, PDF'deki genel toplamla aynıdır."],
        ["Eksik veya çakışan puan", "Gruplar ile genel toplam uyuşmamaktadır; yönetici kaynak sayfaları kontrol etmelidir."],
        ["Genel toplam belirtilmemiş", "PDF açık bir genel toplam vermemiştir; sistem tahmin üretmemiştir."],
        ["Grup adı", "Rapor, sunum veya görev aşaması gibi ana puan bölümüdür."],
        ["Kapsam ve sayfa", "Puan grubunun hangi aşamaya ait ve PDF'nin hangi sayfasından çıkarıldığını gösterir."],
        ["Azami grup puanı", "Bu ana bölümden kazanılabilecek en yüksek puandır."],
        ["Baraj", "Devam edebilmek için alınması gereken en düşük puandır; puanla aynı şey değildir."],
        ["Alt kalemler", "Ana puanı oluşturan dağılımı açıklar; toplamda ikinci kez sayılmaz."],
        ["Alıntı kutusu", "Puan grubunu kanıtlayan kısa PDF metnidir."],
    ], [51 * mm, 120 * mm]),
    p("AI'nin kriter dışında bıraktığı notlar", "H2Guide"),
    p(
        "Açılır bölümde üç tür içerik bulunabilir: Bilgi metni yalnızca açıklamadır; Çalıştırılmayacak kontroller belgede tanımlanmayan veya uygulanmaması gereken denetimlerdir; Analiz uyarısı ise belirsiz, eksik ya da ikinci kez kontrol edilmesi gereken noktaları bildirir."
    ),
    p("Kriter listesi araçları", "H2Guide"),
    table([
        ["Öğe", "Anlamı"],
        ["Kriter ara", "Kriter adında kelime arar."],
        ["Tüm aşamalar", "Teslim, ÖTR, KTR, teknik kontrol, final gibi kapsamları filtreler."],
        ["Renkli küçük çizgi", "Kriter türünü hızlı ayırt etmeye yarayan görsel işarettir; tek başına karar anlamına gelmez."],
        ["Puan / Ceza / Baraj / Geçiş / Öneri", "Kriterin değerlendirme sonucuna nasıl etki ettiğini özetler."],
        ["12p gibi değer", "Bu kriter için PDF'de bulunan azami puanı gösterir."],
        ["!", "Kriterde çözülmesi gereken çakışma vardır."],
        ["Pasif görünüm", "Kriter listede kalır ancak onaylı profile uygulanmaz."],
    ], [48 * mm, 123 * mm]),
]

story.append(PageBreak())

# Page 4
story += [
    p("Seçili kriter - alanların anlamı", "H1Guide"),
    p("Listeden bir kriter seçildiğinde sağdaki düzenleme alanı açılır. Her değişiklik taslağı günceller ve yönetici onayının yeniden verilmesini gerektirir."),
    table([
        ["Alan", "Açıklama"],
        ["Kriter adı", "Kuralın kısa ve anlaşılır adıdır."],
        ["Kriter türü", "Kuralın hangi iş sınıfına ait olduğunu belirtir. Tür, kuralın etkisinden ayrıdır."],
        ["Etkisi", "Kuralın sonuç üzerinde geçiş, puan, ceza, baraj veya yalnızca öneri etkisi olduğunu belirtir."],
        ["Değerlendirme yöntemi", "Kontrolü makinenin mi, AI'nin mi, insanın mı yapacağını belirtir."],
        ["Kapsam / aşama", "Kuralın hangi teslim veya yarışma aşamasında uygulanacağını belirtir."],
        ["Azami puan", "Yalnızca 'Puan kazandırır' etkisinde görünür. PDF'de açıkça verilen üst sınırdır."],
        ["Zorunluluk", "Kuralın uyulması gereken şart mı, yoksa isteğe bağlı/bilgilendirici mi olduğunu belirtir."],
        ["İhlal sonucunda", "Kurala uyulmazsa belgede yazan sonucu veya karar yolunu açıklar."],
        ["Belgedeki dayanak", "Kriteri kanıtlayan PDF alıntısıdır."],
        ["Kaynak sayfayı aç", "Dayanağın bulunduğu PDF sayfasını açar."],
        ["Sistem önerisi", "AI'nin kuralı nasıl yorumladığını ve uygulama önerisini gösterir. Nihai hüküm değildir."],
        ["Güven seviyesi", "AI'nin çıkarımından ne kadar emin olduğunu bildirir; hukuki veya hakem onayı değildir."],
        ["AI tarafından belgeden çıkarıldı", "Kriterin PDF'ye dayandığını gösterir."],
        ["Yönetici tarafından eklendi", "Kriterin PDF'den gelmediğini, kullanıcı tarafından eklendiğini gösterir."],
        ["Aktif / Pasif anahtarı", "Aktif kriter profile girer; pasif kriter saklanır fakat sonraki değerlendirmede uygulanmaz."],
    ], [48 * mm, 123 * mm]),
    p("Kriter türleri", "H2Guide"),
    table([
        ["Tür", "Ne zaman kullanılır?"],
        ["Teknik yükleme kuralı", "Dosya formatı, boyutu, sayısı veya yükleme tekniği için."],
        ["Biçim kuralı", "Sayfa sayısı, yazım düzeni, çözünürlük veya açıkça belirtilmiş biçim şartı için."],
        ["Zorunlu içerik", "Raporda bulunması şart koşulan başlık, belge, video veya bölüm için."],
        ["Nitel puanlama", "Özgünlük, yöntem kalitesi veya sunum gibi dereceyle puanlanan içerik için."],
        ["Eleme incelemesi", "İhlalin doğrudan otomatik sonuç değil, eleme değerlendirmesi başlattığı durum için."],
        ["Hesaplama / formül", "Toplam, katsayı, süre cezası veya açık matematiksel hesap için."],
        ["Yalnızca jüri", "Fiziksel güvenlik, saha gözlemi veya öznel karar gibi tamamen insan yetkisindeki kontroller için."],
    ], [52 * mm, 119 * mm]),
]

story.append(PageBreak())

# Page 5
story += [
    p("Etkiler, yöntemler ve karar dili", "H1Guide"),
    p("Kriter türü 'bu kural nedir?', etki 'sonuca ne yapar?', yöntem ise 'kim veya ne kontrol eder?' sorusunu cevaplar."),
    p("Etkisi", "H2Guide"),
    table([
        ["Seçenek", "Anlamı"],
        ["Uygunluk / geçiş şartı", "Şart sağlanmadan yükleme veya sonraki aşamaya geçiş mümkün değildir ya da incelemeye alınır."],
        ["Puan kazandırır", "Başarı düzeyine göre puan ekler."],
        ["Ceza puanı", "Belgede açıkça yazan sayısal kesintiyi uygular; bakım süresi gibi puan olmayan yaptırımlar burada gösterilmez."],
        ["Baraj / devam şartı", "Belirli en düşük başarı veya puan sağlanmazsa devam edilemez."],
        ["Bilgi ve öneri", "Kararı doğrudan değiştirmez; kullanıcıya veya jüriye yardımcı bilgi verir."],
    ], [52 * mm, 119 * mm]),
    p("Değerlendirme yöntemi", "H2Guide"),
    table([
        ["Seçenek", "Anlamı"],
        ["Kesin otomatik kontrol", "PDF türü, dosya boyutu, sayfa sayısı veya açık sayısal eşik gibi kesin ölçülebilen şarttır."],
        ["AI önerisi", "AI metni yorumlar ve bulgu sunar; karar desteğidir."],
        ["Hakem / jüri kararı", "Fiziksel, güvenlik veya öznel değerlendirmede son karar insandadır."],
        ["AI önerisi + insan onayı", "AI ilk incelemeyi yapar; sonuç hakem veya yetkili onayından sonra geçerli olur."],
    ], [52 * mm, 119 * mm]),
    p("Zorunluluk ve ihlal", "H2Guide"),
    table([
        ["Yazı", "Anlamı"],
        ["Zorunlu", "Kuralın sağlanması gerekir. Ancak tek başına 'otomatik eleme' demek değildir."],
        ["İsteğe bağlı / bilgi", "Eksikliği doğrudan ihlal oluşturmaz; destekleyici içeriktir."],
        ["İhlal sonucunda", "Asıl yaptırım burada yazılır: yüklemeyi engelle, uyar, jüriye gönder, puan kes veya ilgili aşamayı başarısız say gibi."],
    ], [52 * mm, 119 * mm]),
    p("Güven seviyesi", "H2Guide"),
    table([
        ["Seviye", "Yorum"],
        ["Yüksek güven", "Kaynak metin açık, sayfa ve kural bağlantısı güçlüdür."],
        ["Orta güven", "Kural anlaşılırdır fakat bağlam, istisna veya tablo yapısı yönetici kontrolü gerektirir."],
        ["Düşük güven", "Metin belirsizdir veya çıkarım zayıftır; kesinleştirmeden önce kaynak dikkatle incelenmelidir."],
    ], [52 * mm, 119 * mm]),
    p(
        "Örnek: 'Sistem boyutu 100 cm'den küçük olmalıdır' zorunlu bir geçiş şartı olabilir. Ölçüm fiziksel yapılıyorsa yöntem 'Hakem / jüri kararı' olmalıdır. Aynı belgede '60 cm ve altına 20 puan' yazıyorsa bu, aynı konuya bağlı ayrı bir puan etkisidir.",
        "CalloutGuide",
    ),
]

story.append(PageBreak())

# Page 6
story += [
    p("Çakışma, onay ve çıktı", "H1Guide"),
    p("Kaynaklar arasında çakışma bulundu", "H2Guide"),
    p(
        "Temel ayarlardaki bilgi ile PDF'deki bilgi uyuşmadığında görünür. 'Belgedeki değeri kullan' PDF'den çıkarılan değeri kabul eder. "
        "'Başlangıç ayarını koru' yöneticinin ilk girdiği değeri geçerli bırakır. Çakışma çözülmeden profil onaylanamaz."
    ),
    p("Alt onay alanı", "H2Guide"),
    table([
        ["Öğe", "Anlamı"],
        ["Kaynak belgeye dön", "PDF seçme ekranına döner; taslak korunur."],
        ["İnceledim kutusu", "Yöneticinin aktif kriterleri, kaynakları, puan planını ve insan onaylarını kontrol ettiğini beyan eder."],
        ["Yönetici kontrolünü onaylayın", "Onay kutusu işaretlenmeden devam edilemeyeceğini bildirir."],
        ["Çakışmayı çözün", "Onaydan önce belirtilen sayıda uyuşmazlığın kapatılması gerektiğini bildirir."],
        ["Profil onaya hazır", "Aktif kriter var, açık çakışma yok ve yönetici kontrolü verilmiş demektir."],
        ["Profili onayla", "Mevcut kriter taslağını kullanılabilir değerlendirme profiline dönüştürür."],
    ], [52 * mm, 119 * mm]),
    p("Onaylı profil ekranı", "H2Guide"),
    table([
        ["Öğe", "Anlamı"],
        ["Onaylandı", "Profilin yönetici kontrolünden geçtiğini gösterir."],
        ["Profil kimliği", "Yıl / aşama / sürüm bilgisidir; hangi kural setinin kullanıldığını izlemeyi sağlar."],
        ["Yarışma, kategori, rapor, kaynak", "Profilin kapsamını ve dayandığı PDF'yi özetler."],
        ["Aktif kural", "Sonraki modülde uygulanacak kriter sayısıdır."],
        ["Puan grubu", "PDF'den doğrulanan ana puan bölümü sayısıdır."],
        ["PDF toplam puanı", "Belgede açıkça ilan edilen genel toplamdır."],
        ["Kaynak sayfa", "Analiz edilen PDF'nin toplam sayfa sayısıdır."],
        ["Profil JSON'unu indir", "Onaylı kuralları sistemler arasında kullanılabilecek veri dosyası olarak indirir."],
        ["Kriterleri yeniden düzenle", "Onaylı profili tekrar inceleme ekranında açar."],
        ["Yeni bir değerlendirme profili oluştur", "Mevcut iş akışını bitirir ve yeni yarışma/rapor için başa döner."],
        ["Sonraki modül", "Katılımcı raporundaki kanıtları bu kriterlerle eşleştirecek ve gerekçeli puan önerisi üretecek gelecekteki bölümü anlatır."],
    ], [52 * mm, 119 * mm]),
    p("Doğru kullanım için üç kural", "H2Guide"),
    table([
        ["1", "Belgede yazmayan puanı, yaptırımı veya biçim şartını sisteme eklemeyin."],
        ["2", "Zorunlu olan her kuralı otomatik eleme saymayın; ihlal sonucunu ayrıca kontrol edin."],
        ["3", "Fiziksel güvenlik, saha başarımı ve jüri değerlendirmelerinde AI'yi karar verici değil, bulgu sunan yardımcı olarak kullanın."],
    ], [12 * mm, 159 * mm], header=False),
]

doc.build(story, onFirstPage=page_header_footer, onLaterPages=page_header_footer)
print(OUTPUT)
