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


/** Kapsam kararını model verir; sunucu kaynağı doğrular ve etiketleri korur. */
test("doğrulanmış teknik ve haricî kriter korunur; modelin dışladığı aday alınmaz", () => {
  const blocks=[
    block("SAYFA-03-BLOK-001","Video en fazla 2 dakika olmalıdır.",3),
    block("SAYFA-03-BLOK-002","Motor gücü en fazla 5 kW olmalıdır.",3),
    block("SAYFA-03-BLOK-003","Video sisteme yüklenmelidir.",3),
  ];
  const rows=blocks.map((source,index)=>({
    sourceId:source.sourceId,result:index===2?"KAPSAM_DISI":"KRITER",
    classificationReason:index===2?"Teslim işlemi.":"Açık koşul.",
    name:index===0?"Video süresi":"Motor gücü",stage:index===0?"language_template":"criteria_evidence",
    required:true,description:source.originalText,controlType:"KANIT_KONTROLU",
    verifiability:index===0?"HARICI_KANIT_GEREKLI":"PDF_DENETLENEBILIR",
    sourcePage:source.pageNumber,sourceText:source.originalText,
  }));
  const result=normalizeExtraction({decisions:rows} as never,3,blocks,new Set(blocks.map(x=>x.sourceId)));
  assert.equal(result.criteria.length,2);
  assert.equal(result.criteria[0].verifiability,"HARICI_KANIT_GEREKLI");
  assert.equal(result.stats.excludedCandidates,1);
  assert.equal(result.stats.unansweredCandidates,0);
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
  const route = readFileSync("app/lib/criteria-priority.ts", "utf8");
  const cap = Number(route.match(/const CRITERIA_OUTPUT_TOKENS = ([\d_]+);/)?.[1]?.replace(/_/g, "") ?? 0);
  assert.ok(cap >= 32_768, `Çıktı tavanı ölçülen ihtiyacın (25.564) belirgin üstünde olmalıdır; şu an ${cap}.`);
  const runner = readFileSync("app/lib/criteria-generation.ts", "utf8");
  assert.match(runner, /finishReason === "MAX_TOKENS"/, "Kesilme tespit edilmelidir.");
  assert.match(runner, /queue.unshift\(group.slice/, "Yalnızca taşan grup bölünmelidir.");
  // Kesilme kontrolü bozuk JSON dalından ÖNCE gelmelidir; yoksa yanıltıcı mesaj döner.
  assert.ok(
    runner.indexOf('finishReason === "MAX_TOKENS"') < runner.indexOf("JSON.parse(text)"),
    "Kesilme, genel JSON hatasından önce raporlanmalıdır.",
  );
});


/** Talimatın kapsam sınırları; modelin canlı kalitesi ayrı benchmark'ta ölçülür. */
test("istem dört alanı, video dosya istisnasını ve kaynak güvenliğini açıklar", async () => {
  const {EXTRACTION_STAGE_IDS,EXTRACTION_SYSTEM_INSTRUCTION: prompt}=await import("../app/lib/criteria-extraction.ts");
  assert.deepEqual(EXTRACTION_STAGE_IDS,["language_template","headings_content","category_similarity","criteria_evidence"]);
  for (const phrase of ["ÖNCELİKLİ KARAR SIRASI","HARICI_KANIT_GEREKLI","KAPSAM_DISI","required=false","BİREBİR","sourcePage ve sourceId'yi değiştirme","Her aday sourceId","puan tablosuysa","şartnamenin başlığı"])
    assert.ok(prompt.includes(phrase),phrase);
  assert.doesNotMatch(prompt,/Emin değilsen KRITER üretme|verifiability daima PDF_DENETLENEBILIR/);
});

test("zorunlu yenileme eski başarılı önbelleği istek başında silmez", () => {
  const route=readFileSync("app/api/analyze/route.ts","utf8");
  assert.doesNotMatch(route,/deleteStoredAnalysis|analysisCache\(\)\.delete\(cacheKey\)/);
  assert.match(route,/forceRefresh \? undefined : analysisCache\(\)\.get\(cacheKey\)/);
  assert.match(route,/forceRefresh \? null : await findStoredAnalysis/);
  assert.ok(route.indexOf("coverageCheck.stats.unansweredCandidates > 0")<route.indexOf("const extraction: CachedExtraction"));
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

test("şartname toplam 80 saniyede kesilmez, ağ isteği güvenlik sınırı korunur", () => {
  const route = readFileSync("app/api/analyze/route.ts", "utf8");
  assert.doesNotMatch(route, /80_000|CRITERIA_TOTAL_TIMEOUT_MS/);
  assert.match(route, /generatePrioritizedCriteria/);
  const client = readFileSync("app/lib/gemini-analyzer.ts", "utf8");
  assert.doesNotMatch(client, /AbortSignal\.timeout|setTimeout\(/);
});

test("çıktı şeması yalnızca gerçek aday kimliklerini kabul eder ve eksik kapsam başarı sayılmaz", async () => {
  const { extractionSchemaForCandidates } = await import("../app/lib/criteria-extraction.ts");
  const schema = extractionSchemaForCandidates(["SAYFA-01-BLOK-001", "SAYFA-02-BLOK-003"]);
  for (const variant of schema.properties.decisions.items.anyOf) {
    assert.deepEqual(variant.properties.sourceId.enum, ["SAYFA-01-BLOK-001", "SAYFA-02-BLOK-003"]);
  }
  const criterion = schema.properties.decisions.items.anyOf.find((variant) => "stage" in variant.properties)!;
  assert.ok("stage" in criterion.properties);
  assert.deepEqual(criterion.properties.stage.enum, ["language_template", "headings_content", "category_similarity", "criteria_evidence"]);

  const route = readFileSync("app/api/analyze/route.ts", "utf8");
  assert.match(route, /coverageCheck\.stats\.unansweredCandidates > 0/);
  assert.match(route, /Eksik sonuç kaydedilmedi/);
  assert.ok(
    route.indexOf("coverageCheck.stats.unansweredCandidates > 0") < route.indexOf("const extraction: CachedExtraction"),
    "Kapsam kontrolü önbelleğe alma ve kayıt işleminden önce yapılmalıdır.",
  );
});

test("kapsam dışı çıktı şeması iki alanlıdır; gerçek kriterin kanıt alanları zorunlu kalır", async () => {
  const { EXTRACTION_SCHEMA, EXTRACTION_SYSTEM_INSTRUCTION, buildExtractionPrompt } = await import("../app/lib/criteria-extraction.ts");
  const [criterion, excluded] = EXTRACTION_SCHEMA.properties.decisions.items.anyOf;
  assert.deepEqual(Object.keys(excluded.properties).sort(), ["result", "sourceId"]);
  assert.deepEqual([...excluded.required].sort(), ["result", "sourceId"]);
  assert.equal(excluded.additionalProperties, false);
  assert.deepEqual(excluded.properties.result.enum, ["KAPSAM_DISI"]);
  assert.deepEqual(criterion.properties.result.enum, ["KRITER"]);
  for (const field of ["sourceText", "sourcePage", "description", "required", "stage", "classificationReason"]) {
    assert.ok((criterion.required as readonly string[]).includes(field));
  }
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /KAPSAM_DISI kararında gerekçe yazma/);
  assert.doesNotMatch(EXTRACTION_SYSTEM_INSTRUCTION, /kapsam dışı kararların gerekçeli|şemayı tamamlayan sabit yer tutucular/);
  const prompt = buildExtractionPrompt({pageCount: 2, totalBlocks: 4, candidateCount: 3, documentContext: "", candidatesText: "örnek"});
  assert.match(prompt, /gerekçe veya boş alan ekleme/);
  assert.doesNotMatch(prompt, /KAPSAM_DISI olarak gerekçelendir/);
});
