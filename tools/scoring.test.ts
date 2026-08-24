/**
 * Puanlama ve kriter eşleştirme testleri.
 *
 * Çalıştırma (yeni bağımlılık yok, Node yerleşik test koşucusu ve tip
 * sıyırıcısı kullanılır):
 *   node --test tools/scoring.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPenalties,
  maxRawScoreOf,
  normalizeScoreDetailed,
  scopeCriteriaToGroups,
} from "../app/lib/evaluation-summary.ts";
import type { Criterion, ScoreGroup } from "../app/lib/types.ts";

function criterion(patch: Partial<Criterion> & { id: string }): Criterion {
  return {
    name: "Kriter",
    type: "qualitative_score",
    maxScore: null,
    weight: null,
    required: false,
    violationOutcome: "",
    evaluationMethod: "ai",
    sourcePage: 1,
    sourceText: "",
    aiInterpretation: "",
    confidence: "medium",
    active: true,
    origin: "document",
    effect: "score",
    ...patch,
  };
}

function group(patch: Partial<ScoreGroup> & { id: string }): ScoreGroup {
  return {
    name: "Grup",
    scope: "Genel",
    maxScore: 100,
    minimumScore: null,
    sourcePage: 1,
    sourceText: "",
    breakdown: [],
    ...patch,
  };
}

/* --------------------------------------------------------------------- *
 * Normalizasyon: 0–100 aralığı ve anomali tespiti
 * --------------------------------------------------------------------- */

test("normalize: 0 / 315 → 0", () => {
  const result = normalizeScoreDetailed(0, 315);
  assert.equal(result.value, 0);
  assert.equal(result.anomaly, null);
});

test("normalize: 157.5 / 315 → 50", () => {
  assert.equal(normalizeScoreDetailed(157.5, 315).value, 50);
});

test("normalize: 252 / 315 → 80", () => {
  const result = normalizeScoreDetailed(252, 315);
  assert.equal(result.value, 80);
  assert.equal(result.rawScore, 252);
  assert.equal(result.maxRawScore, 315);
  assert.equal(result.anomaly, null);
});

test("normalize: 315 / 315 → 100", () => {
  const result = normalizeScoreDetailed(315, 315);
  assert.equal(result.value, 100);
  assert.equal(result.anomaly, null);
});

test("normalize: 330 / 315 anomali olarak işaretlenir, sessizce kabul edilmez", () => {
  const result = normalizeScoreDetailed(330, 315);
  assert.equal(result.value, 100, "gösterim 100'ü aşmamalı");
  assert.notEqual(result.anomaly, null, "aralık dışı girdi anomali üretmeli");
  assert.match(result.anomaly!, /aşıyor/);
  // Ham değer korunur: hatanın kaynağı gizlenmez.
  assert.equal(result.rawScore, 330);
});

test("normalize: negatif ham puan anomali üretir ve 0'a sabitlenir", () => {
  const result = normalizeScoreDetailed(-5, 315);
  assert.equal(result.value, 0);
  assert.match(result.anomaly!, /negatif/);
});

test("normalize: maksimum ham puan 0 veya tanımsızsa anomali üretir", () => {
  assert.match(normalizeScoreDetailed(10, 0).anomaly!, /tanımlı değil/);
  assert.match(normalizeScoreDetailed(10, Number.NaN).anomaly!, /tanımlı değil/);
});

test("normalize: sonuç her zaman 0–100 aralığında kalır", () => {
  const cases: Array<[number, number]> = [[0, 315], [1, 315], [314, 315], [315, 315], [1000, 315], [-1000, 315]];
  for (const [raw, max] of cases) {
    const { value } = normalizeScoreDetailed(raw, max);
    assert.ok(value >= 0 && value <= 100, `${raw}/${max} → ${value} aralık dışı`);
  }
});

/* --------------------------------------------------------------------- *
 * Ceza uygulaması
 * --------------------------------------------------------------------- */

test("ceza: toplamdan düşülür ama sıfırın altına inmez", () => {
  assert.deepEqual(applyPenalties(100, 30), { finalRaw: 70, appliedPenalty: 30 });
  assert.deepEqual(applyPenalties(20, 50), { finalRaw: 0, appliedPenalty: 20 });
  assert.deepEqual(applyPenalties(100, 0), { finalRaw: 100, appliedPenalty: 0 });
  // Negatif ceza bir kazanca dönüşmez.
  assert.deepEqual(applyPenalties(100, -10), { finalRaw: 100, appliedPenalty: 0 });
});

/* --------------------------------------------------------------------- *
 * Maksimum ham puan: payda pay ile aynı kümeden gelir
 * --------------------------------------------------------------------- */

test("maxRawScoreOf: yalnızca aktif puan kriterlerini toplar", () => {
  const criteria = [
    criterion({ id: "c1", maxScore: 100, effect: "score" }),
    criterion({ id: "c2", maxScore: 150, effect: "score" }),
    criterion({ id: "c3", maxScore: 65, effect: "score", active: false }),
    criterion({ id: "c4", maxScore: 40, effect: "gate" }),
    criterion({ id: "c5", maxScore: null, effect: "score" }),
  ];
  assert.equal(maxRawScoreOf(criteria), 250);
});

/* --------------------------------------------------------------------- *
 * Kriter ↔ puan grubu eşleştirmesi: yalnızca kimlik, asla isim
 * --------------------------------------------------------------------- */

test("kapsam: aynı isimli iki grup birbirine karışmaz", () => {
  const groups = [
    group({ id: "group-1", name: "Teknik Tasarım", maxScore: 100, sourcePage: 4 }),
    group({ id: "group-2", name: "Teknik Tasarım", maxScore: 60, sourcePage: 11 }),
  ];
  const criteria = [
    criterion({ id: "c1", name: "Rapor", maxScore: 100, groupId: "group-1" }),
    criterion({ id: "c2", name: "Saha", maxScore: 60, groupId: "group-2" }),
  ];
  // Yalnızca ilk grup kapsamda: ikinci grubun kriteri pasifleşmeli.
  const scoped = scopeCriteriaToGroups(criteria, groups, new Set(["group-1"]));
  assert.equal(scoped.find((item) => item.id === "c1")!.active, true);
  assert.equal(scoped.find((item) => item.id === "c2")!.active, false);
  assert.equal(maxRawScoreOf(scoped), 100, "payda yalnızca kapsamdaki kriterden gelmeli");
});

test("kapsam: benzer isimli gruplar ayrı kalır", () => {
  const groups = [
    group({ id: "group-1", name: "Teknik Tasarım Puanı", maxScore: 100 }),
    group({ id: "group-2", name: "Teknik Tasarım", maxScore: 60 }),
  ];
  const criteria = [
    criterion({ id: "c1", maxScore: 100, groupId: "group-1" }),
    criterion({ id: "c2", maxScore: 60, groupId: "group-2" }),
  ];
  const scoped = scopeCriteriaToGroups(criteria, groups, new Set(["group-2"]));
  assert.equal(scoped.find((item) => item.id === "c1")!.active, false);
  assert.equal(scoped.find((item) => item.id === "c2")!.active, true);
});

test("kapsam: Türkçe karakterli isimler eşleştirmeyi etkilemez", () => {
  const groups = [
    group({ id: "group-1", name: "Şartname Uygunluğu", maxScore: 80 }),
    group({ id: "group-2", name: "ŞARTNAME UYGUNLUĞU", maxScore: 20 }),
  ];
  const criteria = [
    criterion({ id: "c1", maxScore: 80, groupId: "group-1" }),
    criterion({ id: "c2", maxScore: 20, groupId: "group-2" }),
  ];
  const scoped = scopeCriteriaToGroups(criteria, groups, new Set(["group-1"]));
  assert.equal(maxRawScoreOf(scoped), 80);
});

test("kapsam: kriter adı değişse bile doğru grup korunur", () => {
  const groups = [group({ id: "group-1", maxScore: 100 }), group({ id: "group-2", maxScore: 50 })];
  const renamed = [
    criterion({ id: "c1", name: "Tamamen farklı yeni ad", maxScore: 100, groupId: "group-1" }),
    criterion({ id: "c2", name: "Bir başka ad", maxScore: 50, groupId: "group-2" }),
  ];
  const scoped = scopeCriteriaToGroups(renamed, groups, new Set(["group-1"]));
  assert.equal(scoped.find((item) => item.id === "c1")!.active, true);
  assert.equal(scoped.find((item) => item.id === "c2")!.active, false);
});

test("kapsam: gruba bağlı olmayan kriterler sessizce düşürülmez", () => {
  const groups = [group({ id: "group-1", maxScore: 100 })];
  const criteria = [
    criterion({ id: "c1", maxScore: 100, groupId: "group-1" }),
    criterion({ id: "c2", maxScore: 25, groupId: null }),
  ];
  const scoped = scopeCriteriaToGroups(criteria, groups, new Set(["group-1"]));
  assert.equal(scoped.find((item) => item.id === "c2")!.active, true);
});

test("kapsam: kimliksiz eski analizlerde daraltma uygulanmaz", () => {
  const legacyGroups = [{ ...group({ id: "x" }), id: undefined } as ScoreGroup];
  const criteria = [criterion({ id: "c1", maxScore: 100 })];
  const scoped = scopeCriteriaToGroups(criteria, legacyGroups, new Set());
  assert.equal(scoped[0].active, true, "eski profillerde puan sessizce düşmemeli");
});

/* --------------------------------------------------------------------- *
 * Uçtan uca: kapsam daraltması normalize puanı 100'ün üstüne çıkarmamalı
 * --------------------------------------------------------------------- */

test("regresyon: daraltılmış kapsamda normalize puan 100'ü aşmaz", () => {
  // 315 puanlık şartname: Rapor 100 / Parkur 150 / Teknik 65.
  const groups = [
    group({ id: "group-1", name: "Rapor", maxScore: 100 }),
    group({ id: "group-2", name: "Parkur", maxScore: 150 }),
    group({ id: "group-3", name: "Teknik", maxScore: 65 }),
  ];
  const criteria = [
    criterion({ id: "c1", maxScore: 100, groupId: "group-1" }),
    criterion({ id: "c2", maxScore: 150, groupId: "group-2" }),
    criterion({ id: "c3", maxScore: 65, groupId: "group-3" }),
  ];
  // Görevli yalnızca "Rapor" grubunu kapsama alıyor.
  const scoped = scopeCriteriaToGroups(criteria, groups, new Set(["group-1"]));
  const maxRaw = maxRawScoreOf(scoped);
  assert.equal(maxRaw, 100);

  // Hakem yalnızca kapsamdaki kriterleri puanlayabilir: en fazla 100.
  const worstCaseRaw = scoped
    .filter((item) => item.active)
    .reduce((sum, item) => sum + (item.maxScore ?? 0), 0);
  const result = normalizeScoreDetailed(worstCaseRaw, maxRaw);
  assert.equal(result.value, 100);
  assert.equal(result.anomaly, null, "eski hatada 210/100 → anomali oluşuyordu");
});
