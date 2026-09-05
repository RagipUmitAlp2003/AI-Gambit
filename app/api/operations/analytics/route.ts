import { handleError, json, jsonError, requirePermission } from "../../../lib/admin-guard";
import {
  buildParticipationAnalytics,
  knownFilterValues,
  parseAnalyticsFilters,
} from "../../../lib/participation-analytics";
import { listAnalyticsRecords } from "../../../lib/workflow-db";

/**
 * Değerlendirme Yöneticisi (Rol 04) · Katılım ve karar analitiği.
 *
 * YETKİ: sunucu tarafında `operations_dashboard` izniyle korunur; arayüzde
 * düğme gizlemek yetki değildir. Diğer roller 403 alır.
 *
 * GİZLİLİK: yanıt yalnızca TOPLULAŞTIRILMIŞ sayaç ve oran taşır. Katılımcı
 * adı, e-posta, dosya adı, PDF metni, hakem gerekçesi ve kanıt alıntısı
 * ne okunur ne döndürülür (bkz. workflow-db · listAnalyticsRecords). Hakemler
 * "Hakem N" etiketiyle anonimleştirilir. Üçten az tamamlanmış kararı olan
 * gruplarda oran üretilmez ("Örneklem yetersiz").
 *
 * FİLTRELER: sorgu parametreleri allowlist ile doğrulanır; bilinmeyen anahtar
 * veya listede olmayan değer 400 döner. Bütün grafik ve tablolar aynı filtre
 * kümesinden üretilir.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "operations_dashboard");
  if (!auth.ok) return auth.response;
  try {
    const records = await listAnalyticsRecords();
    const url = new URL(request.url);
    const parsed = parseAnalyticsFilters(url.searchParams.entries(), knownFilterValues(records));
    if (parsed.invalid.length) {
      return jsonError(400, `Geçersiz analitik filtresi: ${[...new Set(parsed.invalid)].join(", ")}.`);
    }
    return json({ analytics: buildParticipationAnalytics(records, parsed.filters) });
  } catch (error) {
    return handleError(error);
  }
}
