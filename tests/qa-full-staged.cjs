const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const siteId='qafull5nov04',base='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-qa-view';
const pages=['index.html','live.html','about.html','gallery.html','contact.html'];
const paths=[...pages,'style.css','site.js'];
(async()=>{
 const authUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL,authBootstrap=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
 assert.ok(authUrl&&authBootstrap,'GitHub Actions OIDC identity unavailable');
 const auth=await fetch(authUrl+(authUrl.includes('?')?'&':'?')+'audience=sho-private-qa',{headers:{Authorization:'bearer '+authBootstrap}});
 assert.equal(auth.status,200,'GitHub OIDC token request');
 const jwt=(await auth.json()).value;assert.ok(jwt&&jwt.length>500);
 const endpoint=(params={})=>base+'?'+new URLSearchParams({site_id:siteId,...params});
 const h={Authorization:'Bearer '+jwt};
 const before=await fetch(endpoint({info:'job'}),{headers:h});
 assert.equal(before.status,200,'OIDC secured QA job inspection');
 const prior=(await before.json()).job;
 let jobId,done=false,last='queued';
 if(prior?.status==='sho_review'){
  jobId=prior.id;done=true;console.log('STAGED_QA_REUSE_COMPLETED_JOB',jobId);
 }else{
  const kicked=await fetch(endpoint(),{method:'POST',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify({action:'qa-dispatch-existing'})});
  if(kicked.status!==202)throw Error('QA worker launch rejected: '+kicked.status+' '+(await kicked.text()).slice(0,200));
  jobId=(await kicked.json()).job_id;assert.ok(jobId,'Worker job exists');
  console.log('STAGED_QA_JOB_ACCEPTED',jobId);
 }
 for(let i=0;i<220;i++){
  await new Promise(r=>setTimeout(r,2800));
  const response=await fetch(endpoint({info:'job'}),{headers:h});
  if(response.status!==200)throw Error('QA status endpoint failed '+response.status);
  const job=(await response.json()).job;
  if(job?.id!==jobId)throw Error('Unexpected QA job');
  if(job.status!==last){last=job.status;console.log('STAGED_QA_STATE',last);}
  if(job.status==='error')throw Error('Full-order production worker returned error');
  if(job.status==='sho_review'){done=true;break;}
  if(!['queued','running'].includes(job.status))throw Error('Unexpected QA job state '+job.status);
 }
 assert.ok(done,'5-page production job did not finish within 10 minutes');
 async function read(file){
  const resp=await fetch(endpoint({path:file}),{headers:h});
  if(resp.status!==200)throw Error('Private generated file missing: '+file+' HTTP '+resp.status);
  const buffer=Buffer.from(await resp.arrayBuffer());
  assert.ok(buffer.length>50,'nonempty generated file '+file);
  return buffer;
 }
 const data={};for(const file of paths)data[file]=(await read(file)).toString('utf8');
 assert.ok(data['index.html'].replace(/<br\s*\/?>/gi,'').replace(/<[^>]+>/g,'').replace(/\s+/g,'').includes('まだ見ぬ夜の、その先へ。'),'requested hero line exists even with responsive HTML breaks');
 assert.ok(data['live.html'].includes('NEON WAVES 2027'),'future live is present');
 assert.ok(data['live.html'].includes('AFTER DARK 2026'),'past live is present');
 assert.ok(['AKI','REN','HINA','SOU'].every(n=>data['about.html'].includes(n)),'all brief member names included');
 assert.ok(data['gallery.html'].includes('写真')&&data['gallery.html'].includes('準備'),'no-photo state clearly explained');
 assert.ok(data['style.css'].length>1000&&data['style.css'].includes('@media'),'responsive shared stylesheet generated');
 new Function(data['site.js']); // Fail on syntax errors.
 const internalReferences=new Set(paths);
 for(const file of pages){
  const htm=data[file];
  assert.ok(htm.includes('<main id="main">')&&htm.includes('</main>'),'semantic main in '+file);
  assert.ok(htm.includes('href="style.css"')&&htm.includes('src="site.js"'),'shared files linked in '+file);
  assert.ok(!htm.includes('SHO WEB SUPPORT'),'agency text not injected into customer site '+file);
  for(const target of pages)assert.ok(htm.includes('href="'+target+'"'),'common navigation points to '+target+' from '+file);
  for(const href of htm.matchAll(/\bhref\s*=\s*["']([^"']+)["']/g)){
   const u=href[1];
   if(u.startsWith('#')){assert.ok(!u.slice(1)||htm.includes('id="'+u.slice(1)+'"'),'anchor '+u+' exists in '+file);continue;}
   if(/^(https?:|mailto:|tel:|data:)/.test(u))continue;
   assert.ok(!u.startsWith('/'),'no root-absolute href in '+file);
   const target=u.split(/[?#]/)[0];
   assert.ok(internalReferences.has(target),'local link '+target+' from '+file+' exists');
  }
  assert.ok(!/<img[^>]+src=["']https?:/i.test(htm),'no invented external photographs in '+file);
 }
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sho-full-staged-qa-'));
 for(const file of paths)fs.writeFileSync(path.join(tmp,file),data[file]);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const [label,width,height] of [['mobile',390,844],['desktop',1366,900]]){
   const context=await browser.newContext({viewport:{width,height},locale:'ja-JP'});
   for(const file of pages){
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(String(e.message)));
    await page.route('https://**',r=>r.abort());
    await page.goto(pathToFileURL(path.join(tmp,file)).href,{waitUntil:'load',timeout:20000});
    const info=await page.evaluate(()=>{
     const doc=document.documentElement;
     return {h1:document.querySelector('h1')?.textContent?.trim()||'',
      width:doc.scrollWidth,viewport:doc.clientWidth,
      styles:[...document.styleSheets].length,
      bodyBackground:getComputedStyle(document.body).backgroundColor,
      nav:[...document.querySelectorAll('nav a')].map(x=>x.getAttribute('href'))};
    });
    assert.ok(info.h1,'headline exists '+file+' '+label);
    assert.ok(info.styles>=1,'CSS applies '+file+' '+label);
    assert.ok(info.width<=info.viewport+5,'horizontal overflow '+file+' '+label+': '+info.width+'>'+info.viewport);
    assert.ok(info.nav.length>=5,'common navigation exists '+file+' '+label);
    assert.deepEqual(errors,[],'no browser JS errors '+file+' '+label);
    console.log('STAGED_QA_RENDER '+JSON.stringify({page:file,device:label,viewport:info.viewport,width:info.width,css:info.styles,h1:info.h1.slice(0,70)}));
    await page.close();
   }
   await context.close();
  }
 }finally{await browser.close();fs.rmSync(tmp,{recursive:true,force:true})}
 const report=await fetch(endpoint(),{method:'POST',headers:{...h,'Content-Type':'application/json'},
  body:JSON.stringify({action:'qa-report-pass',pages:5,viewports:2})});
 assert.equal(report.status,200,'signed browser QA report stored');
 console.log('STAGED_FULL_5PAGE_QA_PASS: real AI + private GitHub files + PC/mobile Chromium rendering + recorded');
})().catch(e=>{console.error('STAGED_FULL_5PAGE_QA_FAIL',e.stack||e);process.exitCode=1});
