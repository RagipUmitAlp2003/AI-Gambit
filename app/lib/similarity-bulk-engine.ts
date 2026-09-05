import { cosineSimilarity } from "./similarity-engine";
import { approximateReportSimilarity, comparableWordUnion, type ScoredChunk } from "./similarity-text";
import type { SimilarityThresholds } from "./similarity-config";
import type { SimilarityChunkFeatures } from "./similarity-corroboration";

/** Compact screening metadata, not a report-similarity percentage. */
export type DocumentSummary = {
 pdfHash: string; textKey: string; centroid: number[] | null; signatures: number[][]; hashes: string[];
 features: SimilarityChunkFeatures[]; words: number; truncatedBlocks: number;
};
export function summarizeChunks(chunks: ScoredChunk[], hashes: string[]): DocumentSummary {
 const content = chunks.filter((chunk) => !chunk.template);
 const vectors = content.filter((chunk) => chunk.embedding?.length);
 let centroid: number[] | null = null;
 if (vectors.length) {
   const dim = vectors[0].embedding!.length;
   centroid = Array.from({ length: dim }, (_, index) =>
     vectors.reduce((sum, chunk) => sum + (chunk.embedding?.[index] ?? 0) * chunk.wordCount, 0));
   const norm = Math.hypot(...centroid);
   centroid = norm ? centroid.map((value) => Math.round(value / norm * 100000) / 100000) : null;
 }
 return { pdfHash:"", textKey:"", centroid, signatures: content.map((chunk) => chunk.minHash),
   hashes: chunks.flatMap((chunk, index) => !chunk.template && hashes[index] ? [hashes[index]] : []),
   features: content.flatMap((chunk) => chunk.features ? [chunk.features] : []),
   words: comparableWordUnion(content), truncatedBlocks: 0 };
}
export type ScreeningDocument = { id: string; participantId: string | null; summary: DocumentSummary };
export function candidatePairs(documents: ScreeningDocument[], topK = 5) {
 const docs = [...documents].sort((a,b) => a.id.localeCompare(b.id));
 const selected = new Map<string, [string,string]>();
 const ranks = new Map<string, Array<{ left: string; right: string; semantic: number; lexical: number }>>();
 let possiblePairs = 0;
 for (let i=0;i<docs.length;i++) for (let j=i+1;j<docs.length;j++) {
   const left=docs[i],right=docs[j];
   if (left.participantId && left.participantId === right.participantId) continue;
   possiblePairs++;
   let lexical = left.summary.hashes.some((hash) => right.summary.hashes.includes(hash)) ? 1 : 0;
   if (lexical < 1) {
     // Independent lexical channel retains local copies hidden by the document centroid.
     const bands = new Set(left.summary.signatures.flatMap(signature =>
       Array.from({length:Math.floor(signature.length/4)},(_,k) => k+":"+signature.slice(k*4,k*4+4).join(","))));
     for (const signature of right.summary.signatures) for (let k=0;k+3<signature.length;k+=4) {
       if (bands.has(k/4+":"+signature.slice(k,k+4).join(","))) lexical += 1;
     }
     lexical = lexical ? 0.5 + Math.min(lexical,100)/1000 : 0;
   }
   const semantic = cosineSimilarity(left.summary.centroid,right.summary.centroid) ?? -1;
   const pair={left:left.id,right:right.id,semantic,lexical};
   for (const id of [left.id,right.id]) ranks.set(id,[...(ranks.get(id)??[]),pair]);
   if (docs.length<=12 || lexical===1) selected.set(left.id+":"+right.id,[left.id,right.id]);
 }
 if(docs.length>12) for(const values of ranks.values()) {
   for (const field of ["semantic","lexical"] as const) {
     for(const pair of [...values].filter(p=>field==="semantic" || p.lexical>0)
       .sort((a,b)=>b[field]-a[field] || a.left.localeCompare(b.left) || a.right.localeCompare(b.right)).slice(0,topK)) {
       selected.set(pair.left+":"+pair.right,[pair.left,pair.right]);
     }
   }
 }
 return { pairs:[...selected.values()].sort((a,b)=>(a[0]+a[1]).localeCompare(b[0]+b[1])),
   possiblePairs, screened:docs.length>12 };
}
export function comparePair(left: ScoredChunk[], right: ScoredChunk[], thresholds: SimilarityThresholds) {
 const forward=approximateReportSimilarity(left,right,thresholds);
 const backward=approximateReportSimilarity(right,left,thresholds);
 const matches=forward.matches;
 return { percent:Math.round((forward.approxPercent+backward.approxPercent)/2),
   directCount:matches.filter(match=>match.kind==="direct").length,
   semanticCount:matches.filter(match=>match.kind==="semantic").length,
   matches:[...matches].sort((a,b)=>b.strength-a.strength || a.ownIndex-b.ownIndex).slice(0,3) };
}
