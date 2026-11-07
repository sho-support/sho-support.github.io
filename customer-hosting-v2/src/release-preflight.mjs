// Provider-independent release package preflight.
// This module NEVER uploads assets or changes a live site's active.json.
const ID=/^[0-9]{4,10}$/,RELEASE=/^[a-f0-9]{12,64}$/;
const ALLOWED=new Set(["html","css","js","mjs","json","txt","svg","png","jpg","jpeg","webp","gif","ico","avif","woff","woff2","pdf","mp4","webm"]);
export function prepareRelease(siteId,releaseId,files){
  const id=String(siteId||""),version=String(releaseId||"");
  if(!ID.test(id)||!RELEASE.test(version))throw new Error("Invalid site ID or release ID");
  if(!Array.isArray(files)||files.length===0||files.length>500)throw new Error("Invalid release file count");
  const names=new Set();let totalBytes=0,hasHome=false;
  const objects=[];
  for(const item of files){
    const name=String(item?.path||"");
    if(!name||name.length>300||name.startsWith("/")||name.includes("//")
       ||!(/^[A-Za-z0-9._/-]+$/).test(name)
       ||name.split("/").some(part=>!part||part==="."||part===".."||part.startsWith("."))
       ||names.has(name))throw new Error("Unsafe or duplicate asset path: "+name);
    const extension=name.slice(name.lastIndexOf(".")+1).toLowerCase();
    if(!ALLOWED.has(extension))throw new Error("Asset format not allowed: "+name);
    const body=item?.content;
    if(typeof body!=="string"&&!(body instanceof Uint8Array))throw new Error("Invalid asset content: "+name);
    const size=typeof body==="string"?new TextEncoder().encode(body).byteLength:body.byteLength;
    if(size===0||size>15*1024*1024)throw new Error("Empty or oversized asset: "+name);
    totalBytes+=size;if(totalBytes>35*1024*1024)throw new Error("Release size exceeds guardrail");
    if(name==="index.html")hasHome=true;
    if(extension==="html"&&typeof body==="string"){
      if(!/<!doctype\s+html/i.test(body)||!/<html\b/i.test(body))throw new Error("Missing HTML document structure: "+name);
      if(/sho-support\.github\.io\/site-|sho-web-support\.netlify\.app\/website-/i.test(body))
        throw new Error("Legacy management or provider URL embedded: "+name);
    }
    names.add(name);
    objects.push({key:"sites/"+id+"/releases/"+version+"/"+name,path:name,body,bytes:size});
  }
  if(!hasHome)throw new Error("Home page is missing");
  return {site_id:id,release:version,total_bytes:totalBytes,file_count:files.length,objects,
    activation:{key:"sites/"+id+"/active.json",json:JSON.stringify({status:"live",release:version})}};
}
