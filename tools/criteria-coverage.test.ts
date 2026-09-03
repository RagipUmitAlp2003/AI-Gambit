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
    block("SAYFA-02-BLOK-001", "Sistemde kullanılan kablolar yırtılma ve elektrik", 2),
    block("SAYFA-02-BLOK-002", "kaçaklarına karşı izole edilmelidir.", 2),
    block("SAYFA-02-BLOK-003", "Rapor Türkçe yazılmalıdır.", 2),
  ];
  const ids = new Set(["SAYFA-02-BLOK-001"]);

  const spanning = normalizeExtraction({
    documentProfile: {},
    decisions: [{
      sourceId: "SAYFA-02-BLOK-001",
      result: "KRITER",
      classificationReason: "Zorunluluk ifadesi",
      name: "Kablo İzolasyonu",
      stage: "criteria_evidence",
      required: true,
      description: "Kabloların izole edildiği raporda gösterilmelidir.",
      controlType: "KANIT_KONTROLU",
      verifiability: "PDF_DENETLENEBILIR",
      sourcePage: 2,
      // Blok + sonraki bağlam bloğuna yayılan TAM cümle.
      sourceText: "Sistemde kullanılan kablolar yırtılma ve elektrik kaçaklarına karşı izole edilmelidir.",
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
      stage: "criteria_evidence",
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
 * 3) KANIT YERİ MODELDEN OKUNUR.
 *
 * `verifiability` sabit "PDF_DENETLENEBILIR" yazılıyordu; modele kanıtı rapor
 * dışında olan bir kuralı kaydetmek için hiçbir yol kalmıyor, tek seçenek onu
 * KAPSAM_DISI ile SİLMEKTİ. Böylece "rapor portala yüklenmelidir" gibi
 * bağlayıcı kurallar kayboluyor ve sistemin PDF dışı kriter sayaçları hep
 * sıfır kalıyordu.
 */
test("kanıt yeri modelden okunur; PDF dışı kural silinmek yerine işaretlenir", () => {
  const blocks: PdfStructureBlock[] = [
    block("SAYFA-03-BLOK-001", "Rapor, KYS sistemine son teslim tarihine kadar yüklenmelidir.", 3),
    block("SAYFA-03-BLOK-002", "Projenin özgünlüğü değerlendirme kurulu kararıyla belirlenir.", 3),
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
    ],
  } as never, 5, blocks, ids);
  assert.equal(result.criteria.length, 2, "PDF dışı kurallar da kriter olarak korunmalıdır.");
  const byName = new Map(result.criteria.map((item) => [item.name, item]));
  assert.equal(byName.get("Rapor Portal Teslimi")?.verifiability, "HARICI_KANIT_GEREKLI", "Modelin işareti okunmalıdır.");
  assert.equal(byName.get("Özgünlük Kurul Kararı")?.verifiability, "HAKEM_KONTROLU_GEREKLI", "Geçersiz değer metinden türetilmelidir.");
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
 * 5) İSTEM SÖZLEŞMESİ: puan/baraj yasağı ve dar kategori aşaması.
 *
 * Kapsam genişletilirken model puan barajlarını kriter yapmaya başladı; bu
 * sistem puan üretmez ve puan eşiği denetlemez. Ayrıca idari kurallar
 * "category_similarity" aşamasına doluyordu; o aşama yalnızca projenin
 * kategoriye uygunluğu içindir.
 */
test("istem puan/baraj kriterini yasaklar ve kategori aşamasını dar tutar", async () => {
  const { EXTRACTION_SYSTEM_INSTRUCTION } = await import("../app/lib/criteria-extraction.ts");
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /PUAN VE BARAJ — MUTLAK KAPSAM DIŞI/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /puan\/baraj\/sıralama ise KRITER YAPMA/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /Bu aşama DARDIR/);
  // Kanıt yeri modele açıkça anlatılmalı; aksi hâlde kural silinir.
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /Bu iki tür kural SİLİNMEZ; işaretlenir/);
  // Kapsam çağrısı korunmalı: model kriter sayısını kendiliğinden kısmamalı.
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /kriter sayısını yapay olarak sınırlama/i);
});
