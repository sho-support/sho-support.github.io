import { adminClient, json, notifyOwner } from '../_shared/website.ts';

const allowedOrigin = 'https://sho-support.github.io';

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
  };
}

function code(){
  const d=new Date();
  const date=d.toISOString().slice(0,10).replaceAll('-','');
  const rand=crypto.randomUUID().replaceAll('-','').slice(0,6).toUpperCase();
  return `ORD-${date}-${rand}`;
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
  const orderCode=code();
  const selections={
    plan:v.plan,
    template_style:v.template_style,
    update_plan:v.update_plan,
    custom_domain:v.custom_domain,
    custom_domain_note:v.custom_domain_note,
    source:'website-order',
  };

  const admin=adminClient();
  const {data,error}=await admin.from('website_orders').insert({
    order_code:orderCode,
    status:'pending_line',
    plan:v.plan,
    template_style:v.template_style,
    update_plan:v.update_plan,
    custom_domain:v.custom_domain,
    custom_domain_note:v.custom_domain_note||null,
    amount_from:amount,
    selections,
  }).select('order_code,status,plan,template_style,update_plan,custom_domain,amount_from,created_at').single();
  if(error) throw error;

  await notifyOwner(`【新規仮注文】\n${orderCode}\nプラン: ${v.plan}\n金額: ¥${amount.toLocaleString()}〜\nLINE送信待ち`);
  return new Response(JSON.stringify({ok:true,order:data}),{status:201,headers:{
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':allowedOrigin
  }});
});