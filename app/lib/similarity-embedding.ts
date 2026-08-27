import { SIMILARITY_EMBEDDING_DIM, SIMILARITY_EMBEDDING_MODEL } from "./similarity-text";

/**
 * Gemini embedding katmanı (anlamsal benzerlik · madde 9.6).
 *
 *   Model      gemini-embedding-001 (başka sağlayıcı veya ikinci anahtar YOK)
 *   Görev      SEMANTIC_SIMILARITY
 *   Boyut      768
 *   Anahtar    mevcut GEMINI_API_KEY
 *
 * Çağrı disiplini:
 *   - İstekler kontrollü gruplar hâlinde gönderilir (parti başına en çok 16 metin).
 *   - 429'da KISA ve SINIRLI geri çekilme uygulanır (tek yeniden deneme);
 *     sonsuz otomatik tekrar YOKTUR.
 *   - Boş veya bozuk embedding asla döndürülmez; parti doğrulanamazsa bütün
 *     işlem başarısız sayılır ve çağıran MinHash katmanıyla devam eder.
 *   - Embedding hatası kriter analizini HİÇBİR koşulda düşürmez; bu modül
 *     yalnızca sonuç nesnesi döndürür, istisna fırlatmaz.
 */

const BATCH_SIZE = 16;
const REQUEST_TIMEOUT_MS = 30_000;
const RATE_LIMIT_BACKOFF_MS = 2_000;

export type EmbeddingOutcome =
  | { ok: true; embeddings: number[][]; apiCalls: number }
  | { ok: false; status: number; detail: string; rateLimited: boolean; apiCalls: number };

type BatchResponse = { embeddings?: Array<{ values?: unknown }> };

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Vektör doğrulaması: tam boyut, yalnızca sonlu sayılar. Bozuk vektör kaydedilmez. */
function validVector(values: unknown): values is number[] {
  return Array.isArray(values)
    && values.length === SIMILARITY_EMBEDDING_DIM
    && values.every((value) => typeof value === "number" && Number.isFinite(value));
}

/** Saklama boyutunu küçültmek için 5 ondalığa yuvarlanır; cosine sonucu değişmez. */
function compactVector(values: number[]): number[] {
  return values.map((value) => Math.round(value * 100_000) / 100_000);
}

async function requestBatch(
  apiKey: string,
  texts: string[],
  fetcher: typeof fetch,
): Promise<{ ok: true; embeddings: number[][] } | { ok: false; status: number; detail: string }> {
  let response: Response;
  try {
    response = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${SIMILARITY_EMBEDDING_MODEL}:batchEmbedContents`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${SIMILARITY_EMBEDDING_MODEL}`,
            content: { parts: [{ text }] },
            taskType: "SEMANTIC_SIMILARITY",
            outputDimensionality: SIMILARITY_EMBEDDING_DIM,
          })),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    return { ok: false, status: 504, detail: "Embedding servisi zaman sınırı içinde yanıt vermedi." };
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    return {
      ok: false,
      status: response.status,
      detail: payload.error?.message || `Embedding isteği ${response.status} koduyla reddedildi.`,
    };
  }
  const payload = await response.json().catch(() => null) as BatchResponse | null;
  const rows = payload?.embeddings;
  if (!Array.isArray(rows) || rows.length !== texts.length) {
    return { ok: false, status: 502, detail: "Embedding servisi beklenen sayıda vektör döndürmedi." };
  }
  const embeddings: number[][] = [];
  for (const row of rows) {
    if (!validVector(row?.values)) {
      return { ok: false, status: 502, detail: "Embedding servisi bozuk veya eksik boyutlu vektör döndürdü." };
    }
    embeddings.push(compactVector(row.values));
  }
  return { ok: true, embeddings };
}

/**
 * Metin listesini partiler hâlinde embedding'e çevirir.
 *
 * 429 alınırsa parti, kısa bir gecikmeyle EN FAZLA BİR KEZ yeniden denenir;
 * yine 429 gelirse işlem `rateLimited: true` ile başarısız döner ve çağıran
 * kriter analizinin arkasından tekrar deneyebilir (madde 9.1).
 */
export async function embedTexts(
  apiKey: string,
  texts: string[],
  fetcher: typeof fetch = fetch,
): Promise<EmbeddingOutcome> {
  if (!texts.length) return { ok: true, embeddings: [], apiCalls: 0 };
  const embeddings: number[][] = [];
  let apiCalls = 0;
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    apiCalls += 1;
    let result = await requestBatch(apiKey, batch, fetcher);
    if (!result.ok && result.status === 429) {
      // Kısa ve sınırlı geri çekilme; sonsuz tekrar yok.
      await delay(RATE_LIMIT_BACKOFF_MS);
      apiCalls += 1;
      result = await requestBatch(apiKey, batch, fetcher);
    }
    if (!result.ok) {
      return { ok: false, status: result.status, detail: result.detail, rateLimited: result.status === 429, apiCalls };
    }
    embeddings.push(...result.embeddings);
  }
  return { ok: true, embeddings, apiCalls };
}
