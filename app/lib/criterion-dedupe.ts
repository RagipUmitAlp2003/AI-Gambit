type CriterionCandidate = {
  name?: unknown;
  sourcePage?: unknown;
  sourceText?: unknown;
  effect?: unknown;
};

const STOP_WORDS = new Set([
  "ve", "veya", "ile", "icin", "bir", "bu", "olan", "olarak", "kural", "kurali",
  "kosul", "kosulu", "sart", "sarti", "sinir", "siniri", "zorunluluk", "zorunlulugu",
  "puan", "puani", "puanlama", "puanlamasi", "deger", "degeri",
]);

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function comparisonTokens(value: unknown): Set<string> {
  const canonical = asText(value)
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return new Set(canonical.split(/\s+/).filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
}

function numericSignature(value: unknown): string[] {
  return asText(value)
    .replace(/,/g, ".")
    .match(/\b\d+(?:\.\d+)?\b/g) ?? [];
}

function tokenOverlap(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/**
 * İkinci tarama aynı kuralı farklı bir başlıkla yazabilir. Yalnızca aynı
 * sayfada, aynı etki türünde ve kaynak/ad benzerliği güçlü olduğunda tekrar
 * sayılır; böylece aynı cümlenin iki ayrı sonucu yanlışlıkla birleştirilmez.
 */
export function sameCriterionCandidate(primary: CriterionCandidate, audit: CriterionCandidate): boolean {
  const primaryPage = asNumber(primary.sourcePage);
  const auditPage = asNumber(audit.sourcePage);
  if (primaryPage === null || auditPage === null || primaryPage !== auditPage) return false;
  if (asText(primary.effect) !== asText(audit.effect)) return false;

  // Aynı sayfadaki iki ayrı eşik yalnızca başlıkları benziyor diye birleşmesin.
  const primaryNumbers = numericSignature(primary.sourceText);
  const auditNumbers = numericSignature(audit.sourceText);
  if (primaryNumbers.length && auditNumbers.length
    && !primaryNumbers.some((number) => auditNumbers.includes(number))) return false;

  const sourceSimilarity = tokenOverlap(comparisonTokens(primary.sourceText), comparisonTokens(audit.sourceText));
  const nameSimilarity = tokenOverlap(comparisonTokens(primary.name), comparisonTokens(audit.name));
  return sourceSimilarity >= 0.58 || nameSimilarity >= 0.72;
}
