const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const BASE='http://127.0.0.1:8765/';
const paths=[
 'website-support.html','website-create.html','website-faq.html','website-order.html',
 'website-order-confirm.html','website-templates.html','website-template-preview.html',
 'website-update-demo.html','website-legal.html','website-terms.html','website-privacy.html',
 'website-payment.html','website-update.html','website-portal.html','website-login.html',
 'website-intake.html?id=DEMO','website-customer-review.html',
 'admin/index.html?demo=1'
];
let assertions=0;
const check=(condition,message)=>{assert.ok(condition,message);assertions++};
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const width of [390,1280]){
   const context=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block'});
   await context.route('**/*',route=>{
    const u=route.request().url();
    return u.startsWith(BASE)||u.startsWith('data:')?route.continue():route.abort();
   });
   const page=await context.newPage();
   const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   for(const path of paths){
    errors.length=0;
    const response=await page.goto(BASE+path,{waitUntil:'domcontentloaded',timeout:25000});
    check(response?.status()===200,'HTTP 200 for '+path);
    check((await page.title())!=='','Page title '+path);
    if(/^(website-support|website-order|website-templates|website-template-preview|website-create|website-faq)\.html/.test(path)){
     const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
     check(overflow<=3,'Horizontal overflow '+width+'px '+path+': '+overflow);
     check(errors.length===0,'JS exceptions in '+path+': '+errors.join(' | '));
    }
   }
   await page.goto(BASE+'website-support.html',{waitUntil:'domcontentloaded'});
   const plans=page.locator('.plans-accordion details.plan-drop');
   check(await plans.count()===3,'Exactly three price plans');
   const borders=await plans.evaluateAll(els=>els.map(el=>getComputedStyle(el).borderTopColor));
   check(borders.every(c=>c===borders[0]),'Price plan border colors equal on initial load');
   const updates=page.locator('.update-prices details.up');
   check(await updates.count()===3,'Exactly three update plans');
   const updateBorders=await updates.evaluateAll(els=>els.map(el=>getComputedStyle(el).borderTopColor));
   check(updateBorders.every(c=>c===updateBorders[0]),'Update plan border colors equal on initial load');
   check(await page.locator('.hero .actions a').count()===2,'Hero has exactly two CTAs');
   check(await page.locator('.site-shot[href="index.html"]').count()===1,'Guns preview is clickable');
   await plans.nth(1).locator('summary').click();
   check(await plans.nth(1).evaluate(el=>el.open),'Semi order plan opens');
   await plans.nth(1).locator('.close-plan').click();
   check(!await plans.nth(1).evaluate(el=>el.open),'Semi order plan closes');
   await page.goto(BASE+'website-order.html',{waitUntil:'domcontentloaded'});
   await page.locator('[data-plan="full"] .plan-select').click();
   check(await page.locator('#finalBtn').isEnabled(),'Full order enables confirmation');
   await page.locator('[data-plan="semi"] .plan-select').click();
   check(!await page.locator('#finalBtn').isEnabled(),'Semi order needs a template');
   await page.locator('[data-template="rock"]').click();
   check(await page.locator('#finalBtn').isEnabled(),'Semi order with template enables confirmation');
   await page.locator('[data-plan="one"] .plan-select').click();
   check(!await page.locator('#finalBtn').isEnabled(),'One-page needs update option');
   await page.locator('[data-update="none"]').click();
   check(await page.locator('#finalBtn').isEnabled(),'One-page with update choice enables confirmation');
   await page.locator('#finalBtn').click();
   await page.waitForURL('**/website-order-confirm.html');
   check(await page.locator('#orderBtn').isDisabled(),'Consent unchecked prevents order');
   await page.locator('#termsCheck').check();
   check(await page.locator('#orderBtn').isEnabled(),'Consent enables order');
   await page.evaluate(()=>{
    const receipt={state_key:localStorage.getItem('sho_web_order_v3'),order:{order_code:'P99999',created_at:new Date().toISOString()}};
    localStorage.setItem('sho_web_order_receipt_v2',JSON.stringify(receipt));
   });
   await page.reload({waitUntil:'domcontentloaded'});
   check((await page.locator('#orderId').textContent()).includes('P99999'),'Saved order receipt restored');
   check(await page.locator('#orderBtn').isDisabled(),'Duplicate order prevented on receipt restore');
   await page.goto(BASE+'website-templates.html',{waitUntil:'domcontentloaded'});
   check(await page.locator('.card .preview-mini').count()===10,'All 10 template previews are linked');
   await page.goto(BASE+'website-template-preview.html?style=cyber',{waitUntil:'domcontentloaded'});
   check((await page.title()).includes('CYBER'),'Template style switches by URL');
   check(await page.locator('.contact-links a:not([href])').count()===0,'No fake clickable anchors in preview');
   console.log('PASS viewport '+width+'px');
   await context.close();
  }
  console.log('WEBSITE QUALITY PASS; assertions='+assertions);
 }finally{await browser.close()}
})().catch(e=>{console.error('WEBSITE QUALITY FAILURE:',e.stack||e);process.exitCode=1});
