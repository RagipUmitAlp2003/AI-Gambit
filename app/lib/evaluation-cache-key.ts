/**
 * RAPOR ANALİZİ ÖNBELLEK ANAHTARININ BAĞLAMI (madde 8)
 *
 * Kaydedilen değerlendirme saf AI çıkarımı DEĞİLDİR: rapor adı,
 * `submissionVersionId` ve profil künyesi gibi BAŞVURUYA ÖZGÜ alanları da
 * taşır. Anahtar yalnızca PDF özeti + kriter özetinden kurulduğunda, aynı
 * belgeyi yükleyen iki farklı başvuru aynı kayda düşüyor ve ikincisi birincinin
 * künyesini (sürüm kimliği, dosya adı) alıyordu.
 *
 * Bu yüzden anahtar başvuru ve rapor SÜRÜMÜ ile kapsamlandırılır:
 *   - Aynı başvurunun aynı sürümü → yeniden kullanılır (gereksiz model çağrısı yok).
 *   - Farklı başvuru veya yeni rapor sürümü → ayrı anahtar, paylaşım YOK.
 *
 * Ayrı ve saf bir modül olmasının nedeni test edilebilirliktir: anahtarın hangi
 * alanlardan kurulduğu birim testiyle korunur ve Cloudflare bağlaması
 * gerektirmeden doğrulanabilir.
 */
export type EvaluationCacheContext = {
  /** Talimat/şema sürümü; değişince eski kayıtlar geçersiz olur. */
  promptVersion: string;
  applicationId: string;
  /** Analiz edilen katılımcı rapor sürümü; yoksa sabit bir yer tutucu yazılır. */
  submissionVersionId: string | null;
  /** Katılımcı PDF'inin SHA-256 özeti. */
  reportHash: string;
  criteriaHash: string;
  criteriaVersion: number;
  model: string;
  mediaResolution: string;
};

export function evaluationCacheContext(input: EvaluationCacheContext): string {
  return [
    input.promptVersion,
    input.applicationId,
    input.submissionVersionId ?? "no-version",
    input.reportHash,
    input.criteriaHash,
    `v${input.criteriaVersion}`,
    input.model,
    input.mediaResolution,
  ].join(":");
}
