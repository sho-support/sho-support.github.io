const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const BASE='http://127.0.0.1:8765/';
const api='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/';
const stub=[
"export async function requireWebsiteSession(){return {user:{id:'test'}}}",
"export async function websiteApi(){throw new Error('Unexpected legacy website API call')}",
"export async function uploadWebsiteFile(){return 'test-upload'}",
"export const websiteSupabase={storage:{from:()=>({uploadToSignedUrl:async()=>({error:null})})}}"
].join('\n');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:850}});
  await context.route('**/*',route=>{
   const u=route.request().url();
   return u.startsWith(BASE)||u.startsWith(api)||u.startsWith('data:')?route.continue():route.abort();
  });
  await context.route('**/website-client.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:stub}));
  const page=await context.newPage();
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  let approved=false,reviewCalls=[],updateCalls=[];
  await page.route(api+'website-customer-access',async route=>{
   const body=route.request().postDataJSON();reviewCalls.push(body.action);
   let data={ok:true};
   if(body.action==='review_load')data={ok:true,site:{site_id:'TEST-001',site_name:'テストサイト',status:'customer_review',customer_approved:approved,preview_url:'https://example.com/preview'}};
   else if(body.action==='review_approve'){approved=true;data={ok:true,customer_approved:true};}
   else if(body.action==='review_publish')data={ok:true,status:'live',public_url:'https://example.com/live'};
   else if(body.action==='update_status')data={ok:true,site:{site_id:'TEST-001',site_name:'テストサイト',status:'live',adjustment_free_until:'2026-11-30T00:00:00Z',update_free_until:'2027-01-31T00:00:00Z'},plan:'full'};
   else if(body.action==='request_update'){updateCalls.push(body);data={ok:true,request_id:12,category:'free_monthly',status:'pending_sho'};}
   else throw Error('Unexpected API: '+body.action);
   await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
  });
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(BASE+'website-customer-review.html?id=TEST-001&prod=1&key=abcdefghijklmnopqrstuvwxyz',{waitUntil:'domcontentloaded'});
  await page.locator('#approve').waitFor({timeout:12000});
  assert.equal(await page.locator('#openRevision').count(),1);
  await page.locator('#approve').click();
  await page.locator('#publish').waitFor({timeout:12000});
  await page.locator('#publish').click();
  await page.getByText('公開設定が完了しました。').waitFor({timeout:12000});
  assert.deepEqual(reviewCalls.slice(0,4),['review_load','review_approve','review_load','review_publish']);
  console.log('PASS secure LINE review approve and publish');
  await page.goto(BASE+'website-update.html?id=TEST-001&key=abcdefghijklmnopqrstuvwxyz',{waitUntil:'domcontentloaded'});
  await page.locator('#updateForm:not([hidden])').waitFor({timeout:12000});
  await page.locator('#detail').fill('11月のライブ日程を追加してください。');
  await page.locator('#send').click();
  await page.getByText('更新依頼 #12').waitFor({timeout:12000});
  assert.equal(updateCalls.length,1);
  assert.equal(updateCalls[0].site_id,'TEST-001');
  console.log('PASS secure customer update request without real side effects');
  await page.route(/\/functions\/v1\/website-preview\?/,route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({html:'<!doctype html><html><body><h1>プレビュー動作確認</h1></body></html>'})}));
  await page.goto(BASE+'website-preview.html?id=TEST-001&key=abcdefghijklmnopqrstuvwxyz',{waitUntil:'domcontentloaded'});
  await page.frameLocator('#view').getByText('プレビュー動作確認').waitFor({timeout:12000});
  console.log('PASS sandboxed private site preview rendering');
  await page.route(api+'website-order-api',route=>route.fulfill({status:201,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:true,order:{order_code:'S99999',link_token:'0123456789abcdef0123456789abcdef01234567',created_at:new Date().toISOString()}})}));
  await page.goto(BASE+'website-order.html',{waitUntil:'domcontentloaded'});
  await page.locator('[data-plan="semi"] .plan-select').click();
  await page.locator('[data-template="rock"]').click();
  await page.locator('#finalBtn').click();
  await page.locator('#termsCheck').check();
  await page.locator('#orderBtn').click();
  await page.getByText('S99999').waitFor({timeout:12000});
  const line=await page.locator('#lineBtn').getAttribute('href');
  assert.ok(line.includes('S99999'),'LINE contact registration carries the order code');
  assert.ok(decodeURIComponent(line).includes('制作案内の連絡先登録'),'LINE message is a short contact registration');
  assert.ok(!decodeURIComponent(line).includes('制作プラン:'),'LINE no longer resends complete order details');
  assert.equal((await page.locator('#done h2').innerText()).trim(),'お申し込みを受け付けました。');
  assert.ok(decodeURIComponent(line).includes('連携コード: 0123456789abcdef0123456789abcdef01234567'),'LINE order pairing includes unpredictable token');
  await page.reload({waitUntil:'domcontentloaded'});
  assert.equal((await page.locator('#orderId').textContent()).trim(),'S99999');
  console.log('PASS order API mocked response, LINE handoff, and receipt persistence');
  assert.deepEqual(pageErrors,[],'No JS runtime errors during customer flows');
  await context.close();
 }finally{await browser.close()}
})().catch(err=>{console.error('CUSTOMER MOCK FLOW FAILED',err.stack||err);process.exitCode=1});
