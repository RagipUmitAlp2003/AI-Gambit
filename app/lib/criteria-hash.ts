/**
 * Kriter seti özet (hash) formülleri.
 *
 * Bu modül SAF'tır: yalnızca `./types` içe aktarır ve Web Crypto kullanır;
 * hem Cloudflare Workers'ta hem Node birim testlerinde çalışır (workflow-db.ts
 * `cloudflare:workers` içe aktardığı için node --test ile yüklenemez).
 *
 * İki formül vardır:
 *   - `criteriaHash`      : YÜRÜRLÜKTEKİ formül; yeni sürüm satırları bununla yazılır.
 *   - `legacyCriteriaHash`: ESKİ (eead40e öncesi) formül; yalnızca eski sürüm
 *                           satırlarını TANIMAK için tutulur, asla yeni satır yazmaz.
 */
import { resolveControlType } from "./types";
import type { Criterion } from "./types";

/** Kanonik dizgenin SHA-256 özeti, küçük harf onaltılık. */
async function sha256Hex(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Kriter setinin içeriğine bağlı, sıralamadan bağımsız kararlı özet. */
export async function criteriaHash(criteria: Criterion[]): Promise<string> {
  const canonical = criteria
    .map((item) => [
      item.id, item.name, item.stage, item.required ? "1" : "0",
      item.description, item.controlType ?? "", item.sourceId ?? "", (item.sourceIds ?? []).join(","),
      item.sourcePage === null ? "" : String(item.sourcePage),
      item.sourceText, item.verifiability, item.active ? "1" : "0", item.origin,
    ].join("␟"))
    .sort()
    .join("␞");
  return sha256Hex(canonical);
}

/**
 * İÇERİK KİMLİĞİ özeti — yayım sırasında "içerik gerçekten değişti mi?"
 * sorusunun tek doğruluk kaynağı.
 *
 * Yeni formülün birebir aynısıdır; tek fark `controlType` alanının
 * KANONİKLEŞTİRİLMESİDİR: alan yoksa veya aşamayla uyumsuzsa aşama varsayılanı
 * yazılır (bkz. resolveControlType). Neden: eski saklanmış sürüm satırları
 * controlType olmadan yazıldı, profil yükleyicisi ise artık her kriterde aşama
 * varsayılanını dolduruyor. Ham özet bu iki eşdeğer hâli farklı sayar ve
 * değişmemiş bir profilin yeniden yayımı sahte sürüm açardı (bağlı
 * değerlendirmeler 409'a düşer). Değerlendirme istemi de aynı çözümü uygular
 * (evaluate-report · buildPrompt); yani "alan yok" ile "aşama varsayılanı"
 * davranışsal olarak aynıdır ve içerik kimliğinde de aynı sayılmalıdır.
 *
 * Açıkça FARKLI bir controlType değeri (ör. varsayılan ICERIK_VARLIGI yerine
 * BIREBIR_BASLIK) kanonikleştirmeden etkilenmez ve gerçek değişiklik olarak
 * yeni sürüm açar.
 */
export async function criteriaContentHash(criteria: Criterion[]): Promise<string> {
  return criteriaHash(criteria.map((item) => ({
    ...item,
    controlType: resolveControlType(item.stage, item.controlType),
  })));
}

/**
 * ESKİ (eead40e öncesi) özet formülü — commit ac3b3fc'deki `criteriaHash`
 * birebir. `violationOutcome` alanını içerir; `controlType`, `sourceId` ve
 * `sourceIds` alanlarını İÇERMEZ (o tarihte yoktular).
 *
 * Eski sürüm satırlarını TANIMAK için tutulur (denetim/teşhis ve altın-sabit
 * testleri); yayım yolundaki içerik kimliği karşılaştırması artık
 * `criteriaContentHash` ile yapılır ve eski/yeni satır ayrımına ihtiyaç
 * duymaz. Bu formül yine de ASLA DEĞİŞTİRİLMEZ; tarihsel satırların hangi
 * formülle yazıldığını kanıtlayan tek kayıttır.
 *
 * Not: `item.violationOutcome` bilerek ham bırakılır (`?? ""` YOK);
 * Array.prototype.join undefined/null değerleri zaten "" olarak yazar ve eski
 * kod da aynen böyle davranıyordu.
 */
export async function legacyCriteriaHash(criteria: Criterion[]): Promise<string> {
  const canonical = criteria
    .map((item) => [
      item.id, item.name, item.stage, item.required ? "1" : "0",
      item.description, item.violationOutcome,
      item.sourcePage === null ? "" : String(item.sourcePage),
      item.sourceText, item.verifiability, item.active ? "1" : "0", item.origin,
    ].join("␟"))
    .sort()
    .join("␞");
  return sha256Hex(canonical);
}
