const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const origin=(process.env.SALES_BASE_URL||'http://127.0.0.1:8765/').replace(/\/?$/,'/');
 if(!origin.startsWith('http://127.0.0.1:'))throw Error('Submit UI test must use mock API and localhost site');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const width of [320,390,430,1366]){
   const context=await browser.newContext({viewport:{width,height:850},locale:'ja-JP'});
   const page=await context.newPage();
   await page.goto(origin+'website-order.html');
   await page.locator('.plan[data-plan="one"] .plan-select').click();
   await page.locator('.update-option[data-update="none"]').click();
   await page.locator('#finalBtn').click();
   await page.waitForURL(/website-order-confirm\.html/);
   assert.equal(await page.locator('#orderBtn').isDisabled(),true,'consent required');
   const attempts=[];
   await page.route('https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-order-api',async route=>{
    const body=route.request().postDataJSON();attempts.push(body);
    assert.match(body.client_request_id,/^[0-9a-f]{8}-[0-9a-f-]{27}$/,'UUID created');
    assert.match(body.client_link_token,/^[a-f0-9]{40}$/,'random LINE token created');
    const first=attempts.length===1;
    await route.fulfill({status:first?503:201,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':origin.slice(0,-1)},
      body:JSON.stringify(first?{error:'通信中断（テスト）'}:{ok:true,order:{
       order_code:'P9999',status:'pending_line',plan:'one',amount_from:15000,
       created_at:new Date().toISOString(),link_token:body.client_link_token
      }})});
   });
   await page.locator('#termsCheck').check();
   await page.locator('#orderBtn').click();
   await page.locator('#error.show').waitFor();
   assert.match(await page.locator('#orderBtn').textContent(),/再試行/);
   await page.locator('#orderBtn').click();
   await page.locator('#done.show').waitFor();
   assert.equal(attempts.length,2,'retry was sent once');
   assert.equal(attempts[0].client_request_id,attempts[1].client_request_id,'request ID re-used');
   assert.equal(attempts[0].client_link_token,attempts[1].client_link_token,'LINE token re-used');
   assert.equal(await page.locator('#orderId').textContent(),'P9999');
   const link=await page.locator('#lineBtn').getAttribute('href');
   assert.ok(link.startsWith('https://line.me/R/oaMessage/%40144dlsxp/?'),'LINE deep link official form');
   assert.ok(decodeURIComponent(link).includes('注文ID: P9999'),'order code in LINE message');
   assert.ok(decodeURIComponent(link).includes('連携コード: '+attempts[1].client_link_token),'recovery token in LINE message');
   assert.equal(await page.locator('#orderBtn').isDisabled(),true,'cannot resubmit after success');
   await page.reload();
   await page.locator('#done.show').waitFor();
   assert.equal(await page.locator('#orderId').textContent(),'P9999','receipt survives reload');
   assert.equal(attempts.length,2,'no new order after reload');
   const box=await page.evaluate(()=>({vw:innerWidth,doc:document.documentElement.scrollWidth}));
   assert.ok(box.doc<=box.vw+3,'confirmation screen must fit on width '+width);
   console.log('ORDER_SUBMIT_UI_QA_PASS '+JSON.stringify({width,retries:attempts.length,code:'P9999',overflow:box.doc-box.vw}));
   await context.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error('ORDER_SUBMIT_UI_QA_FAIL',e.stack||e);process.exitCode=1});
