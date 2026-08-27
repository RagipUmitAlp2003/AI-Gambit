import { AI_DISCLAIMER } from "../lib/types";

/**
 * Yapay zekâ uyarısı (madde 10).
 *
 * Yapay zekâ analizinin gösterildiği BÜTÜN hakem ve katılımcı ekranlarında,
 * AI sonucunun HEMEN ALTINDA görünür. Sayfa altbilgisine konmaz: orada
 * kaybolur ve kullanıcı sonucu okurken görmez.
 *
 * Metnin tek doğruluk kaynağı `app/lib/types.ts · AI_DISCLAIMER`'dır.
 */
export default function AiDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <p className={`ai-disclaimer${compact ? " compact" : ""}`} role="note">
      <span className="ai-disclaimer-mark" aria-hidden="true">!</span>
      <span>{AI_DISCLAIMER}</span>
    </p>
  );
}
