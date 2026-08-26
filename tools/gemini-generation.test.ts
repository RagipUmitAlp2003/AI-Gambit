import assert from "node:assert/strict";
import test from "node:test";
import { runSingleGeneration, describeGeminiFailure } from "../app/lib/gemini-generation.ts";

/**
 * Üretim çağrısı katmanının regresyon testleri.
 *
 * Buradaki sözleşme iki yönlüdür ve ikisi de aynı anda korunmalıdır:
 *
 *  1) MALİYET — bir kullanıcı işlemi için modele en fazla BİR ÜCRETLİ istek
 *     gider. `apiCalls` bunun sayacıdır ve sabit yazılmaz.
 *  2) ERİŞİLEBİLİRLİK — Gemini'nin bedelsiz 503/500 reddi kullanıcıya "analiz
 *     başarısız" olarak geçirilmez; sunucu sınırlı sayıda yeniden dener.
 *
 * Üst akış gerçekten çağrılmaz: `fetch` yerine senaryo veren bir sahte taşıma
 * konur. Böylece test hem hızlıdır hem de Gemini o an sağlıklı olduğu için
 * 503 yolunu hiç görmemek gibi bir kör noktası kalmaz.
 */

type Scripted = { status: number; body?: unknown; headers?: Record<string, string> };

/** Sırayla verilen yanıtları döndüren sahte taşıma; kaç kez çağrıldığını sayar. */
function stubFetch(script: Scripted[]) {
  const calls: number[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const step = script[Math.min(calls.length, script.length - 1)];
    calls.push(step.status);
    return new Response(JSON.stringify(step.body ?? {}), {
      status: step.status,
      headers: { "content-type": "application/json", ...(step.headers ?? {}) },
    });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const unavailable = { error: { code: 503, status: "UNAVAILABLE", message: "This model is currently experiencing high demand." } };
const ok = { candidates: [{ content: { parts: [{ text: "{}" }] } }] };

const input = {
  apiKey: "test-key",
  body: "{}",
  model: "gemini-test",
  timeoutMs: 1_000,
  label: "test",
};

test("bedelsiz 503 reddi yeniden denenir ve ücret tek çağrı olarak sayılır", async () => {
  const stub = stubFetch([
    { status: 503, body: unavailable, headers: { "retry-after": "1" } },
    { status: 503, body: unavailable, headers: { "retry-after": "1" } },
    { status: 200, body: ok },
  ]);
  try {
    const outcome = await runSingleGeneration({ ...input, maxAttempts: 4 });
    assert.equal(outcome.ok, true, "Üçüncü denemede başarı beklenir.");
    assert.equal(stub.calls.length, 3, "İki bedelsiz redden sonra üçüncü istek kurulmalıdır.");
    assert.equal(outcome.attempts, 3);
    assert.equal(outcome.rejectedAttempts, 2, "Faturalanmayan redler ayrı sayılmalıdır.");
    assert.equal(outcome.apiCalls, 1, "Maliyet prensibi: ücretli çağrı 1'i aşmamalıdır.");
  } finally {
    stub.restore();
  }
});

test("503 tükendiğinde ücretli çağrı sayılmaz ve hata geçici işaretlenir", async () => {
  const stub = stubFetch([{ status: 503, body: unavailable, headers: { "retry-after": "1" } }]);
  try {
    const outcome = await runSingleGeneration({ ...input, maxAttempts: 3 });
    assert.equal(outcome.ok, false);
    assert.equal(stub.calls.length, 3, "maxAttempts kadar istek kurulmalı, fazlası değil.");
    assert.equal(outcome.rejectedAttempts, 3);
    assert.equal(outcome.apiCalls, 0, "Modele hiç girilmediyse ücret yazılmaz.");
    if (outcome.ok) return;
    const failure = describeGeminiFailure(outcome.status, outcome.detail, "AI rapor analizi", outcome.rejectedAttempts);
    assert.equal(failure.httpStatus, 503);
    assert.equal(failure.transient, true, "Arayüz 'Yeniden dene' düğmesini göstermelidir.");
    assert.match(failure.message, /3 kez/, "Kullanıcıya kaç kez denendiği söylenmelidir.");
    assert.match(failure.message, /faturalanmaz/, "Redlerin ücretsiz olduğu belirtilmelidir.");
  } finally {
    stub.restore();
  }
});

test("429 kota hatası yeniden DENENMEZ", async () => {
  const stub = stubFetch([{ status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota" } } }]);
  try {
    const outcome = await runSingleGeneration({ ...input, maxAttempts: 4 });
    assert.equal(outcome.ok, false);
    assert.equal(stub.calls.length, 1, "Hız sınırında tekrar denemek sınırı kötüleştirir.");
    assert.equal(outcome.rejectedAttempts, 0);
  } finally {
    stub.restore();
  }
});

test("geçersiz anahtar (403) yeniden DENENMEZ ve oturumu düşürmez", async () => {
  const stub = stubFetch([{ status: 403, body: { error: { code: 403, status: "PERMISSION_DENIED", message: "denied" } } }]);
  try {
    const outcome = await runSingleGeneration({ ...input, maxAttempts: 4 });
    assert.equal(outcome.ok, false);
    assert.equal(stub.calls.length, 1, "Aynı istek aynı yanıtı verir.");
    if (outcome.ok) return;
    const failure = describeGeminiFailure(outcome.status, outcome.detail, "AI rapor analizi", outcome.rejectedAttempts);
    assert.equal(failure.httpStatus, 502, "401/403 uygulamanın oturum katmanına sızmamalıdır.");
    assert.equal(failure.transient, false);
  } finally {
    stub.restore();
  }
});

test("maxAttempts=1 yeniden denemeyi tamamen kapatır", async () => {
  const stub = stubFetch([{ status: 503, body: unavailable }]);
  try {
    const outcome = await runSingleGeneration({ ...input, maxAttempts: 1 });
    assert.equal(outcome.ok, false);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("süre bütçesi dolduğunda yeni tur başlatılmaz", async () => {
  const stub = stubFetch([{ status: 503, body: unavailable }]);
  try {
    // Bütçe tek bir denemeye bile yer bırakmıyor: ilk redden sonra durulmalı.
    const outcome = await runSingleGeneration({ ...input, maxAttempts: 5, timeoutMs: 60_000, totalBudgetMs: 1_000 });
    assert.equal(outcome.ok, false);
    assert.equal(stub.calls.length, 1, "Bütçe yoksa kullanıcı boşuna bekletilmez.");
  } finally {
    stub.restore();
  }
});
