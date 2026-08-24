import { findActiveAccountByRoleAndName } from "./admin-db";
import { isFlowActorRole } from "./admin-roles";
import { ValidationError, assertRoleCode, optionalText, requiredText } from "./admin-guard";
import type { DocumentFlowInput, HandoffInput } from "./admin-types";

/** Belge akışı gövdesinin doğrulanması; iki uç da aynı kuralları kullanır. */

const MAX_HANDOFFS = 12;

function parseHandoff(value: unknown, index: number): HandoffInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${index + 1}. devir kaydı okunamadı.`);
  }
  const raw = value as Record<string, unknown>;
  if (!isFlowActorRole(raw.fromRole)) {
    throw new ValidationError(`${index + 1}. devirde gönderen rolü geçersiz.`);
  }
  assertRoleCode(raw.toRole, `${index + 1}. devirde alıcı rolü`);
  const fromName = requiredText(raw, "fromName", `${index + 1}. devirde gönderen adı`, 120);
  const toName = requiredText(raw, "toName", `${index + 1}. devirde alıcı adı`, 120);
  const handedAt = optionalText(raw, "handedAt", 40);

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : undefined,
    fromRole: raw.fromRole,
    fromName,
    toRole: assertRoleCode(raw.toRole),
    toName,
    note: optionalText(raw, "note", 600),
    // Geçersiz tarih verilirse kaydı reddetmek yerine "şu an" damgası kullanılır.
    handedAt: handedAt && !Number.isNaN(Date.parse(handedAt)) ? new Date(handedAt).toISOString() : undefined,
  };
}

/**
 * Yeni devirlerin tarafları sistemde kayıtlı ve aktif olmalıdır.
 * Kimliği olan (daha önce kaydedilmiş) devirler yeniden doğrulanmaz; onlar
 * değiştirilemez geçmiştir ve tarafları sonradan pasife alınmış olabilir.
 */
async function assertHandoffParties(handoff: HandoffInput, index: number): Promise<void> {
  if (handoff.id) return;

  const recipient = await findActiveAccountByRoleAndName(handoff.toRole, handoff.toName);
  if (!recipient) {
    throw new ValidationError(
      `${index + 1}. devirde alıcı bulunamadı: "${handoff.toName}" adında aktif bir ${handoff.toRole} yöneticisi yok.`,
    );
  }

  if (handoff.fromRole !== "author") {
    const sender = await findActiveAccountByRoleAndName(handoff.fromRole, handoff.fromName);
    if (!sender) {
      throw new ValidationError(
        `${index + 1}. devirde gönderen bulunamadı: "${handoff.fromName}" adında aktif bir ${handoff.fromRole} yöneticisi yok.`,
      );
    }
  }
}

export async function parseFlowInput(body: Record<string, unknown>): Promise<DocumentFlowInput> {
  const competition = requiredText(body, "competition", "Yarışma adı", 200);
  const authorName = requiredText(body, "authorName", "Belgeyi oluşturan", 120);
  const summary = requiredText(body, "summary", "Belgenin özeti", 4000);

  const rawHandoffs = body.handoffs;
  if (rawHandoffs !== undefined && !Array.isArray(rawHandoffs)) {
    throw new ValidationError("Devir zinciri bir liste olmalıdır.");
  }
  const handoffList = (rawHandoffs ?? []) as unknown[];
  if (handoffList.length > MAX_HANDOFFS) {
    throw new ValidationError(`Bir belge akışında en fazla ${MAX_HANDOFFS} devir kaydedilebilir.`);
  }

  const handoffs = handoffList.map(parseHandoff);
  for (let index = 0; index < handoffs.length; index += 1) {
    await assertHandoffParties(handoffs[index], index);
  }

  const status = body.status === "completed" ? "completed" : "in_progress";

  return {
    competition,
    title: optionalText(body, "title", 200),
    authorName,
    summary,
    status,
    finalNote: optionalText(body, "finalNote", 4000),
    finalDocument: optionalText(body, "finalDocument", 400),
    handoffs,
  };
}
