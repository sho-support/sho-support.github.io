import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCustomerSource} from '../../supabase/functions/_shared/hosting-github.mjs';
import {prepareRelease} from '../src/release-preflight.mjs';

const commit='a'.repeat(40),tree='b'.repeat(40),home='<!doctype html><html><body><h1>Private source fixture</h1></body></html>';
const digest=async content=>{
  const bytes=new TextEncoder().encode(content),prefix=new TextEncoder().encode('blob '+bytes.length+'\0'),body=new Uint8Array(prefix.length+bytes.length);
  body.set(prefix);body.set(bytes,prefix.length);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1',body)),b=>b.toString(16).padStart(2,'0')).join('');
};
async function fixture(options={}){
  const sha=await digest(home),requests=[];
  const fetcher=async(url,init)=>{
    requests.push({url,init});const base='https://api.github.com/repos/sho-support/site-1000';
    assert.ok(url.startsWith(base));assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
    const route=url.slice(base.length);
    if(route==='')return Response.json({full_name:'sho-support/site-1000',private:options.private!==false,has_pages:!!options.pages});
    if(route==='/commits/sho-review-fixture')return Response.json({sha:commit,commit:{tree:{sha:tree}}});
    if(route===`/git/trees/${tree}?recursive=1`)return Response.json({truncated:!!options.truncated,tree:options.entries||[
      {type:'blob',mode:'100644',path:'index.html',size:new TextEncoder().encode(home).length,sha},
      {type:'blob',mode:'100644',path:'README.md',size:3,sha:tree}
    ]});
    if(route==='/git/blobs/'+sha)return new Response(options.corrupt?home.replace('Private','Changed'):home);
    throw new Error('Unexpected source request');
  };
  return {requests,read:extra=>snapshotCustomerSource({siteId:'1000',repo:'sho-support/site-1000',branch:'sho-review-fixture',token:'SYNTHETIC_FAKE_TOKEN',fetcher,...extra})};
}
test('source snapshots resolve the branch once, then read an immutable tree and verified blob',async()=>{
  const f=await fixture(),r=await f.read();assert.equal(r.source_commit,commit);assert.equal(r.files.length,1);
  assert.equal(new TextDecoder().decode(r.files[0].content),home);
  assert.deepEqual(f.requests.map(x=>new URL(x.url).pathname.split('/').slice(-2).join('/')),['sho-support/site-1000','commits/sho-review-fixture','trees/'+tree,'blobs/'+await digest(home)]);
});
test('public, Pages-enabled, foreign or shared business repositories never reach R2 staging',async()=>{
  for(const option of [{private:false},{pages:true}])await assert.rejects((await fixture(option)).read(),/private/);
  for(const repo of ['sho-support/sho-support.github.io','other/site-1000','sho-support/site-1001']){
    const f=await fixture();await assert.rejects(f.read({repo}),/Untrusted/);assert.equal(f.requests.length,0);
  }
});
test('incomplete trees, symlinks, executables and oversized files are rejected',async()=>{
  await assert.rejects((await fixture({truncated:true})).read(),/Incomplete/);
  for(const entry of [
    {type:'blob',mode:'120000',path:'index.html',size:10,sha:commit},
    {type:'blob',mode:'100644',path:'setup.exe',size:10,sha:commit},
    {type:'blob',mode:'100644',path:'image.png',size:7_000_001,sha:commit},
    {type:'commit',mode:'160000',path:'index.html',size:10,sha:commit}
  ])await assert.rejects((await fixture({entries:[entry]})).read());
});
test('a same-length blob corruption is rejected before staging',async()=>{
  await assert.rejects((await fixture({corrupt:true})).read(),/checksum/);
});
test('static site preflight rejects credentials, browser storage, dynamic execution and external script/network access',()=>{
  for(const bad of [
    '<script>document.cookie</script>','<script>localStorage.getItem("token")</script>',
    '<script>fetch("https://unreviewed.example/")</script>','<script>eval("alert(1)")</script>',
    '<script src="https://unreviewed.example/a.js"></script>','<a href="javascript:alert(1)">test</a>',
    '<script>navigator.serviceWorker.register("/sw.js")</script>',
    '<p>https://privateproject.supabase.co</p>','<p>sk-proj-'+'x'.repeat(30)+'</p>'
  ])assert.throws(()=>prepareRelease('1000','a'.repeat(24),[{path:'index.html',content:home.replace('</body>',bad+'</body>')}]),/security review/);
  assert.doesNotThrow(()=>prepareRelease('1000','a'.repeat(24),[{path:'index.html',content:home.replace('</body>','<script>document.querySelector("button")?.addEventListener("click",()=>document.body.classList.toggle("open"));</script></body>')} ]));
});
