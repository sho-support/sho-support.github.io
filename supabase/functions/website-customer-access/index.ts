import { adminClient, getUser, json, linePush, notifyOwner, triggerWebsiteWorker } from '../_shared/website.ts';

const allowedOrigin = 'https://sho-support.github.io';

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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

  if(action==='admin_list_orders' || action==='admin_activate_order'){
    const user=await getUser(req,admin);
    if(!user)return json({error:'ログインが必要です。'},401);
    if(!(await isAdmin(admin,user.id)))return json({error:'管理者権限が必要です。'},403);

    if(action==='admin_list_orders'){
      const {data,error}=await admin.from('website_orders')
        .select('order_code,status,plan,template_style,update_plan,custom_domain,amount_from,line_user_id,line_display_name,line_linked_at,site_id,created_at,updated_at')
        .order('created_at',{ascending:false}).limit(200);
      if(error)throw error;
      return json({orders:data||[]});
    }

    const orderCode=String(body?.order_code||'').trim().toUpperCase();
    if(!/^[FSP]\d{4,6}$/.test(orderCode))return json({error:'注文IDが不正です。'},400);
    const {data:target,error:orderError}=await admin.from('website_orders').select('*').eq('order_code',orderCode).maybeSingle();
    if(orderError)throw orderError;
    if(!target)return json({error:'注文が見つかりません。'},404);
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
    await linePush(target.line_user_id,`ご確認ありがとうございます。\n\n正式なSITE IDは ${newSiteId} です。\n下の専用URLから制作内容・写真をご入力ください。入力途中でも自動保存され、同じURLなら別端末・別ブラウザから続けられます。\n\n${url}`);
    await linePush(target.line_user_id,`SITE ID ${newSiteId}`);
    await notifyOwner(`【案件作成】\n注文ID ${orderCode}\nSITE ID ${newSiteId}\nヒアリングURL送信済み`);
    return json({ok:true,site_id:newSiteId});
  }

  const order=await resolveAccess(admin,siteId,key);
  if(!order) return json({error:'専用URLが無効です。LINEで届いた最新のURLをご利用ください。'},403);

  const { data: site, error: siteError } = await admin
    .from('website_sites')
    .select('site_id,site_name,status,updated_at')
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

  if(site.status!=='request_waiting'){
    return json({error:'このヒアリングは送信済みです。追加のご相談はLINEからお送りください。'},409);
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
    if(!['top_photos','gallery_photos','logo_file'].includes(folder)) return json({error:'アップロード先が不正です。'},400);
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