import { listAudit } from "../../../lib/admin-db";
import { handleError, json, requireModerator } from "../../../lib/admin-guard";

/**
 * Denetim izi (yalnizca Rol 00). Kayitlarda parola, oturum jetonu veya
 * API anahtari bulunmaz; yalnizca islem ozeti tutulur.
 */

export async function GET(request: Request): Promise<Response> {
  const auth = await requireModerator(request);
  if (!auth.ok) return auth.response;

  try {
    return json({ entries: await listAudit(60) });
  } catch (error) {
    return handleError(error);
  }
}
