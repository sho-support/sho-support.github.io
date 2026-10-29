import { adminClient, json, notifyOwner, triggerWebsiteWorker } from '../_shared/website.ts';

const allowedOrigin = 'https://sho-support.github.io';

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
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
    'Access-Control-Allow-Headers':'content-type, apikey, x-client-info',
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