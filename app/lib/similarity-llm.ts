import { runSingleGeneration } from "./gemini-generation";

/**
 * Katman 3 — LLM açıklama kontrolü (GÖREV 3 · madde 5 · Katman 3).
 *
 * Model bütün PDF'leri TEKRAR OKUMAZ: yalnızca MinHash ve embedding'in
 * belirlediği en güçlü, sınırlı sayıdaki eşleşme çiftini (sunucunun kendi
 * eşleşme verisinden alınan kısa alıntılarla) alır ve her çifti altı sınıftan
 * birine yerleştirir. Model:
 *
 *   - Matematiksel yüzdeyi DEĞİŞTİREMEZ (oran çağrıdan önce hesaplanmış ve
 *     kaydedilmiştir; bu modül ona hiç dokunmaz).
 *   - Yeni eşleşme ÜRETEMEZ (bilinmeyen index'li yanıtlar sunucuda atılır).
 *   - Verilmeyen PDF bölümlerine atıf YAPAMAZ (sayfa ve alıntılar HER ZAMAN
 *     sunucunun deterministik eşleşme verisinden yazılır; modelin metni
 *     onların üzerine yazılmaz).
 *   - İntihal, onay veya ret kararı VEREMEZ.
 *
 * TEK ÇAĞRI politikası (gemini-generation.ts): bütün eşleşmeler İÇİN TOPLAM
 * BİR generateContent isteği gider. Başarısızlıkta MinHash/embedding sonucu
 * KAYBOLMAZ; çağıran taraf "Açıklama kontrolü tamamlanamadı" notu düşer.
 *
 * `generate` parametresi test enjeksiyonu içindir (embedTexts'in `fetcher`
 * deseniyle aynı); testler canlı Gemini çağrısı YAPMAZ.
 */

/** Madde 5'teki altı eşleşme sınıfı; anahtarlar modele verilen sınıf numaralarıdır. */
export const SIMILARITY_LLM_CLASSES: Record<number, string> = {
  1: "Resmî şablon veya ortak başlık",
  2: "Şartnameden kaynaklanan zorunlu ifade",
  3: "Aynı teknik konunun doğal benzerliği",
  4: "Özgün çözüm/tasarım anlatımı benzerliği",
  5: "Doğrudan veya küçük değişikliklerle aktarılmış metin",
  6: "Karar verilemedi, hakem incelemeli",
};

/** Modele giden alıntı üst sınırı; ekrandaki alıntı (220) bundan bağımsızdır. */
export const SIMILARITY_LLM_EXCERPT_CHARS = 600;
/** Model çıktısı metin alanlarının saklanan üst sınırı. */
const ANNOTATION_TEXT_CAP = 500;
const DEFAULT_TIMEOUT_MS = 60_000;

export type SimilarityLlmMatchInput = {
  /** Eşleşmenin sunucudaki sırası; model YALNIZCA bu index'lere yanıt verebilir. */
  index: number;
  kind: "direct" | "semantic";
  ownPage: number | null;
  peerPage: number | null;
  /** Sunucunun kendi eşleşme verisinden alınan kısa alıntılar (≤600 karakter). */
  ownExcerpt: string;
  peerExcerpt: string;
  /** Anlamsal eşleşmeyi ayakta tutan destek sinyalleri; doğrudan eşleşmede boş. */
  corroboration: string[];
};

export type SimilarityLlmAnnotation = {
  index: number;
  sinif: 1 | 2 | 3 | 4 | 5 | 6;
  /** Kısa açıklama. */
  aciklama: string;
  /** Benzerliğin neden normal veya incelemeye değer olduğu. */
  degerlendirme: string;
};

export type SimilarityLlmOutcome =
  | { ok: true; annotations: SimilarityLlmAnnotation[]; model: string; apiCalls: 1 }
  | { ok: false; detail: string; apiCalls: 0 | 1 };

const RESPONSE_SCHEMA = {
  type: "object",
  required: ["eslesmeler"],
  properties: {
    eslesmeler: {
      type: "array",
      items: {
        type: "object",
        required: ["index", "sinif", "aciklama", "degerlendirme"],
        properties: {
          index: { type: "integer" },
          sinif: { type: "integer", minimum: 1, maximum: 6 },
          aciklama: { type: "string" },
          degerlendirme: { type: "string" },
        },
      },
    },
  },
} as const;

/** Sistem talimatı: altı sınıf + yasaklar; model yalnız verilen alıntıları görür. */
function systemInstructionOf(competitionName: string): string {
  const classes = Object.entries(SIMILARITY_LLM_CLASSES)
    .map(([number, label]) => `${number}. ${label}`)
    .join("\n");
  return [
    `Sen "${competitionName}" yarışmasında raporlar arası benzerlik eşleşmelerini sınıflandıran bir yardımcısın.`,
    "Sana yalnızca sunucunun deterministik katmanlarının (MinHash + embedding) bulduğu eşleşme çiftlerinin kısa alıntıları verilir; raporların başka hiçbir bölümü mevcut değildir.",
    "Her eşleşmeyi şu sınıflardan TAM OLARAK birine yerleştir:",
    classes,
    "KURALLAR:",
    "- Matematiksel benzerlik yüzdesini değiştiremez veya yorumlayıp yeni bir oran öneremezsin.",
    "- Yeni eşleşme üretemezsin; yalnızca verilen index değerlerine yanıt verebilirsin.",
    "- Verilmeyen PDF bölümlerine, sayfalara veya içeriklere atıf yapamazsın; yalnızca verilen alıntılar vardır.",
    "- İntihal, onay, ret veya disiplin kararı veremezsin; nihai karar her zaman hakemindir.",
    "Her eşleşme için kısa bir 'aciklama' (benzerliğin niteliği) ve 'degerlendirme' (benzerliğin neden normal veya incelemeye değer olduğu) yaz. Türkçe yanıt ver.",
    'Yanıtı yalnızca istenen JSON şemasında döndür: {"eslesmeler": [{"index", "sinif", "aciklama", "degerlendirme"}]}.',
  ].join("\n");
}

function extractGeminiText(payload: unknown): string {
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })?.candidates;
  return candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
}

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
}

function capText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, ANNOTATION_TEXT_CAP) : "";
}

/**
 * Model yanıtının SIKI sunucu doğrulaması (halüsinasyon önlemi):
 *   - Bilinmeyen index atılır (model eşleşme uyduramaz).
 *   - Aynı index'in ilk yanıtı kalır.
 *   - sinif 1-6 dışıysa yanıt atılır.
 *   - Metinler kırpılır ve 500 karakterle sınırlanır; boş açıklama atılır.
 */
function validateAnnotations(payload: unknown, knownIndexes: Set<number>): SimilarityLlmAnnotation[] | null {
  const list = (payload as { eslesmeler?: unknown } | null)?.eslesmeler;
  if (!Array.isArray(list)) return null;
  const seen = new Set<number>();
  const annotations: SimilarityLlmAnnotation[] = [];
  for (const entry of list) {
    const record = entry as { index?: unknown; sinif?: unknown; aciklama?: unknown; degerlendirme?: unknown };
    const index = Number(record.index);
    const sinif = Number(record.sinif);
    if (!Number.isInteger(index) || !knownIndexes.has(index) || seen.has(index)) continue;
    if (!Number.isInteger(sinif) || sinif < 1 || sinif > 6) continue;
    const aciklama = capText(record.aciklama);
    const degerlendirme = capText(record.degerlendirme);
    if (!aciklama) continue;
    seen.add(index);
    annotations.push({ index, sinif: sinif as 1 | 2 | 3 | 4 | 5 | 6, aciklama, degerlendirme });
  }
  return annotations;
}

/**
 * En güçlü eşleşme çiftlerini TEK generateContent çağrısıyla sınıflandırır.
 * Başarısızlık asla fırlatılmaz; çağıran deterministik sonucu aynen korur.
 */
export async function explainSimilarityMatches(input: {
  apiKey: string;
  competitionName: string;
  matches: SimilarityLlmMatchInput[];
  model?: string;
  timeoutMs?: number;
  /** Test enjeksiyonu; varsayılan gerçek tek-çağrı katmanıdır. */
  generate?: typeof runSingleGeneration;
}): Promise<SimilarityLlmOutcome> {
  if (!input.matches.length) {
    return { ok: false, detail: "Sınıflandırılacak eşleşme yok.", apiCalls: 0 };
  }
  const generate = input.generate ?? runSingleGeneration;
  const model = input.model ?? (process.env.GEMINI_MODEL || "gemini-3-flash-preview");
  const payload = {
    eslesmeler: input.matches.map((match) => ({
      index: match.index,
      tur: match.kind === "direct" ? "dogrudan-metin" : "anlamsal",
      kendiSayfa: match.ownPage,
      esSayfa: match.peerPage,
      kendiAlinti: match.ownExcerpt.slice(0, SIMILARITY_LLM_EXCERPT_CHARS),
      esAlinti: match.peerExcerpt.slice(0, SIMILARITY_LLM_EXCERPT_CHARS),
      destekSinyalleri: match.corroboration,
    })),
  };
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemInstructionOf(input.competitionName) }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
    generationConfig: {
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_SCHEMA,
    },
  });
  const outcome = await generate({
    apiKey: input.apiKey,
    body,
    model,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    label: "similarity-explain",
  });
  if (!outcome.ok) {
    return { ok: false, detail: outcome.detail, apiCalls: outcome.apiCalls };
  }
  const parsed = parseJsonLoose(extractGeminiText(outcome.payload));
  const annotations = validateAnnotations(parsed, new Set(input.matches.map((match) => match.index)));
  if (!annotations || !annotations.length) {
    return { ok: false, detail: "Model geçerli bir sınıflandırma JSON'u döndürmedi.", apiCalls: 1 };
  }
  return { ok: true, annotations, model: outcome.model, apiCalls: 1 };
}

/* ------------------------------------------------------------------------- *
 * Toplu yarışma görünümü: rapor çiftlerini TEK çağrıda özgünlük açısından
 * yorumlar. Eski eşleşme-sınıflandırma sözleşmesi geriye uyum için yukarıda
 * korunur; toplu ekran yalnızca bu çift düzeyi sözleşmeyi kullanır.
 * ------------------------------------------------------------------------- */

export const SIMILARITY_PAIR_LEVELS = {
  common: "Ortak şablon veya alan dili",
  technical_common: "Ortak teknik tercih",
  conceptual: "Kısmi kavramsal benzerlik",
  strong: "Güçlü özgün içerik benzerliği",
  insufficient: "Yorum için kanıt yetersiz",
} as const;

export type SimilarityPairLevel = keyof typeof SIMILARITY_PAIR_LEVELS;
export type SimilarityPairEvidenceInput = {
  kind: "direct" | "semantic";
  leftPage: number;
  rightPage: number;
  leftSection: string;
  rightSection: string;
  leftText: string;
  rightText: string;
};
export type SimilarityLlmPairInput = {
  pairKey: string;
  leftLabel: string;
  rightLabel: string;
  percent: number;
  evidence: SimilarityPairEvidenceInput[];
};
export type SimilarityLlmPairReview = {
  pairKey: string;
  level: SimilarityPairLevel;
  label: string;
  explanation: string;
  confidence: "low" | "medium" | "high";
};
export type SimilarityPairLlmOutcome =
  | { ok: true; reviews: SimilarityLlmPairReview[]; model: string; apiCalls: 1;
      usage: { prompt: number; output: number; total: number } }
  | { ok: false; detail: string; apiCalls: 0 | 1; model?: string };

const PAIR_RESPONSE_SCHEMA = {
  type: "object",
  required: ["ciftler"],
  properties: {
    ciftler: {
      type: "array",
      items: {
        type: "object",
        required: ["pairKey", "seviye", "guven", "aciklama"],
        properties: {
          pairKey: { type: "string" },
          seviye: { type: "string", enum: Object.keys(SIMILARITY_PAIR_LEVELS) },
          guven: { type: "string", enum: ["low", "medium", "high"] },
          aciklama: { type: "string" },
        },
      },
    },
  },
} as const;

function pairSystemInstruction(competitionName: string): string {
  return [
    `Sen "${competitionName}" yarışmasında rapor çiftlerinin özgün içerik benzerliğini açıklayan ikinci gözsün.`,
    "Sana tam PDF'ler değil, matematiksel benzerlik motorunun seçtiği en güçlü rapor çiftleri ve yalnızca eşleşen kısa alıntılar verilir.",
    "Amacın metin yakınlığının kaynağını ayırmaktır: resmî şablon/ortak alan dili, sıradan teknik tercih, kısmi kavramsal benzerlik, özgün çözüm-tasarım anlatımında güçlü benzerlik veya yetersiz kanıt.",
    "Özgünlük açısından özellikle problem tanımı, önerilen çözüm, sistem mimarisi, ayırt edici yöntem/algoritma ve doğrulama yaklaşımının birlikte örtüşmesine bak.",
    "Aynı malzeme, bileşen, standart, yarışma terimi veya teknik zorunluluk tek başına özgün çözüm benzerliği değildir.",
    "Matematiksel yüzdeyi değiştirme, yeni oran veya yeni eşleşme üretme. Verilmeyen sayfa ve içeriğe atıf yapma.",
    "İntihal ya da otomatik ret kararı verme. Hakemin karar verebilmesi için yalnızca somut, kısa ve tarafsız bir açıklama yaz.",
    "Her pairKey için tam bir yanıt üret ve yalnızca istenen JSON şemasını döndür.",
  ].join("\n");
}

function pairReviewsOf(payload: unknown, knownKeys: Set<string>): SimilarityLlmPairReview[] | null {
  const rows = (payload as { ciftler?: unknown } | null)?.ciftler;
  if (!Array.isArray(rows)) return null;
  const seen = new Set<string>();
  const reviews: SimilarityLlmPairReview[] = [];
  for (const row of rows) {
    const item = row as { pairKey?: unknown; seviye?: unknown; guven?: unknown; aciklama?: unknown };
    const pairKey = typeof item.pairKey === "string" ? item.pairKey : "";
    const rawLevel = typeof item.seviye === "string" ? item.seviye : "";
    const rawConfidence = typeof item.guven === "string" ? item.guven : "";
    const explanation = capText(item.aciklama);
    if (!knownKeys.has(pairKey) || seen.has(pairKey) || !(rawLevel in SIMILARITY_PAIR_LEVELS)
      || !["low", "medium", "high"].includes(rawConfidence) || !explanation) continue;
    const level = rawLevel as SimilarityPairLevel;
    const confidence = rawConfidence as "low" | "medium" | "high";
    seen.add(pairKey);
    reviews.push({ pairKey, level, label: SIMILARITY_PAIR_LEVELS[level], explanation, confidence });
  }
  return reviews;
}

/** En fazla beş rapor çiftini, tam PDF göndermeden, tek üretken çağrıda yorumlar. */
export async function explainSimilarityPairs(input: {
  apiKey: string;
  competitionName: string;
  pairs: SimilarityLlmPairInput[];
  model?: string;
  timeoutMs?: number;
  generate?: typeof runSingleGeneration;
}): Promise<SimilarityPairLlmOutcome> {
  if (!input.pairs.length) return { ok: false, detail: "Yorumlanacak rapor çifti yok.", apiCalls: 0 };
  const generate = input.generate ?? runSingleGeneration;
  const model = input.model ?? (process.env.GEMINI_MODEL || "gemini-3-flash-preview");
  const pairs = input.pairs.slice(0, 5).map((pair) => ({
    pairKey: pair.pairKey,
    solRapor: pair.leftLabel,
    sagRapor: pair.rightLabel,
    matematikselOran: pair.percent,
    kanitlar: pair.evidence.slice(0, 5).map((evidence) => ({
      tur: evidence.kind === "direct" ? "dogrudan" : "anlamsal",
      solSayfa: evidence.leftPage,
      sagSayfa: evidence.rightPage,
      solBolum: evidence.leftSection.slice(0, 160),
      sagBolum: evidence.rightSection.slice(0, 160),
      solAlinti: evidence.leftText.slice(0, SIMILARITY_LLM_EXCERPT_CHARS),
      sagAlinti: evidence.rightText.slice(0, SIMILARITY_LLM_EXCERPT_CHARS),
    })),
  }));
  const outcome = await generate({
    apiKey: input.apiKey,
    model,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    label: "similarity-pairs",
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: pairSystemInstruction(input.competitionName) }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify({ ciftler: pairs }) }] }],
      generationConfig: {
        thinkingConfig: { thinkingLevel: "LOW" },
        maxOutputTokens: 3072,
        responseMimeType: "application/json",
        responseJsonSchema: PAIR_RESPONSE_SCHEMA,
      },
    }),
  });
  if (!outcome.ok) return { ok: false, detail: outcome.detail, apiCalls: outcome.apiCalls, model: outcome.model };
  const reviews = pairReviewsOf(
    parseJsonLoose(extractGeminiText(outcome.payload)),
    new Set(pairs.map((pair) => pair.pairKey)),
  );
  if (!reviews?.length) {
    return { ok: false, detail: "AI geçerli bir rapor çifti açıklaması döndürmedi.", apiCalls: 1, model: outcome.model };
  }
  const usage = (outcome.payload as { usageMetadata?: {
    promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number;
  } })?.usageMetadata;
  return {
    ok: true,
    reviews,
    model: outcome.model,
    apiCalls: 1,
    usage: {
      prompt: Number(usage?.promptTokenCount) || 0,
      output: Number(usage?.candidatesTokenCount) || 0,
      total: Number(usage?.totalTokenCount) || 0,
    },
  };
}
