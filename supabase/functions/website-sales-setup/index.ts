import {adminClient,getUser} from '../_shared/website.ts';
import {handleCommercialAction} from '../_shared/commercial-routes.ts';
const origins=new Set(['https://sho-web-support.netlify.app','https://sho-support.github.io']);
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':origins.has(origin)?origin:'https://sho-web-support.netlify.app','access-control-allow-headers':'authorization, content-type, apikey, x-client-info','access-control-allow-methods':'POST, OPTIONS'};
 const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&!origins.has(origin))return json({error:'Forbidden'},403);
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 if(Number(req.headers.get('content-length')||0)>16000)return json({error:'Request too large'},413);
 try{
  const raw=await req.text();if(raw.length>16000)return json({error:'Request too large'},413);
  const body=JSON.parse(raw);
  if(!['admin_get_sales_settings','admin_save_sales_settings','admin_commercial_policy_status'].includes(body?.action))return json({error:'Forbidden'},403);
  const admin=adminClient(),user=await getUser(req,admin);if(!user)return json({error:'ログインが必要です。'},401);
  const found=await admin.from('website_admins').select('user_id').eq('user_id',user.id).maybeSingle();
  if(found.error||!found.data)return json({error:'管理者権限が必要です。'},403);
  return await handleCommercialAction({body,admin,user,dependencies:{json}})||json({error:'Unsupported action'},400);
 }catch{return json({error:'設定処理に失敗しました。入力内容またはログイン状態を確認してください。'},400);}
});
