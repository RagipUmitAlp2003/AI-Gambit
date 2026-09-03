import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { criteriaContentHash, criteriaHash, legacyCriteriaHash } from "../app/lib/criteria-hash.ts";
import type { Criterion } from "../app/lib/types.ts";

/**
 * Kriter özet formüllerinin regresyon testleri.
 *
 * `legacyCriteriaHash`, commit ac3b3fc'deki formülün BİREBİR yeniden kurulumudur
 * ve yalnızca eead40e öncesi sürüm satırlarını tanımak için vardır. Altın sabit,
 * ac3b3fc'deki kodun kendisi çalıştırılarak üretildi (uygulamadan değil); formül
 * yanlışlıkla değişirse bu dosya kırılır — istenen davranış budur.
 */

/** eead40e ÖNCESİ şekilli kriterler: controlType/sourceId/sourceIds YOK. */
const legacyFixture: Criterion[] = [
  {
    id: "criterion-1",
    name: "Rapor dili Türkçe",
    stage: "language_template",
    required: true,
    description: "Rapor Türkçe yazılmalıdır; şartname dili esastır.",
    violationOutcome: "Değerlendirmeye alınmaz.",
    sourcePage: 2,
    sourceText: "Yarışma raporu Türkçe hazırlanır.",
    verifiability: "PDF_DENETLENEBILIR",
    active: true,
    origin: "document",
  },
  {
    id: "criterion-2",
    name: "Güvenlik önlemleri",
    stage: "criteria_evidence",
    required: false,
    description: "Acil durdurma düğmesi ve sigorta raporda gösterilmelidir.",
    violationOutcome: "Belgede belirtilmemiş",
    sourcePage: null,
    sourceText: "",
    verifiability: "HAKEM_KONTROLU_GEREKLI",
    active: false,
    origin: "manager",
  },
  {
    id: "criterion-3",
    name: "Özgünlük oranı",
    stage: "category_similarity",
    required: true,
    description: "Rapor özgün olmalı; benzerlik %30'u aşmamalıdır.",
    violationOutcome: "Revizyon istenir; ısrar hâlinde elenir.",
    sourcePage: 7,
    sourceText: "Benzerlik oranı %30 üzeri raporlar değerlendirme dışıdır.",
    verifiability: "PDF_DENETLENEBILIR",
    active: true,
    origin: "document",
  },
];

/**
 * scratchpad/golden-legacy-hash.mjs: ac3b3fc:app/lib/workflow-db.ts içindeki
 * criteriaHash kopyalanıp yukarıdaki fixture üzerinde çalıştırıldı.
 */
const LEGACY_GOLDEN = "b3db37fcb40de3cfd204554c11cb27f3a3f59f9dbdebd2ff56ab1c512a899725";

const patchFirst = (patch: Partial<Criterion>): Criterion[] =>
  legacyFixture.map((item, index) => (index === 0 ? { ...item, ...patch } : item));

test("eski formül altın özeti sabittir", async () => {
  assert.equal(await legacyCriteriaHash(legacyFixture), LEGACY_GOLDEN);
});

test("eski ve yeni formül aynı içerik için farklı özet üretir", async () => {
  const oldHash = await legacyCriteriaHash(legacyFixture);
  const newHash = await criteriaHash(legacyFixture);
  assert.match(oldHash, /^[0-9a-f]{64}$/);
  assert.match(newHash, /^[0-9a-f]{64}$/);
  assert.notEqual(oldHash, newHash);
});

test("violationOutcome yeni özete girmez, eski özete girer", async () => {
  const changed = patchFirst({ violationOutcome: "Elenir." });
  assert.equal(await criteriaHash(changed), await criteriaHash(legacyFixture));
  assert.notEqual(await legacyCriteriaHash(changed), await legacyCriteriaHash(legacyFixture));
  // Array.prototype.join undefined değeri "" yazar; eski kod da böyle davranıyordu.
  assert.equal(
    await legacyCriteriaHash(patchFirst({ violationOutcome: undefined })),
    await legacyCriteriaHash(patchFirst({ violationOutcome: "" })),
  );
});

test("controlType/sourceId/sourceIds eski özete girmez, yeni özete girer", async () => {
  const withControl = patchFirst({ controlType: "ICERIK_VARLIGI" });
  assert.equal(await legacyCriteriaHash(withControl), await legacyCriteriaHash(legacyFixture));
  assert.notEqual(await criteriaHash(withControl), await criteriaHash(legacyFixture));

  const withSourceIds = patchFirst({ sourceIds: ["sayfa-02-madde-1"] });
  assert.equal(await legacyCriteriaHash(withSourceIds), await legacyCriteriaHash(legacyFixture));
  assert.notEqual(await criteriaHash(withSourceIds), await criteriaHash(legacyFixture));

  // Yokluk ile boş değer aynı özeti üretmelidir (kilit sourceId'yi null'a,
  // sourceIds'i []'ye çevirir; bu, saklanan "alan yok" hâliyle özdeş kalmalı).
  const absent = legacyFixture;
  const empty = patchFirst({ sourceId: null, sourceIds: [] });
  assert.equal(await criteriaHash(empty), await criteriaHash(absent));
  assert.equal(await legacyCriteriaHash(empty), await legacyCriteriaHash(absent));
});

test("içerik kimliği: yok olan controlType aşama varsayılanına eşit sayılır", async () => {
  /*
   * Saklanmış eski satırlar controlType olmadan yazıldı; profil yükleyicisi
   * artık her kriterde aşama varsayılanını dolduruyor. Ham özet bu iki
   * eşdeğer hâli ayırır (sahte sürümün kök nedeni); kanonik özet eşitler.
   * Aşama varsayılanları: language_template/criteria_evidence → KANIT_KONTROLU,
   * category_similarity → ANLAMSAL_UYGUNLUK (bkz. defaultControlTypeForStage).
   */
  const defaults: Record<string, Criterion["controlType"]> = {
    language_template: "KANIT_KONTROLU",
    criteria_evidence: "KANIT_KONTROLU",
    category_similarity: "ANLAMSAL_UYGUNLUK",
  };
  const incoming = legacyFixture.map((item) => ({ ...item, controlType: defaults[item.stage] }));
  assert.notEqual(await criteriaHash(incoming), await criteriaHash(legacyFixture));
  assert.equal(await criteriaContentHash(incoming), await criteriaContentHash(legacyFixture));
});

test("içerik kimliği: açıkça farklı controlType gerçek değişikliktir", async () => {
  const base = patchFirst({ stage: "headings_content", controlType: "ICERIK_VARLIGI" });
  const changed = patchFirst({ stage: "headings_content", controlType: "BIREBIR_BASLIK" });
  assert.notEqual(await criteriaContentHash(changed), await criteriaContentHash(base));
  // Varsayılana eşit açık değer ile alan yokluğu aynı kimliktir.
  const absent = patchFirst({ stage: "headings_content" });
  assert.equal(await criteriaContentHash(base), await criteriaContentHash(absent));
});

test("özet kriter sırasından bağımsızdır", async () => {
  const reversed = [...legacyFixture].reverse();
  assert.equal(await criteriaHash(reversed), await criteriaHash(legacyFixture));
  assert.equal(await legacyCriteriaHash(reversed), await legacyCriteriaHash(legacyFixture));
});

test("criteria_json gidiş-dönüşü özeti değiştirmez", async () => {
  // Yayım yolu tam olarak bunu yapar: hash'lenen dizi JSON olarak saklanır.
  // Geriye uyumluluk dalı bu değişmeze dayanır.
  const roundTrip = JSON.parse(JSON.stringify(legacyFixture)) as Criterion[];
  assert.equal(await legacyCriteriaHash(roundTrip), await legacyCriteriaHash(legacyFixture));
  assert.equal(await criteriaHash(roundTrip), await criteriaHash(legacyFixture));
});

/* --------------------------------------------------------------------- *
 * Yayım yolu kaynak denetimi: workflow-db.ts `cloudflare:workers` içe
 * aktardığı için doğrudan yüklenemez; geriye uyumluluk dalı kaynak metin
 * üzerinden doğrulanır (tools/authorization.test.ts ile aynı yaklaşım).
 * --------------------------------------------------------------------- */

const WORKFLOW_DB = readFileSync("app/lib/workflow-db.ts", "utf8");

test("yayım, içerik kimliğini kanonik özetle karşılaştırır ve sahte sürüm açmaz", () => {
  const start = WORKFLOW_DB.indexOf("async function publishCriteriaVersion");
  assert.ok(start > 0, "publishCriteriaVersion bulunmalı.");
  const body = WORKFLOW_DB.slice(start, WORKFLOW_DB.indexOf("\nexport ", start));
  // İçerik kimliği İKİ TARAFTA DA kanonik özetle (criteriaContentHash)
  // karşılaştırılır: eski formüllü satırları VE controlType'sız saklanmış
  // satırları aynı anda kapsar (yok olan controlType == aşama varsayılanı).
  assert.match(
    body,
    /criteriaContentHash\(stored\)\) === \(await criteriaContentHash\(input\.criteria\)\)/,
    "İçerik kimliği iki tarafta da kanonik özetle (criteriaContentHash) karşılaştırılmalıdır.",
  );
  assert.match(
    body,
    /parseJson<Criterion\[\]>\(latest\.criteria_json\)/,
    "Doğrulama, satırda saklanan criteria_json üzerinden yapılmalıdır.",
  );
  // Her iki değişmedi-yolu da mevcut sürümü döndürür, yeni satır açmaz.
  const dedupeReturns = body.match(/created: false/g) ?? [];
  assert.ok(dedupeReturns.length >= 2, "Hem hızlı yol hem geriye uyumluluk dalı created: false dönmelidir.");
  // Sahiplik koşulu her iki dalı da sarmalıdır: başka profilin sürümü yeniden kullanılamaz.
  assert.match(
    body,
    /latest\.criteria_profile_id === input\.profileId\) \{/,
    "Sürüm yeniden kullanımı profil sahipliği koşuluna bağlı kalmalıdır.",
  );
  // Yeni satır her zaman YENİ formül özetiyle yazılır.
  assert.match(body, /const hash = await criteriaHash\(input\.criteria\);/, "Özet yeni formülle hesaplanmalıdır.");
  assert.match(body, /INSERT INTO criteria_profile_versions/, "Değişen içerik yeni satır açmalıdır.");
});

test("criteriaHash dışa aktarımı saf modülden yeniden yayımlanır", () => {
  assert.match(
    WORKFLOW_DB,
    /export \{ criteriaHash \} from "\.\/criteria-hash";/,
    "workflow-db, criteriaHash'i ./criteria-hash modülünden yeniden dışa aktarmalıdır.",
  );
});
