import assert from "node:assert/strict";
import test from "node:test";
import { applySourceLock, buildSourceLockIndex } from "../app/lib/source-lock.ts";
import type { Criterion } from "../app/lib/types.ts";

/**
 * Kaynak kilidi eşleştirme testleri (madde 12).
 *
 * Kilit eskiden yalnızca `criterion.id` ile eşleşiyordu; kimlik şeması
 * değişince (konumsal `criterion-N` → içerik türevi kararlı kimlik) bütün
 * profil kilitsiz yayımlanıyordu. Bu testler id → sourceId → alıntı sıralı
 * eşleştirmeyi ve eski şekilli (sourceId'siz) satırlarla geriye uyumluluğu
 * sabitler.
 */

const criterion = (patch: Partial<Criterion> & Pick<Criterion, "id" | "name">): Criterion => ({
  stage: "criteria_evidence",
  required: true,
  description: "Açıklama.",
  sourcePage: 2,
  sourceText: "Şartname alıntısı.",
  verifiability: "PDF_DENETLENEBILIR",
  active: true,
  origin: "document",
  ...patch,
});

/** eead40e öncesi satır şekli: sourceId/sourceIds/controlType alanları hiç yok. */
const oldShape = (patch: Partial<Criterion> & Pick<Criterion, "id" | "name">): Criterion =>
  criterion({ violationOutcome: "Belgede belirtilmemiş", ...patch });

test("eski kilit + aynı id: kurcalanan kaynak geri alınır", () => {
  const lock = buildSourceLockIndex([[
    oldShape({ id: "criterion-1", name: "Rapor dili Türkçe", sourcePage: 2, sourceText: "Rapor Türkçe hazırlanır." }),
    oldShape({ id: "criterion-2", name: "Giriş bölümü", sourcePage: 3, sourceText: "Rapor Giriş bölümü ile başlar." }),
  ]]);
  const incoming = [
    criterion({ id: "criterion-1", name: "Rapor dili Türkçe", sourcePage: 99, sourceText: "ELLE DEĞİŞTİRİLMİŞ ALINTI" }),
    criterion({ id: "criterion-2", name: "Giriş bölümü", sourcePage: 3, sourceText: "Rapor Giriş bölümü ile başlar." }),
  ];
  const result = applySourceLock(incoming, lock);
  assert.deepEqual(result.reverted, ["Rapor dili Türkçe"]);
  assert.equal(result.criteria[0].sourcePage, 2);
  assert.equal(result.criteria[0].sourceText, "Rapor Türkçe hazırlanır.");
  assert.deepEqual(result.orphaned, []);
});

test("id şeması değişimi: aynı alıntı, kurcalanan sayfa yakalanır", () => {
  // Kilit eski şekilli: sourceId verisi YOK (hasStructuredSource=false).
  const lock = buildSourceLockIndex([[
    oldShape({ id: "criterion-1", name: "Rapor dili", sourcePage: 2, sourceText: "Rapor Türkçe hazırlanır." }),
  ]]);
  // Yeniden analiz: kararlı kimlik + sunucu türevi yeni sourceId/sourceIds,
  // alıntı aynı, sayfa elle 99'a çekilmiş.
  const incoming = [criterion({
    id: "criterion-sayfa-02-madde-1-rapor-dili",
    name: "Rapor dili",
    sourcePage: 99,
    sourceText: "Rapor Türkçe hazırlanır.",
    sourceId: "sayfa-02-madde-1",
    sourceIds: ["sayfa-02-madde-1"],
  })];
  const result = applySourceLock(incoming, lock);
  assert.deepEqual(result.reverted, ["Rapor dili"]);
  assert.equal(result.criteria[0].sourcePage, 2, "Alıntı eşleşmesi sayfayı ilk yayımdaki değere döndürmelidir.");
  // Eski şekilli kilit yeni yapısal kaynak kimliklerini SİLMEZ ("Kaynak Satıra Git" verisi korunur).
  assert.equal(result.criteria[0].sourceId, "sayfa-02-madde-1");
  assert.deepEqual(result.criteria[0].sourceIds, ["sayfa-02-madde-1"]);
  assert.deepEqual(result.orphaned, []);
});

test("id şeması değişimi: değişmeyen kaynak eşleşir, geri alma ve yetim yok", () => {
  const lock = buildSourceLockIndex([[
    oldShape({ id: "criterion-1", name: "Rapor dili", sourcePage: 2, sourceText: "Rapor Türkçe hazırlanır." }),
  ]]);
  const incoming = [criterion({
    id: "criterion-sayfa-02-madde-1-rapor-dili",
    name: "Rapor dili",
    sourcePage: 2,
    sourceText: "Rapor Türkçe hazırlanır.",
  })];
  const result = applySourceLock(incoming, lock);
  assert.deepEqual(result.reverted, []);
  assert.deepEqual(result.orphaned, []);
  assert.equal(result.criteria[0].id, "criterion-sayfa-02-madde-1-rapor-dili");
});

test("yeni biçim kilit: id değişse de sourceId yakalar", () => {
  const lock = buildSourceLockIndex([[
    criterion({
      id: "criterion-sayfa-03-madde-4-yapisal-analiz",
      name: "Yapısal analiz",
      sourcePage: 3,
      sourceText: "Yapısal analiz sonuçları raporda gösterilir.",
      sourceId: "SAYFA-03-MADDE-4",
      sourceIds: ["SAYFA-03-MADDE-4", "SAYFA-05-MADDE-2"],
    }),
  ]]);
  const incoming = [criterion({
    id: "criterion-farkli-kimlik",
    name: "Yapısal analiz",
    sourcePage: 3,
    sourceText: "KURCALANMIŞ ALINTI",
    sourceId: "SAYFA-03-MADDE-4",
    sourceIds: ["SAYFA-99-MADDE-9"],
  })];
  const result = applySourceLock(incoming, lock);
  assert.deepEqual(result.reverted, ["Yapısal analiz"]);
  assert.equal(result.criteria[0].sourceText, "Yapısal analiz sonuçları raporda gösterilir.");
  // Yapısal kaynağı OLAN kilit sourceId/sourceIds alanlarını da zorlar.
  assert.equal(result.criteria[0].sourceId, "SAYFA-03-MADDE-4");
  assert.deepEqual(result.criteria[0].sourceIds, ["SAYFA-03-MADDE-4", "SAYFA-05-MADDE-2"]);
});

test("aynı sourceId iki kriter: ad eşleşmesiyle ayrışır", () => {
  const lock = buildSourceLockIndex([[
    criterion({
      id: "criterion-a", name: "Ağırlık sınırı", sourcePage: 4,
      sourceText: "Araç ağırlığı 10 kg'ı aşamaz.", sourceId: "SAYFA-04-MADDE-2", sourceIds: ["SAYFA-04-MADDE-2"],
    }),
    criterion({
      id: "criterion-b", name: "Boyut sınırı", sourcePage: 4,
      sourceText: "Araç boyutları 50 cm'i aşamaz.", sourceId: "SAYFA-04-MADDE-2", sourceIds: ["SAYFA-04-MADDE-2"],
    }),
  ]]);
  // Ad eşleşmesi doğru kilidi seçer; alıntı kurcalanmış olsa bile.
  const matched = applySourceLock([criterion({
    id: "criterion-yeni-kimlik", name: "Ağırlık sınırı", sourcePage: 4,
    sourceText: "KURCALANMIŞ", sourceId: "SAYFA-04-MADDE-2", sourceIds: ["SAYFA-04-MADDE-2"],
  })], lock);
  assert.deepEqual(matched.reverted, ["Ağırlık sınırı"]);
  assert.equal(matched.criteria[0].sourceText, "Araç ağırlığı 10 kg'ı aşamaz.",
    "Kriter KENDİ kilidinin değerini almalı, diğerininkini değil.");

  // Ad, sayfa ve teklik ayrıştıramıyorsa eşleşme YAPILMAZ (yanlış bağlanmaz);
  // iki kilit de yetim sayılır.
  const ambiguous = applySourceLock([criterion({
    id: "criterion-belirsiz", name: "Bambaşka ad", sourcePage: 9,
    sourceText: "Bambaşka alıntı.", sourceId: "SAYFA-04-MADDE-2", sourceIds: ["SAYFA-04-MADDE-2"],
  })], lock);
  assert.deepEqual(ambiguous.reverted, []);
  assert.equal(ambiguous.criteria[0].sourceText, "Bambaşka alıntı.");
  assert.deepEqual([...ambiguous.orphaned].sort(), ["Ağırlık sınırı", "Boyut sınırı"]);
});

test("silinen belge kriteri yetim raporlanır, manuel kriter raporlanmaz", () => {
  const lock = buildSourceLockIndex([[
    oldShape({ id: "criterion-1", name: "Belge kriteri", sourcePage: 2, sourceText: "Belgeden alıntı." }),
    oldShape({
      id: "manual-1", name: "Manuel kriter", origin: "manager",
      sourcePage: null, sourceText: "",
    }),
  ]]);
  const incoming = [criterion({
    id: "criterion-yepyeni", name: "Yepyeni kural", sourcePage: 6, sourceText: "Yeni bir alıntı.",
  })];
  const result = applySourceLock(incoming, lock);
  assert.deepEqual(result.orphaned, ["Belge kriteri"], "Manuel kriterin silinmesi sessizdir; belge kriteri raporlanır.");
});

test("ilk sürüm kazanır: takma ad çözümü", () => {
  // v1 eski şekilli; v2 hata penceresinde yayımlanmış: aynı alıntı, kararlı
  // kimlik ve KURCALANMIŞ sayfa 9 ile. İndeks v2'nin anahtarlarını v1'in
  // girdisine takma ad olarak bağlamalıdır.
  const lock = buildSourceLockIndex([
    [oldShape({ id: "criterion-1", name: "Rapor dili", sourcePage: 2, sourceText: "Rapor Türkçe hazırlanır." })],
    [criterion({
      id: "criterion-sayfa-02-madde-1-rapor-dili", name: "Rapor dili",
      sourcePage: 9, sourceText: "Rapor Türkçe hazırlanır.",
    })],
  ]);
  const incoming = [criterion({
    id: "criterion-sayfa-02-madde-1-rapor-dili", name: "Rapor dili",
    sourcePage: 9, sourceText: "Rapor Türkçe hazırlanır.",
  })];
  const result = applySourceLock(incoming, lock);
  assert.deepEqual(result.reverted, ["Rapor dili"]);
  assert.equal(result.criteria[0].sourcePage, 2, "Kararlı kimlik İLK yayımdaki değere bağlanmalıdır, hata penceresindekine değil.");
  assert.deepEqual(result.orphaned, []);
});

test("boş indeks kimlik döndürür", () => {
  const lock = buildSourceLockIndex([]);
  const incoming = [criterion({ id: "criterion-1", name: "Kural", sourcePage: 5, sourceText: "Alıntı." })];
  const result = applySourceLock(incoming, lock);
  assert.deepEqual(result.criteria, incoming);
  assert.deepEqual(result.reverted, []);
  assert.deepEqual(result.orphaned, []);
});
