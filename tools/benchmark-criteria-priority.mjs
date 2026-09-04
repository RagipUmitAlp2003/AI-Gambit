/** Üretimle aynı çıkarım hattı; kullanıcı/başvuru/profil oluşturmaz, --live ücretli çağrı iznidir. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractPdfStructure } from '../app/lib/pdf-structure.ts';
import { selectCriteriaCandidates } from '../app/lib/criteria-candidates.ts';
import { normalizeExtraction } from '../app/lib/criteria-extraction.ts';
import { generatePrioritizedCriteria } from '../app/lib/criteria-priority.ts';
if (!process.argv.includes('--live')) throw new Error('Gerçek model çağrısı için --live gerekir.');
try { process.loadEnvFile('.env.local'); } catch { /* CI environment */ }
if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY bulunamadı.');
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const pdfPath = resolve(option('--pdf', 'output/pdf/official/2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf'));
const output = resolve(option('--out', 'outputs/criteria-priority-celikkubbe'));
const start = Date.now();
const bytes = await readFile(pdfPath);
const structure = await extractPdfStructure(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const selection = selectCriteriaCandidates(structure.blocks);
console.log(JSON.stringify({ pages: structure.pageCount, candidates: selection.candidates.length, extractionMs: Date.now() - start }));
const result = await generatePrioritizedCriteria({ apiKey: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview', structure, selection });
const normalized = result.ok ? normalizeExtraction(result.raw, structure.pageCount, structure.blocks,
  new Set(selection.candidates.map(item => item.block.sourceId))) : null;
const report = { seconds: (Date.now() - start) / 1000, pdfPath, ...result, normalized };
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: result.ok, seconds: report.seconds, apiCalls: result.apiCalls,
  usage: result.usage, detail: result.ok ? undefined : result.detail, stats: normalized?.stats,
  criteria: normalized?.criteria.map(item => ({ name: item.name, stage: item.stage, page: item.sourcePage })),
  warnings: normalized?.warnings }, null, 2));
if (!result.ok || normalized?.stats.unansweredCandidates || !normalized?.criteria.length) process.exitCode = 1;
