// Isolated screen tests. All identities, banking data and submissions are synthetic.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {mkdirSync}=require('node:fs');
const {join}=require('node:path');
const base='http://127.0.0.1:8765/',widths=[320,360,390,430,768,1366];
(async()=>{
 const {DEFAULT_TERMS}=await import('../supabase/functions/_shared/commercial-setup.mjs');
 const browser=await chromium.launch({headless:true});let checks=0;
 const check=(v,m)=>{assert.ok(v,m);checks++;};
 try{for(const width of widths){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.addInitScript(({terms})=>{
   localStorage.setItem('sho_web_order_v3',JSON.stringify({plan:'one',update:'none',template:'',domain:false}));
   window.__settingsCalls=[];let saved=null;
   window.__mockSales=async body=>{
    window.__settingsCalls.push(body);
    if(body.action==='admin_get_sales_settings')return{data:{ok:true,seller:saved?.seller||{},bank_message:saved?.bank_message||'',backup:{reference:saved?.backup_reference||''},policy:saved?{terms:saved.terms}:null,default_terms:terms}};
    if(body.action==='admin_commercial_policy_status')return{data:{ready:false,reason:'公開基盤の切り替え前です。'}};
    if(body.action==='admin_save_sales_settings'){saved=body;return{data:{ok:true,enabled:body.enable}};}
    throw Error('Unexpected setup mock request');
   };
  },{terms:DEFAULT_TERMS});
  await context.route('**/*',route=>{
   const url=route.request().url();
   if(url===base+'website-client.js')return route.fulfill({status:200,contentType:'text/javascript',body:"export async function requireWebsiteSession(){return true;}export const websiteSupabase={functions:{invoke:async(name,{body})=>window.__mockSales(body)}};"});
   return url.startsWith(base)||url.startsWith('data:')?route.continue():route.abort();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const name of ['website-support','website-create','band-homepage','website-order','website-order-confirm','website-faq','website-legal','website-terms','website-payment']){
   await page.goto(base+name+'.html',{waitUntil:'domcontentloaded'});
   const fee=page.locator('.hosting-fee');check(await fee.isVisible(),'Hosting fee visible '+name+' '+width);
   const text=await fee.innerText();check(text.includes('6,000円／年（税込・年払い）')&&text.includes('月払いではありません'),'Annual billing unambiguous');
   check(text.includes('自動更新・自動課金はありません'),'Renewal requires opt-in');
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+3),'No horizontal overflow '+name+' '+width);
  }
  await page.goto(base+'website-order-confirm.html',{waitUntil:'domcontentloaded'});
  check((await page.locator('#amount').innerText()).includes('15,000'),'Renewal fee is not added to the initial amount');
  check((await page.locator('label:has(#termsCheck)').innerText()).includes('年6,000円'),'Consent includes renewal cost');
  await page.goto(base+'admin/sales-settings.html',{waitUntil:'domcontentloaded'});await page.locator('#salesForm').waitFor();
  await page.locator('#saveDraft').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('下書きを保存'));
  check((await page.evaluate(()=>window.__settingsCalls.filter(x=>x.action==='admin_save_sales_settings')))[0].enable===false,'Draft never activates sales');
  await page.locator('#enablePolicy').click();check((await page.locator('#status').innerText()).includes('3つの確認'),'Explicit attestations required');
  for(const [id,value]of Object.entries({legal_name:'画面試験事業者',address:'検証県検証市検証区1-2-3',phone:'000-1234-5678',contact:'qa@example.test',bank_message:'画面試験銀行・支店・普通1234567・試験名義',backup_reference:'画面試験のみの確認記録20261113'}))await page.locator('#'+id).fill(value);
  for(const id of ['confirm_terms','confirm_disclosure','confirm_backup'])await page.locator('#'+id).check();
  await page.locator('#enablePolicy').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('確認した販売条件を保存'));
  check(await page.evaluate(()=>window.__settingsCalls.filter(x=>x.action==='admin_save_sales_settings').length===2),'Only deliberate draft and approval saves');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+3),'Setup form fits '+width);
  check(errors.length===0,'No script failures: '+errors.join(';'));
  if(process.env.QA_SCREENSHOTS_DIR){mkdirSync(process.env.QA_SCREENSHOTS_DIR,{recursive:true});await page.screenshot({path:join(process.env.QA_SCREENSHOTS_DIR,'sales-setup-'+width+'.png'),fullPage:true});await page.goto(base+'website-order-confirm.html');await page.screenshot({path:join(process.env.QA_SCREENSHOTS_DIR,'annual-hosting-confirm-'+width+'.png'),fullPage:true});}
  await context.close();
 }}finally{await browser.close();}
 console.log('HOSTING_FEES_UI_QA_PASS',JSON.stringify({checks,widths,real_notifications:0,real_payments:0}));
})().catch(e=>{console.error('HOSTING_FEES_UI_QA_FAIL',e.stack||e);process.exitCode=1;});
