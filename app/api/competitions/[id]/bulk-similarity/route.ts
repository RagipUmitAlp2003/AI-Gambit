import { after } from "next/server";
import { handleError,json,jsonError,readJson,requirePermission } from "../../../../lib/admin-guard";
import { bulkContext,bulkOverview,startBulk,continueBulk,SimilarityAccessError } from "../../../../lib/similarity-bulk";
import { prepareApprovedSimilarity,queueApprovedSimilarity } from "../../../../lib/similarity-preparation";
type Context={params:Promise<{id:string}>};
async function handle(request:Request,context:Context,write:boolean) {
 const auth=await requirePermission(request,"run_ai_prescreen");
 if(!auth.ok) return auth.response;
 try {
   let state=await bulkContext((await context.params).id,auth.account);
   if(write) {
     const body=await readJson(request,4096);
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
     } else return jsonError(400,"Benzerlik işlemi tanınmadı.");
     state=await bulkContext(state.competition.id,auth.account);
   }
   return json(await bulkOverview(state));
 } catch(error) {
   if(error instanceof SimilarityAccessError) return jsonError(error.status,error.message);
   return handleError(error);
 }
}
export const GET=(request:Request,context:Context)=>handle(request,context,false);
export const POST=(request:Request,context:Context)=>handle(request,context,true);
