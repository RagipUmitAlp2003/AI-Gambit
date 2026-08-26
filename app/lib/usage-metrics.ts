/**
 * Sunucu tarafı API kullanım sayaçları. Google AI Studio kotanın resmî
 * kaynağıdır; buradaki sayaçlar yerel gözlem ve maliyet takibi içindir.
 * Bellek içidir; sunucu yeniden başlatıldığında sıfırlanır.
 */

export type UsageSample = {
  model: string;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  cached: boolean;
  error: boolean;
  /**
   * Bu işlem için modele GERÇEKTEN gönderilen `generateContent` isteği sayısı.
   * Önbellek isabetinde 0, normal analizde 1. Sayaç sabit yazılmaz: "tek çağrı"
   * denip birden çok istek gönderildiği durumun ölçümde görünmesi gerekir.
   */
  apiCalls: number;
};

type UsageTotals = {
  startedAt: string;
  requestCount: number;
  cachedCount: number;
  errorCount: number;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalDurationMs: number;
  /** Modele gönderilen toplam üretim isteği; requestCount'tan farklı olabilir. */
  generationCalls: number;
};

const globalState = globalThis as unknown as { __kriterUsageTotals?: UsageTotals };

function totals(): UsageTotals {
  if (!globalState.__kriterUsageTotals) {
    globalState.__kriterUsageTotals = {
      startedAt: new Date().toISOString(),
      requestCount: 0,
      cachedCount: 0,
      errorCount: 0,
      promptTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalDurationMs: 0,
      generationCalls: 0,
    };
  }
  return globalState.__kriterUsageTotals;
}

export function recordUsage(sample: UsageSample) {
  const current = totals();
  current.requestCount += 1;
  if (sample.cached) current.cachedCount += 1;
  if (sample.error) current.errorCount += 1;
  current.promptTokens += sample.promptTokens;
  current.outputTokens += sample.outputTokens;
  current.totalTokens += sample.totalTokens;
  current.totalDurationMs += sample.durationMs;
  current.generationCalls += Number.isFinite(sample.apiCalls) ? sample.apiCalls : 0;
  // Yapılandırılmış tek satır: harici log toplama için ayrıştırılabilir.
  console.log(`[usage] ${JSON.stringify(sample)}`);
}

export function usageSnapshot() {
  const current = totals();
  const analyzed = current.requestCount - current.cachedCount;
  return {
    ...current,
    averageDurationMs: current.requestCount ? Math.round(current.totalDurationMs / current.requestCount) : 0,
    averageTokensPerAnalysis: analyzed > 0 ? Math.round(current.totalTokens / analyzed) : 0,
    errorRate: current.requestCount ? Math.round((current.errorCount / current.requestCount) * 1000) / 10 : 0,
    /** İşlem başına ortalama model çağrısı. Tek çağrı prensibinde 1'i aşmamalıdır. */
    callsPerAnalysis: analyzed > 0 ? Math.round((current.generationCalls / analyzed) * 100) / 100 : 0,
  };
}
