import { adminClient, getUser, json, linePush, notifyOwner, triggerWebsiteWorker, setGithubPagesSource, publishApprovedStagedBranch } from './_shared/website.ts';

const allowedOrigin = 'https://sho-support.github.io';

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function afterMonths(base:Date,months:number){const d=new Date(base),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));return d.toISOString();}
async function isAdmin(admin:any,userId:string){
  const {data,error}=await admin.from('website_admins').select('user_id').eq('user_id',userId).maybeSingle();
  if(error)throw error;
  return Boolean(data);
}

function randomAccessKey(){
  const bytes=crypto.getRandomValues(new Uint8Array(24));
  let raw=''; for(const b of bytes)raw+=String.fromCharCode(b);
  return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}

async function resolveAccess(admin:any, siteId:string, key:string) {
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(siteId) || key.length < 20 || key.length > 200) return null;
  const { data: order, error } = await admin
    .from('website_orders')
    .select('order_code,status,plan,template_style,site_id,customer_access_token_hash')
    .eq('site_id', siteId)
    .maybeSingle();
  if (error) throw error;
  if (!order?.customer_access_token_hash) return null;
  const hash = await sha256Hex(key);
  if (hash !== order.customer_access_token_hash) return null;
  return order;
}

function forceOrderFields(payload:any, order:any) {
  const base = payload && typeof payload === 'object' ? structuredClone(payload) : {};
  base.fields = base.fields && typeof base.fields === 'object' ? base.fields : {};
  base.fields.build_plan = order.plan;
  base.fields.template_style = order.plan === 'semi' ? (order.template_style || '') : '';
  return base;
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:{
    'Access-Control-Allow-Origin':allowedOrigin,
    'Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
  }});
  if(req.method!=='POST') return json({error:'Method not allowed'},405);

  const origin=req.headers.get('origin')||'';
  if(origin && origin!==allowedOrigin) return json({error:'Forbidden'},403);

  let body:any={};
  try{body=await req.json()}catch{return json({error:'Invalid request'},400)}
  const action=String(body?.action||'');
  const siteId=String(body?.site_id||'');
  const key=String(body?.key||'');
  const admin=adminClient();

  if(action==='admin_list_orders' || action==='admin_activate_order' || action==='admin_send_review' || action==='admin_resend_intake'){
    const user=await getUser(req,admin);
    if(!user)return json({error:'ログインが必要です。'},401);
    if(!(await isAdmin(admin,user.id)))return json({error:'管理者権限が必要です。'},403);

    if(action==='admin_send_review'){
      const targetSite=String(body?.site_id||'');
      const {data:site,error:siteError}=await admin.from('website_sites')
        .select('site_id,status')
        .eq('site_id',targetSite)
        .maybeSingle();
      if(siteError)throw siteError;
      if(!site||site.status!=='customer_review')return json({error:'現在はお客様最終確認の状態ではありません。'},409);
      const {data:link,error:linkError}=await admin.from('website_line_links')
        .select('line_user_id')
        .eq('site_id',targetSite)
        .maybeSingle();
      if(linkError)throw linkError;
      if(!link?.line_user_id)return json({error:'お客様のLINEが紐付いていません。'},409);
      const reviewKey=randomAccessKey();
      const {error:updateError}=await admin.from('website_sites')
        .update({review_access_token_hash:await sha256Hex(reviewKey)})
        .eq('site_id',targetSite);
      if(updateError)throw updateError;
      const reviewUrl='https://sho-support.github.io/website-customer-review.html?id='+encodeURIComponent(targetSite)+'&prod=1&key='+encodeURIComponent(reviewKey);
      const delivered=await linePush(link.line_user_id,'ホームページの最終確認ができる状態になりました。\n\n下の専用URLからサイトをご確認ください。修正がある場合はそのまま送信できます。問題なければ「この内容でOK」を押してください。\n\n'+reviewUrl);
      if(delivered.skipped||delivered.ok===false)return json({error:'LINEへ確認URLを送信できませんでした。LINE設定やブロック状態を確認し、再送してください。'},502);
      return json({ok:true,review_url:reviewUrl});
    }

    if(action==='admin_list_orders'){
      const {data,error}=await admin.from('website_orders')
        .select('order_code,status,plan,template_style,update_plan,custom_domain,amount_from,line_user_id,line_display_name,line_linked_at,site_id,created_at,updated_at')
        .order('created_at',{ascending:false}).limit(200);
      if(error)throw error;
      const ids=[...new Set((data||[]).map((o:any)=>o.site_id).filter(Boolean))];
      let states:Record<string,string>={};
      if(ids.length){
        const {data:related,error:relatedError}=await admin.from('website_sites').select('site_id,status').in('site_id',ids);
        if(relatedError)throw relatedError;
        states=Object.fromEntries((related||[]).map((site:any)=>[site.site_id,site.status]));
      }
      return json({orders:(data||[]).map((o:any)=>({...o,site_status:o.site_id?states[o.site_id]||null:null}))});
    }

    if(action==='admin_resend_intake'){
      const resendCode=String(body?.order_code||'').trim().toUpperCase();
      if(!/^[FSP]\d{4,6}$/.test(resendCode))return json({error:'注文IDが不正です。'},400);
      const {data:target,error:targetErr}=await admin.from('website_orders').select('order_code,status,site_id,line_user_id').eq('order_code',resendCode).maybeSingle();
      if(targetErr)throw targetErr;
      if(!target||target.status!=='site_created'||!target.site_id||!target.line_user_id)return json({error:'ヒアリングURLを再送できる注文ではありません。'},409);
      const {data:resendSite,error:resendSiteError}=await admin.from('website_sites').select('status').eq('site_id',target.site_id).single();
      if(resendSiteError)throw resendSiteError;
      if(resendSite.status!=='request_waiting')return json({error:'初回ヒアリングはすでに受付終了です。公開後の更新フォームをご利用ください。'},409);
      const newKey=randomAccessKey(),url='https://sho-support.github.io/website-intake.html?id='+encodeURIComponent(target.site_id)+'&prod=1&key='+encodeURIComponent(newKey);
      const {error:tokenErr}=await admin.from('website_orders').update({customer_access_token_hash:await sha256Hex(newKey),access_token_created_at:new Date().toISOString()}).eq('order_code',resendCode);
      if(tokenErr)throw tokenErr;
      const sent=await linePush(target.line_user_id,'制作内容・写真の入力URLを再送します。最新のURLから入力してください。\n\n'+url);
      if(sent.skipped||sent.ok===false)return json({error:'LINE送信に失敗しました。LINE設定やお客様のブロック状態を確認して再送してください。'},502);
      await notifyOwner('【制作ヒアリングURL再送】注文 '+resendCode);
      return json({ok:true,site_id:target.site_id,resent:true});
    }

    const orderCode=String(body?.order_code||'').trim().toUpperCase();
    if(!/^[FSP]\d{4,6}$/.test(orderCode))return json({error:'注文IDが不正です。'},400);
    const {data:target,error:orderError}=await admin.from('website_orders').select('*').eq('order_code',orderCode).maybeSingle();
    if(orderError)throw orderError;
    if(!target)return json({error:'注文が見つかりません。'},404);
    if(target.status!=='pending_payment')return json({error:'この注文は入金確認待ちではありません。'},409);
    if(!target.line_user_id)return json({error:'お客様のLINE送信がまだ確認できません。'},409);

    const newSiteId=orderCode.replace(/^[FSP]/,'');
    const newKey=randomAccessKey();
    const newHash=await sha256Hex(newKey);
    const planLabel=target.plan==='one'?'1ページ完結サイト':target.plan==='semi'?'セミオーダーサイト':'フルオーダーサイト';

    const {data:existing,error:siteReadError}=await admin.from('website_sites').select('site_id').eq('site_id',newSiteId).maybeSingle();
    if(siteReadError)throw siteReadError;
    if(!existing){
      const {error:siteError}=await admin.from('website_sites').insert({
        site_id:newSiteId,site_name:planLabel,status:'request_waiting',
        current_note:'ヒアリング入力待ち。',customer_approved:false,
        publish_branch:'main',live_path:'/',offline_path:'/docs'
      });
      if(siteError)throw siteError;
      const {error:intakeError}=await admin.from('website_intakes').insert({
        site_id:newSiteId,
        payload:{fields:{build_plan:target.plan,template_style:target.template_style||''},checks:{},members:[],lives:[],contacts:[],files:{top_photos:[],gallery_photos:[],logo_file:[]},meta:{}}
      });
      if(intakeError)throw intakeError;
      await admin.from('website_activity').insert({
        site_id:newSiteId,actor_type:'admin',actor_user_id:user.id,action:'site_created',
        detail:`注文 ${orderCode} から案件を作成。`
      });
    }

    const {error:linkError}=await admin.from('website_line_links').upsert({
      site_id:newSiteId,line_user_id:target.line_user_id,line_display_name:target.line_display_name||null
    },{onConflict:'site_id'});
    if(linkError)throw linkError;

    const {error:updateError}=await admin.from('website_orders').update({
      status:'site_created',site_id:newSiteId,customer_access_token_hash:newHash,
      access_token_created_at:new Date().toISOString(),updated_at:new Date().toISOString()
    }).eq('order_code',orderCode);
    if(updateError)throw updateError;

    const url=`https://sho-support.github.io/website-intake.html?id=${encodeURIComponent(newSiteId)}&prod=1&key=${encodeURIComponent(newKey)}`;
    const sent=await linePush(target.line_user_id,`お振込みによるご入金を確認いたしました。\nこのたびは正式にご注文いただき、ありがとうございます。\n\nSITE ID：${newSiteId}\n\n下の専用URLから制作内容・写真をご入力ください。入力途中でも自動保存され、同じURLなら別端末・別ブラウザから続けられます。\n\n${url}`);
    const warning=sent.skipped||sent.ok===false?'お客様へのLINE送信に失敗しました。注文管理画面からURLを再送してください。':null;
    if(warning)await notifyOwner(`【要対応：制作案内LINE送信失敗】\n注文ID ${orderCode}\nSITE ID ${newSiteId}\n${warning}`);
    return json({ok:true,site_id:newSiteId,...(warning?{warning}:{})});
  }

  if(action==='review_load' || action==='review_revision' || action==='review_approve' || action==='review_publish'){
    if(!/^[A-Za-z0-9_-]{3,32}$/.test(siteId)||key.length<20)return json({error:'確認URLが無効です。'},403);
    const {data:reviewSite,error:reviewError}=await admin.from('website_sites')
      .select('site_id,site_name,status,preview_url,customer_approved,review_access_token_hash,repo_full_name,publish_branch,preview_branch,live_path,custom_domain')
      .eq('site_id',siteId)
      .maybeSingle();
    if(reviewError)throw reviewError;
    if(!reviewSite?.review_access_token_hash||await sha256Hex(key)!==reviewSite.review_access_token_hash){
      return json({error:'確認URLが無効です。LINEで届いた最新のURLをご利用ください。'},403);
    }
    if(action==='review_load'){
      const {review_access_token_hash, ...publicReview}=reviewSite;
      return json({ok:true,site:publicReview});
    }
    if(reviewSite.status!=='customer_review')return json({error:'現在は最終確認を受け付ける状態ではありません。'},409);
    if(action==='review_revision'){
      const detail=String(body?.detail||'').trim();
      if(!detail)return json({error:'修正内容を入力してください。'},400);
      await admin.from('website_sites').update({
        status:'building',customer_approved:false,current_note:'お客様から修正依頼。再作成中。',review_access_token_hash:null
      }).eq('site_id',siteId);
      await admin.from('website_activity').insert({
        site_id:siteId,actor_type:'customer_line',action:'customer_revision_requested',detail
      });
      await admin.from('website_jobs').insert({
        site_id:siteId,kind:'customer_revision',status:'queued',instruction:detail,payload:{source:'secure_review'}
      });
      EdgeRuntime.waitUntil(triggerWebsiteWorker(siteId).catch(e=>console.error('worker trigger',e)));
      await notifyOwner('【修正依頼】SITE ID '+siteId+'\n'+detail.slice(0,1200));
      return json({ok:true,status:'building'});
    }
    if(action==='review_approve'){
      await admin.from('website_sites').update({
        customer_approved:true,current_note:'お客様が内容承認。公開操作待ち。'
      }).eq('site_id',siteId);
      await admin.from('website_activity').insert({
        site_id:siteId,actor_type:'customer_line',action:'customer_approved',detail:'サイト内容を承認。SHO公開待ち。'
      });
      await notifyOwner('【お客様確認OK】SITE ID '+siteId+'\n公開操作を行ってください。');
      return json({ok:true,customer_approved:true});
    }
    if(action==='review_publish'){
      if(!reviewSite.customer_approved)return json({error:'先にサイト内容を承認してください。'},409);
      if(!reviewSite.repo_full_name)return json({error:'公開先がまだ設定されていません。'},409);
      const repo=String(reviewSite.repo_full_name).split('/');
      if(repo.length!==2)return json({error:'公開先の設定が不正です。'},409);
      const publicUrl=reviewSite.custom_domain?'https://'+String(reviewSite.custom_domain).replace(/^https?:\/\//,'').replace(/\/$/,'')+'/':'https://'+repo[0]+'.github.io/'+repo[1]+'/';
      await publishApprovedStagedBranch(reviewSite.repo_full_name,reviewSite.publish_branch||'main',reviewSite.preview_branch);
      await setGithubPagesSource(reviewSite.repo_full_name,reviewSite.publish_branch||'main',reviewSite.live_path||'/');
      const now=new Date(),published=now.toISOString();
      const {data:oldSiteDates,error:oldSiteDatesError}=await admin.from('website_sites').select('published_at,adjustment_free_until,update_free_until').eq('site_id',siteId).single();if(oldSiteDatesError)throw oldSiteDatesError;
      const firstPublication=!oldSiteDates.published_at;
      const {data:publishingOrder,error:publishingOrderError}=await admin.from('website_orders').select('plan').eq('site_id',siteId).maybeSingle();if(publishingOrderError)throw publishingOrderError;
      const {error:siteUpdateError}=await admin.from('website_sites').update({
        status:'live',public_url:publicUrl,preview_url:publicUrl,published_at:oldSiteDates.published_at||published,
        adjustment_free_until:firstPublication?new Date(now.getTime()+30*86400000).toISOString():oldSiteDates.adjustment_free_until,
        update_free_until:firstPublication&&publishingOrder&&['semi','full'].includes(publishingOrder.plan)?afterMonths(now,3):oldSiteDates.update_free_until,
        current_note:'お客様確認・公開完了。',customer_approved:false,
        review_access_token_hash:null,preview_access_token_hash:null,preview_branch:null
      }).eq('site_id',siteId);
      if(siteUpdateError)throw siteUpdateError;
      const updateKey=randomAccessKey();
      const {error:orderUpdateError}=await admin.from('website_orders').update({customer_access_token_hash:await sha256Hex(updateKey),access_token_created_at:published,update_free_until:firstPublication&&publishingOrder&&['semi','full'].includes(publishingOrder.plan)?afterMonths(now,3):oldSiteDates.update_free_until}).eq('site_id',siteId);
      if(orderUpdateError)console.error('Failed to set free update period',String(orderUpdateError));
      await admin.from('website_jobs').update({status:'done'}).eq('site_id',siteId).eq('status','sho_review');
      await admin.from('website_update_requests').update({status:'completed'}).eq('site_id',siteId).eq('status','building');
      await admin.from('website_activity').insert({site_id:siteId,actor_type:'customer_line',action:'published',detail:'お客様の承認を受けてサイトを公開。'});
      await notifyOwner('【サイト公開】SITE ID '+siteId+'\\n'+publicUrl);
      const {data:lineLink}=await admin.from('website_line_links').select('line_user_id').eq('site_id',siteId).maybeSingle();
      const updateUrl='https://sho-support.github.io/website-update.html?id='+encodeURIComponent(siteId)+'&key='+updateKey;
      await linePush(lineLink?.line_user_id,'ホームページを公開しました。\\n'+publicUrl+'\\n\\n公開後の更新・修正依頼はこちらから送れます。\\n'+updateUrl);
      return json({ok:true,status:'live',public_url:publicUrl});
    }
  }

  const order=await resolveAccess(admin,siteId,key);
  if(!order) return json({error:'専用URLが無効です。LINEで届いた最新のURLをご利用ください。'},403);

  const { data: site, error: siteError } = await admin
    .from('website_sites')
    .select('site_id,site_name,status,updated_at,adjustment_free_until,update_free_until')
    .eq('site_id',siteId)
    .single();
  if(siteError) throw siteError;

  if(action==='load'){
    const {data:intake,error}=await admin.from('website_intakes').select('payload,last_saved_at,submitted_at').eq('site_id',siteId).maybeSingle();
    if(error) throw error;
    return new Response(JSON.stringify({
      ok:true,
      site,
      order:{order_code:order.order_code,plan:order.plan,template_style:order.template_style},
      intake:intake||null
    }),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':allowedOrigin}});
  }

  if(action==='update_status')return json({ok:true,site,plan:order.plan});
  if(action==='request_update'){
    if(site.status!=='live')return json({error:'公開中のサイトのみ更新を受け付けています。'},409);
    const detail=String(body?.detail||'').trim();
    if(detail.length<3||detail.length>5000)return json({error:'更新内容を3〜5000文字で入力してください。'},400);
    const uploaded=body?.files&&typeof body.files==='object'&&!Array.isArray(body.files)?body.files:{};
    const folders=['top_photos','gallery_photos','logo_file','member_photos'];
    const safeFiles:any={};
    for(const f of folders){
      const list=Array.isArray(uploaded[f])?uploaded[f]:[];
      if(list.length>25)return json({error:'1回の添付枚数が多すぎます。'},400);
      safeFiles[f]=[];
      for(const item of list){
        const path=String(item?.path||''),name=String(item?.name||'').slice(0,120);
        if(!path.startsWith(siteId+'/secure-intake/'+f+'/')||path.includes('..')||!name)return json({error:'添付ファイルを確認してください。'},400);
        safeFiles[f].push({path,name});
      }
    }
    const now=new Date(),jst=new Date(now.getTime()+9*3600000),start=new Date(Date.UTC(jst.getUTCFullYear(),jst.getUTCMonth(),1,-9,0,0));
    const {count,error:countError}=await admin.from('website_update_requests').select('id',{count:'exact',head:true}).eq('site_id',siteId).eq('billing_category','free_monthly').neq('status','cancelled').gte('created_at',start.toISOString());
    if(countError)throw countError;
    let category='estimate_required';
    if(site.update_free_until&&new Date(site.update_free_until)>now&&(count||0)<8)category='free_monthly';
    else if(site.adjustment_free_until&&new Date(site.adjustment_free_until)>now)category='free_adjustment_review';
    const {data:recent,error:recentErr}=await admin.from('website_update_requests').select('id').eq('site_id',siteId).gte('created_at',new Date(now.getTime()-3600000).toISOString()).limit(10);
    if(recentErr)throw recentErr;
    if((recent||[]).length>=5)return json({error:'短時間に更新依頼が続いています。時間をおいてご連絡ください。'},429);
    const {data:ticket,error:ticketErr}=await admin.from('website_update_requests').insert({site_id:siteId,request_note:detail,files:safeFiles,billing_category:category,status:'pending_sho'}).select('id').single();
    if(ticketErr)throw ticketErr;
    await admin.from('website_activity').insert({site_id:siteId,actor_type:'customer_line',action:'update_requested',detail:'更新依頼 #'+ticket.id+' / '+detail.slice(0,1800),payload:{update_request_id:ticket.id,billing_category:category}});
    await notifyOwner('【更新依頼】SITE ID '+siteId+' / #'+ticket.id+' / 区分: '+category+' / '+detail.slice(0,1200));
    return json({ok:true,request_id:ticket.id,category,status:'pending_sho'});
  }
  if(site.status!=='request_waiting'&&!(action==='signed_upload'&&site.status==='live')){
    return json({error:'初回ヒアリングは送信済みです。更新は専用フォームからお願いします。'},409);
  }

  if(action==='save_draft'){
    const raw=JSON.stringify(body?.payload||{});
    if(raw.length>500000) return json({error:'入力内容が大きすぎます。'},413);
    const payload=forceOrderFields(body?.payload||{},order);
    const savedAt=new Date().toISOString();
    const {error}=await admin.from('website_intakes').upsert({
      site_id:siteId,payload,last_saved_at:savedAt
    },{onConflict:'site_id'});
    if(error) throw error;
    return json({ok:true,last_saved_at:savedAt});
  }

  if(action==='signed_upload'){
    const folder=String(body?.folder||'');
    if(!['top_photos','gallery_photos','logo_file','member_photos'].includes(folder)) return json({error:'アップロード先が不正です。'},400);
    const safeName=String(body?.file_name||'file').replace(/[^A-Za-z0-9._-]+/g,'_').slice(-100)||'file';
    const path=`${siteId}/secure-intake/${folder}/${crypto.randomUUID()}-${safeName}`;
    const {data,error}=await admin.storage.from('website-intake-files').createSignedUploadUrl(path);
    if(error) throw error;
    return json({ok:true,path,token:data.token});
  }

  if(action==='submit_intake'){
    const raw=JSON.stringify(body?.payload||{});
    if(raw.length>500000) return json({error:'入力内容が大きすぎます。'},413);
    const payload=forceOrderFields(body?.payload||{},order);
    const f=payload.fields||{},checks=payload.checks||{};
    if(!String(f.site_name||'').trim()) return json({error:'サイト名 / バンド名 / 店名を入力してください。'},400);
    if(!Array.isArray(checks.rights)||!checks.rights.length) return json({error:'掲載権利の確認にチェックしてください。'},400);
    if(!Array.isArray(checks.privacy)||!checks.privacy.length) return json({error:'公開用連絡先の掲載許可を確認してください。'},400);

    const submittedAt=new Date().toISOString();
    const {error:intakeError}=await admin.from('website_intakes').upsert({
      site_id:siteId,payload,last_saved_at:submittedAt,submitted_at:submittedAt
    },{onConflict:'site_id'});
    if(intakeError) throw intakeError;

    const {error:updateSiteError}=await admin.from('website_sites').update({
      site_name:String(f.site_name||'').trim(),
      status:'building',
      current_note:'ヒアリング内容を受信。サイト作成中。',
      customer_approved:false,
    }).eq('site_id',siteId).eq('status','request_waiting');
    if(updateSiteError) throw updateSiteError;

    await admin.from('website_profiles').upsert({
      site_id:siteId,
      industry:String(f.purpose||''),
      summary:String(f.image_text||''),
      preferences:{
        mood:f.image_text?[String(f.image_text)]:[],
        colors:f.colors?[String(f.colors)]:[],
        likes:Array.isArray(checks.features)?checks.features:[],
        dislikes:[],
      },
      decisions:{
        live_layout:Array.isArray(checks.live_all_page)&&checks.live_all_page.length?'all_live_on_separate_page':'upcoming_on_top_history_separate',
        custom_domain_requested:Array.isArray(checks.custom_domain)&&checks.custom_domain.length>0,
      },
    },{onConflict:'site_id'});

    await admin.from('website_activity').insert({
      site_id:siteId,actor_type:'customer_line',action:'intake_submitted',detail:'専用ヒアリングURLから送信。'
    });
    await admin.from('website_jobs').insert({
      site_id:siteId,kind:'initial_create',status:'queued',
      instruction:'最新のヒアリング内容をもとにサイトを制作してください。',
      payload:{source:'secure_intake'}
    });
    EdgeRuntime.waitUntil(triggerWebsiteWorker(siteId).catch((e)=>console.error('worker trigger',e)));
    await notifyOwner(`【SHO WEB SUPPORT】\nSITE ID ${siteId}\nヒアリング送信済み。制作を開始します。\n${String(f.site_name||'')}`);
    return json({ok:true,submitted_at:submittedAt});
  }

  return json({error:'Unknown action'},400);
});