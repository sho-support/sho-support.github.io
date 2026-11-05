import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const reject=(status=403)=>new Response('Not available',{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex'}});
function fromB64url(s:string){const raw=s.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(raw+'='.repeat((4-raw.length%4)%4)),c=>c.charCodeAt(0))}
async function checkOIDC(token:string){
 try{
  const p=token.split('.');if(p.length!==3)return false;
  const header=JSON.parse(new TextDecoder().decode(fromB64url(p[0])));
  const claims=JSON.parse(new TextDecoder().decode(fromB64url(p[1])));
  const now=Math.floor(Date.now()/1000);
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.jku||header.jwk||header.x5u)return false;
  if(claims.iss!=='https://token.actions.githubusercontent.com'||claims.aud!=='sho-private-qa')return false;
  if(claims.repository!=='sho-support/sho-support.github.io'||claims.ref!=='refs/heads/main')return false;
  if(claims.workflow_ref!=='sho-support/sho-support.github.io/.github/workflows/qa-private-site.yml@refs/heads/main')return false;
  if(!(Number(claims.exp)>now&&Number(claims.iat)<=now+60&&(!claims.nbf||Number(claims.nbf)<=now+60)))return false;
  const r=await fetch('https://token.actions.githubusercontent.com/.well-known/jwks',{signal:AbortSignal.timeout(8000)});
  if(!r.ok)return false;
  const jwks=await r.json();
  const jwk=(jwks.keys||[]).find((k:any)=>k.kid===header.kid&&k.kty==='RSA'&&k.n&&k.e);
  if(!jwk)return false;
  const key=await crypto.subtle.importKey('jwk',{kty:'RSA',n:jwk.n,e:jwk.e,ext:true},{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,fromB64url(p[2]),new TextEncoder().encode(p[0]+'.'+p[1]));
 }catch(e){console.error('OIDC verification failed',String(e).slice(0,130));return false}
}
Deno.serve(async req=>{
 if(req.method!=='GET'&&req.method!=='POST')return reject(404);
 const bearer=req.headers.get('authorization')||'';
 const token=bearer.replace(/^Bearer\s+/i,'');
 if(!token||!(await checkOIDC(token)))return reject();
 const url=new URL(req.url),path=url.searchParams.get('path')||'index.html';
 const qaSite=url.searchParams.get('site_id')||'1241';
 if(!['1241','qafull5nov04','qaone20261102'].includes(qaSite))return reject(404);
 const multi=qaSite==='qafull5nov04',one=qaSite==='qaone20261102';
 if(req.method==='GET'&&url.searchParams.get('info')!=='job'&&!(multi?['index.html','live.html','about.html','gallery.html','contact.html','style.css','site.js'].includes(path):one?path==='index.html':(path==='index.html'||/^assets\/(?:top_photos|gallery_photos|logo_file)\/[A-Za-z0-9._-]+$/.test(path))))return reject(404);
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',project=Deno.env.get('SUPABASE_URL')||'';
 const github=Deno.env.get('GITHUB_PAGES_TOKEN')||'';
 if(!service||!project||!github)return reject(503);
 const admin=createClient(project,service,{auth:{persistSession:false}});
 const {data:site,error}=await admin.from('website_sites').select('status,published_at,repo_full_name,preview_branch,publish_branch').eq('site_id',qaSite).maybeSingle();
 if(error||!site||site.published_at||!(multi?['building','sho_review'].includes(site.status):site.status==='sho_review')||
   (site.repo_full_name&&site.repo_full_name!=='sho-support/site-'+qaSite)||(!multi&&!site.repo_full_name))return reject(404);
 if(url.searchParams.get('info')==='job'&&req.method==='GET'){
  const {data:jobs,error:jobError}=await admin.from('website_jobs').select('id,status,created_at').eq('site_id',qaSite).order('created_at',{ascending:false}).limit(1);
  if(jobError)return reject(500);
  return new Response(JSON.stringify({job:jobs?.[0]||null}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }
 if(req.method==='POST'){
  const body=await req.json().catch(()=>({}));
  if(multi&&body.action==='qa-report-pass'){
    if(site.status!=='sho_review'||Number(body.pages)!==5||Number(body.viewports)!==2)return reject(409);
    const {error:writeErr}=await admin.from('website_activity').insert({
      site_id:qaSite,actor_type:'ai',action:'qa_full_browser_pass',
      detail:'署名付きGitHub Actionsによる実AI5ページのPC・スマホ表示、リンク・CSS・JavaScript検証に合格。',
      payload:{site_id:qaSite,pages:5,viewports:2,method:'github_oidc_playwright',note:'internal_qa_only'}
    });
    if(writeErr)return reject(500);
    return new Response(JSON.stringify({ok:true,recorded:true}),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  if(one&&body.action==='qa-report-one-pass'){
    if(site.status!=='sho_review'||Number(body.viewports)!==2)return reject(409);
    const {error:writeErr}=await admin.from('website_activity').insert({
      site_id:qaSite,actor_type:'ai',action:'qa_one_browser_pass',
      detail:'署名付きGitHub Actionsによる1ページ完結の制作HTML、文章・公演情報、PC・スマホ表示に合格。',
      payload:{site_id:qaSite,viewports:2,method:'github_oidc_playwright',note:'internal_qa_only'}
    });
    if(writeErr)return reject(500);
    return new Response(JSON.stringify({ok:true,recorded:true}),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  if(!multi&&!one&&body.action==='qa-report-semi-pass'){
    if(site.status!=='sho_review'||Number(body.viewports)!==2)return reject(409);
    const {error:writeErr}=await admin.from('website_activity').insert({
      site_id:qaSite,actor_type:'ai',action:'qa_semi_browser_pass',
      detail:'署名付きGitHub Actionsによる実セミオーダー・サイバーテンプレートの写真読み込み、CSS、PC・スマホ表示に合格。',
      payload:{site_id:qaSite,viewports:2,method:'github_oidc_playwright',note:'internal_qa_only'}
    });
    if(writeErr)return reject(500);
    return new Response(JSON.stringify({ok:true,recorded:true}),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  if(!one&&body.action==='qa-dispatch-existing'){
    const {data:latest,error:lookupError}=await admin.from('website_jobs').select('id,kind,payload').eq('site_id',qaSite).eq('status','queued').order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(lookupError||!latest||(multi?(latest.kind!=='initial_create'||latest.payload?.qa_rebuild!==true):(latest.kind!=='sho_revision'||latest.payload?.qa_silent!==true)))return reject(409);
    const response=await fetch(project+'/functions/v1/website-worker',{method:'POST',
      headers:{Authorization:'Bearer '+service,apikey:service,'Content-Type':'application/json'},body:JSON.stringify({site_id:qaSite})});
    if(!response.ok)return reject(502);
    return new Response(JSON.stringify({ok:true,job_id:latest.id}),{status:202,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  if(body.action!=='qa-rebuild'||multi||one)return reject(403);
  const {data:active}=await admin.from('website_jobs').select('id').eq('site_id','1241').in('status',['queued','running']).limit(1);
  if(active?.length)return reject(409);
  const {data:queued,error:insertErr}=await admin.from('website_jobs').insert({site_id:'1241',kind:'sho_revision',status:'queued',
    instruction:'QA: restore the purchased cyber template without redesign. Do not publish or notify the customer.',
    payload:{qa_rebuild:true,source:'signed_github_qa'}}).select('id').single();
  if(insertErr||!queued)return reject(500);
  const dispatch=await fetch(project+'/functions/v1/website-worker',{method:'POST',
    headers:{Authorization:'Bearer '+service,apikey:service,'Content-Type':'application/json'},
    body:JSON.stringify({site_id:'1241'})});
  if(!dispatch.ok)return reject(502);
  return new Response(JSON.stringify({ok:true,job_id:queued.id}),{status:202,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }
 if(!site.repo_full_name)return reject(404);
 const branch=site.preview_branch||site.publish_branch||'main';
 const target='https://api.github.com/repos/sho-support/site-'+qaSite+'/contents/'+path.split('/').map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(branch);
 const r=await fetch(target,{signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+github,Accept:'application/vnd.github.raw+json','X-GitHub-Api-Version':'2022-11-28'}});
 if(!r.ok)return reject(404);
 const b=await r.arrayBuffer();
 if(b.byteLength>9000000)return reject(413);
 const type=path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.png')?'image/png':/\.(?:jpg|jpeg)$/i.test(path)?'image/jpeg':path.endsWith('.webp')?'image/webp':'application/octet-stream';
 return new Response(b,{status:200,headers:{'Content-Type':type,'Cache-Control':'no-store','X-Robots-Tag':'noindex,nofollow','X-Content-Type-Options':'nosniff'}});
});