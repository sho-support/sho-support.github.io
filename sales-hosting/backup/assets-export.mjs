import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
const sha=b=>createHash('sha256').update(b).digest('hex');
const project='tyhymvgjkoebetyypspj',maxBytes=35*1024*1024,maxFiles=5000;
const fail=()=>{throw Error('Private assets verification failed');};
export function allowedAssetBackupClaims(c,run,sha,now=Math.floor(Date.now()/1000)){
 return /^\d{8,20}$/.test(run)&&/^[a-f0-9]{40}$/.test(sha)&&c.repository==='sho-support/sho-support.github.io'&&c.repository_id==='1224256882'&&c.repository_owner_id==='275386651'
  &&c.ref==='refs/heads/architecture/sales-cloudflare'&&c.event_name==='push'&&c.run_attempt==='1'&&c.run_id===run&&c.sha===sha&&c.workflow_sha===sha
  &&c.workflow_ref==='sho-support/sho-support.github.io/.github/workflows/sales-assets-backup.yml@refs/heads/architecture/sales-cloudflare'
  &&Number.isInteger(c.exp)&&Number.isInteger(c.iat)&&c.exp>now&&c.exp<=now+600&&c.iat>=now-600&&c.iat<=now+30;
}
function checked(result){if(result?.error||result?.data===undefined||result?.data===null)fail();return result.data;}
function safeName(s){if(typeof s!=='string'||!s.length||s.length>4096||s.includes('\0')||s.split('/').some(x=>x==='.'||x==='..'))fail();return s;}
function stable(x){return JSON.stringify(x);}
async function storageInventory(storage,excluded){
 const buckets=checked(await storage.listBuckets()).filter(b=>b.id!==excluded).sort((a,b)=>a.id<b.id?-1:1),files=[];
 for(const bucket of buckets){
  safeName(bucket.id);const pending=[''],seen=new Set();
  while(pending.length){
   const prefix=pending.shift();if(seen.has(prefix)||seen.size>maxFiles)fail();seen.add(prefix);
   let offset=0;
   while(true){
    const rows=checked(await storage.from(bucket.id).list(prefix,{limit:1000,offset,sortBy:{column:'name',order:'asc'}}));
    if(!Array.isArray(rows)||rows.length>1000)fail();
    for(const row of rows){
     safeName(row.name);if(row.name.includes('/'))fail();const path=prefix?prefix+'/'+row.name:row.name;
     if(row.id===null){pending.push(path);continue;}
     if(typeof row.id!=='string'||!row.metadata||!Number.isSafeInteger(Number(row.metadata.size))||Number(row.metadata.size)<0)fail();
     files.push({bucket:bucket.id,path,metadata:row});if(files.length>maxFiles)fail();
    }
    offset+=rows.length;if(rows.length<1000)break;
   }
  }
 }
 files.sort((a,b)=>{const x=a.bucket+'/'+a.path,y=b.bucket+'/'+b.path;return x<y?-1:x>y?1:0;});
 if(new Set(files.map(f=>f.bucket+'/'+f.path)).size!==files.length)fail();
 return {buckets,files};
}
export async function exportStorageAssets({storage,run,fetch:transport=globalThis.fetch}){
 if(!/^\d{8,20}$/.test(run))fail();
 const qa='hp-backup-qa-'+run,source=await storageInventory(storage),objects=[];
 if(source.buckets.some(b=>b.id===qa))fail();
 if(source.files.reduce((n,f)=>n+Number(f.metadata.metadata.size),0)>maxBytes)fail();
 let created=false,bytes=0,cleanup=false;const attempted=[];
 try{
  checked(await storage.createBucket(qa,{public:false,fileSizeLimit:maxBytes}));created=true;
  if(checked(await storage.getBucket(qa)).public!==false)fail();
  for(const [i,file] of source.files.entries()){
   const blob=checked(await storage.from(file.bucket).download(file.path)),body=Buffer.from(await blob.arrayBuffer());bytes+=body.length;
   if(bytes>maxBytes||body.length!==Number(file.metadata.metadata.size))fail();
   const digest=sha(body),path='objects/'+String(i).padStart(6,'0');attempted.push(path);
   checked(await storage.from(qa).upload(path,body,{upsert:false,contentType:blob.type||'application/octet-stream'}));
   const back=Buffer.from(await checked(await storage.from(qa).download(path)).arrayBuffer());
   if(back.length!==body.length||sha(back)!==digest)fail();
   objects.push({...file,bytes:body.length,sha256:digest,content_type:blob.type||'application/octet-stream',body:body.toString('base64')});
  }
  if(objects.length){
   const url=`https://${project}.supabase.co/storage/v1/object/public/${qa}/${attempted[0]}`;
   const response=await transport(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
   const denied=[400,401,403,404].includes(response.status);await response.body?.cancel();if(!denied)fail();
  }
  const after=await storageInventory(storage,qa);if(stable(after)!==stable(source))fail();
  for(const file of objects){
   const body=Buffer.from(await checked(await storage.from(file.bucket).download(file.path)).arrayBuffer());
   if(body.length!==file.bytes||sha(body)!==file.sha256)fail();
  }
 }finally{
  if(created){
   if(attempted.length)checked(await storage.from(qa).remove(attempted));
   const rows=checked(await storage.from(qa).list('',{limit:1000}));
   // Virtual directories may remain in listing; bucket deletion is the final
   // authoritative absence check. Never empty or delete a source bucket.
   if(rows.some(r=>r.id!==null))fail();
   checked(await storage.deleteBucket(qa));const gone=await storage.getBucket(qa);
   if(!gone.error||!['404','400'].includes(String(gone.error.status||gone.error.statusCode)))fail();cleanup=true;
  }
 }
 if(!cleanup)fail();
 return {buckets:source.buckets,objects,proof:{storage_bucket_count:source.buckets.length,storage_object_count:objects.length,storage_bytes:bytes,
  storage_pagination_complete:true,storage_source_unchanged:true,storage_file_bytes_restored:true,storage_hashes_match:true,qa_bucket_private:true,qa_bucket_cleanup_verified:true}};
}
function xmlValue(s){
 if(typeof s!=='string'||/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(s))fail();
 const value=s.replace(/&(amp|lt|gt|quot|apos);/g,(_,x)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[x]));
 if(/&(?:#|[a-zA-Z]+;)/.test(value))fail();return value;
}
export function parseR2Page(xml){
 if(typeof xml!=='string'||xml.length>2*1024*1024||!/<ListBucketResult[\s>]/.test(xml)||/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml))fail();
 const get=(x,k)=>{const m=x.match(new RegExp('<'+k+'>([\\s\\S]*?)</'+k+'>'));return m?xmlValue(m[1]):null;};
 if(get(xml,'EncodingType')!=='url'||!['true','false'].includes(get(xml,'IsTruncated')))fail();
 const entries=[...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(m=>{
  const encoded=get(m[1],'Key'),length=get(m[1],'Size');if(typeof encoded!=='string'||!encoded.length||!/^(0|[1-9][0-9]{0,10})$/.test(length||''))fail();
  const key=safeName(decodeURIComponent(encoded)),size=Number(length);
  if(!Number.isSafeInteger(size)||size<0)fail();return {key,bytes:size,etag:get(m[1],'ETag'),last_modified:get(m[1],'LastModified')};
 });
 const more=get(xml,'IsTruncated')==='true',next=get(xml,'NextContinuationToken');
 if(more&&(!next||next.length>4096)||!more&&next)fail();return {entries,more,next};
}
export async function exportR2Assets({sign,fetch:transport=globalThis.fetch}){
 const base='https://bdb1bb4a771be8595d5564d5d78cb1d4.r2.cloudflarestorage.com/sho-customer-sites-production';
 async function request(url){
  const req=new Request(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000)}),signed=await sign(req,{aws:{allHeaders:true}});
  if(!(signed instanceof Request)||signed.url!==url||signed.method!=='GET')fail();
  const response=await transport(signed,{redirect:'error'});if(!response.ok){await response.body?.cancel();fail();}return response;
 }
 async function inventory(){
  const files=[],tokens=new Set();let token;
  do{
   const url=new URL(base);url.searchParams.set('list-type','2');url.searchParams.set('encoding-type','url');url.searchParams.set('max-keys','1000');if(token)url.searchParams.set('continuation-token',token);
   const response=await request(url.href),page=parseR2Page(await response.text());files.push(...page.entries);
   if(files.length>maxFiles)fail();token=page.more?page.next:null;if(token){if(tokens.has(token))fail();tokens.add(token);}
  }while(token);
  if(new Set(files.map(x=>x.key)).size!==files.length)fail();return files.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 }
 const source=await inventory(),objects=[];let bytes=0;
 if(source.reduce((n,f)=>n+f.bytes,0)>maxBytes)fail();
 for(const file of source){
  const url=base+'/'+file.key.split('/').map(encodeURIComponent).join('/'),response=await request(url),body=Buffer.from(await response.arrayBuffer());bytes+=body.length;
  if(bytes>maxBytes||body.length!==file.bytes)fail();
  const metadata={};for(const [k,v] of response.headers)if(k.startsWith('x-amz-meta-')||['content-type','cache-control','content-encoding','content-disposition'].includes(k))metadata[k]=v;
  objects.push({...file,sha256:sha(body),metadata,body:body.toString('base64')});
 }
 if(stable(await inventory())!==stable(source))fail();
 return {bucket:'sho-customer-sites-production',objects,proof:{r2_object_count:objects.length,r2_bytes:bytes,r2_pagination_complete:true,r2_source_unchanged:true,r2_bytes_exported:true,r2_source_writes:false}};
}
