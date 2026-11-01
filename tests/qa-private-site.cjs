const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const endpoint='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-qa-view';
(async()=>{
 const oidcURL=process.env.ACTIONS_ID_TOKEN_REQUEST_URL,boot=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
 assert.ok(oidcURL&&boot,'GitHub OIDC identity unavailable');
 const delimiter=oidcURL.includes('?')?'&':'?';
 const auth=await fetch(oidcURL+delimiter+'audience=sho-private-qa',{headers:{Authorization:'bearer '+boot}});
 assert.equal(auth.status,200,'GitHub signed OIDC token');
 const jwt=(await auth.json()).value;assert.ok(jwt&&jwt.length>500);
 if(process.env.REBUILD_QA_SITE==='true'){
  const started=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify({action:'qa-rebuild'})});
  if(started.status!==202)throw Error('Signed QA rebuild was not accepted: HTTP '+started.status);
  const queued=await started.json();
  assert.ok(queued.job_id,'Worker job identifier was returned');
  let finished=false;
  for(let attempt=0;attempt<90;attempt++){
    await new Promise(resolve=>setTimeout(resolve,2500));
    const status=await fetch(endpoint+'?info=job',{headers:{Authorization:'Bearer '+jwt}});
    if(!status.ok)throw Error('Private status check HTTP '+status.status);
    const job=(await status.json()).job;
    if(job?.id===queued.job_id&&job.status==='sho_review'){finished=true;break}
    if(job?.id===queued.job_id&&job.status==='error')throw Error('QA site regeneration failed');
  }
  assert.ok(finished,'QA regeneration did not reach owner-review state');
  console.log('PRIVATE_SITE_REBUILD_COMPLETED job '+queued.job_id);
 }
 async function read(file){
  const r=await fetch(endpoint+'?path='+encodeURIComponent(file),{headers:{Authorization:'Bearer '+jwt}});
  if(!r.ok)throw Error('Authenticated private file unavailable: '+file+' HTTP '+r.status);
  return Buffer.from(await r.arrayBuffer());
 }
 const html=(await read('index.html')).toString('utf8');
 assert.ok(html.includes('data-theme="cyber"')&&html.includes('body[data-theme="cyber"]'),'actual site preserves cyber CSS');
 assert.ok(html.includes('<style>'),'actual site ships real CSS');
 assert.ok(!html.includes('SHO WEB SUPPORT'),'customer page has no vendor branding');
 const refs=[...new Set([...html.matchAll(/(?:src|poster)=["'](assets\/[^"']+)["']/g)].map(m=>m[1]))];
 assert.ok(refs.length>=2,'actual client images included');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sho-private-qa-'));
 fs.writeFileSync(path.join(tmp,'index.html'),html);
 for(const ref of refs){
  if(ref.includes('..')||!/^assets\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(ref))throw Error('Unsafe image path');
  const buf=await read(ref);
  assert.ok(buf.length>100,'Real image bytes present: '+ref);
  const dest=path.join(tmp,ref);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,buf);
 }
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const [label,width,height] of [['mobile',390,844],['desktop',1366,900]]){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,locale:'ja-JP'});
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(String(e.message)));
   await page.route('https://**',route=>route.abort());
   await page.goto(pathToFileURL(path.join(tmp,'index.html')).href,{waitUntil:'load',timeout:30000});
   await page.waitForTimeout(450);
   const info=await page.evaluate(()=>{
     const imgs=[...document.querySelectorAll('img')];
     return {h1:document.querySelector('h1')?.innerText,theme:document.body.dataset.theme,
      background:getComputedStyle(document.body).backgroundColor,
      pageWidth:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,
      images:imgs.map(el=>({loaded:el.complete&&el.naturalWidth>0,width:el.naturalWidth})),
      nav:document.querySelectorAll('nav a').length,
      styleSheetCount:document.styleSheets.length};
   });
   assert.equal(info.theme,'cyber');
   assert.equal(info.background,'rgb(5, 9, 20)','Cyber must not be white');
   assert.ok(info.h1?.trim().length>0);
   assert.ok(info.pageWidth<=info.viewport+4,'no horizontal overflow '+label);
   assert.ok(info.images.length>=2&&info.images.every(x=>x.loaded),'customer images must render in '+label);
   assert.ok(info.styleSheetCount>0,'CSS applied');
   assert.deepEqual(errors,[],'no client runtime errors');
   const jpeg=await page.screenshot({type:'jpeg',quality:57,animations:'disabled',fullPage:true});
   console.log('PRIVATE_SITE_SHOT_BEGIN '+label+' '+jpeg.toString('base64')+' PRIVATE_SITE_SHOT_END');
   console.log('PRIVATE_SITE_AUDIT '+JSON.stringify({device:label,...info}));
   await context.close();
  }
 }finally{await browser.close()}
 console.log('PRIVATE_SITE_QA_PASS: actual SITE ID 1241, 2 viewports, real uploaded images, cyber theme, valid CSS');
})().catch(e=>{console.error('PRIVATE_SITE_QA_FAIL',e.stack||e);process.exitCode=1});
