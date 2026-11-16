import {cloudflareHostingEnabled} from '../_shared/hosting-mode.ts';
import {frozenPreviewFile} from '../_shared/hosting-service.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { verifyWebsiteBeforeDelivery } from './_shared/website.ts';

const noCache={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'cross-origin','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
const error=(message:string,status:number)=>new Response(message,{status,headers:{...noCache,'Content-Type':'text/plain; charset=utf-8'}});
const sha256=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const validPath=(s:string)=>s.length>0&&s.length<=300&&!s.startsWith('/')&&!s.includes('\\')&&!s.split('/').some(p=>p==='..'||p==='.'||p.startsWith('.git'))&&!s.startsWith('docs/')&&/^[\w.\-/ ]+$/.test(s);
function proxy(raw:string,path:string,base:string){
 if(!raw||/^(?:https?:|data:|mailto:|tel:|javascript:|blob:|\/\/|#)/i.test(raw))return raw;
 try{
  const u=new URL(raw,'https://preview.invalid/'+path);
  if(u.origin!=='https://preview.invalid')return raw;
  const next=decodeURIComponent(u.pathname.slice(1));
  if(!validPath(next))return raw;
  return base+'&path='+encodeURIComponent(next)+(u.hash||'');
 }catch{return raw}
}
function rewrite(s:string,path:string,base:string,css:boolean){
 const viewer=(raw:string)=>{
  if(!/\.html?(?:[?#]|$)/i.test(raw))return proxy(raw,path,base);
  const ref=proxy(raw,path,base);
  if(ref===raw)return raw;
  const param=ref.slice(base.length+1);
  return 'https://sho-web-support.netlify.app/website-preview.html?'+base.split('?')[1]+'&'+param;
 };
 if(!css){
   s=s.replace(/\b(href|src|poster|action)\s*=\s*(["'])(.*?)\2/gi,(_,attr,q,v)=>attr+'='+q+(attr.toLowerCase()==='href'?viewer(v):proxy(v,path,base)).replace(/&/g,'&amp;')+q);
   s=s.replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi,(_,q,v)=>'srcset='+q+v.split(',').map((part:string)=>{const m=part.trim().match(/^(\S+)(\s+.*)?$/);return m?proxy(m[1],path,base).replace(/&/g,'&amp;')+(m[2]||''):part}).join(', ')+q);
 }
 return s.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi,(_,q,v)=>'url('+q+proxy(v.trim(),path,base)+q+')');
}
const types:Record<string,string>={html:'text/html; charset=utf-8',htm:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',json:'application/json',svg:'image/svg+xml',png:'image/png',webp:'image/webp',avif:'image/avif',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',ico:'image/x-icon',woff:'font/woff',woff2:'font/woff2',mp4:'video/mp4',pdf:'application/pdf',txt:'text/plain; charset=utf-8'};
Deno.serve(async(req)=>{
 try{
  if(req.method==='OPTIONS')return new Response('ok',{headers:noCache});
  if(req.method!=='GET')return error('Method not allowed',405);
  const u=new URL(req.url),id=u.searchParams.get('id')||'',key=u.searchParams.get('key')||'',path=u.searchParams.get('path')||'index.html';
  if(!/^[A-Za-z0-9_-]{3,32}$/.test(id)||!/^[A-Za-z0-9_-]{20,200}$/.test(key)||!validPath(path))return error('Invalid preview URL',403);
  const db=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}});
  const {data:site,error:dbError}=await db.from('website_sites').select('repo_full_name,publish_branch,preview_branch,status,preview_access_token_hash,review_access_token_hash').eq('site_id',id).maybeSingle();
  if(dbError)throw dbError;
  const hash=await sha256(key);
  if(!site?.repo_full_name||(hash!==site.preview_access_token_hash&&hash!==site.review_access_token_hash))return error('Preview link expired',403);
  if(site.status==='live')return error('Preview ended. Visit the public site.',403);
  let bytes:Uint8Array;
  if(cloudflareHostingEnabled()){
    const result=await frozenPreviewFile(db,id,path,u.searchParams.get('qa')==='1');
    if(u.searchParams.get('qa')==='1')return new Response(JSON.stringify(result),{status:200,headers:{...noCache,'Content-Type':'application/json; charset=utf-8'}});
    bytes=result as Uint8Array;
  }else{
  if(u.searchParams.get('qa')==='1'){
    const {data:order,error:orderError}=await db.from('website_orders').select('plan,template_style').eq('site_id',id).maybeSingle();
    if(orderError)throw orderError;
    try{
      const check=await verifyWebsiteBeforeDelivery(site.repo_full_name,site.preview_branch||site.publish_branch||'main',order?.plan==='semi'?String(order.template_style||''):'');
      return new Response(JSON.stringify({ok:true,css:check.inline_css,files:check.files}),{status:200,headers:{...noCache,'Content-Type':'application/json; charset=utf-8'}});
    }catch(e){return new Response(JSON.stringify({ok:false,error:String((e as Error).message||e).slice(0,300)}),{status:422,headers:{...noCache,'Content-Type':'application/json; charset=utf-8'}})}
  }
  const m=String(site.repo_full_name).match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if(!m)return error('Missing preview repository',404);
  const token=Deno.env.get('GITHUB_PAGES_TOKEN')||'';
  if(!token)return error('Preview unavailable',503);
  const endpoint='https://api.github.com/repos/'+m[1]+'/'+m[2]+'/contents/'+path.split('/').map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(site.preview_branch||site.publish_branch||'main');
  const github=await fetch(endpoint,{headers:{Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28',Accept:'application/vnd.github.raw+json'}});
  if(!github.ok)return error('Preview file unavailable',github.status===404?404:502);
  const limit=8_000_000;
  const declaredSize=Number(github.headers.get('content-length')||0);
  if(declaredSize>limit)return error('Preview file too large',413);
  const buffer=await github.arrayBuffer();
  if(buffer.byteLength>limit)return error('Preview file too large',413);
  bytes=new Uint8Array(buffer);
  // GitHub Contents API may return a JSON/base64 envelope even with the raw
  // media type. Normalize it before assigning the image MIME type.
  if(bytes[0]===123 && (github.headers.get('content-type')||'').includes('json')){
    const obj=JSON.parse(new TextDecoder().decode(bytes));
    if(obj?.encoding==='base64' && typeof obj.content==='string'){
      const raw=atob(obj.content.replace(/\s+/g,''));
      if(raw.length>limit)return error('Preview file too large',413);
      bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    }
  }
  }
  const ext=(path.match(/\.([A-Za-z0-9]+)$/)?.[1]||'html').toLowerCase(),ct=types[ext]||'application/octet-stream';
  if(ext==='png' && !(bytes.length>=8&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10))return error('Preview file is not a PNG image',502);
  if((ext==='jpg'||ext==='jpeg') && !(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255))return error('Preview file is not a JPEG image',502);
  if(ext==='webp' && !(bytes.length>=12&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP'))return error('Preview file is not a WebP image',502);
  if(ext==='html'||ext==='htm'||ext==='css'){
   // req.url is an internal Edge Runtime URL in some deployments (http://.../website-preview).
   // Never use it for browser-facing asset links: use the public HTTPS Functions URL.
   const publicRoot=new URL(Deno.env.get('SUPABASE_URL')||'');
   if(publicRoot.protocol!=='https:'||!publicRoot.hostname.endsWith('.supabase.co'))throw new Error('Invalid public Supabase URL');
   const base=publicRoot.origin+'/functions/v1/website-preview?id='+encodeURIComponent(id)+'&key='+encodeURIComponent(key);
   const content=rewrite(new TextDecoder().decode(bytes),path,base,ext==='css');
   return ext==='css'?new Response(content,{status:200,headers:{...noCache,'Content-Type':ct}}):new Response(JSON.stringify({html:content}),{status:200,headers:{...noCache,'Content-Type':'application/json; charset=utf-8'}});
  }
  return new Response(new Uint8Array(bytes).buffer,{status:200,headers:{...noCache,'Content-Type':ct}});
 }catch(e){console.error('website-preview:',String(e));return error('Preview unavailable',500);}
});
