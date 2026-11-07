// Portable customer-site reader. Designed for Cloudflare Pages Functions + private R2.
// This is a prototype, NOT connected to a production bucket or domain.
const SITE_ID=/^[0-9]{4,10}$/;
const RELEASE=/^[0-9a-f]{12,64}$/;
const TYPES=Object.freeze({
  html:"text/html; charset=utf-8",css:"text/css; charset=utf-8",
  js:"text/javascript; charset=utf-8",mjs:"text/javascript; charset=utf-8",
  json:"application/json; charset=utf-8",txt:"text/plain; charset=utf-8",
  svg:"image/svg+xml",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",
  webp:"image/webp",gif:"image/gif",ico:"image/x-icon",
  avif:"image/avif",woff:"font/woff",woff2:"font/woff2",
  pdf:"application/pdf",mp4:"video/mp4",webm:"video/webm"
});
const notFound=()=>new Response("Not found",{status:404,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const fail=(status,message)=>new Response(message,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
function safePath(path){
  if(!path)return "index.html";
  if(path.length>512||!(/^[A-Za-z0-9._/-]+$/).test(path))return null;
  if(path.startsWith("/")||path.includes("//")||path.split("/").some(p=>p==="."||p===".."||p.startsWith(".")))return null;
  if(path.endsWith("/"))path+="index.html";
  if(!path.includes("."))return null;
  return path;
}
export async function handleCustomerRequest(request,env){
  if(request.method!=="GET"&&request.method!=="HEAD")return fail(405,"Method not allowed");
  const url=new URL(request.url);
  // Isolate every customer to a separate browser origin.
  // The customer URL is stable across origin/hosting-provider changes.
  const match=/^s([0-9]{4,10})\.sho-support\.com$/i.exec(url.hostname);
  if(!match)return notFound();
  const id=match[1];
  if(!SITE_ID.test(id))return notFound();
  if(url.pathname==="/healthz")return new Response("ok",{headers:{"Cache-Control":"no-store"}});
  const file=safePath(url.pathname.slice(1));
  if(!file)return notFound();
  if(!env.SITES||typeof env.SITES.get!=="function")return fail(503,"Storage unavailable");
  let manifest;
  try{
    const m=await env.SITES.get("sites/"+id+"/active.json");
    if(!m)return notFound();
    if(Number(m.size)>4096)return fail(503,"Invalid manifest");
    manifest=JSON.parse(await m.text());
  }catch{return fail(503,"Site manifest unavailable")}
  if(!manifest||manifest.status!=="live"||!RELEASE.test(manifest.release))return notFound();
  let object;
  try{object=await env.SITES.get("sites/"+id+"/releases/"+manifest.release+"/"+file)}
  catch{return fail(503,"Content unavailable")}
  if(!object)return notFound();
  const ext=file.slice(file.lastIndexOf(".")+1).toLowerCase();
  if(!Object.prototype.hasOwnProperty.call(TYPES,ext))return notFound();
  const headers=new Headers({
    "Content-Type":TYPES[ext],
    "Cache-Control":ext==="html"?"no-cache, must-revalidate":"public, max-age=60, must-revalidate",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"strict-origin-when-cross-origin"
  });
  // No cross-customer cookies, even if generated HTML contained stale Set-Cookie headers.
  if(object.httpEtag)headers.set("ETag",object.httpEtag);
  return new Response(request.method==="HEAD"?null:object.body,{status:200,headers});
}
