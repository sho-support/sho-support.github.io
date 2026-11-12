import {makeCommercialQuote,quoteRequest,sameQuoteRequest,validateCommercialPolicy} from './commercial-policy.mjs';
import {hostingHash,hostingRpc,reserveHostingUrl} from './hosting-service.ts';
const read=async(admin:any,table:string,key:string,value:string)=>{const r=await admin.from(table).select('*').eq(key,value).maybeSingle();if(r.error)throw r.error;return r.data;};
// Called only AFTER the shared handler has authenticated a current administrator.
export async function handleCommercialAction({body,admin,user,dependencies:d}:any):Promise<Response|null>{
 const action=String(body.action||'');
 if(!['admin_commercial_policy_status','admin_send_final_quote','admin_record_contract_acceptance','admin_contract_detail'].includes(action))return null;
 try{
  if(action==='admin_commercial_policy_status'){
   const setting=await read(admin,'website_settings','key','commercial_policy');
   try{const p=validateCommercialPolicy(setting?.value);return d.json({ready:true,version:p.version,hosting:p.hosting});}
   catch{return d.json({ready:false,reason:'販売条件が未承認・未設定です。維持費・解約・引き渡し・事業者情報を確定してください。'});}
  }
  const code=String(body.order_code||'').trim().toUpperCase();
  if(!/^(?:[FSP]\d{4,6}|\d{4,10})$/.test(code))return d.json({error:'注文IDが不正です。'},400);
  if(action==='admin_record_contract_acceptance'){
   const result=await hostingRpc(admin,'accept_contract',{p_actor:user.id,p_order:code,p_fingerprint:String(body.quote_fingerprint||''),p_reference:String(body.acceptance_reference||'').trim()});
   return d.json({ok:true,...result});
  }
  const order=await read(admin,'website_orders','order_code',code);if(!order)return d.json({error:'注文が見つかりません。'},404);
  const stored=order.selections?.commercial_quote;
  if(action==='admin_contract_detail')return d.json({contract:stored?{fingerprint:stored.fingerprint,state:stored.state,message:stored.message,accepted_at:stored.accepted_at||null,acceptance_reference:stored.acceptance_reference||null}:null});
  if(order.status!=='pending_payment'||!order.line_user_id)return d.json({error:'LINE連携済みで入金待ちの注文だけ、正式見積りを送信できます。'},409);
  if(order.selections?.final_quote_sent_at)return d.json({error:'正式見積りは送信済みです。訂正が必要ならお客様と個別に確認してください。'},409);
  const request=quoteRequest(body);
  if(request.public_domain!=='free')return d.json({error:'独自ドメインは管理権限・DNS・HTTPSの個別設定後に案内してください。'},409);
  let snapshot:any,message:string;
  if(stored){
   if(!sameQuoteRequest(request,stored.snapshot?.request))return d.json({error:'前回の見積り送信結果が未確定です。同じ金額・提供時期・期限・補足で再試行するか、LINE履歴を確認してください。'},409);
   snapshot=stored.snapshot;message=stored.message;
  }else{
   const setting=await read(admin,'website_settings','key','commercial_policy');
   const policy=validateCommercialPolicy(setting?.value);
   const bank=await read(admin,'website_settings','key','bank_transfer');
   const url=await reserveHostingUrl(admin,user.id,code);
   const made=makeCommercialQuote({policy,order,request,publicUrl:url,bankMessage:String(bank?.value?.message||''),quoteId:crypto.randomUUID()});
   snapshot=made.snapshot;message=made.message;
  }
  const fingerprint=await hostingHash(message);
  const claim=await hostingRpc(admin,'claim_quote',{p_actor:user.id,p_order:code,p_snapshot:snapshot,p_message:message,p_fingerprint:fingerprint});
  const sent=await d.linePush(claim.recipient,claim.message,claim.retry_key);
  if(sent.skipped||sent.ok!==true)return d.json({error:'LINEへの送信結果が未確定です。同一内容で再試行できます。23時間を超えた場合は履歴を確認してください。'},502);
  await hostingRpc(admin,'complete_quote',{p_actor:user.id,p_order:code,p_fingerprint:fingerprint});
  return d.json({ok:true,order_code:code,final_amount:snapshot.initial_total_jpy,quote_fingerprint:fingerprint});
 }catch(e:any){return d.json({error:String(e?.message||'契約条件の処理に失敗しました。')},409);}
}
