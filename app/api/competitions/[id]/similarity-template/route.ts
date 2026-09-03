import { handleError, json, jsonError, requirePermission } from "../../../../lib/admin-guard";
import { readFormDataWithLimit, requestBodyTooLarge } from "../../../../lib/request-guard";
import { pdfIntegrityError } from "../../../../lib/pdf-integrity";
import { PdfTextLayerError, extractPdfStructure } from "../../../../lib/pdf-structure";
import {
  TEMPLATE_FILTER_VERSION,
  templateFoldedLines,
  templateShingleHashes,
} from "../../../../lib/similarity-text";
import {
  findCompetitionKeyById,
  findCurrentSimilarityTemplate,
  ownsCompetition,
  reportBucket,
  saveSimilarityTemplate,
  type SimilarityTemplateRecord,
} from "../../../../lib/workflow-db";
import { recordAudit } from "../../../../lib/admin-db";
import type { SimilarityTemplateInfo } from "../../../../lib/workflow-types";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Resmî rapor şablonu ucu (GÖREV 3 · madde 3) — yalnızca BENZERLİK filtresi.
 *
 *   GET   /api/competitions/{id}/similarity-template  → geçerli şablon meta verisi
 *   POST  /api/competitions/{id}/similarity-template  → yeni şablon PDF'i yükleme
 *
 * Bu şablon KRİTER ÜRETMEZ ve rapor uygunluğu kararı VERMEZ; benzerlik
 * analizindeki beklenen ortak metni (kapak, zorunlu başlıklar, sabit şablon
 * cümleleri) ayıklamak için kullanılır. Kriter akışının emekliye ayrılan
 * templateProfile alanıyla (types.ts) İLGİSİZDİR.
 *
 * Yetki: manage_similarity_template = yalnızca 01; ayrıca yarışma SAHİPLİĞİ
 * doğrulanır. 04 dahil başka hiçbir rol okuyamaz (en az yetki).
 *
 * Sürümleme: içerik değişince sürüm artar; eski sürüm satırı ve R2 nesneleri
 * SİLİNMEZ (denetim: "benzerlik puanına katılmayan ortak/şablon içeriği").
 * Şablon değişimi aynı yarışmadaki benzerlik SONUÇLARINI "güncel değil" yapar;
 * embedding önbelleğine dokunmaz (yeniden embedding maliyeti çıkarılmaz).
 *
 * ÜCRETLİ ÇAĞRI YOKTUR: metin katmanı olmayan (taranmış) şablon PDF'i 422 ile
 * reddedilir; şablon için OCR yolu YOKTUR.
 */

/** Şablon PDF'i sistem sınırı; şartname ucundakiyle aynı (18 MB). */
const MAX_TEMPLATE_BYTES = 18 * 1024 * 1024;
/** multipart zarf payı: sınır kapısı gövde okunmadan Content-Length ile uygulanır. */
const MULTIPART_OVERHEAD_BYTES = 768 * 1024;

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "sablon.pdf";
}

function publicTemplate(template: SimilarityTemplateRecord): SimilarityTemplateInfo {
  return {
    version: template.version,
    fileName: template.fileName,
    pageCount: template.pageCount,
    wordCount: template.wordCount,
    uploadedAt: template.createdAt,
  };
}

async function resolveOwnedCompetition(
  competitionId: string,
  account: Parameters<typeof ownsCompetition>[1],
): Promise<{ competitionKey: string; competitionName: string; archived: boolean } | Response> {
  const competition = await findCompetitionKeyById(competitionId);
  if (!competition) return jsonError(404, "Yarışma bulunamadı.");
  if (!(await ownsCompetition(competitionId, account))) {
    return jsonError(403, "Bu yarışmanın resmî şablonunu yalnızca sahibi olan Yarışma Yöneticisi yönetebilir.");
  }
  return competition;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requirePermission(request, "manage_similarity_template");
  if (!auth.ok) return auth.response;
  try {
    const competitionId = (await context.params).id;
    const competition = await resolveOwnedCompetition(competitionId, auth.account);
    if (competition instanceof Response) return competition;
    const template = await findCurrentSimilarityTemplate(competition.competitionKey);
    return json({ template: template ? publicTemplate(template) : null });
  } catch (error) { return handleError(error); }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requirePermission(request, "manage_similarity_template");
  if (!auth.ok) return auth.response;
  /** D1 kaydı kesinleşmeden yüklenen R2 nesneleri; hata olursa geri alınır. */
  const uploadedKeys: string[] = [];
  try {
    // Boyut kapısı gövde BELLEĞE ALINMADAN uygulanır (Content-Length).
    if (requestBodyTooLarge(request, MAX_TEMPLATE_BYTES + MULTIPART_OVERHEAD_BYTES)) {
      return jsonError(413, "Şablon PDF'i en fazla 18 MB olabilir.");
    }
    const competitionId = (await context.params).id;
    const competition = await resolveOwnedCompetition(competitionId, auth.account);
    if (competition instanceof Response) return competition;
    if (competition.archived) {
      return jsonError(409, "Arşivlenmiş yarışmaya resmî şablon yüklenemez.");
    }

    // Gerçek bayt sınırı akışta uygulanır: Content-Length beyanı olmayan büyük
    // gövde de belleğe alınmadan 413 alır (madde 9; handleError eşler).
    const form = await readFormDataWithLimit(request, MAX_TEMPLATE_BYTES + MULTIPART_OVERHEAD_BYTES);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return jsonError(400, "Resmî rapor şablonu PDF dosyası gereklidir (form alanı: file).");
    }
    if (file.size > MAX_TEMPLATE_BYTES) return jsonError(413, "Şablon PDF'i en fazla 18 MB olabilir.");
    if (!file.name.toLocaleLowerCase("tr-TR").endsWith(".pdf")) {
      return jsonError(400, "Resmî rapor şablonu PDF biçiminde olmalıdır.");
    }
    const bytes = await file.arrayBuffer();
    const integrityError = pdfIntegrityError(bytes);
    if (integrityError) return jsonError(422, `Şablon PDF'i okunamıyor: ${integrityError}`);

    /*
     * Yapısal ayrıştırma (metin katmanı). Taranmış şablon 422 ile reddedilir:
     * şablon için OCR yolu YOKTUR (ücretli çağrı yasağı); yönetici metin
     * katmanlı (aranabilir) bir PDF yüklemelidir.
     */
    let structured;
    try {
      structured = await extractPdfStructure(bytes);
    } catch (structureError) {
      if (structureError instanceof PdfTextLayerError) {
        return jsonError(422,
          "Şablon PDF'inde okunabilir metin katmanı yok (taranmış görüntü olabilir). "
          + "Şablon için OCR uygulanmaz; metin katmanlı (aranabilir) bir PDF yükleyin.");
      }
      throw structureError;
    }

    const pdfHash = structured.pdfHash;
    // İdempotent yeniden yükleme: içerik ve filtre kuralı aynıysa sürüm artmaz,
    // hiçbir şey yazılmaz ve hiçbir sonuç eskitilmez.
    const current = await findCurrentSimilarityTemplate(competition.competitionKey);
    if (current && current.pdfHash === pdfHash && current.filterVersion === TEMPLATE_FILTER_VERSION) {
      return json({ template: publicTemplate(current), unchanged: true });
    }

    // Sayfa metinleri bloklardan kurulur; katlanmış satırlar classifyBlocks'un
    // "sablon" kuralını, shingle kümesi parça düzeyi örtüşme işaretini besler.
    const pageTexts = new Map<number, string[]>();
    const blockLines: string[] = [];
    for (const block of structured.blocks) {
      const lines = pageTexts.get(block.pageNumber) ?? [];
      lines.push(block.originalText);
      pageTexts.set(block.pageNumber, lines);
      blockLines.push(block.originalText);
    }
    const pages = Array.from({ length: structured.pageCount }, (_, index) =>
      (pageTexts.get(index + 1) ?? []).join("\n"));
    const foldedLines = [...templateFoldedLines(blockLines)];
    const shingles = [...templateShingleHashes(pages)];
    const wordCount = pages.reduce((sum, page) => {
      const trimmed = page.trim();
      return sum + (trimmed ? trimmed.split(/\s+/).length : 0);
    }, 0);

    /*
     * R2: orijinal PDF (denetim kopyası) + metin/shingle nesnesi. Eski sürüm
     * nesneleri silinmez; her sürüm kendi anahtarını taşır.
     */
    const objectId = crypto.randomUUID();
    const fileKey = `similarity-templates/${competitionId}/${objectId}-${safeFileName(file.name)}`;
    const textKey = `similarity-templates/${competitionId}/${objectId}.json`;
    await reportBucket().put(fileKey, bytes, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { competitionId, kind: "similarity-template-pdf", uploadedBy: auth.account.id },
    });
    uploadedKeys.push(fileKey);
    await reportBucket().put(textKey, JSON.stringify({
      v: 1,
      filterVersion: TEMPLATE_FILTER_VERSION,
      pdfHash,
      pageCount: structured.pageCount,
      pages,
      foldedLines,
      shingles,
    }), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { competitionId, kind: "similarity-template-text" },
    });
    uploadedKeys.push(textKey);

    const saved = await saveSimilarityTemplate({
      competitionId,
      competitionKey: competition.competitionKey,
      pdfHash,
      fileKey,
      textKey,
      fileName: safeFileName(file.name),
      pageCount: structured.pageCount,
      wordCount,
      shingleCount: shingles.length,
      filterVersion: TEMPLATE_FILTER_VERSION,
      actor: auth.account,
    });
    if (saved.unchanged) {
      // Yarış durumu: eşzamanlı özdeş yükleme sürüm açmadıysa nesneler geri alınır.
      for (const key of uploadedKeys) { try { await reportBucket().delete(key); } catch { /* Asıl sonuç korunur. */ } }
      uploadedKeys.length = 0;
      return json({ template: publicTemplate(saved.template), unchanged: true });
    }
    // D1 kaydı kesinleşti: nesneler artık şablon sürümüne aittir, geri alınmaz.
    uploadedKeys.length = 0;
    await recordAudit({
      actorId: auth.account.id,
      actorEmail: auth.account.email,
      actorRole: auth.account.roleCode,
      action: "similarity_template_uploaded",
      targetType: "competition",
      targetId: competitionId,
      detail: `${competition.competitionName} · resmî şablon v${saved.template.version}`
        + ` (${saved.template.fileName}, ${saved.template.pageCount} sayfa, özet ${pdfHash.slice(0, 12)})`
        + " · eski benzerlik sonuçları güncel değil olarak işaretlendi",
    }).catch((auditError) => console.error("[audit] similarity_template_uploaded", auditError));
    return json({ template: publicTemplate(saved.template), unchanged: false }, 201);
  } catch (error) {
    // D1 kaydı kesinleşmediyse R2'ye yazılan şablon nesneleri geri alınır.
    for (const key of uploadedKeys) { try { await reportBucket().delete(key); } catch { /* Asıl hata korunur. */ } }
    return handleError(error);
  }
}
