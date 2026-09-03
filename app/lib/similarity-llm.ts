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
