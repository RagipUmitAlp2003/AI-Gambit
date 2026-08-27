import { env } from "cloudflare:workers";
import { listMail } from "../../../lib/admin-db";
import { handleError, json, requireModerator } from "../../../lib/admin-guard";
import { mailProviderReady } from "../../../lib/mailer";
import { isProduction } from "../../../lib/session";

/**
 * Gonderilen ve gonderilmeyi bekleyen hesap bildirimleri (yalnizca Rol 00).
 * Govdelerde sifre maskelidir; tek kullanimlik sifre yalnizca hesap
 * olusturma yanitinda bir kez doner.
 */

export async function GET(request: Request): Promise<Response> {
  const auth = await requireModerator(request);
  if (!auth.ok) return auth.response;

  try {
    return json({ mail: await listMail(40), mailReady: mailProviderReady(env), production: isProduction() });
  } catch (error) {
    return handleError(error);
  }
}
