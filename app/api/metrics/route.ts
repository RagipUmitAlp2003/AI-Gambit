import { usageSnapshot } from "../../lib/usage-metrics";

/**
 * Yerel API kullanım özeti: istek sayısı, giriş/çıkış token toplamları,
 * ortalama analiz süresi ve hata oranı. Resmî kota takibi Google AI Studio
 * üzerinden yapılır; bu uç nokta geliştirme sırasındaki gözlem içindir.
 */
export function GET() {
  if (process.env.NODE_ENV === "production" && (process.env.ENABLE_USAGE_METRICS || "off").toLowerCase() !== "on") {
    return Response.json({ error: "Bulunamadı." }, { status: 404 });
  }
  return Response.json(usageSnapshot());
}
