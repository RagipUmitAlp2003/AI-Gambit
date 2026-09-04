/**
 * KATMAN 3 — LLM açıklama kontrolü (GÖREV 3 · madde 5) birim testleri.
 * Ücretli çağrı YAPMAZ: `generate` sahte enjeksiyonla taklit edilir
 * (embedTexts'in mock `fetcher` deseniyle aynı DI yaklaşımı).
 *
 *   - K eşleşme için TAM OLARAK BİR generateContent isteği gider.
 *   - Gövde responseJsonSchema + responseMimeType application/json taşır.
 *   - Model yalnızca sınıf + açıklama döndürür; bilinmeyen index (uydurma
 *     eşleşme), sınıf 1-6 dışı yanıt ve yinelenen index sunucuda ATILIR.
 *   - Arıza asla fırlatılmaz; çağıran deterministik sonucu aynen korur
 *     ("Açıklama kontrolü tamamlanamadı", senaryo 10).
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  SIMILARITY_LLM_CLASSES,
  explainSimilarityMatches,
  type SimilarityLlmMatchInput,
} from "../app/lib/similarity-llm.ts";
import type { GenerationInput, GenerationOutcome } from "../app/lib/gemini-generation.ts";

function matchInput(index: number, kind: "direct" | "semantic" = "semantic"): SimilarityLlmMatchInput {
  return {
    index,
    kind,
    ownPage: index + 2,
    peerPage: index + 5,
    ownExcerpt: `kendi rapor alıntısı ${index}`,
    peerExcerpt: `eş rapor alıntısı ${index}`,
    corroboration: kind === "semantic" ? ["ozgun-sayilar"] : [],
  };
}

function fakeGenerate(
  calls: GenerationInput[],
  responseText: string | null,
  failure?: { status: number; detail: string },
): (input: GenerationInput) => Promise<GenerationOutcome> {
  return async (input) => {
    calls.push(input);
    if (failure) return { ok: false, status: failure.status, detail: failure.detail, model: input.model, apiCalls: 1 };
    return {
      ok: true,
      payload: { candidates: [{ content: { parts: [{ text: responseText ?? "" }] } }] },
      model: input.model,
      apiCalls: 1,
    };
  };
}

test("altı sınıf madde 5 ile birebir aynıdır", () => {
  assert.deepEqual(Object.keys(SIMILARITY_LLM_CLASSES).map(Number).sort(), [1, 2, 3, 4, 5, 6]);
  assert.equal(SIMILARITY_LLM_CLASSES[1], "Resmî şablon veya ortak başlık");
  assert.equal(SIMILARITY_LLM_CLASSES[5], "Doğrudan veya küçük değişikliklerle aktarılmış metin");
  assert.equal(SIMILARITY_LLM_CLASSES[6], "Karar verilemedi, hakem incelemeli");
});

test("K eşleşme için TEK generateContent isteği gider; gövde JSON şema sözleşmesini taşır", async () => {
  const calls: GenerationInput[] = [];
  const outcome = await explainSimilarityMatches({
    apiKey: "test-key",
    competitionName: "2026 Roket Yarışması",
    matches: [matchInput(0), matchInput(1), matchInput(2, "direct")],
    generate: fakeGenerate(calls, JSON.stringify({
      eslesmeler: [
        { index: 0, sinif: 4, aciklama: "Özgün çözüm anlatımı benziyor", degerlendirme: "İncelemeye değer" },
        { index: 1, sinif: 3, aciklama: "Aynı teknik konu", degerlendirme: "Normal" },
        { index: 2, sinif: 5, aciklama: "Küçük değişikliklerle aktarım", degerlendirme: "İncelemeye değer" },
      ],
    })),
  });
  assert.equal(calls.length, 1, "Üç eşleşme TEK çağrıda sınıflandırılmalıdır (TEK ÇAĞRI politikası).");
  assert.equal(calls[0].label, "similarity-explain");
  const body = JSON.parse(calls[0].body) as {
    systemInstruction: { parts: Array<{ text: string }> };
    contents: Array<{ parts: Array<{ text: string }> }>;
    generationConfig: { responseMimeType: string; responseJsonSchema: unknown; maxOutputTokens: number };
  };
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.ok(body.generationConfig.responseJsonSchema, "responseJsonSchema zorunludur (yapılandırılmış çıktı).");
  const instruction = body.systemInstruction.parts[0].text;
  for (const label of Object.values(SIMILARITY_LLM_CLASSES)) {
    assert.ok(instruction.includes(label), `Sistem talimatı "${label}" sınıfını birebir taşımalıdır.`);
  }
  assert.match(instruction, /yüzdesini değiştiremez/i, "Yüzde yasağı talimatta olmalıdır.");
  assert.match(instruction, /Yeni eşleşme üretemez/i, "Yeni eşleşme yasağı talimatta olmalıdır.");
  assert.match(instruction, /atıf yapamaz/i, "Verilmeyen bölüm yasağı talimatta olmalıdır.");
  assert.match(instruction, /İntihal, onay, ret .*karar(ı)? veremez/i, "İntihal/onay/ret karar yasağı talimatta olmalıdır.");
  const userPayload = JSON.parse(body.contents[0].parts[0].text) as { eslesmeler: Array<{ index: number }> };
  assert.equal(userPayload.eslesmeler.length, 3, "Model yalnızca verilen eşleşme çiftlerini görür.");
  assert.ok(outcome.ok);
  assert.equal(outcome.ok && outcome.annotations.length, 3);
  assert.equal(outcome.ok && outcome.apiCalls, 1);
});

test("bilinmeyen index (uydurma eşleşme), sınıf 7 ve yinelenen index sunucuda ATILIR", async () => {
  const calls: GenerationInput[] = [];
  const outcome = await explainSimilarityMatches({
    apiKey: "test-key",
    competitionName: "Yarışma",
    matches: [matchInput(0), matchInput(1)],
    generate: fakeGenerate(calls, JSON.stringify({
      eslesmeler: [
        { index: 9, sinif: 5, aciklama: "Uydurma eşleşme", degerlendirme: "x" },
        { index: 0, sinif: 7, aciklama: "Geçersiz sınıf", degerlendirme: "x" },
        { index: 1, sinif: 2, aciklama: "İlk yanıt", degerlendirme: "Normal" },
        { index: 1, sinif: 5, aciklama: "Yinelenen yanıt", degerlendirme: "x" },
      ],
    })),
  });
  assert.ok(outcome.ok, "Geçerli tek yanıt bile kalsa sonuç başarılıdır.");
  const annotations = outcome.ok ? outcome.annotations : [];
  assert.equal(annotations.length, 1, "Yalnızca geçerli index+sınıf taşıyan yanıt kalır.");
  assert.equal(annotations[0].index, 1);
  assert.equal(annotations[0].sinif, 2);
  assert.equal(annotations[0].aciklama, "İlk yanıt", "Yinelenen index'in İLK yanıtı korunur.");
});

test("model metin alanları 500 karakterle sınırlanır", async () => {
  const outcome = await explainSimilarityMatches({
    apiKey: "test-key",
    competitionName: "Yarışma",
    matches: [matchInput(0)],
    generate: fakeGenerate([], JSON.stringify({
      eslesmeler: [{ index: 0, sinif: 6, aciklama: "u".repeat(2000), degerlendirme: "d".repeat(2000) }],
    })),
  });
  assert.ok(outcome.ok);
  assert.equal(outcome.ok && outcome.annotations[0].aciklama.length, 500);
  assert.equal(outcome.ok && outcome.annotations[0].degerlendirme.length, 500);
});

test("bozuk JSON ve üretim arızası fırlatmadan ok:false döner (senaryo 10)", async () => {
  const malformed = await explainSimilarityMatches({
    apiKey: "test-key",
    competitionName: "Yarışma",
    matches: [matchInput(0)],
    generate: fakeGenerate([], "bu bir json değil"),
  });
  assert.ok(!malformed.ok, "Bozuk JSON başarısızlıktır; istisna fırlatılmaz.");
  const failed = await explainSimilarityMatches({
    apiKey: "test-key",
    competitionName: "Yarışma",
    matches: [matchInput(0)],
    generate: fakeGenerate([], null, { status: 503, detail: "yoğunluk" }),
  });
  assert.ok(!failed.ok);
  assert.equal(!failed.ok && failed.apiCalls, 1, "Gerçek çağrı sayısı korunur.");
  const emptyList = await explainSimilarityMatches({
    apiKey: "test-key", competitionName: "Yarışma", matches: [],
  });
  assert.ok(!emptyList.ok && emptyList.apiCalls === 0, "Eşleşme yoksa hiç çağrı yapılmaz.");
});

/* ------------- Kaynak denetimi: rota kablolaması (iki aşamalı kayıt) ------------- */

test("otomatik rota üretken LLM çağırmaz; matematiksel sonucu tek aşamada kaydeder", () => {
  const route = readFileSync("app/api/applications/[id]/similarity/route.ts", "utf8");
  assert.match(route, /await saveSimilarityResult\(\{ \.\.\.saveInput/);
  assert.doesNotMatch(route, /explainSimilarityMatches\(\{/);
  assert.match(route, /llmApiCalls: 0/);
});

test("otomatik rotada LLM yüzdeyi, seviyeyi, sayfayı ve alıntıyı değiştiremez", () => {
  const route = readFileSync("app/api/applications/[id]/similarity/route.ts", "utf8");
  assert.doesNotMatch(route, /target\.llmClass|target\.llmExplanation|target\.llmAssessment/);
});

test("otomatik rota her durumda üretken LLM'i kapalı tutar", () => {
  const route = readFileSync("app/api/applications/[id]/similarity/route.ts", "utf8");
  assert.doesNotMatch(route, /similarityLlmEnabled\(\)|body\.skipLlm|llmInputs/);
  assert.match(route, /report\.llmStatus = "skipped"/);
  assert.match(route, /llmApiCalls: 0/);
  const config = readFileSync("app/lib/similarity-config.ts", "utf8");
  assert.match(config, /SIMILARITY_LLM_ENABLED/, "Eski dağıtımlar için yapılandırma geriye uyumlu kalır.");
});
