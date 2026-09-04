import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { generateCriteriaInBatches, generateCriteriaInPool, partitionCandidates, CRITERIA_BATCH_SIZE, CRITERIA_BATCH_CHARS,
  CRITERIA_REQUEST_TIMEOUT_MS, CRITERIA_MAX_OUTPUT_TOKENS_TOTAL, type CandidateInput } from "../app/lib/criteria-generation.ts";
import type { GenerationOutcome } from "../app/lib/gemini-generation.ts";

const inputs = (count: number): CandidateInput[] => Array.from({length:count}, (_,i)=>({sourceId:`S-${i}`,text:`Madde ${i}: Motor tasarımı ve aynı kaynak bağlamı.`}));
function response(group: readonly CandidateInput[], finishReason = "STOP", usage = 10): GenerationOutcome {
  return {ok:true,model:"test-model",apiCalls:1,payload:{
    candidates:[{finishReason,content:{parts:[{text:JSON.stringify({documentProfile:{competition:"Test"},
      decisions:group.map(item=>({sourceId:item.sourceId,result:"KAPSAM_DISI"}))})}]}}],
    usageMetadata:{promptTokenCount:usage,candidatesTokenCount:usage,thoughtsTokenCount:usage,totalTokenCount:usage*3},
  }};
}

test("yoğun kısa belge ve uzun belge sayfa sayısıyla değil aday/metin yüküyle bölünür; hiçbir metin kesilmez", () => {
  const candidates=inputs(129);
  candidates[7].text="X".repeat(CRITERIA_BATCH_CHARS+100);
  const groups=partitionCandidates(candidates);
  assert.deepEqual(groups.flat(),candidates);
  assert.ok(groups.every(group=>group.length<=CRITERIA_BATCH_SIZE));
  assert.ok(groups.some(group=>group.length===1&&group[0]===candidates[7]));
});

test("129 aday bütünüyle cevaplanır; toplam kriter sayısına kota konmaz", async () => {
  const candidates=inputs(129);
  const seen:string[]=[];
  const result=await generateCriteriaInBatches({candidates,generate:async group=>{
    seen.push(...group.map(item=>item.sourceId));return response(group);
  }});
  assert.equal(result.ok,true);
  assert.deepEqual(seen,candidates.map(item=>item.sourceId));
  assert.equal(result.apiCalls,6);
  assert.equal(result.usage.output,120);
  if(result.ok) assert.equal((result.raw.decisions as unknown[]).length,129);
});

test("MAX_TOKENS yalnızca başarısız grubu böler; kesik JSON kullanılmaz; bütün çağrılar sayılır", async () => {
  const visited:string[][]=[];
  const result=await generateCriteriaInBatches({candidates:inputs(30),generate:async group=>{
    visited.push(group.map(item=>item.sourceId));
    if(group.length>12) return {ok:true,model:"test-model",apiCalls:1,payload:{
      candidates:[{finishReason:"MAX_TOKENS",content:{parts:[{text:'{"broken":'}]}}],
      usageMetadata:{candidatesTokenCount:200,thoughtsTokenCount:50,totalTokenCount:300},
    }};
    return response(group);
  }});
  assert.equal(result.ok,true);
  assert.deepEqual(visited.map(group=>group.length),[24,6,12,12]);
  assert.equal(result.apiCalls,4);
  assert.equal(result.usage.output,310);
  if(result.ok) assert.equal((result.raw.decisions as unknown[]).length,30);
});

test("429/503 durumunda tekrar yok; başarılı önceki gruplar kısmi sonuç olarak dönmez", async () => {
  let calls=0;
  const result=await generateCriteriaInBatches({candidates:inputs(30),generate:async group=>{
    calls++;return calls===1?response(group):{ok:false,status:429,detail:"quota",model:"test-model",apiCalls:1};
  }});
  assert.equal(result.ok,false);assert.equal(calls,2);assert.equal(result.apiCalls,2);
  assert.equal(result.usage.output,20);assert.ok(!("raw" in result));
});

test("tek madde de taşarsa sonsuz bölme yoktur", async () => {
  const result=await generateCriteriaInBatches({candidates:inputs(1),generate:async group=>response(group,"MAX_TOKENS")});
  assert.equal(result.ok,false);assert.equal(result.apiCalls,1);
});

test("eksik karar, yabancı kimlik veya bitmemiş çıktı başarı olamaz", async () => {
  for(const mode of ["missing","foreign","safety"]) {
    const result=await generateCriteriaInBatches({candidates:inputs(2),generate:async group=>
      response(mode==="missing"?group.slice(0,1):mode==="foreign"?inputs(3):group,mode==="safety"?"SAFETY":"STOP")});
    assert.equal(result.ok,false,mode);assert.ok(!("raw" in result));
  }
});

test("belge süre kesmesi yok; her istekte sonlu ağ güvenliği ve çıktı bütçesi vardır", async () => {
  const timed=await generateCriteriaInBatches({candidates:inputs(30),generate:async (group, timeout)=>{
    assert.equal(timeout,CRITERIA_REQUEST_TIMEOUT_MS);return response(group);
  }});
  assert.equal(timed.ok,true);assert.equal(timed.apiCalls,2);
  const budgeted=await generateCriteriaInBatches({candidates:inputs(30),generate:async group=>response(group,"STOP",CRITERIA_MAX_OUTPUT_TOKENS_TOTAL)});
  assert.equal(budgeted.ok,false);assert.equal(budgeted.apiCalls,2);
});

test("en fazla iki çağrı aynı anda çalışır; ters bitiş sırası kaynak sırasını değiştirmez", async () => {
  const releases: Array<() => void> = [];
  let active=0; let peak=0;
  const run=generateCriteriaInBatches({candidates:inputs(48),generate:async group=>{
    active++;peak=Math.max(peak,active);
    await new Promise<void>(resolve=>releases.push(resolve));
    active--;
    return response(group);
  }});
  assert.equal(releases.length,2);
  releases[1]();releases[0]();
  const result=await run;
  assert.equal(peak,2);assert.equal(active,0);assert.equal(result.ok,true);
  if(result.ok) assert.deepEqual((result.raw.decisions as Array<{sourceId:string}>).map(item=>item.sourceId),inputs(48).map(item=>item.sourceId));
});

test("temel geçiş LOW, teknik üretim MEDIUM; eski HIGH ortam ayarı okunmaz", () => {
  const route=readFileSync("app/lib/criteria-priority.ts","utf8");
  assert.match(route,/CRITERIA_THINKING_LEVEL = "MEDIUM"/);
  assert.match(route,/CRITERIA_CORE_THINKING_LEVEL = "LOW"/);
  assert.match(route,/thinkingLevel: phase === "core" \? CRITERIA_CORE_THINKING_LEVEL : CRITERIA_THINKING_LEVEL/);
  assert.doesNotMatch(route,/process.env.GEMINI_THINKING_LEVEL|thinkingLevelFor\(/);
  assert.ok(CRITERIA_REQUEST_TIMEOUT_MS>80_000);
});

test("rotada tam kapsam kontrolü ve sürümlü önbellek korunur; hata kullanımı da kaydedilir", () => {
  const route=readFileSync("app/api/analyze/route.ts","utf8");
  assert.match(route,/generationVersion: CRITERIA_GENERATION_VERSION/);
  assert.match(route,/coverageCheck.stats.unansweredCandidates > 0/);
  assert.match(route,/generationUsage = generated.usage/);
  assert.ok(route.indexOf("generationUsage = generated.usage")<route.indexOf("if (!generated.ok)"));
  assert.match(readFileSync("app/lib/criteria-priority.ts","utf8"),/formatCandidatesForLlm\(\[candidate\]\)/);
});

test("iş havuzunda yavaş ilk grup sonraki grupları bekletmez; sonuç sırası korunur", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const seen: string[] = [];
  const pending = generateCriteriaInPool({ candidates: inputs(96), concurrency: 2, generate: async group => {
    seen.push(group[0].sourceId);
    if (group[0].sourceId === "S-0") await gate;
    return response(group);
  } });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(seen, ["S-0", "S-24", "S-48", "S-72"]);
  release();
  const result = await pending;
  assert.ok(result.ok);
  assert.equal(result.apiCalls, 4);
  assert.deepEqual((result.raw.decisions as Array<{sourceId:string}>).map(item => item.sourceId), inputs(96).map(item => item.sourceId));
});

test("iş havuzu hatada yeni grup başlatmaz; başlamış kardeşi bekler ve kullanımını sayar", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const pending = generateCriteriaInPool({ candidates: inputs(72), concurrency: 2, generate: async group => {
    calls += 1;
    if (group[0].sourceId === "S-0") return { ok: false, status: 503, model: "test", apiCalls: 1, detail: "busy" };
    await gate;
    return response(group);
  } });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  release();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.apiCalls, 2);
  assert.equal(result.usage.output, 20);
  assert.ok(!("raw" in result));
});
