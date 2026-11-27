import {validateAssetPath,prepareRelease} from './hosting-release-preflight.mjs';

const sha=/^[a-f0-9]{40}$/;
async function bounded(response,limit){
  if(!response.ok)throw new Error('GitHub source read failed: HTTP '+response.status);
  if(Number(response.headers.get('content-length'))>limit)throw new Error('GitHub source response too large');
  if(!response.body)throw new Error('GitHub source response missing');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
    if(size>limit)throw new Error('GitHub source response too large');parts.push(value);}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}
  const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;
}

// GET-only source snapshot pinned to the commit, then each Git blob's immutable SHA.
// No tree-provided URL is followed. Public/foreign/shared repositories and symlinks are refused.
export async function snapshotCustomerSource({siteId,repo,branch,token,owner='sho-support',fetcher=fetch}){
  if(!/^[A-Za-z0-9_-]{3,32}$/.test(siteId)||repo!==owner+'/site-'+siteId.toLowerCase()
    ||!/^[A-Za-z0-9-]+$/.test(owner)||!token||typeof branch!=='string'||branch.length>100
    ||!/^[A-Za-z0-9._/-]+$/.test(branch))throw new Error('Untrusted customer source repository');
  const base='https://api.github.com/repos/'+repo;
  const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'};
  const get=async(path,limit,raw=false)=>bounded(await fetcher(base+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15_000),headers:{...headers,...(raw?{Accept:'application/vnd.github.raw+json'}:{})}}),limit);
  const json=async(path,limit)=>JSON.parse(new TextDecoder().decode(await get(path,limit)));
  const metadata=await json('',16_384);
  if(metadata.full_name?.toLowerCase()!==repo.toLowerCase()||metadata.private!==true||metadata.pages_url||metadata.has_pages===true)throw new Error('Customer source must be private and must not publish through Pages');
  const commit=await json('/commits/'+encodeURIComponent(branch),100_000);
  if(!sha.test(commit.sha||'')||!sha.test(commit.commit?.tree?.sha||''))throw new Error('Invalid source commit');
  const tree=await json('/git/trees/'+commit.commit.tree.sha+'?recursive=1',256*1024);
  if(tree.truncated||!Array.isArray(tree.tree)||tree.tree.length>1000)throw new Error('Incomplete or excessive customer source tree');
  const files=[];let total=0;
  const entries=tree.tree.filter(e=>e.type!=='tree'&&!e.path?.startsWith('docs/')&&e.path!=='README.md'&&e.path!=='.gitignore');
  if(!entries.length||entries.length>80)throw new Error('Customer source file count exceeds the initial operating limit');
  for(const e of entries){
    validateAssetPath(e.path);
    if(e.type!=='blob'||e.mode!=='100644'||!sha.test(e.sha||'')||!Number.isSafeInteger(e.size)||e.size<1||e.size>7_000_000)throw new Error('Unsafe or oversized customer source file');
    total+=e.size;if(total>35*1024*1024)throw new Error('Customer source exceeds the initial 35 MiB operating limit');
    const bytes=await get('/git/blobs/'+e.sha,e.size+16_384,true);
    if(bytes.byteLength!==e.size)throw new Error('GitHub source file size mismatch');
    const prefix=new TextEncoder().encode('blob '+bytes.length+'\0'),payload=new Uint8Array(prefix.length+bytes.length);
    payload.set(prefix);payload.set(bytes,prefix.length);
    const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1',payload)),b=>b.toString(16).padStart(2,'0')).join('');
    if(checksum!==e.sha)throw new Error('GitHub source blob checksum mismatch');
    files.push({path:e.path,content:bytes});
  }
  prepareRelease('1000',commit.sha,files); // Validate the complete package before any R2 writes.
  return {source_commit:commit.sha,files};
}
