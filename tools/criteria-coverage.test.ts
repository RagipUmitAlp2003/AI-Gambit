/**
 * KRİTER SAYISI / KAPSAM REGRESYON TESTLERİ
 *
 * 25 sayfalık gerçek bir şartnameden yalnızca 5 kriter çıkıyordu. Kök neden ÜÇ
 * AYRI kusurdu; buradaki testler üçünü de ayrı ayrı kilitler, artı ölçüm
 * sırasında ortaya çıkan çıktı-tavanı kesilmesini ve istem sözleşmesini korur.
 *
 * Canlı model çağrısı YAPILMAZ: kayıtlı yapı, saf normalizasyon ve kaynak
 * sözleşmesi üzerinden doğrulanır.
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeExtraction } from "../app/lib/criteria-extraction.ts";
import { selectCriteriaCandidates } from "../app/lib/criteria-candidates.ts";
import { normalizeForSearch } from "../app/lib/turkish-text.ts";
import type { PdfStructureBlock } from "../app/lib/pdf-structure.ts";

const SAMPLE = "public/samples/2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf";

function block(sourceId: string, originalText: string, pageNumber = 2): PdfStructureBlock {
  return {
    sourceId,
    pdfHash: "a".repeat(64),
    pdfVersion: "a".repeat(16),
    pageNumber,
    sectionTitle: "Sistem Gereksinimleri",
    subsectionTitle: "",
    clauseNumber: null,
    blockType: "LIST_ITEM",
    originalText,
    normalizedText: normalizeForSearch(originalText),
    approximatePosition: { top: 700, left: 60, lineStart: 1, lineEnd: 1 },
  };
}

function readSample(): ArrayBuffer | null {
  try {
    const file = readFileSync(SAMPLE);
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------- */

/**
 * 1) KAYDIRILMIŞ MADDE SATIRLARI BİRLEŞİR.
 *
 * Madde işaretli bir kural iki görsel satıra taştığında her satır ayrı blok
 * oluyordu ("... 100cm' den" + "kucuk olacaktir."), yani kuralın kendisi
 * hiçbir blokta TAM değildi. Model yarım cümlede uygulanabilir bir kural
 * göremeyip "kapsam dışı" diyordu.
 */
test("kaydırılmış madde satırları tek blokta birleşir; kural yarım kalmaz", async (context) => {
  const bytes = readSample();
  if (!bytes) { context.skip(`${SAMPLE} bulunamadı`); return; }
  const { extractPdfStructure } = await import("../app/lib/pdf-structure.ts");
  const structure = await extractPdfStructure(bytes);

  // Boyut kuralı: cümlenin iki parçası da AYNI blokta olmalıdır.
  const sizeRule = structure.blocks.find((item) => item.originalText.includes("100cm"));
  assert.ok(sizeRule, "Boyut kuralı bloğu bulunmalıdır.");
  assert.match(sizeRule!.originalText, /küçük olacaktır/, "Kural cümlesi bloklara bölünmemelidir.");

  // EMI kuralı: eskiden "... sisteminin EMI" ile kesiliyordu.
  const emi = structure.blocks.find((item) => item.originalText.includes("EMI"));
  assert.ok(emi, "EMI kuralı bloğu bulunmalıdır.");
  assert.match(emi!.originalText, /gereklerini/, "EMI kuralı yarım kalmamalıdır.");

  // Genel sağlık ölçütü: madde/bent bloklarının çoğu tam cümle olmalıdır.
  // (Başlık gibi yazılmış maddeler için pay bırakılır.)
  const clauses = structure.blocks.filter((item) => ["LIST_ITEM", "NUMBERED_CLAUSE"].includes(item.blockType));
  const unfinished = clauses.filter((item) => !/[.!?;:]$/.test(item.originalText.trim()));
  assert.ok(clauses.length > 20, "Belgede madde/bent bloğu bulunmalıdır.");
  assert.ok(
    unfinished.length / clauses.length < 0.35,
    `Madde/bent bloklarının çoğu tam cümle olmalıdır (yarım: ${unfinished.length}/${clauses.length}).`,
  );
});

/**
 * 2) ALINTI DOĞRULAMASI, MODELE VERİLEN BAĞLAM PENCERESİNİ KABUL EDER.
 *
 * `formatCandidatesForLlm` her adaya contextBefore/contextAfter ekliyor. Kural
 * aday bloğun sonunda başlayıp bağlam bloğunda bitiyorsa model — doğru
 * davranıp — kuralın TAMAMINI alıntılıyor; doğrulama yalnızca aday bloğun
 * metnine baktığı için bu DOĞRU alıntılar reddediliyordu (10 sonucun 5'i).
 *
 * Bütünlük zayıflamaz: kaydedilen kaynak bağı her zaman SUNUCUNUN bloğundan
 * gelir ve belgede hiç bulunmayan alıntı yine reddedilir.
 */
test("alıntı adayın yakın bağlamına taşsa da kabul edilir; uydurma alıntı reddedilir", () => {
  const blocks: PdfStructureBlock[] = [
    block("SAYFA-02-BLOK-001", "Raporun yöntem bölümünde motor seçimi ve güç", 2),
    block("SAYFA-02-BLOK-002", "hesabı açıklanmalıdır.", 2),
    block("SAYFA-02-BLOK-003", "Rapor Türkçe yazılmalıdır.", 2),
  ];
  const ids = new Set(["SAYFA-02-BLOK-001"]);

  const spanning = normalizeExtraction({
    documentProfile: {},
    decisions: [{
      sourceId: "SAYFA-02-BLOK-001",
      result: "KRITER",
      classificationReason: "Zorunluluk ifadesi",
      name: "Motor Seçimi İçeriği",
      stage: "headings_content",
      required: true,
      description: "Motor seçimi ve güç hesabı yöntem bölümünde açıklanmalıdır.",
      controlType: "ICERIK_VARLIGI",
      verifiability: "PDF_DENETLENEBILIR",
      sourcePage: 2,
      // Blok + sonraki bağlam bloğuna yayılan TAM cümle.
      sourceText: "Raporun yöntem bölümünde motor seçimi ve güç hesabı açıklanmalıdır.",
    }],
  } as never, 5, blocks, ids);
  assert.equal(spanning.criteria.length, 1, "Bağlama taşan doğru alıntı kabul edilmelidir.");
  assert.equal(spanning.stats.rejectedSources, 0);
  assert.equal(spanning.criteria[0].sourceId, "SAYFA-02-BLOK-001", "Kaynak bağı sunucunun bloğundan gelir.");
  assert.equal(spanning.criteria[0].sourcePage, 2);

  const invented = normalizeExtraction({
    documentProfile: {},
    decisions: [{
      sourceId: "SAYFA-02-BLOK-001",
      result: "KRITER",
      classificationReason: "Zorunluluk ifadesi",
      name: "Uydurma Kural",
      stage: "headings_content",
      required: true,
      description: "Belgede bulunmayan bir kural.",
      controlType: "KANIT_KONTROLU",
      verifiability: "PDF_DENETLENEBILIR",
      sourcePage: 2,
      sourceText: "Araç en fazla 40 kilogram olabilir.",
    }],
  } as never, 5, blocks, ids);
  assert.equal(invented.criteria.length, 0, "Belgede olmayan alıntı kabul edilmemelidir.");
  assert.equal(invented.stats.rejectedSources, 1);

  // Uzak bir blokun metni bağlam sayılmaz: pencere yalnızca komşu bloklardır.
  const distant = normalizeExtraction({
    documentProfile: {},
    decisions: [{
      sourceId: "SAYFA-02-BLOK-001",
      result: "KRITER",
      classificationReason: "Dil kuralı",
      name: "Rapor Dili",
      stage: "language_template",
      required: true,
      description: "Rapor Türkçe olmalıdır.",
      controlType: "KANIT_KONTROLU",
      verifiability: "PDF_DENETLENEBILIR",
      sourcePage: 2,
      sourceText: "Rapor Türkçe yazılmalıdır.",
    }],
  } as never, 5, blocks, ids);
  assert.equal(distant.criteria.length, 0, "İki blok öteden alıntı bu adaya bağlanamaz.");
});

/**
 * 3) AKTİF KRİTER PROFİLİ YALNIZCA KATILIMCI PDF'İNİ KAPSAR.
 *
 * Şartnamedeki her bağlayıcı madde rapor kriteri değildir. Portal, video,
 * saha veya kurul kararı gibi PDF dışı sonuçlar model yanlışlıkla KRITER
 * döndürse bile aktif profile taşınmaz. Dört aşamalı çıkarımda raporun
 * tasarım anlatımından denetlenebilen teknik gereksinim (1080p gerçek zamanlı
 * işleme) criteria_evidence olarak KALIR; parkur gösterimi, CSV teslimi ve
 * idari kurallar yine dışarıdadır.
 */
test("PDF dışı ve insan kararına bağlı kurallar aktif kriter listesine alınmaz", () => {
  const blocks: PdfStructureBlock[] = [
    block("SAYFA-03-BLOK-001", "Rapor, KYS sistemine son teslim tarihine kadar yüklenmelidir.", 3),
    block("SAYFA-03-BLOK-002", "Projenin özgünlüğü değerlendirme kurulu kararıyla belirlenir.", 3),
    block("SAYFA-03-BLOK-003", "Raporun yöntem bölümünde motor seçimi açıklanmalıdır.", 3),
    block("SAYFA-03-BLOK-004", "İletişim konusunda yaşanacak sorunlar takımın sorumluluğundadır.", 3),
    block("SAYFA-03-BLOK-005", "Takım yarışma günü parkuru üç dakikada tamamlamalıdır.", 3),
    block("SAYFA-03-BLOK-006", "Tanıtım videosu en fazla 2 dakika ve MP4 formatında olmalıdır.", 3),
    block("SAYFA-03-BLOK-007", "Teknik Yeterlilik Raporu, Kritik Tasarım Raporu ve Otonomi Kabiliyeti videosu göndermeyen takımlar yarışmaya katılamaz.", 3),
    block("SAYFA-03-BLOK-008", "Sistem 1080p kamera akışını gerçek zamanlı işleyebilmelidir.", 3),
    block("SAYFA-03-BLOK-009", "Navigasyon kabiliyeti parkurda gösterilecektir.", 3),
    block("SAYFA-03-BLOK-010", "Telemetri verileri CSV dosyası olarak teslim edilecektir.", 3),
    block("SAYFA-03-BLOK-011", "Takımlar anlatımı kolaylaştırmak için rapor veya akış diyagramı kullanabilir; bu yöntem önerilir.", 3),
    { ...block("SAYFA-03-MADDE-3-1", "3.1 Teknik Yeterlilik Raporu", 3), blockType: "NUMBERED_CLAUSE" },
  ];
  const ids = new Set(blocks.map((item) => item.sourceId));
  const result = normalizeExtraction({
    documentProfile: {},
    decisions: [
      {
        sourceId: "SAYFA-03-BLOK-001", result: "KRITER", classificationReason: "Teslim zorunluluğu",
        name: "Rapor Portal Teslimi", stage: "language_template", required: true,
        description: "Rapor KYS'ye zamanında yüklenmelidir.", controlType: "KANIT_KONTROLU",
        verifiability: "HARICI_KANIT_GEREKLI", sourcePage: 3,
        sourceText: "Rapor, KYS sistemine son teslim tarihine kadar yüklenmelidir.",
      },
      {
        // Model alanı geçersiz bıraksa bile metinden deterministik türetilir.
        sourceId: "SAYFA-03-BLOK-002", result: "KRITER", classificationReason: "Kurul takdiri",
        name: "Özgünlük Kurul Kararı", stage: "criteria_evidence", required: true,
        description: "Özgünlük değerlendirme kurulu kararıyla belirlenir.", controlType: "KANIT_KONTROLU",
        verifiability: "GECERSIZ_DEGER", sourcePage: 3,
        sourceText: "Projenin özgünlüğü değerlendirme kurulu kararıyla belirlenir.",
      },
      {
        sourceId: "SAYFA-03-BLOK-003", result: "KRITER", classificationReason: "Rapordan denetlenebilir içerik",
        name: "Motor Seçimi Açıklaması", stage: "headings_content", required: true,
        description: "Motor seçimi yöntem bölümünde açıklanmalıdır.", controlType: "ICERIK_VARLIGI",
        verifiability: "PDF_DENETLENEBILIR", sourcePage: 3,
        sourceText: "Raporun yöntem bölümünde motor seçimi açıklanmalıdır.",
      },
      {
        // Model yanlışlıkla PDF denetlenebilir dese de sunucu kapsam kapısı korur.
        sourceId: "SAYFA-03-BLOK-004", result: "KRITER", classificationReason: "Bağlayıcı sorumluluk",
        name: "İletişim Sorumluluğu", stage: "criteria_evidence", required: true,
        description: "İletişim sorunları takımın sorumluluğundadır.", controlType: "KANIT_KONTROLU",
        verifiability: "PDF_DENETLENEBILIR", sourcePage: 3,
        sourceText: "İletişim konusunda yaşanacak sorunlar takımın sorumluluğundadır.",
      },
      {
        sourceId: "SAYFA-03-BLOK-005", result: "KRITER", classificationReason: "Süre sınırı",
        name: "Parkur Süresi", stage: "criteria_evidence", required: true,
        description: "Parkur yarışma günü üç dakikada tamamlanmalıdır.", controlType: "KANIT_KONTROLU",
        verifiability: "PDF_DENETLENEBILIR", sourcePage: 3,
        sourceText: "Takım yarışma günü parkuru üç dakikada tamamlamalıdır.",
      },
      {
        sourceId: "SAYFA-03-BLOK-006", result: "KRITER", classificationReason: "Video biçimi",
        name: "Video Süresi ve Formatı", stage: "language_template", required: true,
        description: "Tanıtım videosu iki dakikayı aşmamalı ve MP4 olmalıdır.", controlType: "KANIT_KONTROLU",
        verifiability: "PDF_DENETLENEBILIR", sourcePage: 3,
        sourceText: "Tanıtım videosu en fazla 2 dakika ve MP4 formatında olmalıdır.",
      },
      {
        sourceId: "SAYFA-03-BLOK-007", result: "KRITER", classificationReason: "Karma rapor ve video teslimi",
        name: "Zorunlu Rapor ve Video Teslimleri", stage: "language_template", required: true,
        description: "Teknik raporlar ve otonomi kabiliyeti videosu gönderilmelidir.", controlType: "ICERIK_VARLIGI",
        verifiability: "PDF_DENETLENEBILIR", sourcePage: 3,
        sourceText: "Teknik Yeterlilik Raporu, Kritik Tasarım Raporu ve Otonomi Kabiliyeti videosu göndermeyen takımlar yarışmaya katılamaz.",
      },
      {
        sourceId: "SAYFA-03-BLOK-008", result: "KRITER", classificationReason: "Teknik yetenek",
        name: "Video İşleme Yeteneği", stage: "criteria_evidence", required: true,
        description: "Sistem 1080p kamera akışını gerçek zamanlı işlemelidir.", controlType: "KANIT_KONTROLU",
        verifiability: "PDF_DENETLENEBILIR", sourcePage: 3,
        sourceText: "Sistem 1080p kamera akışını gerçek zamanlı işleyebilmelidir.",
      },
      {
        sourceId: "SAYFA-03-BLOK-009", result: "KRITER", classificationReason: "Canlı görev",
        name: "Parkur Navigasyon Gösterimi", stage: "criteria_evidence", required: true,
        description: "Navigasyon kabiliyeti parkurda gösterilmelidir.", controlType: "KANIT_KONTROLU",
        verifiability: "PDF_DENETLENEBILIR", sourcePage: 3,
        sourceText: "Navigasyon kabiliyeti parkurda gösterilecektir.",
      },
      {
        sourceId: "SAYFA-03-BLOK-010", result: "KRITER", classificationReason: "Ayrı veri teslimi",
        name: "Telemetri CSV Teslimi", stage: "criteria_evidence", required: true,
        description: "Telemetri verileri CSV dosyası olarak teslim edilmelidir.", controlType: "KANIT_KONTROLU",
        verifiability: "PDF_DENETLENEBILIR", sourcePage: 3,
        sourceText: "Telemetri verileri CSV dosyası olarak teslim edilecektir.",
      },
      {
        sourceId: "SAYFA-03-BLOK-011", result: "KRITER", classificationReason: "Yardımcı içerik",
        name: "Yardımcı Akış Diyagramı", stage: "headings_content", required: false,
        description: "Akış diyagramı kullanılabilir.", controlType: "ICERIK_VARLIGI",
        verifiability: "PDF_DENETLENEBILIR", sourcePage: 3,
        sourceText: "Takımlar anlatımı kolaylaştırmak için rapor veya akış diyagramı kullanabilir; bu yöntem önerilir.",
      },
      {
        sourceId: "SAYFA-03-MADDE-3-1", result: "KRITER", classificationReason: "Şartname bölüm başlığı",
        name: "Teknik Yeterlilik Raporu Başlığı", stage: "headings_content", required: true,
        description: "Raporda Teknik Yeterlilik Raporu başlığı bulunmalıdır.", controlType: "BIREBIR_BASLIK",
        verifiability: "PDF_DENETLENEBILIR", sourcePage: 3,
        sourceText: "3.1 Teknik Yeterlilik Raporu",
      },
    ],
  } as never, 5, blocks, ids);
  assert.deepEqual(result.criteria.map((item) => item.name), ["Motor Seçimi Açıklaması", "Video İşleme Yeteneği"]);
  assert.equal(result.criteria[1].stage, "criteria_evidence");
  assert.equal(result.criteria[1].controlType, "KANIT_KONTROLU");
  assert.equal(result.stats.excludedCandidates, 10);
  assert.ok(result.warnings.some((warning) => warning.includes("katılımcı PDF'inden değerlendirilemediği")));
});

/**
 * 4) ÇIKTI TAVANI VE KESİLME.
 *
 * Tavan 24.576'ya indirilmişti. Kapsam düzeltildikten sonra 129 adaylı bir
 * şartnamede cevap tavana dayanıp kesildi ve uç "şemaya uygun JSON olarak
 * okunamadı" ile 502 döndürdü — sebebi anlaşılmayan bir hata. Ölçülen gerçek
 * çıktı 25.564 token. Tavan yükseltildi; kesilme artık sebebini söyleyen bir
 * hataya çevriliyor.
 */
test("çıktı tavanı ölçülen ihtiyacın üstündedir ve kesilme açık hata üretir", () => {
  const route = readFileSync("app/api/analyze/route.ts", "utf8");
  const cap = Number(route.match(/const MAX_OUTPUT_TOKENS = ([\d_]+);/)?.[1]?.replace(/_/g, "") ?? 0);
  assert.ok(cap >= 32_768, `Çıktı tavanı ölçülen ihtiyacın (25.564) belirgin üstünde olmalıdır; şu an ${cap}.`);
  assert.match(route, /finishReason === "MAX_TOKENS"/, "Kesilme tespit edilmelidir.");
  assert.match(route, /token sınırına ulaştığı için kesildi/, "Kullanıcıya sebep açıkça söylenmelidir.");
  // Kesilme kontrolü bozuk JSON dalından ÖNCE gelmelidir; yoksa yanıltıcı mesaj döner.
  assert.ok(
    route.indexOf("truncatedByTokenLimit(outcome.payload)") < route.indexOf("şemaya uygun JSON olarak okunamadı"),
    "Kesilme, genel JSON hatasından önce raporlanmalıdır.",
  );
});

/**
 * 5) İSTEM SÖZLEŞMESİ: dört aşama; puan/baraj, yarışma günü, video ve portal
 * yasağı korunur.
 *
 * Kapsam genişletilirken model puan barajlarını kriter yapmaya başladı; bu
 * sistem puan üretmez ve puan eşiği denetlemez. Ayrıca idari kurallar
 * "category_similarity" aşamasına doluyordu; o aşama yalnızca projenin
 * kategoriye uygunluğu içindir. Dördüncü aşama (criteria_evidence) yalnızca
 * rapordan metinsel/sayısal olarak denetlenebilen teknik tasarım kuralıdır.
 */
test("istem dört aşamalı rapor kontrolünü üretir; yarışma günü, video, portal ve puan yasağı korunur", async () => {
  const { EXTRACTION_STAGE_IDS, EXTRACTION_SYSTEM_INSTRUCTION } = await import("../app/lib/criteria-extraction.ts");
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /TEKNOFEST'te ön eleme aşamasında görevli, deneyimli bir Proje Yöneticisisin/);
  assert.deepEqual(EXTRACTION_STAGE_IDS, ["language_template", "headings_content", "category_similarity", "criteria_evidence"]);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /DÖRT KAPSAM/);
  assert.doesNotMatch(EXTRACTION_SYSTEM_INSTRUCTION, /YALNIZCA ÜÇ KAPSAM/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /4\. criteria_evidence/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /Motor, malzeme, boyut, ağırlık, batarya/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /criteria_evidence \/ KRITER/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /Yarışma günü\/sırasında\/esnasında yapılacak parkur/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /yarışma sonrası işlemler\s+daima KAPSAM_DISI/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /Video içeriği\/süresi\/formatı\/yüklemesi; portal\/KYS/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /Puan, baraj, sıralama, ödül, ceza/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /verifiability daima PDF_DENETLENEBILIR/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /Raporlar arası benzerlik kriteri\s+üretme/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /Asla "\.\.\." veya "…" ekleme/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /kriter sayısını yapay olarak sınırlama/i);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /TÜM sourceId'ler/);
});

test("çok satırlı zorunlu başlık listesinde sonraki maddeler kaçırılmaz", () => {
  const blocks: PdfStructureBlock[] = [
    block("SAYFA-04-BLOK-001", "Rapor aşağıdaki bölümleri içermelidir:", 4),
    block("SAYFA-04-BLOK-002", "Proje Özeti", 4),
    { ...block("SAYFA-04-BLOK-003", "3.2 Mekanik Tasarım", 4), blockType: "NUMBERED_CLAUSE" },
    block("SAYFA-04-BLOK-004", "Elektronik Tasarım", 4),
  ];
  const selection = selectCriteriaCandidates(blocks);
  assert.ok(selection.candidates.some((item) => item.block.sourceId === "SAYFA-04-BLOK-003"));
  const source = blocks[2];
  const result = normalizeExtraction({ decisions: [{
    sourceId: source.sourceId,
    result: "KRITER",
    classificationReason: "Zorunlu rapor bölümü",
    name: "Mekanik Tasarım Başlığı",
    stage: "headings_content",
    required: true,
    description: "Raporda Mekanik Tasarım bölümü bulunmalıdır.",
    controlType: "BIREBIR_BASLIK",
    verifiability: "PDF_DENETLENEBILIR",
    sourcePage: 4,
    sourceText: "3.2 Mekanik Tasarım",
  }] } as never, 4, blocks, new Set([source.sourceId]));
  assert.equal(result.criteria.length, 1);
});

test("çıktı şeması yalnızca gerçek aday kimliklerini kabul eder ve eksik kapsam başarı sayılmaz", async () => {
  const { extractionSchemaForCandidates } = await import("../app/lib/criteria-extraction.ts");
  const schema = extractionSchemaForCandidates(["SAYFA-01-BLOK-001", "SAYFA-02-BLOK-003"]);
  assert.deepEqual(schema.properties.decisions.items.properties.sourceId.enum, ["SAYFA-01-BLOK-001", "SAYFA-02-BLOK-003"]);
  assert.deepEqual(schema.properties.decisions.items.properties.stage.enum, ["language_template", "headings_content", "category_similarity", "criteria_evidence"]);

  const route = readFileSync("app/api/analyze/route.ts", "utf8");
  assert.match(route, /coverageCheck\.stats\.unansweredCandidates > 0/);
  assert.match(route, /Eksik sonuç kaydedilmedi/);
  assert.ok(
    route.indexOf("coverageCheck.stats.unansweredCandidates > 0") < route.indexOf("const extraction: CachedExtraction"),
    "Kapsam kontrolü önbelleğe alma ve kayıt işleminden önce yapılmalıdır.",
  );
});
