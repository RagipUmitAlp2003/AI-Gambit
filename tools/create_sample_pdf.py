from pathlib import Path
from shutil import copyfile

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
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
OUTPUT = ROOT / "output" / "pdf" / "Ornek_Akilli_Ulasim_OTR_Degerlendirme_Kilavuzu.pdf"
PUBLIC = ROOT / "public" / "ornek-degerlendirme-kilavuzu.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
PUBLIC.parent.mkdir(parents=True, exist_ok=True)

font_regular = Path("C:/Windows/Fonts/arial.ttf")
font_bold = Path("C:/Windows/Fonts/arialbd.ttf")
pdfmetrics.registerFont(TTFont("Arial", str(font_regular)))
pdfmetrics.registerFont(TTFont("Arial-Bold", str(font_bold)))


def footer(canvas, doc):
    canvas.saveState()
    width, _ = A4
    canvas.setStrokeColor(colors.HexColor("#D6DEE4"))
    canvas.line(22 * mm, 16 * mm, width - 22 * mm, 16 * mm)
    canvas.setFont("Arial", 8)
    canvas.setFillColor(colors.HexColor("#52616D"))
    canvas.drawString(22 * mm, 10 * mm, "SENTETIK TEST BELGESI - RESMI TEKNOFEST BELGESI DEGILDIR")
    canvas.drawRightString(width - 22 * mm, 10 * mm, f"Sayfa {doc.page}")
    canvas.restoreState()


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="TitleTR", fontName="Arial-Bold", fontSize=20, leading=25,
    textColor=colors.HexColor("#102A43"), alignment=TA_CENTER, spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="SubtitleTR", fontName="Arial", fontSize=10.5, leading=15,
    textColor=colors.HexColor("#52616D"), alignment=TA_CENTER, spaceAfter=18,
))
styles.add(ParagraphStyle(
    name="H1TR", fontName="Arial-Bold", fontSize=15, leading=19,
    textColor=colors.HexColor("#102A43"), spaceBefore=8, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="H2TR", fontName="Arial-Bold", fontSize=11.5, leading=15,
    textColor=colors.HexColor("#0B6E69"), spaceBefore=6, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="BodyTR", fontName="Arial", fontSize=9.5, leading=14,
    textColor=colors.HexColor("#263746"), spaceAfter=7,
))
styles.add(ParagraphStyle(
    name="SmallTR", fontName="Arial", fontSize=8.3, leading=11.5,
    textColor=colors.HexColor("#52616D"),
))
styles.add(ParagraphStyle(
    name="TableBodyTR", fontName="Arial", fontSize=8.0, leading=10.4,
    textColor=colors.HexColor("#263746"),
))
styles.add(ParagraphStyle(
    name="TableHeaderTR", fontName="Arial-Bold", fontSize=8.0, leading=10.4,
    textColor=colors.white,
))
styles.add(ParagraphStyle(
    name="CalloutTR", fontName="Arial-Bold", fontSize=9.2, leading=13,
    textColor=colors.HexColor("#7A3E00"), backColor=colors.HexColor("#FFF5DE"),
    borderPadding=8, spaceBefore=5, spaceAfter=10,
))


def wrapped_table(rows):
    return [
        [Paragraph(str(cell), styles["TableHeaderTR" if index == 0 else "TableBodyTR"]) for cell in row]
        for index, row in enumerate(rows)
    ]

doc = SimpleDocTemplate(
    str(OUTPUT), pagesize=A4,
    rightMargin=22 * mm, leftMargin=22 * mm,
    topMargin=22 * mm, bottomMargin=22 * mm,
    title="Örnek Akıllı Ulaşım ÖTR Değerlendirme Kılavuzu",
    author="Sentetik test içeriği",
)

story = []
story.append(Spacer(1, 12 * mm))
story.append(Paragraph("2026 AKILLI ULAŞIM SİSTEMLERİ YARIŞMASI", styles["TitleTR"]))
story.append(Paragraph("Ön Tasarım Raporu (ÖTR) Değerlendirme ve Yazım Kılavuzu - Sürüm 1.1", styles["SubtitleTR"]))
story.append(Paragraph(
    "Bu belge, kriter çıkarma ve değerlendirme profili oluşturma yazılımını sınamak amacıyla hazırlanmış sentetik bir örnektir. Gerçek bir TEKNOFEST şartnamesi veya resmî karar metni değildir.",
    styles["CalloutTR"],
))
story.append(Paragraph("1. Amaç ve kapsam", styles["H1TR"]))
story.append(Paragraph(
    "Bu kılavuz, Akıllı Ulaşım Sistemleri Yarışması Ön Tasarım Raporlarının ortak ve izlenebilir bir yaklaşımla değerlendirilmesini düzenler. Projelerin yenilikçi olması, toplumsal fayda üretmesi ve ulaşım güvenliğine katkı sunması beklenmektedir. Bu beklenti cümlesi tek başına ek bir puanlama kriteri oluşturmaz.",
    styles["BodyTR"],
))
story.append(Paragraph("2. Teslim dosyasına ilişkin teknik kurallar", styles["H1TR"]))
technical_rows = [
    ["Kural", "Açıklama", "İhlal sonucu"],
    ["Dosya biçimi", "Rapor tek bir PDF dosyası olarak yüklenmelidir.", "Sistem yüklemeyi engeller."],
    ["Dosya büyüklüğü", "Yüklenen dosya en fazla 25 MB olabilir.", "Sistem yüklemeyi engeller."],
    ["Dosya sayısı", "Takım başına yalnızca bir rapor dosyası kabul edilir.", "Fazla dosya reddedilir."],
]
t = Table(wrapped_table(technical_rows), colWidths=[37 * mm, 82 * mm, 40 * mm], repeatRows=1)
t.setStyle(TableStyle([
    ("FONTNAME", (0, 0), (-1, 0), "Arial-Bold"),
    ("FONTNAME", (0, 1), (-1, -1), "Arial"),
    ("FONTSIZE", (0, 0), (-1, -1), 8.2),
    ("LEADING", (0, 0), (-1, -1), 11),
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#102A43")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F3F7F8")]),
    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5DC")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story.append(t)
story.append(Spacer(1, 5 * mm))
story.append(Paragraph("3. Rapor düzeni ve zorunlu içerik", styles["H1TR"]))
story.append(Paragraph(
    "3.1 Sayfa sınırı: Rapor, kapak ve kaynakça hariç en fazla 25 sayfa olmalıdır. Sınırın aşılması durumunda rapor otomatik olarak elenmez; inceleme ekranında jüri uyarısı oluşturulur.",
    styles["BodyTR"],
))
story.append(Paragraph(
    "3.2 Sayfa düzeni: Rapor A4 boyutunda hazırlanmalı ve tüm kenarlarda 2,5 cm boşluk kullanılmalıdır. Bu kılavuz belirli bir yazı tipi, punto veya satır aralığı şartı koymamaktadır.",
    styles["BodyTR"],
))
story.append(Paragraph(
    "3.3 Zorunlu bölümler: Problem Tanımı, Mevcut Çözümler, Önerilen Sistem Mimarisi, Yöntem, Doğrulama ve Test Planı, Risk ve Etik Değerlendirme ile Kaynakça bölümleri raporda bulunmalıdır. Eksik bölüm doğrudan eleme oluşturmaz; ilgili puanlama kriterinde eksiklik olarak değerlendirilir.",
    styles["BodyTR"],
))
story.append(PageBreak())
story.append(Paragraph("4. Puanlama kriterleri", styles["H1TR"]))
story.append(Paragraph(
    "Ön Tasarım Raporu toplam 100 puan üzerinden değerlendirilir. Aşağıdaki ana kriterler ve azami puanlar kullanılır.",
    styles["BodyTR"],
))
score_rows = [
    ["No", "Kriter", "Azami puan", "Değerlendirme odağı"],
    ["4.1", "Problem Tanımı ve Gereksinim Analizi", "10", "Problemin açıklığı, hedef kullanıcı ve ölçülebilir gereksinimler"],
    ["4.2", "Özgünlük ve Yenilikçi Değer", "20", "Mevcut çözümlerden fark ve bu farkı destekleyen karşılaştırma"],
    ["4.3", "Teknik Tasarım Yeterliliği", "25", "Mimari, bileşen seçimi, veri akışı ve teknik gerekçeler"],
    ["4.4", "Yöntem ve Doğrulama Planı", "15", "Test senaryoları, başarı ölçütleri ve tekrar edilebilirlik"],
    ["4.5", "Uygulanabilirlik ve Proje Planı", "15", "İş paketleri, takvim, kaynaklar, risk azaltma adımları"],
    ["4.6", "Yaygın Etki ve Sürdürülebilirlik", "10", "Kullanıcı faydası, ölçeklenebilirlik ve sürdürülebilir kullanım"],
    ["4.7", "Raporlama Açıklığı ve Kaynak Kullanımı", "5", "Anlatım bütünlüğü, şekil/tablo açıklamaları ve atıflar"],
]
t2 = Table(wrapped_table(score_rows), colWidths=[13 * mm, 53 * mm, 24 * mm, 69 * mm], repeatRows=1)
t2.setStyle(TableStyle([
    ("FONTNAME", (0, 0), (-1, 0), "Arial-Bold"),
    ("FONTNAME", (0, 1), (-1, -1), "Arial"),
    ("FONTSIZE", (0, 0), (-1, -1), 7.7),
    ("LEADING", (0, 0), (-1, -1), 10.3),
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0B6E69")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F3F7F8")]),
    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5DC")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("ALIGN", (0, 1), (0, -1), "CENTER"),
    ("ALIGN", (2, 1), (2, -1), "CENTER"),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story.append(t2)
story.append(Spacer(1, 5 * mm))
story.append(Paragraph("4.3 Teknik Tasarım Yeterliliği alt başlıkları", styles["H2TR"]))
story.append(Paragraph(
    "Jüri; sistem mimarisinin anlaşılabilirliğini, bileşen seçiminin gerekçesini, alt sistemler arası veri akışını ve tasarımın test edilebilirliğini birlikte dikkate alır. Bu alt başlıklar için ayrı puan dağılımı tanımlanmamıştır; 25 puan bütüncül değerlendirilir.",
    styles["BodyTR"],
))
story.append(Paragraph("4.2 Özgünlük değerlendirmesine ilişkin not", styles["H2TR"]))
story.append(Paragraph(
    "Benzer proje ve ürün karşılaştırması rapordan incelenebilir. Ancak çözümün gerçekten özgün olup olmadığına ilişkin nihai yorum jüriye aittir. Otomatik sistem yalnızca kanıt ve eksiklik önerisi sunabilir.",
    styles["BodyTR"],
))
story.append(Paragraph("5. Eleme, etik ve benzerlik", styles["H1TR"]))
story.append(Paragraph(
    "Raporun takımın kendi çalışması olmadığına ilişkin doğrulanmış bulgu, kaynak göstermeden üçüncü kişilere ait içeriğin kullanılması veya belge benzerlik oranının yüzde 20'yi aşması eleme incelemesi başlatır. Sistem doğrudan eleme kararı vermez; bulguyu kaynaklarıyla jüriye iletir.",
    styles["BodyTR"],
))
story.append(Paragraph(
    "Yapay zekâ araçlarından yararlanılmışsa kullanım amacı ve kapsamı raporun sonunda açıklanmalıdır. Açıklamanın bulunmaması otomatik eleme sebebi değildir; etik inceleme uyarısı oluşturur.",
    styles["BodyTR"],
))
story.append(PageBreak())
story.append(Paragraph("6. Değerlendirme yöntemi", styles["H1TR"]))
method_rows = [
    ["Kontrol türü", "Uygulama"],
    ["Kesin kontroller", "Dosya biçimi, dosya büyüklüğü, dosya sayısı, sayfa sınırı ve zorunlu bölüm varlığı otomatik olarak kontrol edilebilir."],
    ["Yapay zekâ destekli ön değerlendirme", "Nitel kriterler için rapordaki kanıtlar, eksikler ve gerekçeli puan önerisi hazırlanır."],
    ["Jüri kararı", "Özgünlük, etik ihlal, gerçek uygulanabilirlik ve doğrulanamayan teknik iddialarda nihai karar jüriye aittir."],
]
t3 = Table(wrapped_table(method_rows), colWidths=[48 * mm, 111 * mm], repeatRows=1)
t3.setStyle(TableStyle([
    ("FONTNAME", (0, 0), (-1, 0), "Arial-Bold"),
    ("FONTNAME", (0, 1), (-1, -1), "Arial"),
    ("FONTSIZE", (0, 0), (-1, -1), 8.4),
    ("LEADING", (0, 0), (-1, -1), 11.5),
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#102A43")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F3F7F8")]),
    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5DC")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story.append(t3)
story.append(Spacer(1, 5 * mm))
story.append(Paragraph("7. Yetkili onayı ve sürüm", styles["H1TR"]))
story.append(Paragraph(
    "Otomatik sistem tarafından oluşturulan değerlendirme profili, yarışma yetkilisi tarafından onaylanmadan kullanılamaz. Yetkili; kriter türünü, puanı, zorunluluk durumunu ve ihlal sonucunu değiştirebilir. Her değişiklik tarihçe kaydına alınır.",
    styles["BodyTR"],
))
story.append(Paragraph(
    "Bu kılavuz 12 Ağustos 2026 tarihli 1.1 sürümüdür. Sonraki değişiklikler yeni profil sürümü olarak saklanmalıdır.",
    styles["BodyTR"],
))
story.append(Spacer(1, 10 * mm))
story.append(Paragraph(
    "Belge sonu - Bu test örneğinde yazı tipi ve punto şartı bilerek tanımlanmamıştır. Sistem bu kontrolleri etkinleştirmemelidir.",
    styles["CalloutTR"],
))

doc.build(story, onFirstPage=footer, onLaterPages=footer)
copyfile(OUTPUT, PUBLIC)
print(OUTPUT)
print(PUBLIC)
