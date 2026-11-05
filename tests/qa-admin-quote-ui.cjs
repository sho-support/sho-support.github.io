const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const base=(process.env.SALES_BASE_URL||'http://127.0.0.1:8765/').replace(/\/?$/,'/');
 if(!base.startsWith('http://127.0.0.1:'))throw Error('Mock financial UI must run on local checked-out source only');
 const mockModule=[
  "export async function requireWebsiteSession(){return true;}",
  "const order={order_code:'F1234',status:'pending_payment',plan:'full',template_style:null,amount_from:30000,line_display_name:'テスト顧客',site_id:null,final_amount:null,final_public_domain:'',final_quote_sent_at:null,created_at:'2026-11-05T00:00:00.000Z'};",
  "window.__quoteCalls=[];",
  "export const websiteSupabase={functions:{invoke:async function(name,params){",
  "const input=params.body;window.__quoteCalls.push(input);",
  "if(input.action==='admin_list_orders')return{data:{orders:[order]},error:null};",
  "if(input.action==='admin_bank_settings')return{data:{message:''},error:null};",
  "if(input.action==='admin_send_final_quote'){order.final_amount=input.final_amount;order.final_public_domain=input.public_domain;order.final_quote_sent_at='2026-11-05T00:00:00Z';return{data:{ok:true},error:null}};",
  "return{data:{ok:true},error:null};",
  "}}};"
 ].join('\n');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const width of [320,390,1366]){
   const page=await browser.newPage({viewport:{width,height:820},locale:'ja-JP'});
   const dialogs=[],errors=[];
   page.on('dialog',async d=>{dialogs.push({type:d.type(),text:d.message()});if(d.type()==='confirm')await d.accept();else await d.dismiss()});
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/website-client.js',async route=>route.fulfill({status:200,contentType:'text/javascript',body:mockModule}));
   const response=await page.goto(base+'admin/orders.html',{waitUntil:'networkidle',timeout:30000});
   assert.equal(response.status(),200);
   await page.locator('[data-quote]').waitFor();
   assert.equal(await page.locator('[data-activate]').isDisabled(),true,'activation disabled before quote');
   await page.locator('[data-quote]').click();
   assert.ok(dialogs.some(d=>d.text.includes('正式公開URL')),'missing domain stopped with clear alert');
   assert.equal((await page.evaluate(()=>window.__quoteCalls)).filter(x=>x.action==='admin_send_final_quote').length,0);
   await page.locator('[data-public-domain]').fill('band.customer-example.jp');
   await page.locator('[data-quote]').click();
   assert.ok(dialogs.some(d=>d.text.includes('更新負担')),'domain-control checkbox required');
   await page.locator('[data-domain-confirm]').check();
   await page.locator('[data-quote]').click();
   await page.waitForTimeout(160);
   const calls=await page.evaluate(()=>window.__quoteCalls.filter(x=>x.action==='admin_send_final_quote'));
   assert.equal(calls.length,1,'final quotation is sent exactly once');
   assert.equal(calls[0].public_domain,'band.customer-example.jp');
   assert.equal(calls[0].domain_control_confirmed,true);
   assert.equal(calls[0].final_amount,30000);
   assert.equal(await page.locator('[data-activate]').isEnabled(),true,'quoted order can proceed to manual bank check');
   assert.equal(await page.locator('[data-quote]').isDisabled(),true,'final quotation cannot be sent twice');
   assert.deepEqual(errors,[],'no admin page JavaScript errors');
   const vw=await page.evaluate(()=>({w:innerWidth,doc:document.documentElement.scrollWidth}));
   assert.ok(vw.doc<=vw.w+3,'admin order panel must not overflow viewport '+width);
   console.log('ADMIN_QUOTE_UI_MOCK_QA_PASS',JSON.stringify({width,dialogPrompts:dialogs.length,actions:calls.length,documentWidth:vw.doc}));
   await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error('ADMIN_QUOTE_UI_MOCK_QA_FAIL',e.stack||e);process.exitCode=1});
