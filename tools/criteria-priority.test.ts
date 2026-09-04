import assert from "node:assert/strict";
import test from "node:test";
import { generatePrioritizedCriteria, priorityInstruction, prioritySchema } from "../app/lib/criteria-priority.ts";
import { normalizeExtraction, type RawCandidateDecision } from "../app/lib/criteria-extraction.ts";
import { selectCriteriaCandidates } from "../app/lib/criteria-candidates.ts";
import { PDF_STRUCTURE_VERSION, type StructuredPdf, type PdfStructureBlock } from "../app/lib/pdf-structure.ts";
import type { GenerationInput, GenerationOutcome } from "../app/lib/gemini-generation.ts";
import { normalizeForSearch } from "../app/lib/turkish-text.ts";

function fixture(technical: number, core: number) {
  const blocks: PdfStructureBlock[] = Array.from({ length: technical + core }, (_, i) => ({
    sourceId: `S-${i}`, pdfHash: "a".repeat(64), pdfVersion: "v", pageNumber: i + 1,
    sectionTitle: i < technical ? "Teknik gereksinimler" : "Rapor kuralları", subsectionTitle: "", clauseNumber: null,
    blockType: "PARAGRAPH", originalText: i < technical ? `Motor ${i + 1} kg olmalıdır.` : `Rapor ${i + 1} sayfa olmalıdır.`,
    normalizedText: "", approximatePosition: { top: 10, left: 10, lineStart: 0, lineEnd: 0 },
  }));
  for (const block of blocks) block.normalizedText = normalizeForSearch(block.originalText);
  const structure: StructuredPdf = { version: PDF_STRUCTURE_VERSION, pdfHash: "a".repeat(64),
    pageCount: blocks.length, blocks, textLength: 1000, letterRatio: 1 };
  return { structure, selection: selectCriteriaCandidates(blocks) };
}
function row(source: PdfStructureBlock, stage: string): RawCandidateDecision {
  return { sourceId: source.sourceId, result: "KRITER", name: `Kural ${source.sourceId}`, stage, required: true,
    description: source.originalText, sourceText: source.originalText, sourcePage: source.pageNumber,
    verifiability: "PDF_DENETLENEBILIR", controlType: "KANIT_KONTROLU", classificationReason: "Açık kaynak koşulu." };
}
function payload(raw: unknown): GenerationOutcome {
  return { ok: true, apiCalls: 1, model: "test", payload: { candidates: [{ finishReason: "STOP",
    content: { parts: [{ text: JSON.stringify(raw) }] } }], usageMetadata: { promptTokenCount: 10,
    candidatesTokenCount: 10, totalTokenCount: 20 } } };
}
function simulator(data: ReturnType<typeof fixture>, coreIds: Set<string>) {
  const requests: { phase: string; ids: string[]; capacity: number }[] = [];
  const generate = async (request: GenerationInput) => {
    const body = JSON.parse(request.body);
    const ids: string[] = body.generationConfig.responseJsonSchema.properties.decisions.items.anyOf[0].properties.sourceId.enum;
    const core = request.label === "analyze-core";
    const capacity = Number(body.systemInstruction.parts[0].text.match(/EN FAZLA (\d+) kriterdir/)?.[1] ?? 0);
    requests.push({ phase: core ? "core" : "technical", ids, capacity });
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, core ? "LOW" : "MEDIUM");
    assert.equal(body.generationConfig.temperature, 1);
    assert.equal(body.generationConfig.topP, undefined);
    assert.ok(request.timeoutMs > 80_000);
    return payload({ documentProfile: { competition: "Test" },
      ...(core ? { technicalCandidateSourceIds: ids.filter(id => !coreIds.has(id)) } : {}),
      decisions: ids.map((id, index) => {
        const block = data.structure.blocks.find(item => item.sourceId === id)!;
        if (core) return coreIds.has(id) ? row(block, "headings_content") : { sourceId: id, result: "KAPSAM_DISI" };
        return index < capacity ? row(block, "criteria_evidence") : { sourceId: id, result: "TEKNIK_LIMIT" };
      }),
    });
  };
  return { requests, generate };
}
function normalized(data: ReturnType<typeof fixture>, raw: Parameters<typeof normalizeExtraction>[0]) {
  return normalizeExtraction(raw, data.structure.pageCount, data.structure.blocks,
    new Set(data.selection.candidates.map(item => item.block.sourceId)));
}

test("son sayfadaki 6 temel kriter korunur; 22 teknikten sonra kalan adaylar çağrılmaz", async () => {
  const data = fixture(123, 6);
  const core = new Set(data.structure.blocks.slice(123).map(item => item.sourceId));
  const mock = simulator(data, core);
  const result = await generatePrioritizedCriteria({ ...data, apiKey: "test", model: "test", generate: mock.generate });
  assert.ok(result.ok);
  const output = normalized(data, result.raw);
  assert.equal(output.criteria.length, 28);
  assert.equal(output.criteria.filter(item => item.stage === "headings_content").length, 6);
  assert.equal(output.stats.unansweredCandidates, 0);
  assert.equal(output.stats.excludedCandidates, 0, "Kontenjan dışı teknik aday gerçek kapsam dışı değildir.");
  assert.equal(output.stats.technicalLimitSkipped, 101);
  assert.equal(mock.requests.filter(item => item.phase === "technical").length, 2);
  assert.deepEqual(mock.requests.filter(item => item.phase === "technical").map(item => item.capacity), [11, 11]);
  assert.equal(mock.requests.filter(item => item.phase === "core").flatMap(item => item.ids).length, 129);
  const replay = normalized(data, JSON.parse(JSON.stringify(result.raw)));
  assert.deepEqual(replay, output, "Önbellek normalizasyonu da aynı 28 kriteri ve limit bilgisini korur.");
});

test("15 gerçek kriter 28'e tamamlanmaz", async () => {
  const data = fixture(12, 3);
  const mock = simulator(data, new Set(data.structure.blocks.slice(12).map(item => item.sourceId)));
  const result = await generatePrioritizedCriteria({ ...data, apiKey: "test", model: "test", generate: mock.generate });
  assert.ok(result.ok);
  assert.equal(normalized(data, result.raw).criteria.length, 15);
  assert.equal(normalized(data, result.raw).stats.technicalLimitSkipped, 0);
});

test("temel kriterler tek başına 28'i aşarsa korunur, teknik çağrı yapılmaz", async () => {
  const data = fixture(20, 30);
  const mock = simulator(data, new Set(data.structure.blocks.slice(20).map(item => item.sourceId)));
  const result = await generatePrioritizedCriteria({ ...data, apiKey: "test", model: "test", generate: mock.generate });
  assert.ok(result.ok);
  assert.equal(normalized(data, result.raw).criteria.length, 30);
  assert.equal(mock.requests.filter(item => item.phase === "technical").length, 0);
});

test("karma adayın temel kuralı korunurken teknik koşulu da incelenir", async () => {
  const data = fixture(0, 1);
  const source = data.structure.blocks[0];
  source.originalText = "Rapor Türkçe olmalıdır. Motor 30 kg olmalıdır.";
  const result = await generatePrioritizedCriteria({ ...data, apiKey: "test", model: "test", generate: async request =>
    payload({ documentProfile: {}, ...(request.label === "analyze-core" ? { technicalCandidateSourceIds: [source.sourceId] } : {}),
      decisions: [row(source, request.label === "analyze-core" ? "language_template" : "criteria_evidence")] }) });
  assert.ok(result.ok);
  assert.equal(normalized(data, result.raw).criteria.length, 2);
});

test("doğrulanmayan alıntı ve tekrarlar kontenjanı tüketmez; taşan gerçek teknikler sunucuda sınırlanır", () => {
  const data = fixture(40, 6);
  const core = data.structure.blocks.slice(40).map(item => row(item, "headings_content"));
  const technical = data.structure.blocks.slice(0, 40).map(item => row(item, "criteria_evidence"));
  const output = normalized(data, { criteriaLimitPolicy: "core-first-28", decisions: [
    ...core, core[0], { ...core[1], name: "Geçersiz", sourceText: "Kaynakta olmayan alıntı" }, ...technical,
  ] });
  assert.equal(output.criteria.length, 28);
  assert.equal(output.stats.rejectedSources, 1);
  assert.equal(output.stats.duplicateCriteria, 1);
  assert.equal(output.stats.droppedCriteria, 18);
});

test("temel tarama eksikse veya teknik API başarısızsa tamamlanmış sonuç verilmez", async () => {
  for (const failure of ["missing", "foreign", "wrong-stage", "503"]) {
    const data = fixture(1, 0);
    const result = await generatePrioritizedCriteria({ ...data, apiKey: "test", model: "test", generate: async request => {
      if (request.label === "analyze-technical") return { ok: false, apiCalls: 1, model: "test", status: 503, detail: "busy" };
      return payload({ documentProfile: {}, technicalCandidateSourceIds: [failure === "foreign" ? "foreign" : "S-0"],
        decisions: failure === "missing" ? [] : failure === "wrong-stage" ? [row(data.structure.blocks[0], "criteria_evidence")]
          : [{ sourceId: "S-0", result: "KAPSAM_DISI" }] });
    } });
    assert.equal(result.ok, false, failure);
    assert.ok(!("raw" in result), failure);
  }
});

test("öncelik talimatı 28'i hedef yapmaz ve teknik kuralı kategoriye taşımayı yasaklar", () => {
  assert.match(priorityInstruction("core", 0), /category_similarity DEĞİLDİR/);
  assert.match(priorityInstruction("technical", 22), /EN FAZLA 22/);
  assert.match(priorityInstruction("technical", 22), /hedef DEĞİLDİR/);
  const schema = prioritySchema(["S-0"], "core");
  assert.equal(Object.keys(schema.properties)[0], "technicalCandidateSourceIds");
  for (const variant of schema.properties.decisions.items.anyOf) {
    assert.equal(Object.keys(variant.properties)[0], "result", "Karar, gerekçe/ad üretiminden önce gelmeli.");
  }
  assert.match(priorityInstruction("core", 0), /VERSİYON TABLOSU/);
  assert.match(priorityInstruction("core", 0), /Puan kazanma eşiği tasarım zorunluluğu veya önerisi değildir/);
});
