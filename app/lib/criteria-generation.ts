import type { GenerationOutcome } from "./gemini-generation";
import type { RawCandidateDecision, RawExtraction } from "./criteria-extraction";

/** Yalnız yürütme politikası; aday seçimi ve kapsam talimatı değişmez. */
export const CRITERIA_GENERATION_VERSION = "core-first-v7-low-core-medium-technical";
export const CRITERIA_CONCURRENCY = 2;
export const CRITERIA_BATCH_SIZE = 24;
export const CRITERIA_BATCH_CHARS = 24_000;
export const CRITERIA_MAX_CALLS = 32;
export const CRITERIA_MAX_OUTPUT_TOKENS_TOTAL = 262_144;
// Ağ isteği için sonlu güvenlik sınırı; belgeye 80 saniyelik kesme uygulanmaz.
export const CRITERIA_REQUEST_TIMEOUT_MS = 180_000;

export type CandidateInput = { sourceId: string; text: string };
export type GenerationUsage = { prompt: number; output: number; total: number; thoughts: number };
export function generationUsage(payload: unknown): GenerationUsage {
  const value = (payload as { usageMetadata?: Record<string, number> })?.usageMetadata;
  const count = (key: string) => Number.isFinite(value?.[key]) ? Math.max(0, value![key]) : 0;
  return { prompt: count("promptTokenCount"), output: count("candidatesTokenCount") + count("thoughtsTokenCount"),
    total: count("totalTokenCount"), thoughts: count("thoughtsTokenCount") };
}

/** Metin kesilmez; büyük tek madde de kaynağı/bölüm bağlamıyla aynen taşınır. */
export function partitionCandidates(candidates: readonly CandidateInput[], size = CRITERIA_BATCH_SIZE, maxChars = CRITERIA_BATCH_CHARS): CandidateInput[][] {
  const groups: CandidateInput[][] = [];
  let group: CandidateInput[] = [];
  let chars = 0;
  for (const candidate of candidates) {
    if (group.length && (group.length >= size || chars + candidate.text.length > maxChars)) {
      groups.push(group); group = []; chars = 0;
    }
    group.push(candidate); chars += candidate.text.length;
  }
  if (group.length) groups.push(group);
  return groups;
}

export type CriteriaGenerationResult = {
  ok: true; raw: RawExtraction; apiCalls: number; usage: GenerationUsage;
} | {
  ok: false; status: number; detail: string; apiCalls: number; usage: GenerationUsage;
};

/**
 * Küçük gruplar aynı model/talimatla en fazla ikili paralel işlenir. Yalnız MAX_TOKENS'ta
 * başarısız grup ikiye ayrılır; başarılı gruplar yeniden üretilmez.
 * 429/503/ağ hatasında tekrar yok. Çağrı/çıktı tavanı vardır; toplam süre kesmesi yoktur.
 * Bütün gruplar tamamlanmadan dışarıya kısmi RawExtraction verilmez.
 */
export async function generateCriteriaInBatches(input: {
  candidates: readonly CandidateInput[];
  generate: (group: readonly CandidateInput[], timeoutMs: number) => Promise<GenerationOutcome>;
  batchSize?: number;
  batchChars?: number;
  concurrency?: number;
  phase?: "core" | "technical";
}): Promise<CriteriaGenerationResult> {
  const usage: GenerationUsage = { prompt: 0, output: 0, total: 0, thoughts: 0 };
  let apiCalls = 0;
  let attempts = 0;
  const fail = (status: number, detail: string): CriteriaGenerationResult => ({ ok: false, status, detail, apiCalls, usage });
  const ids = input.candidates.map((item) => item.sourceId);
  if (!ids.length || new Set(ids).size !== ids.length) return fail(422, "Aday kimlikleri boş veya tekrarlı; analiz başlatılmadı.");
  const queue = partitionCandidates(input.candidates, input.batchSize, input.batchChars);
  if (queue.length > CRITERIA_MAX_CALLS) return fail(422, "Belge güvenli işlem bütçesini aşıyor; hiçbir aday elenmedi ve model çağrısı yapılmadı.");
  const decisions: RawCandidateDecision[] = [];
  const technicalCandidateSourceIds = new Set<string>();
  const documentProfile: Record<string, unknown> = {};
  const profiles: Array<{ order: number; value: Record<string, unknown> }> = [];
  const sourceOrder = new Map(ids.map((id, index) => [id, index]));
  while (queue.length) {
    if (attempts >= CRITERIA_MAX_CALLS
      || usage.output > CRITERIA_MAX_OUTPUT_TOKENS_TOTAL - 65_536) return fail(422,
      "Analizin toplam işlem bütçesi doldu. Eksik sonuç kaydedilmedi; yeniden deneyebilirsiniz.");
    const capacity = Math.min(input.concurrency ?? CRITERIA_CONCURRENCY, CRITERIA_MAX_CALLS - attempts,
      Math.floor((CRITERIA_MAX_OUTPUT_TOKENS_TOTAL - usage.output) / 65_536));
    const wave = queue.splice(0, capacity);
    const firstAttempt = attempts + 1;
    attempts += wave.length;
    // Başarısız kardeş çağrı olsa da başlamış bütün çağrılar beklenir ve ölçülür.
    const outcomes = await Promise.all(wave.map(async (group): Promise<GenerationOutcome> => {
      try { return await input.generate(group, CRITERIA_REQUEST_TIMEOUT_MS); }
      catch { return { ok: false, model: "", apiCalls: 1, status: 502, detail: "Model çağrısı tamamlanamadı." }; }
    }));
    for (const outcome of outcomes) {
      apiCalls += outcome.apiCalls;
      if (outcome.ok) {
        const measured = generationUsage(outcome.payload);
        for (const key of ["prompt", "output", "total", "thoughts"] as const) usage[key] += measured[key];
      }
    }
    if (usage.output > CRITERIA_MAX_OUTPUT_TOKENS_TOTAL) return fail(422,
      "Analizin çıktı bütçesi doldu. Eksik sonuç kaydedilmedi.");
    for (const [index, outcome] of outcomes.entries()) {
      const group = wave[index];
      if (!outcome.ok) return fail(outcome.status, outcome.detail);
      const measured = generationUsage(outcome.payload);
      const candidate = (outcome.payload as { candidates?: Array<{
        finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      }> })?.candidates?.[0];
      console.info("[criteria-generation]", { phase: input.phase, attempt: firstAttempt + index, candidateCount: group.length,
        finishReason: candidate?.finishReason, ...measured });
      if (candidate?.finishReason === "MAX_TOKENS") {
        if (group.length === 1) return fail(502,
          "Model tek bir kaynak maddesinde bile çıktı sınırına ulaştı. Eksik sonuç kaydedilmedi; bu bir API çıktı sınırıdır, PDF sayfa sınırı değildir.");
        const middle = Math.ceil(group.length / 2);
        queue.unshift(group.slice(0, middle), group.slice(middle));
        continue;
      }
      if (candidate?.finishReason !== "STOP") return fail(502,
        `Model grubun cevabını tamamlamadı (${candidate?.finishReason ?? "bitiş nedeni yok"}); eksik sonuç kaydedilmedi.`);
      let raw: RawExtraction;
      try {
        const text = candidate.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? "").join("") ?? "";
        raw = JSON.parse(text) as RawExtraction;
      } catch { return fail(502, "Model grubun cevabını geçerli JSON olarak döndürmedi; eksik sonuç kaydedilmedi."); }
      if (!raw || typeof raw !== "object" || !Array.isArray(raw.decisions)) return fail(502, "Model karar listesi geçersiz; eksik sonuç kaydedilmedi.");
      const expected = new Set(group.map((item) => item.sourceId));
      const answered = new Set<string>();
      for (const entry of raw.decisions as RawCandidateDecision[]) {
        if (!entry || typeof entry.sourceId !== "string" || !expected.has(entry.sourceId)
          || (entry.result !== "KRITER" && entry.result !== "KAPSAM_DISI"
            && !(input.phase === "technical" && entry.result === "TEKNIK_LIMIT"))) {
          return fail(502, "Model geçersiz kaynak kimliği veya karar döndürdü; eksik sonuç kaydedilmedi.");
        }
        answered.add(entry.sourceId);
        if (entry.result === "KRITER" && input.phase
          && (input.phase === "core" ? !["language_template", "headings_content", "category_similarity"].includes(String(entry.stage))
            : entry.stage !== "criteria_evidence")) return fail(502, "Model istenen kontrol alanı dışında kriter döndürdü.");
      }
      if (answered.size !== expected.size) return fail(502,
        `Model gruptaki ${expected.size - answered.size} aday için karar döndürmedi. Eksik sonuç kaydedilmedi; yeniden deneyebilirsiniz.`);
      if (input.phase === "core") {
        if (!Array.isArray(raw.technicalCandidateSourceIds)
          || raw.technicalCandidateSourceIds.some((id) => typeof id !== "string" || !expected.has(id))) {
          return fail(502, "Model teknik aday yönlendirmesini geçerli kaynaklarla döndürmedi.");
        }
        for (const id of raw.technicalCandidateSourceIds) technicalCandidateSourceIds.add(id);
      }
      decisions.push(...raw.decisions as RawCandidateDecision[]);
      profiles.push({ order: sourceOrder.get(group[0].sourceId)!, value: raw.documentProfile ?? {} });
    }
  }
  // Ağın bitiş sırası ve taşma bölünmeleri sonuç sırasını değiştiremez.
  decisions.sort((a, b) => sourceOrder.get(a.sourceId as string)! - sourceOrder.get(b.sourceId as string)!);
  for (const profile of profiles.sort((a, b) => a.order - b.order)) {
    for (const [key, value] of Object.entries(profile.value)) {
      if (documentProfile[key] == null || documentProfile[key] === ""
        || (Array.isArray(documentProfile[key]) && documentProfile[key].length === 0)) documentProfile[key] = value;
    }
  }
  return { ok: true, raw: { documentProfile, decisions, ...(input.phase === "core"
    ? { technicalCandidateSourceIds: ids.filter((id) => technicalCandidateSourceIds.has(id)) } : {}) }, apiCalls, usage };
}

/** Biten grup yuvası hemen yeniden kullanılır; yavaş kardeş tüm kuyruğu durdurmaz. */
export async function generateCriteriaInPool(input: Parameters<typeof generateCriteriaInBatches>[0]): Promise<CriteriaGenerationResult> {
  const ids = input.candidates.map((item) => item.sourceId);
  const usage: GenerationUsage = { prompt: 0, output: 0, total: 0, thoughts: 0 };
  const groups = partitionCandidates(input.candidates, input.batchSize, input.batchChars);
  if (!ids.length || new Set(ids).size !== ids.length || groups.length > CRITERIA_MAX_CALLS) {
    return { ok: false, apiCalls: 0, usage, status: 422, detail: "Aday listesi boş, tekrarlı veya güvenli grup bütçesini aşıyor." };
  }
  const results: CriteriaGenerationResult[] = [];
  let next = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(input.concurrency ?? CRITERIA_CONCURRENCY, groups.length) }, async () => {
    while (!failed && next < groups.length) {
      const index = next++;
      const result = await generateCriteriaInBatches({ ...input, candidates: groups[index], concurrency: 1 });
      results[index] = result;
      if (!result.ok) failed = true;
    }
  }));
  let apiCalls = 0;
  for (const result of results.filter(Boolean)) {
    apiCalls += result.apiCalls;
    for (const key of ["prompt", "output", "total", "thoughts"] as const) usage[key] += result.usage[key];
  }
  const failure = results.find((result) => result && !result.ok);
  if (failure && !failure.ok) return { ...failure, apiCalls, usage };
  const decisions: RawCandidateDecision[] = [];
  const documentProfile: Record<string, unknown> = {};
  const technical = new Set<string>();
  for (const result of results) {
    if (!result.ok) continue;
    decisions.push(...result.raw.decisions as RawCandidateDecision[]);
    for (const id of result.raw.technicalCandidateSourceIds ?? []) technical.add(id);
    for (const [key, value] of Object.entries(result.raw.documentProfile ?? {})) {
      if (documentProfile[key] == null || documentProfile[key] === ""
        || (Array.isArray(documentProfile[key]) && documentProfile[key].length === 0)) documentProfile[key] = value;
    }
  }
  return { ok: true, apiCalls, usage, raw: { documentProfile, decisions,
    ...(input.phase === "core" ? { technicalCandidateSourceIds: ids.filter((id) => technical.has(id)) } : {}) } };
}
