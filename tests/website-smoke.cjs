const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {mkdirSync}=require('node:fs');
const {join}=require('node:path');
const screenshots=process.env.QA_SCREENSHOTS_DIR;
if(screenshots)mkdirSync(screenshots,{recursive:true});
const BASE='http://127.0.0.1:8765/';
const paths=[
 'website-support.html','website-create.html','website-faq.html','website-order.html',
 'website-order-confirm.html','website-templates.html','website-template-preview.html',
 'website-update-demo.html','website-legal.html','website-terms.html','website-privacy.html',
 'website-payment.html','website-update.html','website-portal.html','website-login.html',
 'website-intake.html?id=DEMO','website-customer-review.html',
 'website-demo-semi-rock.html','website-demo-semi-premium.html','website-demo-semi-cyber.html',
 'admin/index.html?demo=1'
];
let assertions=0;
const check=(condition,message)=>{assert.ok(condition,message);assertions++};
async function checkLiveArchive(browser) {
 const context=await browser.newContext({viewport:{width:320,height:850},timezoneId:'America/Los_Angeles',serviceWorkers:'block'});
 try{
  await context.route('**/*',route=>route.request().url().startsWith(BASE)?route.continue():route.abort());
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install({time:new Date('2026-11-21T14:59:00Z')});
  await page.clock.pauseAt(new Date('2026-11-21T14:59:50Z'));
  await page.goto(BASE+'website-update-demo.html?mode=band-owner');
  const archive=page.locator('#pastItems');
  const choices=archive.locator('.archive-choice');
  check(!await choices.first().isVisible(),'Past shows start collapsed');
  await archive.locator('summary').first().click();
  const dates=await choices.locator('time').evaluateAll(items=>items.map(item=>item.dateTime));
  assert.deepEqual(dates,['2026-10-24','2026-10-03','2026-09-05'],'Past shows start with the three newest dates');
  await archive.getByRole('button',{name:'+5件表示'}).click();
  check(await choices.count()===8,'First expansion adds five shows');
  await archive.getByRole('button',{name:'+5件表示'}).click();
  check(await choices.count()===9 && !await page.locator('#morePast').isVisible(),'Final expansion shows all remaining shows');

  const schedule=page.locator('#liveItems');
  const showName='日付切替の確認ライブ';
  await schedule.locator('[name="date"]').fill('2026-11-21');
  await schedule.locator('[name="name"]').fill(showName);
  await schedule.locator('[name="place"]').fill('確認用会場');
  await page.locator('#applyAll').click();
  await page.locator('#formStatus').getByText('このブラウザに下書きを保存しました。').waitFor();
  check(await page.locator('#liveList').getByText(showName).count()===1,'Show stays upcoming on its date in Japan');
  await page.clock.runFor(40_000);
  check(await page.locator('#liveList').getByText(showName).count()===0,'JST midnight removes the saved show from the schedule');
  check(await page.locator('#pastList').getByText(showName).count()===1,'The same show moves to past shows once');

  await archive.getByRole('button',{name:new RegExp(showName)}).click();
  const editor=page.locator('#pastEditor');
  await editor.locator('[name="setlist"]').fill('試験曲 1\n試験曲 2');
  await editor.locator('[name="video"]').fill('https://example.invalid/test');
  await editor.getByRole('button',{name:'保存',exact:true}).click();
  await page.locator('#pastStatus').getByText('過去ライブにはYouTubeの動画リンクを入力してください。').waitFor();
  await editor.locator('[name="video"]').fill('https://youtu.be/kHdosslnuB4?si=test');
  await schedule.locator('[name="date"]').fill('2026-11-23');
  await schedule.locator('[name="name"]').fill('未保存の次回ライブ');
  await editor.getByRole('button',{name:'保存',exact:true}).click();
  await page.locator('#pastStatus').getByText('過去ライブの下書きを保存しました。').waitFor();
  const savedCard=page.locator('#pastList article').filter({hasText:showName});
  check((await savedCard.textContent()).includes('確認用会場'),'Archiving keeps the venue');
  check(await savedCard.locator('a').getAttribute('href')==='https://www.youtube.com/watch?v=kHdosslnuB4','Save updates the selected show video');
  assert.deepEqual(await savedCard.locator('li').allTextContents(),['試験曲 1','試験曲 2'],'Setlist keeps its order');
  check(await schedule.locator('[name="name"]').inputValue()==='未保存の次回ライブ','Saving one show leaves an unsaved schedule form intact');
  check(await page.locator('#liveList').getByText('未保存の次回ライブ').count()===0,'Archive Save does not publish schedule changes');

  await page.reload();
  await archive.locator('summary').first().click();
  await archive.getByRole('button',{name:new RegExp(showName)}).click();
  check(await choices.count()===3,'Reopening starts with three past shows');
  check(await page.locator('#pastList').getByText(showName).count()===1,'Reload does not duplicate archived shows');
  check(await editor.locator('[name="setlist"]').inputValue()==='試験曲 1\n試験曲 2','Setlist survives reload');
  check(await editor.locator('[name="video"]').inputValue()==='https://www.youtube.com/watch?v=kHdosslnuB4','Video survives reload');
  check(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=3,'Archive editor fits at 320px');

  await page.evaluate(()=>new Promise((resolve,reject)=>{
   const request=indexedDB.open('sho-guns-n-loses-update-demo',1);
   request.onerror=()=>reject(request.error);
   request.onsuccess=()=>{
    const db=request.result, transaction=db.transaction('drafts','readwrite');
    transaction.objectStore('drafts').put({
     upcoming:[{date:'2026-11-20',name:'旧形式の終了ライブ'}],
     past:[{date:'2026-10-01',name:'旧形式の過去ライブ',setlist:['保存済みの曲']}],
     photos:{top:null,gallery:[]},notice:'保存済みのお知らせ',other:'',
    },'current');
    transaction.oncomplete=()=>{db.close();resolve()};
    transaction.onabort=()=>{db.close();reject(transaction.error)};
   };
  }));
  await page.reload();
  await archive.locator('summary').first().click();
  await archive.getByRole('button',{name:/旧形式の終了ライブ/}).waitFor();
  check(await choices.count()===2,'An expired legacy schedule is archived even if the page was closed');
  check((await page.locator('#pastList').textContent()).includes('保存済みの曲'),'Legacy archive setlists survive');
  check(await page.locator('#pNotice').textContent()==='保存済みのお知らせ','Legacy drafts keep other saved fields');
  check(errors.length===0,'Archive JS exceptions: '+errors.join(' | '));
 }finally{await context.close()}
}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.QA_CHROMIUM_EXECUTABLE?{executablePath:process.env.QA_CHROMIUM_EXECUTABLE}:{})});
 try{
  for(const width of [320,360,390,430,768,1366]){
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
    const visibleHidden=await page.locator('[hidden]').evaluateAll(els=>els.filter(el=>el.getClientRects().length>0).map(el=>el.id||el.tagName));
    check(visibleHidden.length===0,'Hidden content must stay hidden '+width+'px '+path+': '+visibleHidden.join(','));
    if(/^(website-support|website-order|website-templates|website-template-preview|website-demo-semi-(rock|premium|cyber)|website-create|website-faq)\.html/.test(path)){
     const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
     check(overflow<=3,'Horizontal overflow '+width+'px '+path+': '+overflow);
     check(errors.length===0,'JS exceptions in '+path+': '+errors.join(' | '));
    }
    if(/^website-(template-preview|demo-semi-(rock|premium|cyber))\.html/.test(path)){
     const heights=await page.locator('.gallery .shot').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height));
     if(path==='website-template-preview.html')check(heights.length===5,'Template preview shows five gallery frames');
     if(heights.length)check(heights.every(height=>height>=120),'Visible gallery frames keep image height '+width+'px '+path);
    }
    if(screenshots&&['website-support.html','website-order.html','website-template-preview.html'].includes(path)){
     await page.screenshot({path:join(screenshots,width+'-'+path.replace('.html','.png')),fullPage:true});
    }
    if(screenshots&&path.startsWith('website-demo-semi-')){
     await page.screenshot({path:join(screenshots,width+'-'+path.replace('.html','.png')),fullPage:true});
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
   check(await page.locator('.promo-benefit').first().innerText()==='公開後30日間調整無料','First promo benefit is explicitly on second line');
   check((await page.locator('.promo .promo-main').nth(1).innerText()).includes('月8回まで'),'Campaign visibly states 8 monthly updates');
   await page.locator('[data-plan="full"] .plan-select').click();
   check(await page.locator('#finalBtn').isEnabled(),'Full order enables confirmation');
   await page.locator('[data-plan="semi"] .plan-select').click();
   check(!await page.locator('#finalBtn').isEnabled(),'Semi order needs a template');
   await page.locator('[data-template="rock"]').click();
   check(await page.locator('#finalBtn').isEnabled(),'Semi order with template enables confirmation');
   await page.locator('[data-plan="one"] .plan-select').click();
   check(await page.locator('#finalBtn').isEnabled(),'Switching from free campaign defaults one-page to pay per update');
   check(await page.locator('[data-update="none"]').evaluate(el=>el.classList.contains('selected')),'One-page defaults to the selected pay-per-update option');
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
  await checkLiveArchive(browser);
  console.log('WEBSITE QUALITY PASS; assertions='+assertions);
 }finally{await browser.close()}
})().catch(e=>{console.error('WEBSITE QUALITY FAILURE:',e.stack||e);process.exitCode=1});
