// Actual HTML rendering; authentication, DB, LINE and hosting are isolated browser mocks.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {mkdirSync}=require('node:fs');
const {join}=require('node:path');
const base='http://127.0.0.1:8765/',widths=[320,360,390,430,768,1366];
const a='a'.repeat(32),b='b'.repeat(32),op='11111111-1111-4111-8111-111111111111';
const formal='https://s8100.customer-sites.example/';
const client=recovery=>`
 const a=${JSON.stringify(a)},b=${JSON.stringify(b)};
 const detail={site:{site_id:'8100',site_name:'ホームページ公開・復元の確認用サイト',status:'${recovery?'customer_review':'private'}',public_url:${JSON.stringify(formal)},preview_url:'',current_note:'確認用の仮データ',updated_at:'2026-11-12T01:00:00Z'},intake:{payload:{fields:{build_plan:'one'}}},activity:[],jobs:[],updates:[],reviewIssues:[],hosting:{provider:'cloudflare-r2',status:'${recovery?'unpublished':'private'}',public_url:${JSON.stringify(formal)},active_release:${recovery?'null':'a'},active_publication_id:${JSON.stringify(op)},active_operation_id:${recovery?JSON.stringify(op):'null'},releases:${recovery?'[]':"[{release_id:a,published_at:'2026-11-12T01:00:00Z'},{release_id:b,published_at:'2026-11-11T01:00:00Z'}]"}}};
 window.__hostingActions=[];
 export async function requireWebsiteSession(){return {user:{id:'synthetic-admin'}};}
 export async function websiteApi(action,payload={}){
  if(action==='list_sites')return {admin:true,sites:[structuredClone(detail.site)]};
  if(action==='load_site')return structuredClone(detail);
  window.__hostingActions.push({action,payload});
  if(action==='admin_rollback_site'){detail.site.status='live';detail.hosting.status='live';detail.hosting.active_release=payload.release_id;}
  else if(action==='admin_reconcile_publication'){detail.hosting.active_operation_id=null;detail.hosting.status='private';}
  else if(action!=='admin_resend_publication')throw new Error('Unexpected mocked action '+action);
  return {ok:true,status:detail.site.status,public_url:detail.site.public_url};
 }
 export const websiteSupabase={functions:{invoke:async()=>{throw new Error('Unexpected legacy function invocation');}}};
`;
// Validate both generated ESM fixture variants before starting any browser.
for(const recovery of [false,true])new Function(client(recovery).replace(/\\bexport\\s+/g,''));
async function inlineScreenshot(page,label,width){
 if(process.env.QA_INLINE_SCREENSHOTS!=='true'||![320,390,1366].includes(width))return;
 const data=(await page.screenshot({type:'jpeg',quality:45,fullPage:true})).toString('base64');
 const total=Math.ceil(data.length/8000);
 for(let i=0;i<total;i++)console.log('SHO_UI_IMAGE '+label+'-'+width+' '+i+'/'+total+' '+data.slice(i*8000,(i+1)*8000));
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.QA_CHROMIUM_EXECUTABLE?{executablePath:process.env.QA_CHROMIUM_EXECUTABLE}:{})});let checks=0;
 const check=(value,label)=>{assert.ok(value,label);checks++;};
 try{
  for(const width of widths){
   const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
   const external=[],errors=[];
   await context.route('**/*',async route=>{
    const request=route.request(),url=request.url();
    if(url===base+'website-client.js')return route.fulfill({status:200,contentType:'text/javascript',body:client(false)});
    if(url.startsWith(base)||url.startsWith('data:'))return route.continue();
    if(url==='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-customer-access'){
     if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type'}});
     const body=request.postDataJSON();assert.equal(body.action,'review_load');assert.equal(body.site_id,'8100');
     return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:true,site:{site_id:'8100',site_name:'公開済みの確認用サイト',status:'live',public_url:formal,preview_url:formal},update_url:base+'website-update.html?id=8100&key='+'k'.repeat(40)})});
    }
    external.push(url);return route.abort();
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
   await page.goto(base+'admin/index.html?site=8100',{waitUntil:'domcontentloaded'});
   try{await page.locator('#restorePublication').waitFor({state:'visible',timeout:10000});}
   catch(e){if(process.env.QA_SCREENSHOTS_DIR){mkdirSync(process.env.QA_SCREENSHOTS_DIR,{recursive:true});await page.screenshot({path:join(process.env.QA_SCREENSHOTS_DIR,'hosting-error-'+width+'.png'),fullPage:true});}throw new Error('Admin fixture did not render; page errors='+errors.join('; ')+'; body='+(await page.locator('body').innerText()).slice(0,1500),{cause:e});}
   const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,
    clipped:[...document.querySelectorAll('header a,header .brand,button,select,textarea,input')].filter(e=>e.getClientRects().length&&!e.closest('[hidden]')&&!e.closest('.tabs')).filter(e=>{const r=e.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1;}).map(e=>e.id||e.textContent.trim())}));
   check(!layout.overflow,'No page overflow at '+width);check(!layout.clipped.length,'Visible controls fit at '+width+': '+layout.clipped.join(','));
   check((await page.locator('#restoreRelease option').count())===2,'Only server-provided published releases are offered');
   if(process.env.QA_SCREENSHOTS_DIR){mkdirSync(process.env.QA_SCREENSHOTS_DIR,{recursive:true});await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:join(process.env.QA_SCREENSHOTS_DIR,'hosting-admin-'+width+'.png'),fullPage:true});}
   await inlineScreenshot(page,'hosting-admin',width);
   await page.locator('#restoreRelease').selectOption(b);await page.locator('#restorePublication').click();
   await page.waitForFunction(()=>window.__hostingActions.some(x=>x.action==='admin_rollback_site'));
   const restored=await page.evaluate(()=>window.__hostingActions.find(x=>x.action==='admin_rollback_site'));
   check(restored.payload.site_id==='8100'&&restored.payload.release_id===b,'Restore sends the exact selected site/release');
   check((await page.getByRole('link',{name:formal,exact:true}).getAttribute('href'))===formal,'Restore keeps the formal URL');
   await page.locator('#resendPublicationNotice').click();
   await page.waitForFunction(()=>window.__hostingActions.some(x=>x.action==='admin_resend_publication'));
   check(true,'Notice retry uses its own operation');
   await page.goto(base+'website-customer-review.html?id=8100&prod=1&key='+'k'.repeat(40),{waitUntil:'domcontentloaded'});
   const update=page.getByRole('link',{name:'更新・管理画面を開く',exact:true});await update.waitFor({state:'visible'});
   check(new URL(await update.getAttribute('href')).searchParams.get('key')==='k'.repeat(40),'Published customer review links to the authenticated update page');
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Published review has no overflow at '+width);
   if(process.env.QA_SCREENSHOTS_DIR)await page.screenshot({path:join(process.env.QA_SCREENSHOTS_DIR,'hosting-review-'+width+'.png'),fullPage:true});
   await inlineScreenshot(page,'hosting-review',width);
   check(!errors.length,'No JavaScript page errors: '+errors.join(';'));
   check(external.every(url=>url==='https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'),'No real external service request');
   await context.close();
  }
  const context=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'});
  await context.route('**/*',route=>route.request().url()===base+'website-client.js'?route.fulfill({status:200,contentType:'text/javascript',body:client(true)}):route.request().url().startsWith(base)?route.continue():route.abort());
  const page=await context.newPage();page.on('dialog',d=>d.accept());
  await page.goto(base+'admin/index.html?site=8100',{waitUntil:'domcontentloaded'});await page.locator('#recoverPublication').waitFor();
  check(await page.locator('#restorePublication').count()===0,'An unknown publication hides new publish/restore controls');
  await page.locator('#recoverPublication').click();await page.waitForFunction(()=>window.__hostingActions.some(x=>x.action==='admin_reconcile_publication'));
  const recovered=await page.evaluate(()=>window.__hostingActions[0]);check(recovered.payload.operation_id===op,'Recovery uses the persisted operation ID');
  await context.close();
  console.log('HOSTING UI PASS; widths=6; assertions='+checks+'; external_writes=0');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
