/** Dört alan: kaynak doğrulama, aday kapsaması ve model kararının korunması.
 * Eski regex-kapsam veto testleri ürün kararıyla kaldırılmıştır. Bu testler
 * Gemini'nin doğru sınıflandırdığını iddia etmez; canlı kalite benchmark'ta ölçülür.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CANDIDATE_SELECTOR_VERSION, selectCriteriaCandidates } from "../app/lib/criteria-candidates.ts";
import { DICTIONARY_VERSION } from "../app/lib/criteria-dictionary.ts";
import {
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_STAGE_IDS,
  normalizeExtraction,
} from "../app/lib/criteria-extraction.ts";
import { normalizeForSearch } from "../app/lib/turkish-text.ts";
import type { PdfStructureBlock } from "../app/lib/pdf-structure.ts";

const CELIKKUBBE = "public/samples/2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf";
const IDA = "output/pdf/official/2026_Insansiz_Deniz_Araci_Sartnamesi.pdf";

function block(
  sourceId: string,
  originalText: string,
  pageNumber = 2,
  overrides: Partial<PdfStructureBlock> = {},
): PdfStructureBlock {
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
    ...overrides,
  };
}

type RawDecision = Record<string, unknown>;

/** Modelin KRITER kararı; alıntı varsayılan olarak bloğun tamamıdır. */
function decision(source: PdfStructureBlock, overrides: RawDecision = {}): RawDecision {
  return {
    sourceId: source.sourceId,
    result: "KRITER",
    classificationReason: "Şartname kuralı",
    name: "Kural",
    stage: "criteria_evidence",
    required: true,
    description: "Kural raporda denetlenir.",
    controlType: "KANIT_KONTROLU",
    verifiability: "PDF_DENETLENEBILIR",
    sourcePage: source.pageNumber,
    sourceText: source.originalText,
    ...overrides,
  };
}

function run(blocks: PdfStructureBlock[], decisions: RawDecision[]) {
  return normalizeExtraction(
    { documentProfile: {}, decisions } as never,
    20,
    blocks,
    new Set(blocks.map((item) => item.sourceId)),
  );
}

function readPdf(path: string): ArrayBuffer | null {
  try {
    const file = readFileSync(path);
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

test("1) Türkçe rapor dili kuralı aday seçilir ve language_template kriteri olur", () => {
  const source = block("SAYFA-02-BLOK-001", "Rapor Türkçe hazırlanmalıdır.");
  const selection = selectCriteriaCandidates([source]);
  assert.equal(selection.candidates.length, 1);
  assert.ok(selection.candidates[0].signals.includes("LANGUAGE_TEMPLATE_TERM"));

  const result = run([source], [decision(source, {
    name: "Rapor Dili", stage: "language_template", description: "Rapor Türkçe hazırlanmalıdır.",
  })]);
  assert.equal(result.criteria.length, 1);
  assert.equal(result.criteria[0].stage, "language_template");
  assert.equal(result.criteria[0].sourceId, source.sourceId);
});

test("2) sayfa sınırı language_template kriteri olur", () => {
  const source = block("SAYFA-02-BLOK-002", "Rapor en fazla 20 sayfa olmalıdır.");
  assert.equal(selectCriteriaCandidates([source]).candidates.length, 1);
  const result = run([source], [decision(source, {
    name: "Rapor Sayfa Sınırı", stage: "language_template", description: "Rapor en fazla 20 sayfa olmalıdır.",
    sourceText: "en fazla 20 sayfa olmalıdır",
  })]);
  assert.equal(result.criteria.length, 1);
  assert.equal(result.criteria[0].stage, "language_template");
});

test("3) font/punto, A4 ve kenar boşluğu aynı cümleden ayrı language_template kriterleri olur", () => {
  const source = block(
    "SAYFA-02-BLOK-003",
    "Rapor A4 sayfa düzeninde, 12 punto Times New Roman yazı tipiyle ve 2,5 cm kenar boşluğuyla hazırlanmalıdır.",
  );
  assert.equal(selectCriteriaCandidates([source]).candidates.length, 1);
  const result = run([source], [
    decision(source, { name: "Sayfa Düzeni A4", stage: "language_template", description: "Rapor A4 sayfa düzeninde olmalıdır.", sourceText: "A4 sayfa düzeninde" }),
    decision(source, { name: "Yazı Tipi ve Punto", stage: "language_template", description: "12 punto Times New Roman kullanılmalıdır.", sourceText: "12 punto Times New Roman yazı tipiyle" }),
    decision(source, { name: "Kenar Boşluğu", stage: "language_template", description: "Kenar boşluğu 2,5 cm olmalıdır.", sourceText: "2,5 cm kenar boşluğuyla" }),
  ]);
  assert.deepEqual(result.criteria.map((item) => item.name), ["Sayfa Düzeni A4", "Yazı Tipi ve Punto", "Kenar Boşluğu"]);
  assert.ok(result.criteria.every((item) => item.stage === "language_template"));
  assert.equal(result.stats.duplicateCriteria, 0);
});

test("4) çok satırlı zorunlu başlık listesinin bütün maddeleri ayrı headings_content kriteri olur", () => {
  const blocks = [
    block("SAYFA-04-BLOK-001", "Rapor aşağıdaki bölümleri içermelidir:", 4),
    block("SAYFA-04-BLOK-002", "Mekanik Tasarım", 4),
    block("SAYFA-04-BLOK-003", "Elektronik Tasarım", 4),
    block("SAYFA-04-BLOK-004", "Yazılım Mimarisi", 4),
    block("SAYFA-04-BLOK-005", "Test ve Doğrulama Sonuçları", 4),
  ];
  const selection = selectCriteriaCandidates(blocks);
  for (const item of blocks.slice(1)) {
    assert.ok(selection.candidates.some((candidate) => candidate.block.sourceId === item.sourceId), `${item.originalText} aday olmalıdır.`);
  }
  const result = run(blocks, blocks.slice(1).map((item) => decision(item, {
    name: `${item.originalText} Başlığı`, stage: "headings_content", controlType: "BIREBIR_BASLIK",
    description: `Raporda ${item.originalText} bölümü bulunmalıdır.`,
  })));
  assert.equal(result.criteria.length, 4);
  assert.ok(result.criteria.every((item) => item.stage === "headings_content"));
  assert.equal(new Set(result.criteria.map((item) => item.name)).size, 4);
});

test("8) \"Motor seçimi raporda açıklanmalıdır\" headings_content kriteri olur", () => {
  const source = block("SAYFA-06-BLOK-001", "Motor seçimi ve güç hesabı raporda açıklanmalıdır.", 6);
  // Aday seçimi bağlayıcı kiple yapılır; aşama kararı (rapor içeriği) LLM'e ve
  // sunucunun headings_content kapısına (rapor bağlamı + istenen içerik) aittir.
  const selection = selectCriteriaCandidates([source]);
  assert.equal(selection.candidates.length, 1);
  assert.ok(selection.candidates[0].signals.includes("OBLIGATION_TERM"));
  const result = run([source], [decision(source, {
    name: "Motor Seçimi Açıklaması", stage: "headings_content", controlType: "ICERIK_VARLIGI",
    description: "Motor seçimi ve güç hesabı raporda açıklanmalıdır.",
  })]);
  assert.equal(result.criteria.length, 1);
  assert.equal(result.criteria[0].stage, "headings_content");
  assert.equal(result.criteria[0].controlType, "ICERIK_VARLIGI");
});

test("9) \"Motor gücü en fazla 5 kW olmalıdır\" aday seçilir ve criteria_evidence KRITER olarak kalır", () => {
  const source = block("SAYFA-07-BLOK-001", "Motor gücü en fazla 5 kW olmalıdır.", 7);
  const selection = selectCriteriaCandidates([source]);
  assert.equal(selection.candidates.length, 1, "Teknik limit adaya alınmalıdır.");
  for (const signal of ["TECHNICAL_TERM", "NUMBER_UNIT_PATTERN", "MIN_MAX_PATTERN", "OBLIGATION_TERM"]) {
    assert.ok(selection.candidates[0].signals.includes(signal as never), `${signal} sinyali bulunmalıdır.`);
  }
  const result = run([source], [decision(source, {
    name: "Motor Gücü Sınırı", description: "Motor gücü en fazla 5 kW olmalıdır.",
  })]);
  assert.equal(result.criteria.length, 1);
  assert.equal(result.criteria[0].stage, "criteria_evidence");
  assert.equal(result.criteria[0].controlType, "KANIT_KONTROLU");
  assert.equal(result.criteria[0].verifiability, "PDF_DENETLENEBILIR");
  assert.equal(result.criteria[0].required, true);
  assert.equal(result.stats.excludedCandidates, 0);
});

test("10) \"Araç 50 kg'dan ağır olmamalıdır\" criteria_evidence KRITER olur; kontrol türü KANIT_KONTROLU'na çözülür", () => {
  const source = block("SAYFA-07-BLOK-002", "Araç 50 kg'dan ağır olmamalıdır.", 7);
  const selection = selectCriteriaCandidates([source]);
  assert.equal(selection.candidates.length, 1);
  assert.ok(selection.candidates[0].signals.includes("PROHIBITION_TERM"));
  // Model aşamayla uyumsuz kontrol türü yazsa bile criteria_evidence KANIT_KONTROLU'dur.
  const result = run([source], [decision(source, {
    name: "Araç Ağırlık Sınırı", description: "Araç 50 kg'dan ağır olmamalıdır.", controlType: "ICERIK_VARLIGI",
  })]);
  assert.equal(result.criteria.length, 1);
  assert.equal(result.criteria[0].stage, "criteria_evidence");
  assert.equal(result.criteria[0].controlType, "KANIT_KONTROLU");
});

test("13) somut yarışma kapsamı category_similarity kriteri olur", () => {
  const source = block("SAYFA-01-BLOK-004", "Yarışma kapsamı, tarımda otonom yabancı ot tespiti çözümlerine yönelik projelerle sınırlıdır.", 1);
  const selection = selectCriteriaCandidates([source]);
  assert.equal(selection.candidates.length, 1);
  assert.ok(selection.candidates[0].signals.includes("CATEGORY_TERM"));
  const result = run([source], [decision(source, {
    name: "Yarışma Konu Kapsamı", stage: "category_similarity", controlType: "ANLAMSAL_UYGUNLUK", required: false,
    description: "Proje tarımda otonom yabancı ot tespitine yönelik olmalıdır.",
  })]);
  assert.equal(result.criteria.length, 1);
  assert.equal(result.criteria[0].stage, "category_similarity");
  assert.equal(result.criteria[0].controlType, "ANLAMSAL_UYGUNLUK");
});


test("yeni çıkarım ve seçici sürümleri eski sonuç önbelleğini kullanmaz", () => {
  assert.deepEqual([...EXTRACTION_STAGE_IDS], ["language_template", "headings_content", "category_similarity", "criteria_evidence"]);
  assert.equal(EXTRACTION_PROMPT_VERSION, "v43-preliminary-local-context");
  assert.equal(CANDIDATE_SELECTOR_VERSION, "candidate-selector-v4-local-context-hints");
  assert.equal(DICTIONARY_VERSION, "sozluk-v6-four-stages-scope-gates");
});

test("zorunlu olmayan açık içerik koşulu korunur, zorunluya dönüşmez", () => {
  const source=block("SAYFA-05-BLOK-001", "Raporda ek bir risk tablosu sunulması önerilir.", 5);
  const result=run([source],[decision(source,{name:"Risk tablosu",stage:"headings_content",required:false,description:"Raporda ek risk tablosu sunulması önerilir."})]);
  assert.equal(result.criteria.length,1);
  assert.equal(result.criteria[0].required,false);
});

test("360 derece ve yarışma kelimeleri modelin doğrulanmış tasarım kararını silmez", () => {
  const source=block("SAYFA-05-BLOK-001","Sistem 360 derece dönebilmelidir. Yarışma sırasında test yapılır.",5);
  const result=run([source],[decision(source,{name:"Dönüş kabiliyeti",description:"Sistem 360 derece dönebilmelidir.",sourceText:"Sistem 360 derece dönebilmelidir."})]);
  assert.equal(result.criteria.length,1);
  assert.equal(result.stats.excludedCandidates,0);
});

test("geçerli aşamanın anlamsal uygunluğu ikinci bir regex ile veto edilmez", () => {
  const source=block("SAYFA-05-BLOK-001","Sistem gereksinimleri raporda açıklanmalıdır.",5);
  for (const stage of EXTRACTION_STAGE_IDS) {
    const result=run([source],[decision(source,{stage})]);
    assert.equal(result.criteria.length,1);
    assert.equal(result.criteria[0].stage,stage);
  }
  const invalid=run([source],[decision(source,{stage:"unknown_stage"})]);
  assert.equal(invalid.criteria.length,0);
});

test("video dosya özelliği saklanır fakat mevcut PDF değerlendirme kapsamına girmez", async () => {
  const { criteriaScopeOf }=await import("../app/lib/report-prechecks.ts");
  const source=block("SAYFA-05-BLOK-001","Video en fazla iki dakika ve MP4 olmalıdır.",5);
  const result=run([source],[decision(source,{name:"Video süresi",stage:"language_template",description:"Video en fazla iki dakika olmalıdır.",verifiability:"HARICI_KANIT_GEREKLI"})]);
  assert.equal(result.criteria.length,1);
  const scope=criteriaScopeOf({criteria:result.criteria} as never);
  assert.equal(scope.published,1);
  assert.equal(scope.pdfEvaluable,0);
  assert.equal(scope.outsidePdf,1);
});

test("modelin kapsam dışı kararları gerekçeleriyle ham yanıtta kalır ve kritere dönüşmez", () => {
  const texts=["Yarışma günü geç kalanlara ceza uygulanır.","Videoda kalkış ve iniş gösterilmelidir.","KYS üzerinden yükleyiniz.","Final değerlendirme sunumu yapılacaktır."];
  const blocks=texts.map((value,i)=>block("SAYFA-05-BLOK-"+i,value,5));
  const rows=blocks.map(source=>decision(source,{result:"KAPSAM_DISI",classificationReason:"Rapor ön elemesi değil, dış süreç."}));
  const result=run(blocks,rows);
  assert.equal(result.criteria.length,0);
  assert.equal(result.stats.excludedCandidates,4);
  assert.equal(result.stats.unansweredCandidates,0);
  assert.ok(rows.every(row=>row.classificationReason));
});

test("sahte alıntı veya kaynak kimliği kapsam esnekliğinden yararlanamaz", () => {
  const source=block("SAYFA-05-BLOK-001","Motor gücü en fazla 5 kW olmalıdır.",5);
  const result=run([source],[
    decision(source,{sourceId:"UYDURMA",name:"Sahte kimlik"}),
    decision(source,{sourceText:"Motor 10 kW olmalıdır.",name:"Sahte alıntı"}),
  ]);
  assert.equal(result.criteria.length,0);
  assert.equal(result.stats.rejectedSources,2);
});

test("tanınmayan karar sonucu cevaplanmış aday sayılmaz", () => {
  const source=block("SAYFA-05-BLOK-001","Motor gücü en fazla 5 kW olmalıdır.",5);
  const result=run([source],[decision(source,{result:"BELIRSIZ"})]);
  assert.equal(result.stats.unansweredCandidates,1);
});

test("aynı adlı ayrı atomik kuralların kimlikleri çakışmaz; gerçek tekrar birleşir", () => {
  const source=block("SAYFA-05-BLOK-001","Rapor Türkçe ve en fazla 10 sayfa olmalıdır.",5);
  const rows=[
    decision(source,{name:"Rapor kuralı",stage:"language_template",description:"Rapor Türkçe olmalıdır."}),
    decision(source,{name:"Rapor kuralı",stage:"language_template",description:"Rapor en fazla 10 sayfa olmalıdır."}),
  ];
  const result=run([source],[...rows,rows[0]]);
  assert.equal(result.criteria.length,2);
  assert.equal(new Set(result.criteria.map(x=>x.id)).size,2);
  assert.equal(result.stats.duplicateCriteria,1);
  assert.deepEqual(run([source],rows).criteria.map(x=>x.id),result.criteria.map(x=>x.id));
});

test("açık liste girişi sözlükte olmayan alt başlığı da LLM'ye taşır", async () => {
  const {formatCandidatesForLlm}=await import("../app/lib/criteria-candidates.ts");
  const blocks=[
    block("SAYFA-05-BLOK-001","Rapor aşağıdaki bölümleri içermelidir:",5),
    block("SAYFA-05-BLOK-002","Mekanik Tasarım",5),
    block("SAYFA-05-BLOK-003","Göç Planı",5),
  ];
  const selection=selectCriteriaCandidates(blocks);
  const child=selection.candidates.find(x=>x.block.sourceId===blocks[2].sourceId);
  assert.ok(child);
  assert.equal(child.listContext,blocks[0].originalText);
  assert.match(formatCandidatesForLlm([child]),/Rapor aşağıdaki bölümleri içermelidir/);
});

test("liste bağlamı sayfa ve uzun bağımsız paragraf sınırını aşmaz", () => {
  const blocks=[
    block("SAYFA-05-BLOK-001","Rapor aşağıdaki bölümleri içermelidir:",5),
    block("SAYFA-06-BLOK-001","Göç Planı",6),
  ];
  assert.equal(selectCriteriaCandidates(blocks).candidates.some(x=>x.block.sourceId===blocks[1].sourceId),false);
});

test("yerel yorumlama ipuçları adayları elemez ve kaynak metnini değiştirmez", async () => {
  const { formatCandidatesForLlm } = await import("../app/lib/criteria-candidates.ts");
  const sources = [
    block("SAYFA-05-BLOK-001", "Rapor kapak ve içindekiler dahil en fazla 10 sayfa olmalıdır.", 5),
    block("SAYFA-05-BLOK-002", "Yarışma bu aşamada gerçekleştirilecektir. Motor en fazla 5 kW olmalıdır.", 5),
    block("SAYFA-05-BLOK-003", "Araç ağırlığı en fazla 30 kg olmalıdır.", 5),
  ];
  const selection = selectCriteriaCandidates(sources);
  assert.equal(selection.candidates.length, 3);
  const formatted = formatCandidatesForLlm(selection.candidates);
  for (const source of sources) assert.ok(formatted.includes(source.originalText));
  assert.match(formatted, /Bu liste tek başına zorunlu rapor başlığı/);
  assert.match(formatted, /Bu eylemlerden tasarım yükümlülüğü türetme/);
  assert.doesNotMatch(formatCandidatesForLlm([selection.candidates[2]]), /interpretationHints/);
});

test("Çelikkubbe: amaç, sayfa limitleri, teknik koşullar ve video dosya sınırı LLM adayları arasındadır", async (context) => {
  const bytes=readPdf(CELIKKUBBE);
  if (!bytes) {context.skip("Yerel şartname bulunamadı"); return;}
  const {extractPdfStructure}=await import("../app/lib/pdf-structure.ts");
  const structure=await extractPdfStructure(bytes);
  const selection=selectCriteriaCandidates(structure.blocks);
  const expected=[/Bu ihtiyaç doğrultusunda yarışmanın amacı/,/Ön tasarım raporu en fazla 10 sayfa/,/Kritik tasarım raporuen fazla 30 sayfa/,/100cm/,/kablolar yırtılma ve elektrik kaçaklarına/,/patlayıcı kullanmaları yasaktır/,/farklı otonomluk seviyeleri bulundurması beklenmektedir/,/Videonun çözünürlüğü/];
  for (const pattern of expected) assert.ok(selection.candidates.some(x=>pattern.test(x.block.originalText)),String(pattern));
  assert.equal(selection.candidates.length+selection.unselected.length,structure.blocks.length);
});

test("İDA: modem, keskin kenar, uçuş durdurma ve batarya sızdırmazlığı aday seçilmeye devam eder", async (context) => {
  const bytes=readPdf(IDA);
  if (!bytes) {context.skip("Yerel şartname bulunamadı"); return;}
  const {extractPdfStructure}=await import("../app/lib/pdf-structure.ts");
  const structure=await extractPdfStructure(bytes);
  const selection=selectCriteriaCandidates(structure.blocks);
  for (const pattern of [/modemler kullanılamayacaktır/,/keskin noktalar bulunmayacak/,/uçuşu devre dışı bırakmasını sağlayacak/,/Bataryaların bulunduğu bölüm sızdırmaz olacaktır/])
    assert.ok(selection.candidates.some(x=>pattern.test(x.block.originalText)),String(pattern));
});
