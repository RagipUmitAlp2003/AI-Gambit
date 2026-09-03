/**
 * UCUZ SİNYALLİ ADAY DARALTMA (GÖREV 3 · madde 8) birim testleri — ağ yok.
 *
 *   - İşaret izi deterministiktir ve Hamming uzaklığı simetriktir.
 *   - Yüksek kosinüslü (yeniden yazım benzeri) çiftler kapıdan geçer;
 *     alakasız (dik) vektörler elenir → pahalı kosinüs hiç hesaplanmaz.
 *   - İz eksikse kapı AÇIK kalır: hiçbir eski kayıt karşılaştırma dışı kalmaz
 *     ve daraltmasız sonuçla birebir aynı sonuç üretilir (gerileme korkuluğu).
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SKETCH_BITS,
  SKETCH_MAX_HAMMING,
  embeddingSketch,
  planBatches,
  semanticCandidateAllowed,
  sketchHamming,
} from "../app/lib/similarity-candidates.ts";
import { cosineSimilarity } from "../app/lib/similarity-engine.ts";
import {
  approximateReportSimilarity,
  chunkMinHash,
  type PeerChunk,
  type ScoredChunk,
} from "../app/lib/similarity-text.ts";

/** Deterministik sahte vektör (birim normlu değil; iz açıyı normdan bağımsız ölçer). */
function vector(seed: number, dimensions = 768): number[] {
  const values: number[] = [];
  let state = seed | 0 || 1;
  for (let index = 0; index < dimensions; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    values.push(((state >>> 8) / 0x7fffff) - 1);
  }
  return values;
}

/** Vektöre kontrollü gürültü ekler: yüksek kosinüslü "yeniden yazım" benzeri eş. */
function paraphraseOf(base: number[], noise: number, seed = 97): number[] {
  const jitter = vector(seed, base.length);
  return base.map((value, index) => value + jitter[index] * noise);
}

test("işaret izi deterministiktir: aynı vektör her koşuda aynı izi üretir", () => {
  const v = vector(42);
  const first = embeddingSketch(v);
  const second = embeddingSketch([...v]);
  assert.ok(first && /^[0-9a-f]{16}$/.test(first), "İz 16 karakter hex olmalıdır.");
  assert.equal(first, second);
  assert.equal(embeddingSketch([]), null);
  assert.equal(embeddingSketch(null), null);
  assert.equal(embeddingSketch([1, Number.NaN]), null, "Sonlu olmayan bileşen iz üretmemelidir.");
});

test("Hamming uzaklığı simetriktir ve öz uzaklık sıfırdır", () => {
  const left = embeddingSketch(vector(7))!;
  const right = embeddingSketch(vector(1907))!;
  assert.equal(sketchHamming(left, left), 0);
  assert.equal(sketchHamming(left, right), sketchHamming(right, left));
  assert.ok(sketchHamming(left, right) <= SKETCH_BITS);
  assert.equal(sketchHamming("bozuk", right), SKETCH_BITS, "Biçimsiz iz 'uzak' sayılmalıdır.");
});

test("yeniden yazım benzeri (yüksek kosinüs) çift kapıdan geçer; alakasız çift elenir", () => {
  const base = vector(11);
  const paraphrase = paraphraseOf(base, 0.35);
  const unrelated = vector(5011);
  const cosClose = cosineSimilarity(base, paraphrase)!;
  const cosFar = cosineSimilarity(base, unrelated)!;
  assert.ok(cosClose >= 0.82, `Test kurgusu: yakın çift kosinüsü ${cosClose.toFixed(3)} >= 0.82 olmalı.`);
  assert.ok(cosFar < 0.3, `Test kurgusu: alakasız çift kosinüsü ${cosFar.toFixed(3)} < 0.3 olmalı.`);
  const sBase = embeddingSketch(base)!;
  const sPara = embeddingSketch(paraphrase)!;
  const sFar = embeddingSketch(unrelated)!;
  assert.ok(sketchHamming(sBase, sPara) <= SKETCH_MAX_HAMMING,
    `Yakın çift iz uzaklığı ${sketchHamming(sBase, sPara)} kapının içinde kalmalıdır.`);
  assert.ok(sketchHamming(sBase, sFar) > SKETCH_MAX_HAMMING,
    `Alakasız çift iz uzaklığı ${sketchHamming(sBase, sFar)} kapıyı geçmemelidir.`);
  assert.equal(semanticCandidateAllowed(sBase, sPara), true);
  assert.equal(semanticCandidateAllowed(sBase, sFar), false);
});

test("iz eksikse kapı açık kalır (eski kayıtlar karşılaştırma dışı kalamaz)", () => {
  const sketch = embeddingSketch(vector(3))!;
  assert.equal(semanticCandidateAllowed(null, sketch), true);
  assert.equal(semanticCandidateAllowed(sketch, undefined), true);
  assert.equal(semanticCandidateAllowed("gecersiz", sketch), true);
});

test("planBatches parti boyutunu uygular ve sırayı korur", () => {
  const items = ["a", "b", "c", "d", "e"];
  assert.deepEqual(planBatches(items, 2), [["a", "b"], ["c", "d"], ["e"]]);
  assert.deepEqual(planBatches([], 10), []);
  assert.deepEqual(planBatches(items, 0), [["a"], ["b"], ["c"], ["d"], ["e"]], "Geçersiz boyut 1'e düşmelidir.");
});

/* --------- Gerileme korkuluğu: daraltma sonucu DEĞİŞTİRMEZ, yalnız hızlandırır --------- */

function ownChunk(index: number, text: string, embedding: number[] | null, sketch?: string | null): ScoredChunk {
  return {
    index, wordCount: text.split(" ").length, pageStart: index + 1, text,
    minHash: chunkMinHash(text), embedding, template: false, wordStart: index * 200,
    features: { rare: [1000 + index, 2000 + index, 3000 + index], nums: ["450newton", "3.2saniye"] },
    sketch,
  };
}

function peerChunk(index: number, text: string, embedding: number[] | null, sketch?: string | null): PeerChunk {
  return {
    index, wordCount: text.split(" ").length, pageStart: index + 1,
    minHash: chunkMinHash(text), embedding, template: false, wordStart: index * 200,
    features: { rare: [1000 + index, 2000 + index, 3000 + index], nums: ["450newton", "3.2saniye"] },
    sketch,
  };
}

function distinctText(seed: string, words = 150): string {
  const vocabulary = Array.from({ length: 45 }, (_, i) => `${seed}terim${i}`);
  return Array.from({ length: words }, (_, i) => vocabulary[(i * 11 + (i % 7)) % vocabulary.length]).join(" ");
}

test("izli daraltılmış tarama, izsiz tam taramayla AYNI raporu üretir (yakın çiftlerde)", () => {
  const base = vector(21);
  const paraphrase = paraphraseOf(base, 0.3);
  const farA = vector(9001);
  const farB = vector(9002);
  const ownTexts = [distinctText("kendi1"), distinctText("kendi2")];
  const peerTexts = [distinctText("es1"), distinctText("es2")];
  const ownVectors = [base, farA];
  const peerVectors = [paraphrase, farB];

  const fullOwn = ownTexts.map((text, i) => ownChunk(i, text, ownVectors[i], null));
  const fullPeer = peerTexts.map((text, i) => peerChunk(i, text, peerVectors[i], null));
  const narrowedOwn = ownTexts.map((text, i) => ownChunk(i, text, ownVectors[i], embeddingSketch(ownVectors[i])));
  const narrowedPeer = peerTexts.map((text, i) => peerChunk(i, text, peerVectors[i], embeddingSketch(peerVectors[i])));

  const full = approximateReportSimilarity(fullOwn, fullPeer);
  const narrowed = approximateReportSimilarity(narrowedOwn, narrowedPeer);
  assert.equal(narrowed.approxPercent, full.approxPercent);
  assert.equal(narrowed.matchedWords, full.matchedWords);
  assert.deepEqual(
    narrowed.matches.map((m) => [m.ownIndex, m.peerIndex, m.kind]),
    full.matches.map((m) => [m.ownIndex, m.peerIndex, m.kind]),
  );
  assert.ok(full.matches.length >= 1, "Test kurgusu: yakın çift eşleşme üretmelidir.");
});
