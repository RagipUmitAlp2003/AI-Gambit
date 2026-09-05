import { workflowDatabase } from "./workflow-db";
import { SIMILARITY_EMBEDDING_MODEL, SIMILARITY_PIPELINE_VERSION } from "./similarity-text";
import type { DocumentSummary } from "./similarity-bulk-engine";
import type { BulkPair, PreparationState } from "./similarity-bulk-types";

export const BULK_SCHEMA = [
 `CREATE TABLE IF NOT EXISTS similarity_preparations (
 id TEXT PRIMARY KEY, application_id TEXT NOT NULL, state TEXT NOT NULL,
 summary_json TEXT, message TEXT NOT NULL DEFAULT '', lease TEXT, expires_at INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS similarity_bulk_runs (
 id TEXT PRIMARY KEY, competition_key TEXT NOT NULL, actor_id TEXT NOT NULL, snapshot TEXT NOT NULL,
 data_json TEXT NOT NULL, lease TEXT, expires_at INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`,
];
export async function similarityDatabase() {
 const db=await workflowDatabase();
 for(const sql of BULK_SCHEMA) await db.prepare(sql).run();
 return db;
}
export function preparationKey(id:string,version:string,templateVersion:number|null) {
 return [id,version,SIMILARITY_EMBEDDING_MODEL,SIMILARITY_PIPELINE_VERSION,templateVersion??"none"].join("|");
}
export async function enqueuePreparation(key:string,applicationId:string) {
 const db=await similarityDatabase();
 await db.prepare("INSERT OR IGNORE INTO similarity_preparations (id,application_id,state,updated_at) VALUES (?,?,'queued',?)")
   .bind(key,applicationId,new Date().toISOString()).run();
}
export async function claimPreparation(key:string,applicationId:string) {
 await enqueuePreparation(key,applicationId);
 const db=await similarityDatabase(), lease=crypto.randomUUID();
 const result=await db.prepare("UPDATE similarity_preparations SET state='running',lease=?,expires_at=?,updated_at=? WHERE id=? AND state<>'ready' AND (state<>'running' OR expires_at<?) AND NOT EXISTS (SELECT 1 FROM similarity_preparations other WHERE other.application_id=? AND other.id<>? AND other.state='running' AND other.expires_at>?)")
 .bind(lease,Date.now()+900000,new Date().toISOString(),key,Date.now(),applicationId,key,Date.now()).run();
 return result.meta.changes ? lease : null;
}
export async function assertPreparationLease(key:string,lease:string) {
 const db=await similarityDatabase();
 const row=await db.prepare("SELECT id FROM similarity_preparations WHERE id=? AND lease=? AND state='running' AND expires_at>?")
   .bind(key,lease,Date.now()).first();
 if(!row) throw new Error("Hazırlık kilidi artık güncel değil; eski işlem yayınlanmadı.");
}
export async function renewPreparationLease(key:string,lease:string) {
 const db=await similarityDatabase();
 const result=await db.prepare("UPDATE similarity_preparations SET expires_at=?,updated_at=? WHERE id=? AND lease=? AND state='running' AND expires_at>?")
   .bind(Date.now()+900000,new Date().toISOString(),key,lease,Date.now()).run();
 if(!result.meta.changes) throw new Error("Hazırlık kilidi artık güncel değil; eski işlem yayınlanmadı.");
}
export async function resetBrokenPreparation(key:string) {
 const db=await similarityDatabase();
 await db.prepare("UPDATE similarity_preparations SET state='queued',summary_json=NULL,message=?,lease=NULL,expires_at=0,updated_at=? WHERE id=? AND state='ready'")
   .bind("Hazır veri eksik bulundu; yeniden hazırlanıyor.",new Date().toISOString(),key).run();
}
export async function finishPreparation(key:string,lease:string,state:string,summary:DocumentSummary|null,message:string) {
 const db=await similarityDatabase();
 await db.prepare("UPDATE similarity_preparations SET state=?,summary_json=?,message=?,lease=NULL,expires_at=0,updated_at=? WHERE id=? AND lease=?")
 .bind(state,summary?JSON.stringify(summary):null,message,new Date().toISOString(),key,lease).run();
}
export type Preparation = { id:string; state:PreparationState; summary:DocumentSummary|null; message:string; updatedAt:string };
export async function readPreparations(keys:string[]) {
 const db=await similarityDatabase(), map=new Map<string,Preparation>();
 for(let i=0;i<keys.length;i+=40) {
   const slice=keys.slice(i,i+40);
   const rows=await db.prepare("SELECT * FROM similarity_preparations WHERE id IN ("+slice.map(()=>"?").join(",")+")")
   .bind(...slice).all<{id:string;state:PreparationState;summary_json:string|null;message:string;expires_at:number;updated_at:string}>();
   for(const row of rows.results??[]) map.set(row.id,{id:row.id,
     state:row.state==="running" && row.expires_at<Date.now()?"failed":row.state,
     summary:row.summary_json?JSON.parse(row.summary_json):null,message:row.message,updatedAt:row.updated_at});
 }
 return map;
}
export type BulkRunData = {
 status:"running"|"completed"; cursor:number; possiblePairs:number; screened:boolean;
 queue:Array<[string,string]>; results:BulkPair[];
 aiStatus:"not_started"|"completed"|"failed"|"skipped";
 aiCandidateCount:number; aiMessage:string; aiModel:string; aiReviewedAt:string|null;
};
export type BulkRun = { snapshot:string; data:BulkRunData; updatedAt:string };
export async function readBulkRun(id:string):Promise<BulkRun|null> {
 const db=await similarityDatabase();
 const row=await db.prepare("SELECT snapshot,data_json,updated_at FROM similarity_bulk_runs WHERE id=?")
 .bind(id).first<{snapshot:string;data_json:string;updated_at:string}>();
 if(!row) return null;
 const parsed=JSON.parse(row.data_json) as Partial<BulkRunData>;
 return {snapshot:row.snapshot,data:{
   status:parsed.status??"completed",cursor:parsed.cursor??0,possiblePairs:parsed.possiblePairs??0,
   screened:parsed.screened??false,queue:parsed.queue??[],results:parsed.results??[],
   aiStatus:parsed.aiStatus??"not_started",aiCandidateCount:parsed.aiCandidateCount??0,
   aiMessage:parsed.aiMessage??"",aiModel:parsed.aiModel??"",aiReviewedAt:parsed.aiReviewedAt??null,
 },updatedAt:row.updated_at};
}
export async function startBulkRun(id:string,competitionKey:string,actorId:string,snapshot:string,data:BulkRunData) {
 const db=await similarityDatabase();
 await db.prepare(`INSERT INTO similarity_bulk_runs(id,competition_key,actor_id,snapshot,data_json,updated_at)
 VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot,data_json=excluded.data_json,
 lease=NULL,expires_at=0,updated_at=excluded.updated_at WHERE similarity_bulk_runs.expires_at<?`)
 .bind(id,competitionKey,actorId,snapshot,JSON.stringify(data),new Date().toISOString(),Date.now()).run();
}
export async function claimBulkRun(id:string) {
 const db=await similarityDatabase(),lease=crypto.randomUUID();
 const result=await db.prepare("UPDATE similarity_bulk_runs SET lease=?,expires_at=? WHERE id=? AND expires_at<?")
 .bind(lease,Date.now()+60000,id,Date.now()).run();
 return result.meta.changes?lease:null;
}
export async function saveBulkRun(id:string,lease:string,data:BulkRunData) {
 const db=await similarityDatabase();
 await db.prepare("UPDATE similarity_bulk_runs SET data_json=?,lease=NULL,expires_at=0,updated_at=? WHERE id=? AND lease=?")
 .bind(JSON.stringify(data),new Date().toISOString(),id,lease).run();
}
export async function releaseBulkRun(id:string,lease:string) {
 const db=await similarityDatabase();
 await db.prepare("UPDATE similarity_bulk_runs SET lease=NULL,expires_at=0 WHERE id=? AND lease=?").bind(id,lease).run();
}
