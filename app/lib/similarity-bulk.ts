import type { AdminAccount } from "./admin-types";
import {
 findCompetitionWorkflowById, findCurrentSimilarityTemplate, findStoredSimilarityChunks,
 listBulkSimilarityPool, reportBucket, workflowDatabase,
 rejectAcceptedApplicationForSimilarity,
} from "./workflow-db";
import { SIMILARITY_EMBEDDING_MODEL, SIMILARITY_PIPELINE_VERSION, isTemplateChunkHash, sha256Hex, type ScoredChunk } from "./similarity-text";
import { similarityLlmEnabled, similarityThresholds } from "./similarity-config";
import { poolFeatureCounts, stripPoolCommonFeatures } from "./similarity-corroboration";
import { candidatePairs, comparePair } from "./similarity-bulk-engine";
import {
 preparationKey, readPreparations, readBulkRun, startBulkRun, claimBulkRun, saveBulkRun, releaseBulkRun,
} from "./similarity-jobs";
import type { BulkOverview, BulkPair } from "./similarity-bulk-types";
import { explainSimilarityPairs } from "./similarity-llm";
import { recordUsage } from "./usage-metrics";

export class SimilarityAccessError extends Error {
 status:number;
 constructor(status:number,message:string) { super(message); this.status=status; }
}
export async function bulkContext(competitionId:string,actor:AdminAccount) {
 const competition=await findCompetitionWorkflowById(competitionId);
 if(!competition) throw new SimilarityAccessError(404,"Yarışma bulunamadı.");
 const db=await workflowDatabase();
 if(actor.roleCode==="02") {
   const membership=await db.prepare("SELECT id FROM competition_applications WHERE competition_key=? AND assigned_judge_id=? AND deleted_at IS NULL LIMIT 1")
     .bind(competition.competitionKey,actor.id).first();
   if(!membership) throw new SimilarityAccessError(403,"Bu yarışmada size atanmış başvuru yok.");
 }
 const pool=await listBulkSimilarityPool(competition.competitionKey,SIMILARITY_PIPELINE_VERSION);
 const template=await findCurrentSimilarityTemplate(competition.competitionKey);
 const keys=new Map(pool.map(entry=>[entry.applicationId,preparationKey(entry.applicationId,entry.submissionVersionId,template?.version??null)]));
 const preparations=await readPreparations([...keys.values()]);
 const ready=pool.filter(entry=>{
   const job=preparations.get(keys.get(entry.applicationId)!);
   return job?.state==="ready" && Boolean(job.summary?.pdfHash && job.summary?.textKey);
 });
 // Include state/version/model/template/config AND assignment in the snapshot. Stale results never become current silently.
 const snapshot=await sha256Hex(JSON.stringify({ version:"bulk-v2",model:SIMILARITY_EMBEDDING_MODEL,
   pipeline:SIMILARITY_PIPELINE_VERSION,template:template?.version??null,thresholds:similarityThresholds(),
   pool:pool.map(entry=>[entry.applicationId,entry.submissionVersionId,entry.participantId,entry.assignedJudgeId,
     preparations.get(keys.get(entry.applicationId)!)?.state??"missing",
     preparations.get(keys.get(entry.applicationId)!)?.summary?.pdfHash??""]) }));
 return { competition,pool,keys,preparations,ready,snapshot,runId:competition.id+":"+actor.id,actor };
}
type BulkContext=Awaited<ReturnType<typeof bulkContext>>;
export async function bulkOverview(context:BulkContext):Promise<BulkOverview> {
 const {pool,preparations,keys,ready,actor}=context;
 const run=await readBulkRun(context.runId);
 const reports=pool.map(entry=>{
   const job=preparations.get(keys.get(entry.applicationId)!);
   return {id:entry.applicationId,label:entry.participantLabel,state:job?.state??"missing",
     canPrepare:actor.roleCode!=="02" || entry.assignedJudgeId===actor.id,message:job?.message??""};
 });
 const emptyCount=reports.filter(entry=>entry.state==="empty").length;
 const decisionThreshold=similarityThresholds().llmMinPercent;
 const visiblePairs=(run?.data.results??[]).map(pair=>({
   ...pair,
   canMarkLeftNegative:pair.percent>=decisionThreshold && actor.roleCode==="02" && pool.some(entry=>entry.applicationId===pair.leftId && entry.assignedJudgeId===actor.id),
   canMarkRightNegative:pair.percent>=decisionThreshold && actor.roleCode==="02" && pool.some(entry=>entry.applicationId===pair.rightId && entry.assignedJudgeId===actor.id),
 }));
 return {poolSize:pool.length,readyCount:ready.length,emptyCount,missingCount:pool.length-ready.length-emptyCount,reports,
   run:run?{status:run.snapshot!==context.snapshot?"stale":run.data.status,processed:run.data.cursor,
     total:run.data.queue.length,possiblePairs:run.data.possiblePairs,screened:run.data.screened,
     pairs:run.snapshot===context.snapshot?visiblePairs:[],updatedAt:run.updatedAt,
     aiStatus:run.data.aiStatus,aiCandidateCount:run.data.aiCandidateCount,aiMessage:run.data.aiMessage,
     aiModel:run.data.aiModel,aiReviewedAt:run.data.aiReviewedAt}:null};
}
export async function startBulk(context:BulkContext) {
 if(context.ready.length<2) throw new SimilarityAccessError(409,"Karşılaştırma için en az iki hazır, onaylı rapor gerekir.");
 if(context.pool.some(entry=>{
   const state=context.preparations.get(context.keys.get(entry.applicationId)!)?.state;
   return state!=="ready" && state!=="empty";
 })) throw new SimilarityAccessError(409,"Önce eksik raporların benzerlik verilerini hazırlayın.");
 const existing=await readBulkRun(context.runId);
 if(existing?.snapshot===context.snapshot) return; // completed cache or resumable work; no duplicate computation
 const plan=candidatePairs(context.ready.map(entry=>({id:entry.applicationId,participantId:entry.participantId,
   summary:context.preparations.get(context.keys.get(entry.applicationId)!)!.summary!})));
 // Judges can inspect only pairs involving a report assigned to them.
 const visible=plan.pairs.filter(([left,right])=>context.actor.roleCode!=="02" ||
   context.ready.some(entry=>(entry.applicationId===left || entry.applicationId===right) && entry.assignedJudgeId===context.actor.id));
 await startBulkRun(context.runId,context.competition.competitionKey,context.actor.id,context.snapshot,{
   status:visible.length?"running":"completed",cursor:0,possiblePairs:plan.possiblePairs,screened:plan.screened,queue:visible,results:[],
   aiStatus:"not_started",aiCandidateCount:0,aiMessage:"",aiModel:"",aiReviewedAt:null,
 });
}
export async function continueBulk(context:BulkContext) {
 const lease=await claimBulkRun(context.runId);
 if(!lease) return;
 try {
   const run=await readBulkRun(context.runId);
   if(!run || run.snapshot!==context.snapshot) throw new SimilarityAccessError(409,"Onaylı rapor havuzu değişti. Yeni bir tarama başlatın.");
   if(run.data.status==="completed") return;
   const loadDocument=async(id:string)=>{
     const entry=context.ready.find(item=>item.applicationId===id);
     if(!entry) throw new SimilarityAccessError(409,"Rapor artık karşılaştırma havuzunda değil.");
     const job=context.preparations.get(context.keys.get(id)!)!;
     const summary=job.summary!;
     const chunks=await findStoredSimilarityChunks({submissionVersionId:entry.submissionVersionId,pdfHash:summary.pdfHash,
       embeddingModel:SIMILARITY_EMBEDDING_MODEL,pipelineVersion:SIMILARITY_PIPELINE_VERSION});
     const object=await reportBucket().get(summary.textKey);
     if(!chunks?.length || !object) throw new SimilarityAccessError(409,"Kayıtlı parça verisi eksik. Rapor verisini yeniden hazırlayın.");
     const stored=await object.json<{included:Array<{index:number;text:string;section?:string}>;sourcePdfHash?:string}>();
     if(stored.sourcePdfHash && stored.sourcePdfHash!==summary.pdfHash) throw new SimilarityAccessError(409,"PDF sürümü değişmiş; veriyi yeniden hazırlayın.");
     const texts=new Map(stored.included.map(item=>[item.index,item]));
     const others=context.ready.filter(item=>item.applicationId!==id)
       .map(item=>context.preparations.get(context.keys.get(item.applicationId)!)!.summary!);
     const featureCounts=poolFeatureCounts(others.map(item=>item.features));
     const hashCounts=new Map<string,number>();
     for(const other of others) for(const hash of new Set(other.hashes)) hashCounts.set(hash,(hashCounts.get(hash)??0)+1);
     const scored:ScoredChunk[]=chunks.map(chunk=>{
       const text=texts.get(chunk.chunkIndex);
       if(!text || !chunk.embedding) throw new SimilarityAccessError(409,"Rapor verisi eksik; yeniden hazırlayın.");
       return {index:chunk.chunkIndex,wordCount:chunk.wordCount,pageStart:chunk.pageStart,text:text.text,
         minHash:chunk.minHash,embedding:chunk.embedding,wordStart:chunk.wordStart,
         template:chunk.isTemplate||isTemplateChunkHash(chunk.textHash,hashCounts,others.length),
         features:stripPoolCommonFeatures(chunk.features,featureCounts,others.length),sketch:chunk.sketch};
     });
     return {entry,scored,texts};
   };
   // Bounded work per request, durable cursor after each slice. Browser can stop and resume safely.
   const deadline=Date.now()+8000;
   for(let processed=0;processed<2 && run.data.cursor<run.data.queue.length;processed++) {
     const [leftId,rightId]=run.data.queue[run.data.cursor];
     const [left,right]=await Promise.all([loadDocument(leftId),loadDocument(rightId)]);
     const result=comparePair(left.scored,right.scored,similarityThresholds());
     const pair:BulkPair={key:leftId+":"+rightId,leftId,rightId,leftLabel:left.entry.participantLabel,
       rightLabel:right.entry.participantLabel,percent:result.percent,directCount:result.directCount,
       semanticCount:result.semanticCount,evidence:result.matches.map(match=>({
         kind:match.kind,leftPage:left.scored.find(chunk=>chunk.index===match.ownIndex)!.pageStart,
         rightPage:right.scored.find(chunk=>chunk.index===match.peerIndex)!.pageStart,
         leftSection:left.texts.get(match.ownIndex)?.section??"",rightSection:right.texts.get(match.peerIndex)?.section??"",
         leftText:(left.texts.get(match.ownIndex)?.text??"").slice(0,500),
         rightText:(right.texts.get(match.peerIndex)?.text??"").slice(0,500),
       }))};
     run.data.results.push(pair);
     // Bounded report payload. UI explicitly says the strongest 50 pairs are shown.
     run.data.results.sort((a,b)=>b.percent-a.percent || a.key.localeCompare(b.key));
     run.data.results=run.data.results.slice(0,50);
     run.data.cursor++;
     if(Date.now()>deadline) break;
   }
   const current=await bulkContext(context.competition.id,context.actor);
   if(current.snapshot!==context.snapshot) throw new SimilarityAccessError(409,"Tarama sırasında havuz değişti. Yeni tarama başlatın.");
   if(run.data.cursor===run.data.queue.length) run.data.status="completed";
   await saveBulkRun(context.runId,lease,run.data);
 } finally { await releaseBulkRun(context.runId,lease); }
}

/**
 * Matematiksel tarama bittikten sonra yalnız eşik üstündeki en güçlü en fazla
 * beş çifti TEK LLM çağrısıyla açıklar. Sonuç aynı snapshot içinde kalıcıdır;
 * düğmeye tekrar basmak yeni ücretli çağrı üretmez.
 */
export async function reviewBulkWithAi(context:BulkContext):Promise<void> {
 const lease=await claimBulkRun(context.runId);
 if(!lease) return;
 const startedAt=Date.now();
 try {
   const run=await readBulkRun(context.runId);
   if(!run || run.snapshot!==context.snapshot) throw new SimilarityAccessError(409,"Onaylı rapor havuzu değişti. Önce benzerlik taramasını yenileyin.");
   if(run.data.status!=="completed") throw new SimilarityAccessError(409,"AI yorumu için matematiksel karşılaştırmanın tamamlanması gerekir.");
   if(run.data.aiStatus==="completed" || run.data.aiStatus==="skipped") return;
   const thresholds=similarityThresholds();
   const candidates=[...run.data.results]
     .filter(pair=>pair.percent>=thresholds.llmMinPercent)
     .sort((left,right)=>right.percent-left.percent || left.key.localeCompare(right.key))
     .slice(0,thresholds.llmTopK);
   run.data.aiCandidateCount=candidates.length;
   run.data.aiReviewedAt=new Date().toISOString();
   if(!candidates.length) {
     run.data.aiStatus="skipped";
     run.data.aiMessage=`%${thresholds.llmMinPercent} eşiğini geçen rapor çifti bulunmadığı için ücretli AI çağrısı yapılmadı.`;
     await saveBulkRun(context.runId,lease,run.data);
     return;
   }
   if(!similarityLlmEnabled()) {
     run.data.aiStatus="skipped";
     run.data.aiMessage="AI özgünlük yorumu sistem ayarından kapalı; matematiksel sonuçlar korunuyor.";
     await saveBulkRun(context.runId,lease,run.data);
     return;
   }
   const apiKey=process.env.GEMINI_API_KEY;
   if(!apiKey) {
     run.data.aiStatus="failed";
     run.data.aiMessage="AI özgünlük yorumu için servis anahtarı bulunamadı; matematiksel sonuçlar korunuyor.";
     await saveBulkRun(context.runId,lease,run.data);
     return;
   }
   const outcome=await explainSimilarityPairs({
     apiKey,
     competitionName:context.competition.competitionName,
     pairs:candidates.map(pair=>({
       pairKey:pair.key,leftLabel:pair.leftLabel,rightLabel:pair.rightLabel,
       percent:pair.percent,evidence:pair.evidence,
     })),
   });
   if(!outcome.ok) {
     run.data.aiStatus="failed";
     run.data.aiModel=outcome.model??"";
     run.data.aiMessage=`AI özgünlük yorumu tamamlanamadı: ${outcome.detail.slice(0,300)} Matematiksel sonuçlar korunuyor.`;
     recordUsage({model:outcome.model??"",promptTokens:0,outputTokens:0,totalTokens:0,
       durationMs:Date.now()-startedAt,cached:false,error:true,apiCalls:outcome.apiCalls});
   } else {
     const reviews=new Map(outcome.reviews.map(review=>[review.pairKey,review]));
     run.data.results=run.data.results.map(pair=>{
       const review=reviews.get(pair.key);
      return review?{...pair,aiReview:{level:review.level,label:review.label,
         explanation:review.explanation,confidence:review.confidence,
         focusAreas:review.focusAreas,dimensions:review.dimensions}}:pair;
     });
     run.data.aiStatus="completed";
     run.data.aiModel=outcome.model;
     run.data.aiMessage=`${outcome.reviews.length} güçlü rapor çifti tek AI çağrısıyla özgün içerik açısından yorumlandı.`;
     recordUsage({model:outcome.model,promptTokens:outcome.usage.prompt,outputTokens:outcome.usage.output,
       totalTokens:outcome.usage.total,durationMs:Date.now()-startedAt,cached:false,error:false,apiCalls:1});
   }
   await saveBulkRun(context.runId,lease,run.data);
 } finally { await releaseBulkRun(context.runId,lease); }
}

/** Hakemin yalnız kendisine atanmış onaylı raporu, yüksek benzerlik kanıtı üzerinden olumsuza çevirmesi. */
export async function markBulkApplicationNegative(context:BulkContext,input:{
 applicationId:string; pairKey:string; reason:string;
}):Promise<string> {
 if(context.actor.roleCode!=="02") throw new SimilarityAccessError(403,"Bu kararı yalnızca atanmış hakem verebilir.");
 const run=await readBulkRun(context.runId);
 if(!run || run.snapshot!==context.snapshot || run.data.status!=="completed") {
   throw new SimilarityAccessError(409,"Benzerlik sonucu güncel değil. Önce taramayı tamamlayın.");
 }
 const pair=run.data.results.find(item=>item.key===input.pairKey);
 const thresholds=similarityThresholds();
 if(!pair || pair.percent<thresholds.llmMinPercent) {
   throw new SimilarityAccessError(409,"Bu rapor çifti yüksek benzerlik eşiğini karşılamıyor.");
 }
 if(input.applicationId!==pair.leftId && input.applicationId!==pair.rightId) {
   throw new SimilarityAccessError(400,"Seçilen proje bu rapor çiftine ait değil.");
 }
 const target=context.pool.find(entry=>entry.applicationId===input.applicationId);
 if(!target || target.assignedJudgeId!==context.actor.id) {
   throw new SimilarityAccessError(403,"Yalnızca size atanmış projeyi olumsuza çevirebilirsiniz.");
 }
 const peerApplicationId=input.applicationId===pair.leftId?pair.rightId:pair.leftId;
 await rejectAcceptedApplicationForSimilarity({
   applicationId:input.applicationId,peerApplicationId,pairKey:pair.key,percent:pair.percent,
   aiLevel:pair.aiReview?.level??"not_reviewed",reason:input.reason,
 },context.actor);
 return "Başvuru sonucu benzerlik incelemesinin ardından olumsuz olarak güncellendi. Kriter kararları ve inceleme kanıtı korundu.";
}
