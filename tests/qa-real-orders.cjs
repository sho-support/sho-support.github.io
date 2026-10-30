const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const BASE='https://sho-support.github.io/';
const API='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-order-api';
const MARKER='QA_E2E_20261031_SHO';
const scenarios=[
 {plan:'one',code:'P',update:'none',domain:false},
 {plan:'semi',code:'S',template:'rock',domain:false},
 {plan:'full',code:'F',domain:true},
];
const results=[];
const browserTest=async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const [index,scenario] of scenarios.entries()){
   const context=await browser.newContext({viewport:{width:index===2?1366:390,height:850},locale:'ja-JP'});
   const page=await context.newPage();
   page.setDefaultTimeout(20000);
   const errors=[];
   page.on('pageerror',err=>errors.push(err.message));
   await page.route('**/functions/v1/website-order-api',async route=>{
    const raw=JSON.parse(route.request().postData()||'{}');
    const marker=MARKER+'_'+scenario.plan+'_'+(index+1);
    await route.continue({postData:JSON.stringify({...raw,custom_domain_note:marker})});
   });
   const r=await page.goto(BASE+'website-order.html',{waitUntil:'domcontentloaded',timeout:35000});
   assert.equal(r.status(),200,'live order page exists');
   await page.locator('[data-plan="'+scenario.plan+'"] .plan-select').click();
   if(scenario.template)await page.locator('[data-template="'+scenario.template+'"]').click();
   if(scenario.update)await page.locator('[data-update="'+scenario.update+'"]').click();
   if(scenario.domain)await page.locator('#domainSelect').click();
   const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('sho_web_order_v3')));
   assert.equal(state.plan,scenario.plan);
   if(scenario.template)assert.equal(state.template,scenario.template);
   assert.equal(state.domain,scenario.domain);
   if(scenario.plan!=='one')assert.equal(state.update,'free3','3-month promotion assigned to semi/full');
   assert.equal(await page.locator('#finalBtn').isEnabled(),true,'valid order can proceed');
   await page.locator('#finalBtn').click();
   await page.waitForURL('**/website-order-confirm.html');
   assert.equal(await page.locator('#orderBtn').isDisabled(),true,'consent required');
   await page.locator('#termsCheck').check();
   assert.equal(await page.locator('#orderBtn').isEnabled(),true,'consent unlocks ordering');
   const responsePending=page.waitForResponse(response=>response.url().includes('website-order-api')&&response.request().method()==='POST',{timeout:30000});
   await page.locator('#orderBtn').click();
   const orderResponse=await responsePending;
   const rawResponse=await orderResponse.json();
   assert.equal(orderResponse.status(),201,'real order endpoint returns 201');
   assert.ok(rawResponse.ok&&rawResponse.order,'real order issued');
   assert.equal(rawResponse.order.plan,scenario.plan);
   assert.match(rawResponse.order.order_code,new RegExp('^'+scenario.code+'[0-9]{4,6}$'));
   assert.match(rawResponse.order.link_token,/^[a-f0-9]{40}$/,'secure pairing token exists');
   const orderId=await page.locator('#orderId').innerText();
   assert.equal(orderId,rawResponse.order.order_code);
   const lineURL=decodeURIComponent(await page.locator('#lineBtn').getAttribute('href')||'');
   assert.ok(lineURL.includes(rawResponse.order.order_code),'LINE handoff contains order ID');
   assert.ok(lineURL.includes(rawResponse.order.link_token),'LINE handoff contains pairing code');
   const receipt=await page.evaluate(()=>JSON.parse(localStorage.getItem('sho_web_order_receipt_v2')));
   assert.equal(receipt.order.order_code,orderId);
   await page.reload({waitUntil:'domcontentloaded'});
   assert.equal((await page.locator('#orderId').innerText()).trim(),orderId,'reload retains order without new post');
   assert.equal(await page.locator('#orderBtn').isDisabled(),true,'double posting prevented');
   assert.deepEqual(errors,[],'no visible JavaScript runtime errors');
   const item={plan:scenario.plan,order_code:orderId,update_plan:rawResponse.order.update_plan,custom_domain:rawResponse.order.custom_domain,marker:MARKER+'_'+scenario.plan+'_'+(index+1)};
   results.push(item);
   console.log('QA_REAL_ORDER '+JSON.stringify(item));
   await context.close();
  }
  const context=await browser.newContext();
  const page=await context.newPage();
  await page.goto(BASE+'website-order.html',{waitUntil:'domcontentloaded'});
  const invalid=await page.evaluate(async api=>{
   const r=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan:'semi',template_style:'not-real',update_plan:'free3',custom_domain:false,website:''})});
   return r.status;
  },API);
  assert.equal(invalid,400,'invalid design is rejected by live server');
  console.log('QA_REAL_ORDER_INVALID_REJECTED '+invalid);
  await context.close();
  console.log('QA_REAL_ORDER_ALL_PASS '+JSON.stringify({count:results.length,plans:results.map(r=>r.plan)}));
 }finally{await browser.close()}
};
browserTest().catch(e=>{console.error('QA_REAL_ORDER_FAILED '+(e.stack||e));console.error('QA_ISSUED_ORDERS '+JSON.stringify(results));process.exitCode=1});
