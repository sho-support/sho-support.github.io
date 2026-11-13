import {cloudflareHostingEnabled} from './hosting-mode.ts';
import {hostingHash,hostingMapping,hostingPublisher,hostingRpc,reserveHostingUrl} from './hosting-service.ts';
import {PublicationUncertainError,supabaseHostingDatabase} from './hosting-publication.mjs';
import {handleCommercialAction} from './commercial-routes.ts';

const root='https://sho-web-support.netlify.app/';
const randomKey=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const link=(page:string,id:string,key:string)=>root+page+'?id='+encodeURIComponent(id)+'&key='+encodeURIComponent(key);
const one=async(admin:any,table:string,field:string,value:string)=>{
  const {data,error}=await admin.from(table).select('*').eq(field,value).maybeSingle();if(error)throw error;return data;
};
const missing=()=>new Error('必要な顧客データが見つかりません。');

async function deliverPublicationNotice(admin:any,actorId:string,operationId:string,linePush:any){
  const db=supabaseHostingDatabase(admin),op=await db.operation(operationId);
  if(!op)return '通知する公開履歴が見つかりません。';
  const h=await db.hosting(op.site_id);
  if(!op||!h||h.active_publication_id!==operationId)return 'この操作より新しい公開状態があります。通知は管理者が確認してください。';
  const title=op.kind==='private'?'ホームページを非公開にしました。':op.kind==='rollback'?'ホームページを以前の正常な内容へ戻しました。':'ホームページを公開しました。';
  const [customer,setting]=await Promise.all([one(admin,'website_line_links','site_id',op.site_id),one(admin,'website_settings','key','line_owner')]);
  const owner=Deno.env.get('LINE_OWNER_USER_ID')||String(setting?.value?.user_id||'');
  const message=title+(op.kind==='private'?'':'\n\n【公開サイト】\n'+h.public_url)+
    '\n\n更新・修正依頼は、直近にお送りした「確認・修正依頼・内容承認」のURLを開き、「更新・管理画面」からお願いします。';
  const lease=crypto.randomUUID();
  const n=await hostingRpc(admin,'claim_notice',{p_actor:actorId,p_operation:operationId,p_lease:lease,p_payload:{
    customer:{to:customer?.line_user_id||'',text:message},owner:{to:owner,text:'【SHO WEB SUPPORT】SITE ID '+op.site_id+'\n'+title+'\n'+h.public_url}
  }});
  if(!n.claimed)return n.state==='sent'?null:'公開状態は保存済みです。通知は確認または再送待ちです。';
  if(!n.customer_sent_at){
    const sent=await linePush(n.delivery_payload.customer.to,n.delivery_payload.customer.text,op.operation_id);
    if(sent.skipped||sent.ok!==true)return '公開状態は保存済みです。お客様へのLINE通知を確認・再送してください。';
    await hostingRpc(admin,'complete_notice',{p_operation:operationId,p_lease:lease,p_recipient:'customer'});
  }
  if(!n.owner_sent_at){
    const sent=await linePush(n.delivery_payload.owner.to,n.delivery_payload.owner.text,op.fence_id);
    if(sent.skipped||sent.ok!==true)return '公開状態は保存済みです。運営者へのLINE通知を確認・再送してください。';
    await hostingRpc(admin,'complete_notice',{p_operation:operationId,p_lease:lease,p_recipient:'owner'});
  }
  return null;
}

// Shared by BOTH customer-access and authenticated portal/admin routes.
// Authentication comes from getUser(req), membership from SQL, and token hashes from server hashing.
export async function handleHostingAction({req,body,admin,user,dependencies:d}:any):Promise<Response|null>{
  const action=String(body?.action||'');
  const transition=action==='admin_transition'&&['customer_review','live','private','improving_private'].includes(String(body.status));
  if(action==='review_publish')return d.json({error:'公開作業は運営者が行います。内容の承認をお願いします。'},403);
  const handled=new Set(['review_load','review_approve','review_revision','review_action','admin_send_review','admin_publish_site',
    'admin_rollback_site','admin_reconcile_publication','admin_resend_publication','admin_secure_preview','admin_domain','admin_repo_config','admin_activate_order','create_site',
    'admin_commercial_policy_status','admin_get_sales_settings','admin_save_sales_settings','admin_send_final_quote','admin_record_contract_acceptance','admin_contract_detail']);
  if(!handled.has(action)&&!transition)return null;
  try{
    const commercialAction=action.startsWith('admin_')&&['admin_commercial_policy_status','admin_get_sales_settings','admin_save_sales_settings','admin_send_final_quote','admin_record_contract_acceptance','admin_contract_detail'].includes(action);
    const publicationMutation=['admin_activate_order','create_site','admin_publish_site','admin_rollback_site','admin_reconcile_publication'].includes(action)||transition;
    if(!cloudflareHostingEnabled()&&!commercialAction&&!publicationMutation)return null;
    const siteId=String(body.site_id||'');
    const customer=action.startsWith('review_')||action==='review_action';
    if(!customer){
      user=user||await d.getUser(req,admin);
      if(!user)return d.json({error:'ログインが必要です。'},401);
      const adminRow=await one(admin,'website_admins','user_id',user.id);
      if(!adminRow)return d.json({error:'管理者権限が必要です。'},403);
    }
    const commercial=await handleCommercialAction({body,admin,user,dependencies:d});
    if(commercial)return commercial;
    if(!cloudflareHostingEnabled())return d.json({error:'公開基盤の本番切り替えが未完了です。旧方式での案件作成・公開は実行できません。'},409);
    if(['create_site','admin_domain','admin_repo_config'].includes(action))return d.json({error:
      action==='create_site'?'新しい案件は、確定URLを案内した注文の入金確認から作成してください。':
      action==='admin_domain'?'独自ドメインは、管理権限・DNS・HTTPSの個別設定が完了するまで自動接続できません。':
      '制作データの保存先は自動管理します。保存先の変更は個別の移管確認が必要です。'},409);
    if(action==='admin_activate_order'){
      const code=String(body.order_code||'').trim().toUpperCase();
      await reserveHostingUrl(admin,user.id,code);
      const key=randomKey(),r=await hostingRpc(admin,'activate_order',{p_actor:user.id,p_order:code,p_key_hash:await hostingHash(key)});
      if(r.already_active)return d.json({ok:true,site_id:r.site_id,already_active:true,warning:'入金確認は保存済みです。制作案内が必要なら「ヒアリングURL再送」を使ってください。'});
      const order=await one(admin,'website_orders','order_code',code);
      const sent=await d.linePush(order?.line_user_id,'お振込みによるご入金を確認いたしました。\nこのたびはご注文いただき、ありがとうございます。\n\nSITE ID：'+r.site_id+'\n制作内容・写真は、下の専用URLからご入力ください。\n'+link('website-intake.html',r.site_id,key)+'&prod=1');
      return d.json({ok:true,site_id:r.site_id,...(sent.skipped||sent.ok!==true?{warning:'入金確認は保存済みです。ヒアリングURLのLINE再送が必要です。'}:{})});
    }
    if(!/^[A-Za-z0-9_-]{3,32}$/.test(siteId))return d.json({error:'SITE IDが不正です。'},400);
    const h=await hostingMapping(admin,siteId);
    if(customer){
      const key=String(body.key||''),portal=action==='review_action';
      if(portal&&!user)return d.json({error:'ログインが必要です。'},401);
      if(!portal&&!/^[A-Za-z0-9_-]{20,200}$/.test(key))return d.json({error:'確認URLが無効です。'},403);
      const s=await one(admin,'website_sites','site_id',siteId);if(!s)throw missing();
      const keyHash=portal?null:await hostingHash(key);
      if(action==='review_load'){
        const order=await one(admin,'website_orders','site_id',siteId);
        const published=s.published_at&&keyHash===order?.customer_access_token_hash;
        if(!published&&(s.status!=='customer_review'||keyHash!==s.review_access_token_hash))return d.json({error:'確認URLが無効です。LINEで届いた最新のURLをご利用ください。'},403);
        const update=published?link('website-update.html',siteId,key):null;
        return d.json({ok:true,site:{site_id:siteId,site_name:s.site_name,status:s.status,updated_at:s.updated_at,
          customer_approved:!!s.customer_approved,public_url:h.public_url,preview_url:published?h.public_url:link('website-preview.html',siteId,key)},
          release_id:published?h.active_release:h.pending_release,update_url:update});
      }
      const reviewAction=portal?body.review_action:action==='review_approve'?'approve':'revision';
      if(!['approve','revision'].includes(reviewAction))return d.json({error:'公開操作には運営者の確認が必要です。'},403);
      // The latest random review key is bound to h.pending_release; an old tab/key cannot approve a new build.
      const release=body.release_id||h.pending_release;
      if(!release)return d.json({error:'承認できる制作案がありません。最新の案内をご確認ください。'},409);
      if(reviewAction==='approve'){
        const approval=await hostingRpc(admin,'approve',{p_site:siteId,p_release:release,p_key_hash:keyHash,p_user:portal?user.id:null});
        if(!approval.already_approved){try{await d.notifyOwner('【お客様確認OK】SITE ID '+siteId+'\n運営者の公開操作待ちです。');}catch{/* Approval and its audit record remain durable. */}}
        return d.json({ok:true,customer_approved:true,release_id:release});
      }
      const detail=String(body.detail||'').trim();
      const r=await hostingRpc(admin,'request_revision',{p_site:siteId,p_release:release,p_note:detail,p_key_hash:keyHash,p_user:portal?user.id:null});
      EdgeRuntime.waitUntil(d.triggerWebsiteWorker(siteId).catch(()=>{}));
      try{await d.notifyOwner('【修正依頼】SITE ID '+siteId+'\n'+detail.slice(0,1200));}catch{/* Saved revision does not disappear if the notice fails. */}
      return d.json({ok:true,status:r.status});
    }
    if(action==='admin_secure_preview'){
      if(!h.pending_release)return d.json({error:'検査済みの制作案がまだありません。'},409);
      const key=randomKey(),url=link('website-preview.html',siteId,key);
      const {error}=await admin.from('website_sites').update({preview_url:url,preview_access_token_hash:await hostingHash(key),preview_token_issued_at:new Date().toISOString()}).eq('site_id',siteId);
      if(error)throw error;return d.json({ok:true,preview_url:url,status:'secure_preview'});
    }
    if(action==='admin_send_review'||(transition&&body.status==='customer_review')){
      const site=await one(admin,'website_sites','site_id',siteId);
      if(!site||!(action==='admin_send_review'?site.status==='customer_review':site.status==='sho_review'))return d.json({error:'先に運営が制作案を確認してください。'},409);
      const key=randomKey();
      await hostingRpc(admin,'open_review',{p_actor:user.id,p_site:siteId,p_release:h.pending_release,p_key_hash:await hostingHash(key)});
      const review=link('website-customer-review.html',siteId,key)+'&prod=1',preview=link('website-preview.html',siteId,key);
      const customer=await one(admin,'website_line_links','site_id',siteId);
      const sent=await d.linePush(customer?.line_user_id,'ホームページの制作案ができました。\n\n【サイトを見る】\n'+preview+'\n\n【確認・修正依頼・内容承認】\n'+review+'\n\n内容をご確認ください。承認後の公開操作はSHO WEB SUPPORTが行います。');
      return d.json({ok:true,status:'customer_review',review_url:review,...(sent.skipped||sent.ok!==true?{warning:'確認URLは保存済みです。LINE送信の確認・再送が必要です。'}:{})});
    }
    if(transition&&body.status==='live')return d.json({error:'公開はお客様の内容承認後、運営管理の公開ボタンから行ってください。'},409);
    let result;
    const publisher=hostingPublisher(admin);
    if(action==='admin_reconcile_publication')result=await publisher.reconcile({siteId,actorId:user.id,operationId:String(body.operation_id||h.active_operation_id||'')});
    else if(action==='admin_resend_publication'){
      const operationId=String(body.operation_id||h.active_publication_id||'');
      const op=await supabaseHostingDatabase(admin).operation(operationId);
      if(!op||op.site_id!==siteId||op.state!=='committed')return d.json({error:'通知できる公開履歴がありません。'},409);
      result={ok:true,operation_id:operationId,state:'committed',public_url:h.public_url};
    }else if(action==='admin_publish_site'&&!h.pending_release&&h.status==='live'){
      // A double click after a successful publication only retries its durable notice.
      result={ok:true,operation_id:h.active_publication_id,state:'committed',public_url:h.public_url};
    }else{
      const kind=action==='admin_rollback_site'?'rollback':transition?'private':'publish';
      const release=kind==='private'?h.active_release:kind==='rollback'?String(body.release_id||''):h.pending_release;
      result=await publisher.publish({siteId,actorId:user.id,releaseId:release,kind});
    }
    let warning=null;
    if(result.state==='committed'){
      try{warning=await deliverPublicationNotice(admin,user.id,result.operation_id,d.linePush);}catch{warning='公開状態は保存済みです。LINE通知の確認・再送が必要です。';}
    }else warning='未確定だった公開処理は安全に中止しました。内容を確認して再実行してください。';
    const current=await hostingMapping(admin,siteId);
    return d.json({...result,status:current.status,...(warning?{warning}:{})});
  }catch(e:any){
    if(e instanceof PublicationUncertainError)return d.json({error:'公開結果の確認が必要です。再公開せず、復旧処理を実行してください。',operation_id:e.operationId,reconciliation_required:true},409);
    console.error('customer-hosting action failed',{code:e?.code||'hosting_error',type:e?.name||'Error'});
    return d.json({error:e?.code==='42501'?'操作権限を確認できません。':'公開・確認の状態が変わったか、設定が未完了です。最新状態を読み直してください。'},e?.code==='42501'?403:409);
  }
}
