// Local browser mocks only. Never sends a real order, LINE message or bank operation.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {mkdirSync}=require('node:fs');
const {join}=require('node:path');
const base='http://127.0.0.1:8765/',widths=[320,360,390,430,768,1366];
const client=ready=>`
 window.__contractCalls=[];
 const order={order_code:'P9100',status:'pending_payment',plan:'one',update_plan:'unlimited',amount_from:15000,line_user_id:'U_SYNTHETIC',line_display_name:'架空のお客様',created_at:'2026-11-12T00:00:00Z',contract_state:null};
 export async function requireWebsiteSession(){return true;}
 export async function websiteApi(){return {};}
 export const websiteSupabase={functions:{invoke:async(name,{body})=>{
  window.__contractCalls.push(body);
  if(body.action==='admin_list_orders')return{data:{orders:[structuredClone(order)]}};
  if(body.action==='admin_bank_settings')return{data:{message:'架空の銀行・支店・口座番号・名義です'}};
  if(body.action==='admin_commercial_policy_status')return{data:{ready:${ready},unpaid_cancellation_ready:${ready},version:'試験用・未公開',hosting:{initial_fee_jpy:0},reason:'販売条件が未承認です。送信できません。'}};
  if(body.action==='admin_resolve_free_url')return{data:{free_url:'https://s9100.contract.example/'}};
  if(body.action==='admin_send_final_quote'){
   order.final_quote_sent_at='2026-11-13T01:00:00Z';order.final_amount=22000;order.quoted_production_amount=body.final_amount;order.final_public_domain='https://s9100.contract.example/';order.contract_state='sent';order.contract_fingerprint='a'.repeat(64);order.quote_request={production_amount:body.final_amount,public_domain:body.public_domain,quote_note:body.quote_note,delivery_terms:body.delivery_terms,payment_deadline:body.payment_deadline};
   return{data:{ok:true}};
  }
  if(body.action==='admin_contract_detail')return{data:{contract:{state:order.contract_state,message:'保存済みの正式見積り・契約条件\\n初回合計22,000円\\n<script>window.__injected=true</script>'}}};
  if(body.action==='admin_record_contract_acceptance'){order.contract_state='accepted';order.contract_accepted_at='2026-11-13T01:02:00Z';return{data:{ok:true}};}
  if(body.action==='admin_cancel_unpaid_order'&&body.confirm_unpaid===true){order.status='cancelled';return{data:{ok:true}};}
  throw Error('Unexpected contract mock action '+body.action);
 }}};
`;
(async()=>{
 const browser=await chromium.launch({headless:true});let checks=0;
 const check=(v,m)=>{assert.ok(v,m);checks++;};
 try{
  for(const width of widths){
   for(const ready of [false,true]){
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),external=[],errors=[],dialogs=[];
    await context.route('**/*',route=>{
     const u=route.request().url();if(u===base+'website-client.js')return route.fulfill({status:200,contentType:'text/javascript',body:client(ready)});
     if(u.startsWith(base)||u.startsWith('data:'))return route.continue();external.push(u);return route.abort();
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});
    await page.goto(base+'admin/orders.html',{waitUntil:'domcontentloaded'});
    try{await page.locator('.order-card').waitFor({timeout:10000});}catch(e){throw Error('Contract UI failed to load; errors='+errors.join(';')+'; body='+(await page.locator('body').innerText()).slice(0,1800),{cause:e});}await page.locator('.order-card > summary').click();
    check(await page.locator('[data-activate]').isDisabled(),'Activation requires recorded customer acceptance');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow at '+width);
    check(await page.locator('header .back').evaluateAll(els=>els.every(e=>e.getBoundingClientRect().width>=e.textContent.trim().length*7)),'Navigation links keep enough width to remain readable');
    if(!ready){
     check(await page.locator('[data-quote]').isDisabled(),'Unapproved policy blocks final quotations');
     check((await page.locator('#commercialStatus').innerText()).includes('未承認'),'Blocked reason is visible');
     check(await page.locator('[data-cancel-unpaid]').count()===0,'An older backend does not offer cancellation');
    }else{
     await page.locator('[data-quote]').click();check(dialogs.some(x=>x.includes('提供時期')),'Missing delivery date/terms is explained');
     await page.locator('[data-delivery-terms]').fill('1サイト・1ページを制作。全素材受領と入金確認から14日以内に初回案を提出します。');
     await page.locator('[data-payment-deadline]').fill('2026-11-20');
     await page.locator('[data-quote]').click();
     await page.waitForFunction(()=>document.querySelector('[data-quote]')?.disabled&&document.querySelector('[data-contract]'));
     check(dialogs.some(x=>x.includes('22,000円（税込')),'Operator confirms the exact itemized initial total');
     check(await page.locator('[data-activate]').isDisabled(),'Sent quote alone does not enable activation');
     check(await page.locator('.order-card').evaluate(el=>el.open),'The active order stays expanded after saving the quotation');
     check(await page.locator('[data-delivery-terms]').inputValue()==='1サイト・1ページを制作。全素材受領と入金確認から14日以内に初回案を提出します。','Frozen delivery terms remain visible');
     check(await page.locator('[data-final-amount]').isDisabled(),'Sent quotation values cannot be edited in the form');
     const fold=page.locator('.mini-fold').filter({has:page.locator('[data-contract]')});await fold.locator('summary').click();
     await page.locator('[data-contract]').click();await page.waitForFunction(()=>document.querySelector('[data-contract-text]').textContent.includes('保存済み'));
     check(await page.evaluate(()=>window.__injected!==true),'Frozen text is displayed without executing HTML');
     await page.locator('[data-accept-contract]').click();check(dialogs.some(x=>x.includes('同意返信のLINE日時')),'Acceptance evidence is required');
     await page.locator('[data-acceptance-reference]').fill('試験のみ：11月13日18時30分・上記見積りへの同意返信');
     await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
     if(process.env.QA_SCREENSHOTS_DIR){mkdirSync(process.env.QA_SCREENSHOTS_DIR,{recursive:true});await page.screenshot({path:join(process.env.QA_SCREENSHOTS_DIR,'contract-orders-'+width+'.png'),fullPage:true});}
     if(process.env.QA_INLINE_SCREENSHOTS==='true'&&[320,390,1366].includes(width)){
      const s=(await page.screenshot({type:'jpeg',quality:50,fullPage:true})).toString('base64'),n=Math.ceil(s.length/8000);
      for(let i=0;i<n;i++)console.log('SHO_UI_IMAGE contract-orders-'+width+' '+i+'/'+n+' '+s.slice(i*8000,(i+1)*8000));
     }
     await page.locator('[data-accept-contract]').click();await page.waitForFunction(()=>document.querySelector('[data-activate]')?.disabled===false);
     const calls=await page.evaluate(()=>window.__contractCalls);
     check(calls.filter(x=>x.action==='admin_send_final_quote').length===1,'One quote is sent');
     check(calls.filter(x=>x.action==='admin_record_contract_acceptance').length===1,'One exact acceptance is recorded');
     check(calls.find(x=>x.action==='admin_record_contract_acceptance').quote_fingerprint==='a'.repeat(64),'Acknowledgement is bound to the frozen quote hash');
     check(!calls.some(x=>x.action==='admin_activate_order'),'Recording acceptance does not itself confirm bank payment');
     await page.locator('[data-cancel-unpaid]').click();
     await page.locator('.order-card[data-stage="cancelled"]').waitFor();
     check(dialogs.some(x=>x.includes('着金がないことを確認')),'Cancellation asks the administrator to check that no funds arrived');
     check(await page.locator('[data-quote],[data-activate],[data-accept-contract],[data-cancel-unpaid]').count()===0,'A cancelled order has no sales actions');
     check(await page.locator('[data-contract]').count()===1,'The old quotation remains available to review');
     check(await page.evaluate(()=>window.__contractCalls.filter(x=>x.action==='admin_cancel_unpaid_order'&&x.confirm_unpaid===true).length===1),'One cancellation confirmation is sent');
    }
    check(errors.length===0,'No page JavaScript errors: '+errors.join(','));check(external.length===0,'All requests stay inside the mock');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Expanded contract controls fit at '+width);
    await context.close();
   }
  }
  for (const width of [320, 1366]) {
   const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
   const external = [], errors = [];
   await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    external.push(url);
    return route.abort();
   });
   const page = await context.newPage();
   page.on('pageerror', error => errors.push(error.message));
   await page.goto(base + 'customer-hosting-v2/renewal-preview/index.html');
   const scenario = page.getByLabel('見本の日時・入金状態');
   const decline = page.getByRole('button', { name: '継続しない', exact: true });
   const renew = page.getByRole('button', { name: '継続を希望する', exact: true });
   const access = page.locator('#access');
   const retention = page.locator('#retention');

   await scenario.selectOption('before');
   check(await decline.isDisabled(), 'Renewal selection begins at the notice date');
   await scenario.selectOption('open');
   await decline.click();
   check(await decline.getAttribute('aria-pressed') === 'true', 'The customer can decline renewal');
   await renew.click();
   check((await page.locator('#payment').innerText()).includes('入金確認後'), 'Renewal intent is recorded before payment confirmation');
   await decline.click();
   await scenario.selectOption('locked');
   check(await renew.isDisabled() && await decline.isDisabled(), 'The choice is locked at the deadline');
   check((await access.innerText()).includes('公開期間中'), 'The current term runs until expiry');
   await scenario.selectOption('expiry');
   check((await access.innerText()).includes('サイトは非公開'), 'The site becomes private at expiry');
   check((await retention.innerText()).includes('引き渡し') && (await retention.innerText()).includes('有料復元'), 'Both grace periods are shown at expiry');
   await scenario.selectOption('retained');
   check(/^有料復元/.test(await retention.innerText()), 'Only paid restoration is offered after the handover period');
   await scenario.selectOption('purged');
   check((await retention.innerText()).includes('復元の受付は終了しました'), 'The restoration window has closed');
   await scenario.selectOption('paid');
   check((await page.locator('#choice').innerText()).includes('継続が確定') && (await access.innerText()).includes('公開期間中'), 'Confirmed payment extends publication');
   await scenario.selectOption('open');
   const consent = page.getByRole('checkbox', { name: '年払いの自動更新に同意します' });
   const register = page.getByRole('button', { name: 'カード自動更新を登録（見本）' });
   const stop = page.getByRole('button', { name: '次回の自動請求を停止（見本）' });
   const cardStatus = page.locator('#card-status');
   const cardTerms = await page.locator('#card-terms').innerText();
   check(cardTerms.includes('0円') && cardTerms.includes('6,000円（税込）') && cardTerms.includes('2027/11/20'), 'The charge date, annual amount and zero due now precede authorization');
   check(cardTerms.includes('確認に3日程度かかる場合があります'), 'The confirmation estimate appears before consent');
   check(!(await consent.isChecked()) && await register.isDisabled(), 'Card renewal requires an express opt-in');
   await consent.check();
   await register.click();
   check(await stop.isVisible() && await renew.isDisabled(), 'A registered customer can stop card billing, and bank selection is blocked');
   await scenario.selectOption('locked');
   await stop.click();
   check((await cardStatus.innerText()).includes('自動請求を停止') && (await access.innerText()).includes('公開期間中'), 'The last-day billing stop preserves the rest of the current paid period');
   await scenario.selectOption('card-processing');
   check((await access.innerText()).includes('サイトは非公開'), 'A customer who has stopped automatic renewal enters the ordinary expiry flow');
   await scenario.selectOption('open');
   await consent.check();
   await register.click();
   await scenario.selectOption('card-processing');
   check((await access.innerText()).includes('確認中は公開を続けます'), 'A scheduled card charge gets a confirmation hold at the due time');
   check((await cardStatus.innerText()).includes('確認に3日程度かかる場合があります'), 'Pending card charges show their confirmation estimate');
   await scenario.selectOption('card-review');
   check((await cardStatus.innerText()).includes('運営側で決済状況を確認') && await retention.isHidden() && await page.locator('#restoration-price').isHidden(), 'An unresolved charge reaches operator review without offering a second payment for restoration');
   await scenario.selectOption('card-failed');
   check((await cardStatus.innerText()).includes('カード決済に失敗') && !(await page.locator('#choice').innerText()).includes('継続が確定'), 'A card failure does not extend the contract');
   await scenario.selectOption('card-paid');
   check((await cardStatus.innerText()).includes('公開維持を延長') && (await access.innerText()).includes('公開期間中'), 'A settled card renewal extends publication');
   check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Renewal controls fit at ' + width);
   check(errors.length === 0 && external.length === 0, 'Renewal demo runs without page errors or external requests');
   await context.close();
  }
 }finally{await browser.close();}
 console.log('CONTRACT_UI_QA_PASS',JSON.stringify({checks,widths,real_notifications:0,real_payments:0}));
})().catch(e=>{console.error('CONTRACT_UI_QA_FAIL',e.stack||e);process.exitCode=1;});
