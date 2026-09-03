/** Gerçek, ücretli Gemini denemesi yalnızca --live ile çalışır; profil yayımlamaz. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractPdfStructure } from '../app/lib/pdf-structure.ts';
import { selectCriteriaCandidates, formatCandidatesForLlm, CANDIDATE_SELECTOR_VERSION } from '../app/lib/criteria-candidates.ts';
import { EXTRACTION_SYSTEM_INSTRUCTION, EXTRACTION_PROMPT_VERSION, buildExtractionPrompt, extractionSchemaForCandidates, normalizeExtraction } from '../app/lib/criteria-extraction.ts';
import { runSingleGeneration } from '../app/lib/gemini-generation.ts';

if (!process.argv.includes('--live')) throw new Error('Ücretli API çağrısı için --live açıkça verilmelidir.');
try { process.loadEnvFile('.env.local'); } catch { /* CI ortam değişkenleri kullanılabilir. */ }
if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY bulunamadı.');
const option = name => { const i=process.argv.indexOf(name); return i>=0 ? process.argv[i+1] : undefined; };
const pdfPath=resolve(option('--pdf') || 'public/samples/2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf');
const output=resolve(option('--out') || 'outputs/criteria-benchmark');
const bytes=await readFile(pdfPath);
const structure=await extractPdfStructure(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const selection=selectCriteriaCandidates(structure.blocks);
const model=process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const override=(process.env.GEMINI_THINKING_LEVEL || '').toUpperCase();
const thinkingLevel=['LOW','MEDIUM','HIGH'].includes(override) ? override : structure.pageCount>=10 ? 'HIGH' : 'MEDIUM';
const context=structure.blocks.filter((block,index)=>index<10 || block.blockType==='HEADING' || block.pageNumber===structure.pageCount).slice(0,80).map(block=>`${block.sourceId} | s.${block.pageNumber} | ${block.blockType} | ${block.originalText}`).join('\n');
const prompt=buildExtractionPrompt({pageCount:structure.pageCount,totalBlocks:structure.blocks.length,candidateCount:selection.candidates.length,documentContext:context,candidatesText:formatCandidatesForLlm(selection.candidates)});
await mkdir(output,{recursive:true});
await writeFile(resolve(output,'input.json'),JSON.stringify({structure,selection,promptVersion:EXTRACTION_PROMPT_VERSION,selectorVersion:CANDIDATE_SELECTOR_VERSION},null,2));
console.log(JSON.stringify({model,thinkingLevel,pages:structure.pageCount,blocks:structure.blocks.length,candidates:selection.candidates.length,promptVersion:EXTRACTION_PROMPT_VERSION}));
const start=Date.now();
const outcome=await runSingleGeneration({apiKey:process.env.GEMINI_API_KEY,model,timeoutMs:150000,label:'criteria-benchmark',body:JSON.stringify({systemInstruction:{parts:[{text:EXTRACTION_SYSTEM_INSTRUCTION}]},contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0,topP:1,thinkingConfig:{thinkingLevel},maxOutputTokens:65536,responseMimeType:'application/json',responseJsonSchema:extractionSchemaForCandidates(selection.candidates.map(x=>x.block.sourceId))}})});
if (!outcome.ok) throw new Error(`Gemini isteği başarısız: ${outcome.status} ${outcome.detail}`);
const candidate=outcome.payload.candidates?.[0];
if (candidate?.finishReason==='MAX_TOKENS') throw new Error('Model çıktısı token sınırında kesildi.');
const raw=JSON.parse(candidate?.content?.parts?.filter(x=>!x.thought).map(x=>x.text || '').join('') || 'null');
if (!raw || !Array.isArray(raw.decisions)) throw new Error('Geçerli aday kararları alınamadı.');
const normalized=normalizeExtraction(raw,structure.pageCount,structure.blocks,new Set(selection.candidates.map(x=>x.block.sourceId)));
const report={pdfPath,promptVersion:EXTRACTION_PROMPT_VERSION,selectorVersion:CANDIDATE_SELECTOR_VERSION,model,thinkingLevel,seconds:Math.round((Date.now()-start)/1000),apiCalls:outcome.apiCalls,usage:outcome.payload.usageMetadata,selection:selection.diagnostics,rawCriteria:raw.decisions.filter(x=>x.result==='KRITER').length,...normalized};
await writeFile(resolve(output,'raw.json'),JSON.stringify(raw,null,2));
await writeFile(resolve(output,'result.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,criteria:report.criteria.map(x=>({name:x.name,stage:x.stage,source:x.sourceId,verifiability:x.verifiability,description:x.description}))},null,2));
if (normalized.stats.unansweredCandidates || normalized.stats.rejectedSources) process.exitCode=1;
