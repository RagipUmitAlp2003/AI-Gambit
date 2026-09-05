import type { AdminAccount } from "./admin-types";
import {
 findCompetitionWorkflowById, findCurrentSimilarityTemplate, findStoredSimilarityChunks,
 listBulkSimilarityPool, reportBucket, workflowDatabase,
} from "./workflow-db";
import { SIMILARITY_EMBEDDING_MODEL, SIMILARITY_PIPELINE_VERSION, isTemplateChunkHash, sha256Hex, type ScoredChunk } from "./similarity-text";
import { similarityThresholds } from "./similarity-config";
import { poolFeatureCounts, stripPoolCommonFeatures } from "./similarity-corroboration";
import { candidatePairs, comparePair } from "./similarity-bulk-engine";
import {
 preparationKey, readPreparations, readBulkRun, startBulkRun, claimBulkRun, saveBulkRun, releaseBulkRun,
} from "./similarity-jobs";
import type { BulkOverview, BulkPair } from "./similarity-bulk-types";

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
 const snapshot=await sha256Hex(JSON.stringify({ version:"bulk-v1",model:SIMILARITY_EMBEDDING_MODEL,
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
 return {poolSize:pool.length,readyCount:ready.length,emptyCount,missingCount:pool.length-ready.length-emptyCount,reports,
   run:run?{status:run.snapshot!==context.snapshot?"stale":run.data.status,processed:run.data.cursor,
     total:run.data.queue.length,possiblePairs:run.data.possiblePairs,screened:run.data.screened,
     pairs:run.snapshot===context.snapshot?run.data.results:[],updatedAt:run.updatedAt}:null};
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
