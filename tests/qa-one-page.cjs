const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const id='qaone20261102',endpoint='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-qa-view';
(async()=>{
 const oidc=process.env.ACTIONS_ID_TOKEN_REQUEST_URL,bootstrap=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
 assert.ok(oidc&&bootstrap,'GitHub Actions OIDC missing');
 const response=await fetch(oidc+(oidc.includes('?')?'&':'?')+'audience=sho-private-qa',{headers:{Authorization:'bearer '+bootstrap}});
 assert.equal(response.status,200,'Valid signed identity');
 const jwt=(await response.json()).value;assert.ok(jwt&&jwt.length>500);
 const url=(values={})=>endpoint+'?'+new URLSearchParams({site_id:id,...values});
 const headers={Authorization:'Bearer '+jwt};
 const state=await fetch(url({info:'job'}),{headers});
 assert.equal(state.status,200,'Private job status allowed for signed worker');
 assert.equal((await state.json()).job?.status,'sho_review','one-page site generated and pending SHO approval');
 const pageResponse=await fetch(url({path:'index.html'}),{headers});
 assert.equal(pageResponse.status,200,'Private index exists');
 const html=await pageResponse.text();
 const plain=html.replace(/<br\s*\/?>/gi,'').replace(/<[^>]*>/g,'').replace(/\s+/g,'');
 assert.ok(plain.includes('夜と音楽が、ここで重なる。'),'specified hero catch copy');
 assert.ok(plain.includes('MIDNIGHT SESSION'),'requested event included');
 assert.ok(/<style[\s>]/i.test(html)||/rel=["']stylesheet["']/i.test(html),'page is styled');
 assert.ok(!html.includes('SHO WEB SUPPORT'),'provider brand not in client-facing content');
 for(const m of html.matchAll(/<a\b[^>]+href=["']([^"']+)["']/gi)){
  const href=m[1];
  assert.ok(!href.startsWith('/'),'no host-root absolute broken href');
  if(href.startsWith('#')){const anchor=href.slice(1);if(anchor)assert.ok(html.includes('id="'+anchor+'"')||html.includes("id='"+anchor+"'"),'anchor '+anchor+' exists');}
 }
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sho-one-page-qa-'));
 fs.writeFileSync(path.join(tmp,'index.html'),html);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const [device,width,height] of [['mobile',390,844],['desktop',1366,900]]){
   const context=await browser.newContext({viewport:{width,height},locale:'ja-JP'}),p=await context.newPage(),errors=[];
   p.on('pageerror',e=>errors.push(String(e.message)));
   await p.route('https://**',r=>r.abort());
   await p.goto(pathToFileURL(path.join(tmp,'index.html')).href,{waitUntil:'load',timeout:20000});
   const result=await p.evaluate(()=>{
     const doc=document.documentElement;
     return {h1:document.querySelector('h1')?.textContent?.trim(),width:doc.scrollWidth,viewport:doc.clientWidth,styles:document.styleSheets.length};
   });
   assert.ok(result.h1,'hero visible');
   assert.ok(result.styles>0,'CSS loaded');
   assert.ok(result.width<=result.viewport+5,'no horizontal overflow');
   assert.deepEqual(errors,[],'no JS exceptions');
   console.log('ONE_PAGE_CHROMIUM_AUDIT '+JSON.stringify({device,width,scrollWidth:result.width,styleCount:result.styles}));
   await context.close();
  }
 }finally{await browser.close();fs.rmSync(tmp,{recursive:true,force:true})}
 const report=await fetch(url(),{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({action:'qa-report-one-pass',viewports:2})});
 assert.equal(report.status,200,'Signed one-page QA report persisted');
 console.log('ONE_PAGE_BROWSER_QA_PASS: generated private one-page site, both viewport sizes');
})().catch(e=>{console.error('ONE_PAGE_BROWSER_QA_FAIL',e.stack||e);process.exitCode=1});
