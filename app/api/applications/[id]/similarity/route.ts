import { handleError, json, jsonError, readJson, requirePermission } from "../../../../lib/admin-guard";
import { buildMinHash, hybridSimilarity, type SimilarityFingerprint } from "../../../../lib/similarity-engine";
import { saveAndListSimilarityFingerprints } from "../../../../lib/workflow-db";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requirePermission(request, "run_ai_prescreen");
  if (!auth.ok) return auth.response;
  try {
    const body = await readJson(request);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text.length < 100) return jsonError(400, "Benzerlik analizi için rapordan yeterli metin çıkarılamadı.");
    if (text.length > 600_000) return jsonError(413, "Benzerlik analizi metni izin verilen sınırı aşıyor.");
    // Ham rapor metni veritabanına yazılmaz ve başka bir servise gönderilmez.
    // Aynı yarışma+yıl+aşama havuzunda yalnızca geri döndürülemez MinHash izi tutulur.
    const base = buildMinHash(text);
    const fingerprint: SimilarityFingerprint = { ...base, embedding: null, embeddingModel: null };
    const peers = await saveAndListSimilarityFingerprints((await context.params).id, auth.account, fingerprint);
    if (peers === "not_found") return jsonError(404, "Başvuru bulunamadı.");
    if (peers === "forbidden") return jsonError(403, "Bu başvurunun benzerlik analizine erişiminiz yok.");
    const ranked = peers.map((peer) => ({ ...peer, ...hybridSimilarity(fingerprint, peer.fingerprint) }))
      .sort((left, right) => right.combined - left.combined);
    const top = ranked[0];
    if (!top) {
      return json({ check: {
        id: "precheck-similarity", kind: "similarity", name: "Aynı yarışma havuzunda benzerlik",
        status: "skipped", method: "deterministic",
        detail: "Aynı yarışma, yıl ve aşamada karşılaştırılabilecek daha önce işlenmiş rapor yok.", evidence: [],
      } });
    }
    const flagged = top.lexical >= 0.55;
    const warning = !flagged && top.lexical >= 0.30;
    const percent = Math.round(top.lexical * 100);
    return json({ check: {
      id: "precheck-similarity", kind: "similarity", name: "Aynı yarışma havuzunda benzerlik",
      status: flagged ? "flagged" : warning ? "warning" : "passed", method: "deterministic",
      detail: `${peers.length} raporla karşılaştırıldı. En yakın eşleşme: ${top.participantLabel} (%${percent}). Bu yalnızca Hakemin incelemesi için bir işarettir; otomatik ihlal veya diskalifiye kararı verilmez.`,
      evidence: [],
    } });
  } catch (error) { return handleError(error); }
}
