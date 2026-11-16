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
   if(location.origin!=='http://127.0.0.1:8765')return;
   localStorage.setItem('sho_web_order_v3',JSON.stringify({plan:'one',update:'none',template:'',domain:false}));
   window.__settingsCalls=[];let saved=null;
   window.__mockSales=async body=>{
    window.__settingsCalls.push(body);
    if(body.action==='admin_list_orders')return{data:{orders:[{order_code:'9000001001',status:'pending_payment',plan:'one',amount_from:15000,line_user_id:'U_SYNTHETIC_TEST',selections:{qa_purpose:'line_connection_acceptance_only'}}]}};
    if(body.action==='admin_bank_settings')return{data:{message:''}};
    if(body.action==='status')return{data:{ok:true,line_test:{order_code:'9000001001',line_linked:false,real_order:false,open_line_url:'https://line.me/R/oaMessage/%40144dlsxp/?'+encodeURIComponent('【HP販売 接続テスト】実注文ではありません。')},configuration:{seller_saved:true,test_bank_saved:true,hosting_schema_installed:false,hosting_mode_enabled:false,production_storage_configured:false,stable_domain_configured:false,backup_attested:false,commercial_policy_approved:false,production_bank_saved:false},order_to_delivery_live_test_verified:false}};
    if(body.action==='line_check')return{data:{ok:true,line:{credential_valid:true,official_account_matches:true,webhook_configured:true,webhook_active:true,signed_empty_webhook_verified:true,real_message_receipt_verified:false,real_messages_sent:0}}};
    if(body.action==='admin_get_sales_settings')return{data:{ok:true,seller:saved?.seller||{},bank_message:saved?.bank_message||'',backup:{reference:saved?.backup_reference||''},policy:saved?{terms:saved.terms}:null,default_terms:terms}};
    if(body.action==='admin_commercial_policy_status')return{data:{ready:false,reason:'公開基盤の切り替え前です。'}};
    if(body.action==='admin_save_sales_settings'){saved=body;return{data:{ok:true,enabled:body.enable}};}
    throw Error('Unexpected setup mock request');
   };
  },{terms:DEFAULT_TERMS});
  await context.route('**/*',route=>{
   const url=route.request().url();
   if(url===base+'website-client.js')return route.fulfill({status:200,contentType:'text/javascript',body:"export async function requireWebsiteSession(){return true;}export async function websiteApi(){throw Error('Receipt tests cannot invoke production APIs');}export const websiteSupabase={functions:{invoke:async(name,{body})=>window.__mockSales(body)}};"});
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
  await page.goto(base+'admin/readiness.html',{waitUntil:'domcontentloaded'});await page.locator('#privateChecks').waitFor();
  check((await page.locator('#journeyStatus').innerText()).includes('未確認'),'Configuration cannot claim completed order-to-delivery testing');
  check(await page.locator('#lineFixture').isVisible(),'Owner can start the isolated LINE acceptance test');
  check(new URL(await page.locator('#openLineFixture').getAttribute('href')).origin==='https://line.me','Fixture opens only the official LINE link');
  check((await page.locator('#lineFixture').innerText()).includes('実注文・契約・請求・サイト公開は発生しません'),'Fixture cannot be confused with a real purchase');
  check((await page.locator('#configuration').innerText()).includes('本番用の公開ストレージ設定'),'Production storage blocker is visible');
  check((await page.locator('#configuration').innerText()).includes('未確認'),'Missing configuration stays visible');
  await page.locator('#checkLine').click();await page.waitForFunction(()=>document.querySelector('#lineResults').children.length===6);
  check((await page.locator('#status').innerText()).includes('実際の問い合わせ・納品通知'),'Signed empty webhook cannot claim real message delivery');
  check(await page.locator('#lineResults div').filter({hasText:'実際の問い合わせの受信'}).locator('dd').innerText()==='未確認','Real message receipt remains explicitly unverified');
  check(await page.evaluate(()=>window.__settingsCalls.filter(x=>x.action==='line_check').length===1),'One explicit LINE inspection only');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+3),'Readiness page fits '+width);
  check(errors.length===0,'No readiness script failures: '+errors.join(';'));
  if(process.env.QA_SCREENSHOTS_DIR)await page.screenshot({path:join(process.env.QA_SCREENSHOTS_DIR,'sales-readiness-'+width+'.png'),fullPage:true});
  await page.goto(base+'admin/orders.html',{waitUntil:'domcontentloaded'});await page.locator('[data-line-test]').waitFor();
  await page.locator('[data-line-test] > summary').click();
  check((await page.locator('[data-line-test]').innerText()).includes('テスト専用'),'Receipt fixture is visibly separate from real orders');
  check((await page.locator('[data-line-test]').innerText()).includes('実際の注文・契約・請求・制作・公開は発生しません'),'Test order explains its limits');
  check(await page.locator('[data-line-test] [data-quote],[data-line-test] [data-activate],[data-line-test] [data-resend],[data-line-test] [data-accept-contract]').count()===0,'Test fixture has no commercial action buttons');
  check(await page.locator('#nLine').innerText()==='0'&&await page.locator('#nPay').innerText()==='0'&&await page.locator('#nDone').innerText()==='0','Test fixture is excluded from real order counts');
  check(await page.locator('[data-line-test] a').getAttribute('href')==='readiness.html','Test fixture links back to its receipt test');
  check(await page.locator('[data-line-test] a').evaluate(el=>el.getBoundingClientRect().height>=44),'Receipt test link keeps a comfortable mobile touch target');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+3),'Test order fits '+width);
  check(errors.length===0,'No test-order script failures: '+errors.join(';'));
  if(process.env.QA_SCREENSHOTS_DIR)await page.screenshot({path:join(process.env.QA_SCREENSHOTS_DIR,'line-test-order-'+width+'.png'),fullPage:true});
  await context.close();
 }}finally{await browser.close();}
 console.log('HOSTING_FEES_UI_QA_PASS',JSON.stringify({checks,widths,real_notifications:0,real_payments:0}));
})().catch(e=>{console.error('HOSTING_FEES_UI_QA_FAIL',e.stack||e);process.exitCode=1;});
