import assert from "node:assert/strict";
import { test } from "node:test";
import { sameCriterionCandidate } from "../app/lib/criterion-dedupe.ts";

test("denetim tekrarı: farklı başlıklı aynı kaynak kuralı tek kriter sayılır", () => {
  assert.equal(sameCriterionCandidate(
    {
      name: "Teknik rapor sayfa sınırı",
      sourcePage: 10,
      sourceText: "Teknik rapor en fazla 10 sayfa olacaktır.",
      effect: "gate",
    },
    {
      name: "Rapor uzunluğu",
      sourcePage: 10,
      sourceText: "Teknik rapor en fazla 10 sayfa olacaktır; aşan rapor değerlendirmeye alınmaz.",
      effect: "gate",
    },
  ), true);
});

test("aynı sayfadaki farklı sayısal eşikler yanlışlıkla birleştirilmez", () => {
  assert.equal(sameCriterionCandidate(
    { name: "Dosya boyutu", sourcePage: 4, sourceText: "Dosya en fazla 10 MB olabilir.", effect: "gate" },
    { name: "Ek dosya boyutu", sourcePage: 4, sourceText: "Ek dosya en fazla 25 MB olabilir.", effect: "gate" },
  ), false);
});

test("denetim tekrarı: aynı sayfadaki farklı etki türleri birleştirilmez", () => {
  assert.equal(sameCriterionCandidate(
    { name: "Aşama 1 barajı", sourcePage: 19, sourceText: "En az 50 puan gerekir.", effect: "threshold" },
    { name: "Aşama 1 cezası", sourcePage: 19, sourceText: "En az 50 puan gerekir.", effect: "penalty" },
  ), false);
});

test("denetim tekrarı: aynı metin farklı sayfadaysa ayrı kalır", () => {
  assert.equal(sameCriterionCandidate(
    { name: "Güvenlik onayı", sourcePage: 13, sourceText: "Hakem onayı gerekir.", effect: "gate" },
    { name: "Güvenlik onayı", sourcePage: 17, sourceText: "Hakem onayı gerekir.", effect: "gate" },
  ), false);
});
