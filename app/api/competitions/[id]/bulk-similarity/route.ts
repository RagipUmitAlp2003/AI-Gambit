import { after } from "next/server";
import { handleError,json,jsonError,readJson,requirePermission } from "../../../../lib/admin-guard";
import { bulkContext,bulkOverview,startBulk,continueBulk,reviewBulkWithAi,markBulkApplicationNegative,SimilarityAccessError } from "../../../../lib/similarity-bulk";
import { prepareApprovedSimilarity,queueApprovedSimilarity } from "../../../../lib/similarity-preparation";
type Context={params:Promise<{id:string}>};
async function handle(request:Request,context:Context,write:boolean) {
 const baseAuth=await requirePermission(request,"run_ai_prescreen");
 if(!baseAuth.ok) return baseAuth.response;
 try {
   const body=write?await readJson(request,4096):{};
   let auth=baseAuth;
   if(body.action==="mark_negative") {
     const decisionAuth=await requirePermission(request,"final_judgement");
     if(!decisionAuth.ok) return decisionAuth.response;
     auth=decisionAuth;
   }
   let state=await bulkContext((await context.params).id,auth.account);
   let notice="";
   if(write) {
     if(body.action==="prepare") {
       const entry=state.pool.find(item=>item.applicationId===body.applicationId);
       if(!entry || (auth.account.roleCode==="02" && entry.assignedJudgeId!==auth.account.id)) return jsonError(403,"Bu rapor için hazırlık yetkiniz yok.");
       if(await queueApprovedSimilarity(entry.applicationId,auth.account)) {
         after(async()=>{try{await prepareApprovedSimilarity(entry.applicationId,auth.account);}catch(error){console.error("[similarity-background]",error);}});
       }
     } else if(body.action==="start") {
       await startBulk(state);
     } else if(body.action==="continue") {
       await continueBulk(state);
     } else if(body.action==="explain") {
       await reviewBulkWithAi(state);
     } else if(body.action==="mark_negative") {
       if(typeof body.applicationId!=="string" || typeof body.pairKey!=="string" || typeof body.reason!=="string") {
         return jsonError(400,"Proje, rapor çifti ve hakem gerekçesi gereklidir.");
       }
       if(!body.reason.trim() || body.reason.trim().length>1000) {
         return jsonError(400,"Olumsuz karar gerekçesi 1–1000 karakter olmalıdır.");
       }
       notice=await markBulkApplicationNegative(state,{
         applicationId:body.applicationId,pairKey:body.pairKey,reason:body.reason,
       });
     } else return jsonError(400,"Benzerlik işlemi tanınmadı.");
     state=await bulkContext(state.competition.id,auth.account);
   }
   return json({...await bulkOverview(state),...(notice?{notice}:{})});
 } catch(error) {
   if(error instanceof SimilarityAccessError) return jsonError(error.status,error.message);
   return handleError(error);
 }
}
export const GET=(request:Request,context:Context)=>handle(request,context,false);
export const POST=(request:Request,context:Context)=>handle(request,context,true);
