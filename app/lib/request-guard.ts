type RateEntry = {
  startedAt: number;
  count: number;
};

type GuardState = {
  clients: Map<string, RateEntry>;
  concurrent: number;
};

export type RequestPermit =
  | { ok: true; release: () => void }
  | { ok: false; retryAfterSeconds: number; reason: "rate" | "concurrency" };

const globalState = globalThis as unknown as { __kriterRequestGuard?: GuardState };

function state(): GuardState {
  if (!globalState.__kriterRequestGuard) {
    globalState.__kriterRequestGuard = { clients: new Map(), concurrent: 0 };
  }
  return globalState.__kriterRequestGuard;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Geçici maliyet koruması. Kimlik doğrulama eklendiğinde ana sınır kullanıcı ve
 * kurum kotası olmalıdır; bu katman yine ani yük ve bot trafiğine karşı kalır.
 */
export function acquireAnalysisPermit(request: Request): RequestPermit {
  const windowMs = positiveInteger(process.env.ANALYSIS_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000);
  const maxRequests = positiveInteger(process.env.ANALYSIS_RATE_LIMIT_MAX, 20);
  const globalMaxRequests = positiveInteger(process.env.ANALYSIS_GLOBAL_RATE_LIMIT_MAX, 60);
  const maxConcurrent = positiveInteger(process.env.ANALYSIS_MAX_CONCURRENT, 2);
  const now = Date.now();
  const current = state();

  // Cloudflare bu başlığı kenarda kendisi üretir. Diğer başlıklar yalnızca yerel
  // geliştirme/ters vekil uyumluluğu içindir; kimlik veya yetki kanıtı değildir.
  const client = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  const clientKey = `client:${client}`;
  const globalKey = "global";

  for (const [key, entry] of current.clients) {
    if (now - entry.startedAt >= windowMs) current.clients.delete(key);
  }

  const globalEntry = current.clients.get(globalKey);
  if (globalEntry && now - globalEntry.startedAt < windowMs && globalEntry.count >= globalMaxRequests) {
    return {
      ok: false,
      reason: "rate",
      retryAfterSeconds: Math.max(1, Math.ceil((globalEntry.startedAt + windowMs - now) / 1000)),
    };
  }

  const entry = current.clients.get(clientKey);
  if (entry && now - entry.startedAt < windowMs && entry.count >= maxRequests) {
    return {
      ok: false,
      reason: "rate",
      retryAfterSeconds: Math.max(1, Math.ceil((entry.startedAt + windowMs - now) / 1000)),
    };
  }

  if (current.concurrent >= maxConcurrent) {
    return { ok: false, reason: "concurrency", retryAfterSeconds: 5 };
  }

  if (!entry || now - entry.startedAt >= windowMs) {
    current.clients.set(clientKey, { startedAt: now, count: 1 });
  } else {
    entry.count += 1;
  }
  if (!globalEntry || now - globalEntry.startedAt >= windowMs) {
    current.clients.set(globalKey, { startedAt: now, count: 1 });
  } else {
    globalEntry.count += 1;
  }

  current.concurrent += 1;
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      current.concurrent = Math.max(0, current.concurrent - 1);
    },
  };
}

/**
 * YALNIZCA başlık tabanlı HIZLI RED: Content-Length sınırın üzerindeyse true.
 * Başlık eksikse (chunked aktarım) false döner; bu "güvenli" demek DEĞİLDİR —
 * tek başına asla yeterli kapı sayılmaz. Gerçek bayt sınırı her zaman
 * `readBodyWithLimit` ile akış sırasında uygulanır (madde 9).
 */
export function requestBodyTooLarge(request: Request, maxBytes: number): boolean {
  const raw = request.headers.get("content-length");
  if (!raw) return false;
  const length = Number(raw);
  return Number.isFinite(length) && length > maxBytes;
}

/** Ortam değişkeniyle ayarlanabilir bayt sınırı; geçersiz değer varsayılana düşer. */
export function configuredByteLimit(name: string, fallback: number): number {
  return positiveInteger(process.env[name], fallback);
}

/** 413 karşılığı: gövde bayt sınırı aşıldı. Boyut kapısı JSON parse'tan ÖNCE çalışır. */
export class PayloadTooLargeError extends Error {
  readonly maxBytes: number;
  constructor(maxBytes: number) {
    // Not: parametre özelliği (constructor(readonly ...)) kullanılmaz; Node'un
    // strip-only TypeScript kipi (birim testleri) bu sözdizimini desteklemez.
    super(`İstek gövdesi ${maxBytes} bayt sınırını aşıyor.`);
    this.name = "PayloadTooLargeError";
    this.maxBytes = maxBytes;
  }
}

/**
 * Gövdeyi AKIŞ hâlinde, gerçek baytları sayarak okur (madde 9):
 *
 *   - Content-Length sınırın ÜZERİNDEYSE akış hiç okunmadan reddedilir (hızlı yol).
 *   - Content-Length EKSİKSE istek otomatik güvenli SAYILMAZ: baytlar tek tek
 *     sayılır ve sınır aşıldığı anda okuma İPTAL edilir. 200 MB'lık chunked bir
 *     gövde hiçbir zaman tamamen Worker belleğine alınmaz.
 *   - Boyut kapısı her zaman JSON/multipart ayrıştırmasından ÖNCE çalışır.
 */
export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (requestBodyTooLarge(request, maxBytes)) throw new PayloadTooLargeError(maxBytes);
  const body = request.body;
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      // Erken iptal: kalan baytlar hiç okunmaz, bellek büyümez.
      await reader.cancel("payload too large").catch(() => undefined);
      throw new PayloadTooLargeError(maxBytes);
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
  return out;
}

/**
 * Multipart gövdeler için AYNI kapı: sınırlanmış baytlar standart ayrıştırıcıya
 * verilir. `request.formData()` yerine kullanılır; sınır aşımı ayrıştırma
 * başlamadan `PayloadTooLargeError` fırlatır (handleError → 413).
 */
export async function readFormDataWithLimit(request: Request, maxBytes: number): Promise<FormData> {
  const bytes = await readBodyWithLimit(request, maxBytes);
  // Tip notu: lib.dom `BodyInit` genel Uint8Array'i doğrudan kabul etmiyor;
  // çalışma zamanında (workerd + undici) ArrayBufferView geçerli bir gövdedir.
  return await new Response(bytes as unknown as BodyInit, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
}
