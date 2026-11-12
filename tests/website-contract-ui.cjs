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
  if(body.action==='admin_commercial_policy_status')return{data:{ready:${ready},version:'試験用・未公開',hosting:{initial_fee_jpy:500},reason:'販売条件が未承認です。送信できません。'}};
  if(body.action==='admin_resolve_free_url')return{data:{free_url:'https://s9100.contract.example/'}};
  if(body.action==='admin_send_final_quote'){
   order.final_quote_sent_at='2026-11-13T01:00:00Z';order.final_amount=22500;order.quoted_production_amount=body.final_amount;order.final_public_domain='https://s9100.contract.example/';order.contract_state='sent';order.contract_fingerprint='a'.repeat(64);
   return{data:{ok:true}};
  }
  if(body.action==='admin_contract_detail')return{data:{contract:{state:order.contract_state,message:'保存済みの正式見積り・契約条件\\n初回合計22,500円\\n<script>window.__injected=true</script>'}}};
  if(body.action==='admin_record_contract_acceptance'){order.contract_state='accepted';order.contract_accepted_at='2026-11-13T01:02:00Z';return{data:{ok:true}};}
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
    if(!ready){
     check(await page.locator('[data-quote]').isDisabled(),'Unapproved policy blocks final quotations');
     check((await page.locator('#commercialStatus').innerText()).includes('未承認'),'Blocked reason is visible');
    }else{
     await page.locator('[data-quote]').click();check(dialogs.some(x=>x.includes('提供時期')),'Missing delivery date/terms is explained');
     await page.locator('[data-delivery-terms]').fill('1サイト・1ページを制作。全素材受領と入金確認から14日以内に初回案を提出します。');
     await page.locator('[data-payment-deadline]').fill('2026-11-20');
     await page.locator('[data-quote]').click();
     await page.waitForFunction(()=>document.querySelector('[data-quote]')?.disabled&&document.querySelector('[data-contract]'));
     check(dialogs.some(x=>x.includes('22,500円（税込')),'Operator confirms the exact itemized initial total');
     check(await page.locator('[data-activate]').isDisabled(),'Sent quote alone does not enable activation');
     check(await page.locator('.order-card').evaluate(el=>el.open),'The active order stays expanded after saving the quotation');
     const fold=page.locator('.mini-fold').filter({has:page.locator('[data-contract]')});await fold.locator('summary').click();
     await page.locator('[data-contract]').click();await page.waitForFunction(()=>document.querySelector('[data-contract-text]').textContent.includes('保存済み'));
     check(await page.evaluate(()=>window.__injected!==true),'Frozen text is displayed without executing HTML');
     await page.locator('[data-accept-contract]').click();check(dialogs.some(x=>x.includes('同意返信のLINE日時')),'Acceptance evidence is required');
     await page.locator('[data-acceptance-reference]').fill('試験のみ：11月13日18時30分・上記見積りへの同意返信');
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
    }
    check(errors.length===0,'No page JavaScript errors: '+errors.join(','));check(external.length===0,'All requests stay inside the mock');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Expanded contract controls fit at '+width);
    await context.close();
   }
  }
 }finally{await browser.close();}
 console.log('CONTRACT_UI_QA_PASS',JSON.stringify({checks,widths,real_notifications:0,real_payments:0}));
})().catch(e=>{console.error('CONTRACT_UI_QA_FAIL',e.stack||e);process.exitCode=1;});
