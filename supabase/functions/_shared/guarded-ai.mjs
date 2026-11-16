export const AI_ACCOUNTING=Object.freeze({model:'gpt-6.1-sol',inputMicroPerToken:4,outputMicroPerToken:20,maxRequestBytes:200000,framingTokens:8192,maxOutput:16000});
export class AIAccountingError extends Error{
  constructor(code,message){super(message);this.name='AIAccountingError';this.code=code;this.retryable=false;}
}
const fail=(code,message)=>new AIAccountingError(code,message);
export function prepareAIRequest(body){
  const allowed=['model','input','reasoning','max_output_tokens','text'];
  if(!body||Object.keys(body).some(k=>!allowed.includes(k))||body.model!==AI_ACCOUNTING.model
    ||!Number.isInteger(body.max_output_tokens)||body.max_output_tokens<1||body.max_output_tokens>16000
    ||!Array.isArray(body.input)||body.input.length<1||body.input.length>4
    ||body.input.some(x=>!x||!['system','user'].includes(x.role)||typeof x.content!=='string'||Object.keys(x).some(k=>!['role','content'].includes(k)))
    ||body.reasoning&&(!['low','medium'].includes(body.reasoning.effort)||Object.keys(body.reasoning).some(k=>k!=='effort')))
    throw fail('AI_CONFIGURATION','AI制作の設定が確認済みの範囲外です。運営者が設定を確認してください。');
  const request={...body,store:false,service_tier:'default'};
  const serialized=JSON.stringify(request),bytes=new TextEncoder().encode(serialized).length;
  if(bytes>AI_ACCOUNTING.maxRequestBytes)throw fail('AI_INPUT_LIMIT','AIへ送る制作情報が上限を超えています。素材や指示を運営者が整理してください。');
  const inputBound=bytes+AI_ACCOUNTING.framingTokens;
  return {request,serialized,inputBound,reservedMicroUsd:inputBound*4+body.max_output_tokens*20};
}
async function limitedJSON(response,signal,maxBytes=2000000){
  if(!response.body)throw Error('Empty response');
  const reader=response.body.getReader(),chunks=[];let size=0;
  let abort;const stopped=new Promise((_,reject)=>{abort=()=>reject(Error('AI body deadline'));signal.addEventListener('abort',abort,{once:true});});
  try{if(signal.aborted)throw Error('AI body deadline');for(;;){const {value,done}=await Promise.race([reader.read(),stopped]);if(done)break;size+=value.length;if(size>maxBytes)throw Error('Oversized response');chunks.push(value);}}
  catch(error){reader.cancel().catch(()=>{});throw error;}
  finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
  const data=new Uint8Array(size);let offset=0;for(const part of chunks){data.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder().decode(data));
}
export function createGuardedAI({key,model='gpt-6.1-sol',ledger,fetcher=fetch,timeoutMs=90000}){
  return {async request(body){
    if(!key)throw fail('AI_CONFIGURATION','AI制作の接続設定が確認できません。');
    const prepared=prepareAIRequest({...body,model});
    const requestId=crypto.randomUUID(),requestHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prepared.serialized))),b=>b.toString(16).padStart(2,'0')).join('');
    let reserved;
    try{reserved=await ledger.reserve({requestId,requestHash,model,inputBound:prepared.inputBound,outputBound:body.max_output_tokens});}
    catch{throw fail('AI_BUDGET','AI費用の上限または利用記録を確認できないため、制作を停止しました。運営者が利用状況を確認してください。');}
    if(reserved?.request_id!==requestId||reserved.reserved_micro_usd!==prepared.reservedMicroUsd)throw fail('AI_BUDGET','AI費用の予約結果を確認できません。');
    let result;
    try{
      const signal=AbortSignal.timeout(timeoutMs);
      const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',signal,
        headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:prepared.serialized});
      if(!response.ok){response.body?.cancel().catch(()=>{});throw Error('Provider rejection');}
      result=await limitedJSON(response,signal);
      const usage=result?.usage;
      if(!/^resp_[A-Za-z0-9_-]{1,150}$/.test(result?.id||'')||!/^gpt-6\.1-sol(?:-\d{4}-\d{2}-\d{2})?$/.test(result?.model||'')
        ||!Number.isInteger(usage?.input_tokens)||!Number.isInteger(usage?.output_tokens)||usage.input_tokens<0||usage.output_tokens<0)throw Error('Invalid usage');
    }catch{
      await ledger.uncertain(requestId).catch(()=>{});
      throw fail('AI_UNCERTAIN','AIの応答・費用を確認できませんでした。自動再試行はせず、運営者が確認します。');
    }
    let settled;
    try{settled=await ledger.settle({requestId,responseId:result.id,inputTokens:result.usage.input_tokens,outputTokens:result.usage.output_tokens});}
    catch{throw fail('AI_RECORD_UNCERTAIN','AIの利用記録の保存を確認できません。再生成せず、運営者が確認します。');}
    if(settled?.settled!==true||settled.overrun||result.usage.input_tokens>prepared.inputBound||result.usage.output_tokens>body.max_output_tokens)
      throw fail('AI_USAGE_LIMIT','AI利用量が設定範囲を超えました。運営者が確認するまで制作を停止します。');
    if(result.status&&result.status!=='completed')throw fail('AI_INCOMPLETE','AIの出力が完了しませんでした。運営者が内容と費用を確認します。');
    return result;
  }};
}
