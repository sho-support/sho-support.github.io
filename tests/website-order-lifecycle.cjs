// Browser-only mocks: never sends an order, payment, LINE or email to a real service.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {mkdirSync}=require('node:fs');
const {join}=require('node:path');
const base='http://127.0.0.1:8765/';
const endpoint='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-order-api';
const cases=[
  {plan:'one',update:'none',amount:15000},
  {plan:'semi',template:'rock',update:'free3',amount:22000},
  {plan:'full',update:'free3',amount:30000},
  {plan:'one',update:'unlimited',amount:22000,lostResponse:true}
];

(async()=>{
 const browser=await chromium.launch({headless:true});
 let checks=0;
 const check=(value,message)=>{assert.ok(value,message);checks++;};
 try{
  for(const scenario of cases){
   const context=await browser.newContext({viewport:{width:390,height:850},serviceWorkers:'block'});
   const requests=[],ledger=new Map(),outbound=[];
   await context.route('**/*',async route=>{
    const request=route.request(),url=request.url();
    if(url.startsWith(base)||url.startsWith('data:'))return route.continue();
    if(url!==endpoint){outbound.push(url);return route.abort();}
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{
      'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type'
    }});
    assert.equal(request.method(),'POST');
    const body=request.postDataJSON();requests.push(body);
    assert.equal(body.plan,scenario.plan);
    assert.equal(body.update_plan,scenario.update);
    assert.equal(body.template_style,scenario.template||'');
    assert.equal(body.custom_domain,false);
    assert.equal(body.website,'');
    assert.match(body.client_request_id,/^[0-9a-f-]{36}$/);
    assert.match(body.client_link_token,/^[0-9a-f]{40}$/);
    if(!ledger.has(body.client_request_id))ledger.set(body.client_request_id,{
      order_code:'MOCK-'+scenario.plan.toUpperCase(),created_at:new Date().toISOString(),link_token:body.client_link_token
    });
    if(scenario.lostResponse&&requests.length===1)return route.abort('failed');
    return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},
      body:JSON.stringify({ok:true,order:ledger.get(body.client_request_id)})});
   });
   const page=await context.newPage();
   await page.goto(base+'website-order.html',{waitUntil:'domcontentloaded'});
   await page.locator(`[data-plan="${scenario.plan}"] .plan-select`).click();
   if(scenario.template)await page.locator(`[data-template="${scenario.template}"]`).click();
   if(scenario.plan==='one')await page.locator(`[data-update="${scenario.update}"]`).click();
   check(await page.locator('#finalBtn').isEnabled(),'Selected plan is ready for final review');
   check(await page.locator('#sumTemplateRow').isVisible()===(scenario.plan==='semi'),'Only semi-order shows a selected-template summary');
   check(!await page.locator('#sumExtraRow').isVisible(),'Empty extra-request summary stays hidden');
   await page.locator('#finalBtn').click();
   await page.waitForURL('**/website-order-confirm.html');
   check((await page.locator('#amount').innerText()).includes(scenario.amount.toLocaleString()),'Displayed estimate preserves approved prices');
   check(await page.locator('#templateRow').isVisible()===(scenario.plan==='semi'),'Only semi-order shows the template on final review');
   check(!await page.locator('#extraRow').isVisible(),'Empty extra requests do not appear on final review');
   check(await page.locator('#orderBtn').isDisabled(),'Unchecked consent blocks submission');
   await page.locator('#termsCheck').check();
   await page.locator('#orderBtn').click();
   if(scenario.lostResponse){
    await page.locator('#error.show').waitFor();
    check(await page.locator('#orderBtn').isEnabled(),'Lost response permits a retry');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#termsCheck').check();
    await page.locator('#orderBtn').click();
   }
   await page.locator('#done.show').waitFor();
   check(await page.locator('#orderId').innerText()==='MOCK-'+scenario.plan.toUpperCase(),'Mock saved order has the same receipt ID');
   check(ledger.size===1,'One saved order per user attempt');
   check(requests.length===(scenario.lostResponse?2:1),'No unexpected submit requests');
   if(scenario.lostResponse){
    check(requests[0].client_request_id===requests[1].client_request_id,'Retry after reload keeps idempotency ID');
    check(requests[0].client_link_token===requests[1].client_link_token,'Retry keeps the same private link token');
   }
   const receipt=await page.evaluate(()=>JSON.parse(localStorage.getItem('sho_web_order_receipt_v2')));
   check(receipt.order.order_code==='MOCK-'+scenario.plan.toUpperCase(),'Receipt is persisted in the browser');
   check(await page.evaluate(()=>localStorage.getItem('sho_web_order_pending_v1'))===null,'Successful receipt clears the pending attempt');
   // A prior bug re-enabled the submit button when consent was toggled after success.
   await page.locator('#termsCheck').uncheck();
   await page.locator('#termsCheck').check();
   check(await page.locator('#orderBtn').isDisabled(),'Accepted orders stay locked after consent changes');
   await page.reload({waitUntil:'domcontentloaded'});
   await page.locator('#done.show').waitFor();
   check(await page.locator('#orderBtn').isDisabled(),'Reload restores the accepted order lock');
   await page.locator('#termsCheck').uncheck();
   await page.locator('#termsCheck').check();
   check(await page.locator('#orderBtn').isDisabled(),'Restored receipt also stays locked after consent changes');
   check(requests.length===(scenario.lostResponse?2:1),'Consent and reload never create another order');
   check(outbound.every(url=>url.startsWith('https://www.googletagmanager.com/')),'No LINE, email, payment or other external request');
   if(process.env.QA_SCREENSHOTS_DIR){
    mkdirSync(process.env.QA_SCREENSHOTS_DIR,{recursive:true});
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:join(process.env.QA_SCREENSHOTS_DIR,`receipt-${scenario.plan}-${scenario.update}.png`),fullPage:true});
   }
   await context.close();
  }
  console.log(`ORDER MOCK LIFECYCLE PASS; plans=3; scenarios=4; assertions=${checks}; real_external_writes=0`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
