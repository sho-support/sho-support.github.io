// Local, synthetic financial UI test. No real order, LINE message or bank operation.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const base=(process.env.SALES_BASE_URL||'http://127.0.0.1:8765/').replace(/\/?$/,'/');
 if(!base.startsWith('http://127.0.0.1:'))throw Error('Mock financial UI must run on local checked-out source only');
 const mockModule=`
  export async function requireWebsiteSession(){return true;}
  export async function websiteApi(){return {};}
  const order={order_code:'F1234',status:'pending_payment',plan:'full',update_plan:'free3',template_style:null,amount_from:30000,line_display_name:'試験用顧客',site_id:null,final_amount:null,final_public_domain:'',final_quote_sent_at:null,contract_state:null,created_at:'2026-11-05T00:00:00.000Z'};
  window.__quoteCalls=[];
  export const websiteSupabase={functions:{invoke:async(name,{body:input})=>{
   window.__quoteCalls.push(input);
   if(input.action==='admin_list_orders')return{data:{orders:[structuredClone(order)]}};
   if(input.action==='admin_bank_settings')return{data:{message:'試験用口座のみ'}};
   if(input.action==='admin_commercial_policy_status')return{data:{ready:true,version:'synthetic-only',hosting:{initial_fee_jpy:0}}};
   if(input.action==='admin_resolve_free_url')return{data:{free_url:'https://s1234.fixture.invalid/'}};
   if(input.action==='admin_send_final_quote'){
    order.final_amount=input.final_amount;order.quoted_production_amount=input.final_amount;order.final_public_domain='https://s1234.fixture.invalid/';order.final_quote_sent_at='2026-11-13T00:00:00Z';order.contract_state='sent';order.contract_fingerprint='a'.repeat(64);order.quote_request={...input};return{data:{ok:true}};
   }
   if(input.action==='admin_record_contract_acceptance'){order.contract_state='accepted';order.contract_accepted_at='2026-11-13T00:02:00Z';return{data:{ok:true}};}
   throw Error('Unexpected synthetic financial action: '+input.action);
  }}};
 `;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const width of [320,390,1366]){
   const context=await browser.newContext({viewport:{width,height:820},locale:'ja-JP',serviceWorkers:'block'});
   const page=await context.newPage(),dialogs=[],errors=[],external=[];
   page.on('dialog',async d=>{dialogs.push({type:d.type(),text:d.message()});if(d.type()==='confirm')await d.accept();else await d.dismiss()});
   page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',route=>{
    const url=route.request().url();
    if(url===base+'website-client.js')return route.fulfill({status:200,contentType:'text/javascript',body:mockModule});
    if(url.startsWith(base)||url.startsWith('data:'))return route.continue();external.push(url);return route.abort();
   });
   const response=await page.goto(base+'admin/orders.html',{waitUntil:'domcontentloaded',timeout:30000});
   assert.equal(response.status(),200);await page.locator('.order-card').waitFor();await page.locator('.order-card > summary').click();
   assert.equal(await page.locator('[data-activate]').isDisabled(),true,'activation disabled before quote and acceptance');
   await page.locator('[data-quote]').click();
   assert.ok(dialogs.some(d=>d.text.includes('提供時期')),'delivery and payment deadline are required');
   assert.equal((await page.evaluate(()=>window.__quoteCalls)).filter(x=>x.action==='admin_send_final_quote').length,0);
   await page.locator('[data-delivery-terms]').fill('1サイトの制作。入金と全素材の受領から14日以内に初回案を提出します。');
   await page.locator('[data-payment-deadline]').fill('2026-11-20');
   await page.locator('[data-public-domain]').fill('band.customer-example.jp');await page.locator('[data-quote]').click();
   assert.ok(dialogs.some(d=>d.text.includes('更新負担')),'custom domain needs separate ownership review');
   // The first-sale flow reserves a verified SHO URL. Custom-domain provisioning is a separate unsupported step.
   await page.locator('[data-public-domain]').fill('');await page.locator('[data-quote]').click();
   await page.waitForFunction(()=>document.querySelector('[data-quote]')?.disabled&&document.querySelector('[data-accept-contract]'));
   const calls=await page.evaluate(()=>window.__quoteCalls.filter(x=>x.action==='admin_send_final_quote'));
   assert.equal(calls.length,1,'final quotation is sent exactly once');
   assert.equal(calls[0].public_domain,'free');assert.equal(calls[0].domain_control_confirmed,true);assert.equal(calls[0].final_amount,30000);
   assert.ok(dialogs.some(d=>d.type==='confirm'&&d.text.includes('30,000円（税込')&&d.text.includes('https://s1234.fixture.invalid/')),'exact total and reserved URL are confirmed');
   assert.equal(await page.locator('[data-activate]').isDisabled(),true,'sending a quote alone never enables payment confirmation');
   assert.equal(await page.locator('[data-quote]').isDisabled(),true,'final quotation cannot be sent twice');
   const fold=page.locator('.mini-fold').filter({has:page.locator('[data-accept-contract]')});await fold.locator('summary').click();
   await page.locator('[data-accept-contract]').click();assert.ok(dialogs.some(d=>d.text.includes('同意返信のLINE日時')),'acceptance evidence is required');
   await page.locator('[data-acceptance-reference]').fill('試験のみ：11月13日18時30分・上記見積りに同意した返信');
   await page.locator('[data-accept-contract]').click();await page.waitForFunction(()=>document.querySelector('[data-activate]')?.disabled===false);
   const all=await page.evaluate(()=>window.__quoteCalls),accepted=all.filter(x=>x.action==='admin_record_contract_acceptance');
   assert.equal(accepted.length,1);assert.equal(accepted[0].quote_fingerprint,'a'.repeat(64));assert.ok(!all.some(x=>x.action==='admin_activate_order'),'no simulated acceptance performs bank confirmation');
   assert.deepEqual(errors,[]);assert.deepEqual(external,[],'no request leaves the local fixture');
   const vw=await page.evaluate(()=>({w:innerWidth,doc:document.documentElement.scrollWidth}));assert.ok(vw.doc<=vw.w+3,'admin order panel fits '+width);
   console.log('ADMIN_QUOTE_UI_MOCK_QA_PASS',JSON.stringify({width,dialogPrompts:dialogs.length,quotes:calls.length,acceptances:accepted.length,real_external_writes:0}));
   await context.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error('ADMIN_QUOTE_UI_MOCK_QA_FAIL',e.stack||e);process.exitCode=1});
