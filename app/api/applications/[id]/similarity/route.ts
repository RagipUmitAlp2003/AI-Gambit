import { handleError,json,jsonError,requirePermission } from "../../../../lib/admin-guard";
import { prepareApprovedSimilarity } from "../../../../lib/similarity-preparation";
/** Compatibility endpoint: preparation only, never criterion attachment or peer comparison. */
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 const auth=await requirePermission(request,"run_ai_prescreen");
 if(!auth.ok) return auth.response;
 try {
   const result=await prepareApprovedSimilarity((await context.params).id,auth.account);
   return json({prepared:result.state==="ready",state:result.state,embeddingApiCalls:result.apiCalls,llmApiCalls:0});
 } catch(error) {
   if(error instanceof Error && error.message.includes("yalnızca onaylanmış")) return jsonError(409,error.message);
   return handleError(error);
 }
}
