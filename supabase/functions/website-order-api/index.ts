import { adminClient, json, notifyOwner } from './_shared/website.ts';

const allowedOrigin = 'https://sho-support.github.io';

async function requestHash(req:Request){
  const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')||'';
  if(!ip.trim())return '';
  const ua=req.headers.get('user-agent')||'';
  const raw=(ip.split(',')[0].trim()+'|'+ua.slice(0,160));
  const bytes=new TextEncoder().encode(raw);
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return [...hash].map(b=>b.toString(16).padStart(2,'0')).join('');
}

function validBody(body:any){
  const plan=String(body?.plan||'');
  if(!['one','semi','full'].includes(plan)) return null;
  const templateStyle=String(body?.template_style||'').slice(0,32);
  if(plan==='semi'&&!['rock','cafe','cute','minimal','premium','pop','vintage','cyber','organic','editorial'].includes(templateStyle)) return null;
  const updatePlan=String(body?.update_plan||'none');
  if(!['none','live','standard','unlimited','free3'].includes(updatePlan)) return null;
  return {
    plan,
    template_style: plan==='semi'?templateStyle:null,
    update_plan: plan==='semi'||plan==='full'?'free3':updatePlan,
    custom_domain:Boolean(body?.custom_domain),
    custom_domain_note:String(body?.custom_domain_note||'').slice(0,300),
    extra_request:String(body?.extra_request||'').trim().slice(0,1500),
  };
}

async function code(admin: ReturnType<typeof adminClient>, plan: string){
  const { data, error } = await admin.rpc('next_website_order_number');
  if(error) throw error;
  const n=String(Number(data)).padStart(4,'0');
  const prefix=plan==='full'?'F':plan==='semi'?'S':'P';
  return prefix+n;
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:{
    'Access-Control-Allow-Origin':allowedOrigin,
    'Access-Control-Allow-Headers':'content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
  }});
  if(req.method!=='POST') return json({error:'Method not allowed'},405);

  const origin=req.headers.get('origin')||'';
  if(origin&&origin!==allowedOrigin) return json({error:'Forbidden'},403);

  const raw=await req.text();
  if(raw.length>12000) return json({error:'Request too large'},413);
  let body:any; try{body=JSON.parse(raw)}catch{return json({error:'Invalid request'},400)}
  if(String(body?.website||'')) return json({ok:true},200);

  const v=validBody(body);
  if(!v) return json({error:'注文内容を確認してください。'},400);

  const amount=v.plan==='one'?15000:v.plan==='semi'?22000:30000;
  const admin=adminClient();
  const reqHash=await requestHash(req);
  const since=new Date(Date.now()-60*60*1000).toISOString();
  if(reqHash){
    const {count:recentCount,error:limitError}=await admin.from('website_orders')
      .select('id',{count:'exact',head:true})
      .eq('request_hash',reqHash)
      .gte('created_at',since);
    if(limitError)throw limitError;
    if((recentCount||0)>=5)return json({error:'短時間に注文操作が繰り返されています。時間を置いてお試しください。'},429);
  }
  const orderCode=await code(admin,v.plan);
  const linkToken=Array.from(crypto.getRandomValues(new Uint8Array(20)),b=>b.toString(16).padStart(2,'0')).join('');
  const linkHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(linkToken))),b=>b.toString(16).padStart(2,'0')).join('');
  const selections={
    plan:v.plan,
    template_style:v.template_style,
    update_plan:v.update_plan,
    custom_domain:v.custom_domain,
    custom_domain_note:v.custom_domain_note,
    extra_request:v.extra_request,
    source:'website-order',
  };

  const {data,error}=await admin.from('website_orders').insert({
    order_code:orderCode,
    line_link_token_hash:linkHash,
    status:'pending_line',
    plan:v.plan,
    template_style:v.template_style,
    update_plan:v.update_plan,
    custom_domain:v.custom_domain,
    custom_domain_note:v.custom_domain_note||null,
    extra_request:v.extra_request||null,
    amount_from:amount,
    request_hash:reqHash,
    selections,
  }).select('order_code,status,plan,template_style,update_plan,custom_domain,amount_from,created_at').single();
  if(error) throw error;

  await notifyOwner(`【新規仮注文】\n${orderCode}\nプラン: ${v.plan}\n金額: ¥${amount.toLocaleString()}〜\nLINE送信待ち`);
  return new Response(JSON.stringify({ok:true,order:{...data,link_token:linkToken}}),{status:201,headers:{
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':allowedOrigin
  }});
});