import {createGuardedAI} from './guarded-ai.mjs';
export function budgetedAI(admin:any,job:any){
  async function rpc(name:string,args:any){const {data,error}=await admin.rpc('website_ai_'+name,args);if(error)throw Error('AI accounting unavailable');return data;}
  return createGuardedAI({key:Deno.env.get('OPENAI_API_KEY')||'',model:Deno.env.get('OPENAI_MODEL')||'gpt-6.1-sol',ledger:{
    reserve:({requestId,requestHash,model,inputBound,outputBound}:any)=>rpc('reserve',{p_job:job.id,p_request:requestId,p_model:model,p_hash:requestHash,p_input:inputBound,p_output:outputBound}),
    settle:({requestId,responseId,inputTokens,outputTokens}:any)=>rpc('settle',{p_request:requestId,p_response:responseId,p_input:inputTokens,p_output:outputTokens}),
    uncertain:(id:string)=>rpc('uncertain',{p_request:id})
  }});
}
