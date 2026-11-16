import {makeCommercialQuote,quoteRequest,sameQuoteRequest,validateCommercialPolicy} from './commercial-policy.mjs';
import {hostingHash,hostingRpc,reserveHostingUrl} from './hosting-service.ts';
import {DEFAULT_TERMS,makeSalesSettings} from './commercial-setup.mjs';
import {HOSTING_OFFER} from './hosting-offer.mjs';
const read=async(admin:any,table:string,key:string,value:string)=>{const r=await admin.from(table).select('*').eq(key,value).maybeSingle();if(r.error)throw r.error;return r.data;};
// Called only AFTER the shared handler has authenticated a current administrator.
export async function handleCommercialAction({body,admin,user,dependencies:d}:any):Promise<Response|null>{
 const action=String(body.action||'');
 if(!['admin_commercial_policy_status','admin_get_sales_settings','admin_save_sales_settings','admin_send_final_quote','admin_record_contract_acceptance','admin_contract_detail'].includes(action))return null;
 try{
  if(action==='admin_get_sales_settings'){
   const [p,b,s,k]=await Promise.all([read(admin,'website_settings','key','commercial_policy'),read(admin,'website_settings','key','bank_transfer'),read(admin,'website_settings','key','sales_identity'),read(admin,'website_settings','key','sales_backup_attestation')]);
   return d.json({ok:true,seller:s?.value||{},bank_message:b?.value?.message||'',backup:k?.value||{},policy:p?.value||null,default_terms:DEFAULT_TERMS,offer:HOSTING_OFFER});
  }
  if(action==='admin_save_sales_settings'){
   const settings=makeSalesSettings(body,user.id);
   if(settings.policy.enabled)validateCommercialPolicy(settings.policy);
   const {error}=await admin.from('website_settings').upsert([
    {key:'sales_identity',value:settings.seller},{key:'bank_transfer',value:{message:settings.bank}},
    {key:'sales_backup_attestation',value:settings.backup},{key:'commercial_policy',value:settings.policy}
   ].map(x=>({...x,updated_at:new Date().toISOString()})),{onConflict:'key'});
   if(error)return d.json({error:'設定を保存できませんでした。時間を置いて再試行してください。'},503);
   return d.json({ok:true,enabled:settings.policy.enabled,version:settings.policy.version});
  }
  if(action==='admin_commercial_policy_status'){
   const setting=await read(admin,'website_settings','key','commercial_policy');
   try{
    const p=validateCommercialPolicy(setting?.value),mode=Deno.env.get('WEBSITE_CUSTOMER_HOSTING')==='cloudflare-r2';
    let reason='';
    if(!mode)reason='販売条件は保存済みです。公開基盤の本番切り替えが完了するまで正式見積りを送信できません。';
    else{
     const [bank,backup]=await Promise.all([read(admin,'website_settings','key','bank_transfer'),read(admin,'website_settings','key','sales_backup_attestation')]);
     const domain=Deno.env.get('CUSTOMER_BASE_DOMAIN')||'';
     if(!domain||Deno.env.get('CUSTOMER_HOSTING_DOMAIN_READY')!==domain)reason='正式URLの所有・DNS・HTTPS確認が未完了です。';
     else if(!['CUSTOMER_R2_ACCOUNT_ID','CUSTOMER_R2_BUCKET','CUSTOMER_R2_ACCESS_KEY_ID','CUSTOMER_R2_SECRET_ACCESS_KEY'].every(k=>!!Deno.env.get(k)))reason='本番R2の接続設定が未完了です。';
     else if(String(bank?.value?.message||'').trim().length<15)reason='振込先が未登録です。';
     else if(backup?.value?.attested!==true||!backup.value.reference||backup.value.attested_by!==p.approved_by||backup.value.attested_at!==p.approved_at)reason='現在の販売条件に対応するバックアップの実施確認が未登録です。';
    }
    return d.json({ready:!reason,policy_ready:true,version:p.version,hosting:p.hosting,...(reason?{reason}:{})});
   }
   catch{return d.json({ready:false,reason:'販売条件が未承認・未設定です。維持費・解約・引き渡し・事業者情報を確定してください。'});}
  }
  if(Deno.env.get('WEBSITE_CUSTOMER_HOSTING')!=='cloudflare-r2')return d.json({error:'公開基盤の本番切り替えが完了していません。正式見積り・案件作成はまだ実行できません。'},409);
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
