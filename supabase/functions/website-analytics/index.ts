import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type','Cache-Control':'no-store'};
const respond=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return respond({error:'Method not allowed'},405);
 try{
   const raw=await req.text();
   if(raw.length>1000)return respond({error:'Invalid input'},413);
   const body=JSON.parse(raw);
   const siteId=String(body?.site_id||'');
   if(!/^[A-Za-z0-9_-]{3,32}$/.test(siteId))return respond({error:'Invalid site'},400);
   const db=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}});
   // Counts only when site is truly live; prelaunch preview views do not contribute.
   const {data:site,error:siteErr}=await db.from('website_sites').select('status,published_at').eq('site_id',siteId).maybeSingle();
   if(siteErr)throw siteErr;
   if(!site||site.status!=='live'||!site.published_at)return respond({ok:true,counted:false});
   const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
   const {error}=await db.rpc('record_website_pageview',{p_site_id:siteId,p_day:day});
   if(error)throw error;
   return respond({ok:true,counted:true});
 }catch(e){console.error('pageview ingest',String(e));return respond({error:'Unable to record'},500)}
});