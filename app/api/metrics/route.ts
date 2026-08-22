import { usageSnapshot } from "../../lib/usage-metrics";

/**
 * Yerel API kullanım özeti: istek sayısı, giriş/çıkış token toplamları,
 * ortalama analiz süresi ve hata oranı. Resmî kota takibi Google AI Studio
 * üzerinden yapılır; bu uç nokta geliştirme sırasındaki gözlem içindir.
 */
export function GET() {
  return Response.json(usageSnapshot());
}
