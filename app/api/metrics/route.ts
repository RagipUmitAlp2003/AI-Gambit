import { usageSnapshot } from "../../lib/usage-metrics";
import { requirePermission } from "../../lib/admin-guard";
import { isProduction } from "../../lib/session";

/**
 * Yerel API kullanım özeti: istek sayısı, giriş/çıkış token toplamları,
 * ortalama analiz süresi ve hata oranı. Resmî kota takibi Google AI Studio
 * üzerinden yapılır; bu uç nokta geliştirme sırasındaki gözlem içindir.
 */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "operations_dashboard");
  if (!auth.ok) return auth.response;
  // Ortam kontrolü tek kaynaktan (fail-closed): eksik ortam production sayılır.
  if (isProduction() && (process.env.ENABLE_USAGE_METRICS || "off").toLowerCase() !== "on") {
    return Response.json({ error: "Bulunamadı." }, { status: 404 });
  }
  return Response.json(usageSnapshot());
}
