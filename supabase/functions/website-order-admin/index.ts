import { adminClient, getUser, json, linePush, notifyOwner } from '../_shared/website.ts';

function randomAccessKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function sha256Hex(value:string){
  const bytes=new TextEncoder().encode(value);
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return [...hash].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function isAdmin(admin:any,userId:string){
  const {data,error}=await admin.from('website_admins').select('user_id').eq('user_id',userId).maybeSingle();
  if(error)throw error;
  return Boolean(data);
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:{
    'Access-Control-Allow-Origin':'https://sho-support.github.io',
    'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods':'POST, OPTIONS'
  }});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const admin=adminClient();
  const user=await getUser(req,admin);
  if(!user)return json({error:'ログインが必要です。'},401);
  if(!(await isAdmin(admin,user.id)))return json({error:'管理者権限が必要です。'},403);
  const body=await req.json().catch(()=>({}));
  const action=String(body?.action||'');

  if(action==='list'){
    const {data,error}=await admin.from('website_orders')
      .select('order_code,status,plan,template_style,update_plan,custom_domain,amount_from,line_user_id,line_display_name,line_linked_at,site_id,created_at,updated_at')
      .order('created_at',{ascending:false}).limit(200);
    if(error)throw error;
    return json({orders:data||[]});
  }

  if(action==='mark_paid'){
    const orderCode=String(body?.order_code||'').trim().toUpperCase();
    if(!/^[FSP]\d{4,6}$/.test(orderCode))return json({error:'注文IDが不正です。'},400);
    const {data:order,error:orderError}=await admin.from('website_orders').select('*').eq('order_code',orderCode).maybeSingle();
    if(orderError)throw orderError;
    if(!order)return json({error:'注文が見つかりません。'},404);
    if(!order.line_user_id)return json({error:'お客様のLINE送信がまだ確認できません。'},409);

    const siteId=orderCode.replace(/^[FSP]/,'');
    const key=randomAccessKey();
    const hash=await sha256Hex(key);
    const planLabel=order.plan==='one'?'1ページ完結サイト':order.plan==='semi'?'セミオーダーサイト':'フルオーダーサイト';

    const {data:existing,error:siteReadError}=await admin.from('website_sites').select('site_id').eq('site_id',siteId).maybeSingle();
    if(siteReadError)throw siteReadError;
    if(!existing){
      const {error:siteError}=await admin.from('website_sites').insert({
        site_id:siteId,site_name:planLabel,status:'request_waiting',
        current_note:'入金確認済み。ヒアリング入力待ち。',customer_approved:false,
        publish_branch:'main',live_path:'/',offline_path:'/docs'
      });
      if(siteError)throw siteError;
      const {error:intakeError}=await admin.from('website_intakes').insert({
        site_id:siteId,
        payload:{fields:{build_plan:order.plan,template_style:order.template_style||''},checks:{},members:[],lives:[],contacts:[],files:{top_photos:[],gallery_photos:[],logo_file:[]},meta:{}}
      });
      if(intakeError)throw intakeError;
      await admin.from('website_activity').insert({
        site_id:siteId,actor_type:'admin',actor_user_id:user.id,action:'site_created',
        detail:`注文 ${orderCode} の入金確認後に案件を作成。`
      });
    }

    const {error:linkError}=await admin.from('website_line_links').upsert({
      site_id:siteId,line_user_id:order.line_user_id,line_display_name:order.line_display_name||null
    },{onConflict:'site_id'});
    if(linkError)throw linkError;

    const {error:updateError}=await admin.from('website_orders').update({
      status:'site_created',site_id:siteId,customer_access_token_hash:hash,
      access_token_created_at:new Date().toISOString(),updated_at:new Date().toISOString()
    }).eq('order_code',orderCode);
    if(updateError)throw updateError;

    const url=`https://sho-support.github.io/website-intake.html?id=${encodeURIComponent(siteId)}&prod=1&key=${encodeURIComponent(key)}`;
    await linePush(order.line_user_id,`ご入金を確認しました。ありがとうございます。\n\n正式なSITE IDは ${siteId} です。\n下の専用URLから制作内容・写真をご入力ください。入力途中でも自動保存され、同じURLなら別端末・別ブラウザから続けられます。\n\n${url}`);
    await linePush(order.line_user_id,`SITE ID ${siteId}`);
    await notifyOwner(`【入金確認・案件作成】\n注文ID ${orderCode}\nSITE ID ${siteId}\nヒアリングURL送信済み`);
    return json({ok:true,site_id:siteId});
  }

  return json({error:'Unknown action'},400);
});