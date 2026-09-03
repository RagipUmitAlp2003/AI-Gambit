/**
 * Kaynak sayfa / kaynak alıntı kilidi — saf eşleştirme mantığı (madde 12).
 *
 * Bu modül SAF'tır: yalnızca `./turkish-text` ve `./types` içe aktarır; D1 veya
 * Node bağımlılığı yoktur. workflow-db.ts `cloudflare:workers` içe aktardığı
 * için node --test ile yüklenemez; kilit mantığı burada birim testlenebilir.
 *
 * NEDEN ÇOK ANAHTARLI İNDEKS?
 *
 * Kilit eskiden yalnızca `criterion.id` ile eşleşiyordu. Kimlik şeması
 * değişince (eead40e: konumsal `criterion-N` → içerik türevi
 * `criterion-sayfa-03-...`) eski profillerin yeniden analizi HİÇBİR kilide
 * çarpmıyor ve bütün profil kilitsiz yayımlanıyordu. Ayrıca kimlik istemciden
 * geldiği için id'yi değiştirmek kilidi baştan beri atlatabiliyordu.
 * Bu indeks aynı kriteri id → sourceId → alıntı sırasıyla arar; PDF yeniden
 * analiz edildiğinde de aynı alıntı aynı kilide bağlanır (alıntı anahtarı
 * `sourceText` üzerinden üretilir ve yapısal sürüm değişimlerinden etkilenmez).
 */
import { foldKey } from "./turkish-text";
import type { Criterion } from "./types";

export type SourceLock = {
  /** İlk yayımdaki kriter adı; yetim raporu ve ad eşleştirmesi için. */
  name: string;
  sourcePage: number | null;
  sourceText: string;
  sourceId: string | null;
  sourceIds: string[];
  origin: Criterion["origin"];
  /**
   * Tarihsel kriter gerçekten yapısal kaynak kimliği taşıyor muydu?
   * Eski şekilli satırlar (alan hiç yok) ve manuel kriterler (null/boş) için
   * false: bu kilit sayfa/alıntı/orijini geri koyar ama yeniden analizin
   * ürettiği yeni sourceId/sourceIds değerlerini SİLMEZ (geriye uyumluluk).
   */
  hasStructuredSource: boolean;
};

export type SourceLockIndex = {
  byId: Map<string, SourceLock>;
  bySourceId: Map<string, SourceLock[]>;
  byQuote: Map<string, SourceLock[]>;
  entries: SourceLock[];
};

/**
 * Alıntı anahtarı: Türkçe katlamalı karşılaştırma anahtarı, 200 karakterle
 * sınırlı. DİKKAT: `sourceText` üzerinden üretilir — aynı PDF yeniden analiz
 * edildiğinde alıntı metni değişmez, yapısal blok kimlikleri değişse bile.
 * Boş alıntı anahtar üretmez; yoksa bütün manuel kriterler tek anahtarda çakışırdı.
 */
function quoteKeyOf(text: string): string {
  return foldKey(text).slice(0, 200);
}

/** Kriterin taşıdığı bütün yapısal kaynak anahtarları (boşlar ayıklanır). */
function sourceIdKeysOf(item: Criterion): string[] {
  const keys = [item.sourceId, ...(item.sourceIds ?? [])];
  return keys.filter((value): value is string => typeof value === "string" && value !== "");
}

/**
 * Liste isabetinde eşitlik bozucu: (a) katlanmış ad eşitliği, (b) sayfa
 * eşitliği, (c) tek adaysa o. Belirsizlik kalırsa null — kilit yanlış kritere
 * bağlanmaktansa eşleşmez (yayım engellenmez; yetim sinyali sayar).
 */
function resolveFromList(candidates: SourceLock[] | undefined, item: Criterion): SourceLock | null {
  if (!candidates?.length) return null;
  const nameKey = foldKey(item.name);
  const byName = candidates.filter((entry) => foldKey(entry.name) === nameKey);
  if (byName.length === 1) return byName[0];
  const page = typeof item.sourcePage === "number" ? item.sourcePage : null;
  const pool = byName.length ? byName : candidates;
  const byPage = pool.filter((entry) => entry.sourcePage === page);
  if (byPage.length === 1) return byPage[0];
  if (candidates.length === 1) return candidates[0];
  return null;
}

/** Kimlik dışı arama: önce sourceId, sonra alıntı anahtarı. */
function resolveFallback(index: SourceLockIndex, item: Criterion): SourceLock | null {
  for (const key of sourceIdKeysOf(item)) {
    const hit = resolveFromList(index.bySourceId.get(key), item);
    if (hit) return hit;
  }
  const quoteKey = typeof item.sourceText === "string" && item.sourceText !== ""
    ? quoteKeyOf(item.sourceText)
    : "";
  if (quoteKey) {
    const hit = resolveFromList(index.byQuote.get(quoteKey), item);
    if (hit) return hit;
  }
  return null;
}

/** Gelen kriteri indekste arar: önce id, sonra sourceId, en son alıntı. */
function resolveEntry(index: SourceLockIndex, item: Criterion): SourceLock | null {
  return index.byId.get(item.id) ?? resolveFallback(index, item);
}

/** Kriterin henüz kayıtlı olmayan anahtarlarını verilen girdiye bağlar. */
function registerKeys(index: SourceLockIndex, item: Criterion, entry: SourceLock): void {
  if (!index.byId.has(item.id)) index.byId.set(item.id, entry);
  for (const key of sourceIdKeysOf(item)) {
    const list = index.bySourceId.get(key) ?? [];
    if (!list.includes(entry)) list.push(entry);
    index.bySourceId.set(key, list);
  }
  const quoteKey = typeof item.sourceText === "string" && item.sourceText !== ""
    ? quoteKeyOf(item.sourceText)
    : "";
  if (quoteKey) {
    const list = index.byQuote.get(quoteKey) ?? [];
    if (!list.includes(entry)) list.push(entry);
    index.byQuote.set(quoteKey, list);
  }
}

/**
 * Bütün tarihsel sürümlerden (eskiden yeniye) kilit indeksini kurar.
 *
 * İLK görülen sürüm kazanır: sonraki bir sürümde aynı kriter başka bir id,
 * sourceId veya alıntıyla görülürse YENİ girdi açılmaz; o kriterin henüz
 * kayıtlı olmayan anahtarları EN ESKİ girdiye takma ad olarak bağlanır. Böylece
 * kimlik şeması değişse de (ör. hata penceresinde yapılmış yayımlar) zincir
 * ilk yayımdaki değerlere geri bağlanır.
 */
export function buildSourceLockIndex(versions: readonly (readonly Criterion[])[]): SourceLockIndex {
  const index: SourceLockIndex = {
    byId: new Map(),
    bySourceId: new Map(),
    byQuote: new Map(),
    entries: [],
  };
  for (const version of versions) {
    // Aynı sürümdeki iki FARKLI kriter tek girdiye bağlanamaz: takma ad
    // yalnızca sürümler ARASI kimlik değişimini köprüler. Aksi hâlde aynı
    // sourceId'yi paylaşan iki kriter tek kilide çöker ve biri kaybolurdu.
    const claimed = new Set<SourceLock>();
    for (const item of version ?? []) {
      if (!item || typeof item.id !== "string" || !item.id) continue;
      let existing = index.byId.get(item.id) ?? null;
      if (!existing) {
        const fallback = resolveFallback(index, item);
        if (fallback && !claimed.has(fallback)) existing = fallback;
      }
      if (existing) {
        claimed.add(existing);
        registerKeys(index, item, existing);
        continue;
      }
      const sourceIds = Array.isArray(item.sourceIds)
        ? item.sourceIds.filter((value): value is string => typeof value === "string")
        : [];
      const entry: SourceLock = {
        name: typeof item.name === "string" ? item.name : "",
        sourcePage: typeof item.sourcePage === "number" ? item.sourcePage : null,
        sourceText: typeof item.sourceText === "string" ? item.sourceText : "",
        sourceId: typeof item.sourceId === "string" && item.sourceId !== "" ? item.sourceId : null,
        sourceIds,
        origin: item.origin === "manager" ? "manager" : "document",
        hasStructuredSource: (typeof item.sourceId === "string" && item.sourceId !== "") || sourceIds.length > 0,
      };
      index.entries.push(entry);
      claimed.add(entry);
      registerKeys(index, item, entry);
    }
  }
  return index;
}

/**
 * Kilitli kaynak alanlarını geri yazar; değiştirilmeye çalışılan kriterleri
 * (`reverted`) ve hiçbir gelen kriterle eşleşmeyen belge kaynaklı kilitleri
 * (`orphaned`) bildirir. Eski şekilli kilitlerde (hasStructuredSource=false)
 * sourceId/sourceIds ZORLANMAZ: yeniden analizin ürettiği sunucu türevi blok
 * kimlikleri ("Kaynak Satıra Git" verisi) korunur.
 */
export function applySourceLock(
  criteria: Criterion[],
  lock: SourceLockIndex,
): { criteria: Criterion[]; reverted: string[]; orphaned: string[] } {
  const reverted: string[] = [];
  const matched = new Set<SourceLock>();
  const next = criteria.map((item) => {
    const locked = resolveEntry(lock, item);
    if (!locked) return item;
    matched.add(locked);
    const changed = (item.sourcePage ?? null) !== locked.sourcePage
      || (item.sourceText ?? "") !== locked.sourceText
      || item.origin !== locked.origin
      || (locked.hasStructuredSource && (
        (item.sourceId ?? null) !== locked.sourceId
        || JSON.stringify(item.sourceIds ?? []) !== JSON.stringify(locked.sourceIds)
      ));
    if (!changed) return item;
    reverted.push(item.name);
    return {
      ...item,
      sourcePage: locked.sourcePage,
      sourceText: locked.sourceText,
      origin: locked.origin,
      ...(locked.hasStructuredSource ? { sourceId: locked.sourceId, sourceIds: locked.sourceIds } : {}),
    };
  });
  // Yetimler: gerçek belge kaynağı olan (alıntısı ya da sayfası bulunan) ama bu
  // yayımda hiçbir kriterle eşleşmeyen kilitler. Manuel kriterin silinmesi
  // sessizdir; belge kaynaklı kriterin kaybı olarak raporlanır, asla sessizce düşmez.
  const orphaned = lock.entries
    .filter((entry) => !matched.has(entry) && (entry.sourceText !== "" || entry.sourcePage !== null))
    .map((entry) => entry.name);
  return { criteria: next, reverted, orphaned };
}
