const assert=require('node:assert/strict'),{chromium}=require('playwright');
const BASE='http://127.0.0.1:8765/';
const stub=String.raw`let confirmed=false,state='sho_review';
export async function requireWebsiteSession(){return {user:{id:'qa-owner'}}}
export const websiteSupabase={functions:{invoke:async()=>({data:{ok:true},error:null})}};
export async function websiteApi(action,args={}){
 if(action==='list_sites')return {admin:true,sites:[{site_id:'1241',status:state}]};
 if(action==='load_site')return {
  site:{site_id:'1241',site_name:'動作テストサイト',status:state,preview_url:'https://sho-support.github.io/website-preview.html?id=qa',publish_branch:'main',created_at:'2026-11-01T00:00:00Z'},
  intake:{payload:{fields:{site_name:'動作テストサイト',contact_name:'テスト顧客',purpose:'バンド・アーティスト公式サイト',build_plan:'semi',template_style:'cyber'},checks:{features:[]}}},
  jobs:[{kind:'sho_revision',status:'sho_review'}],updates:[],activity:[],profile:{},
  reviewIssues:[{id:1,note:'ヘッダー表示を確認して修正しました',status:confirmed?'confirmed':'ready_for_check',created_at:'2026-11-01T00:00:00Z'}]};
 if(action==='admin_confirm_review_fix'){confirmed=true;return {ok:true}};
 if(action==='admin_transition'){if(args.status==='customer_review'&&!confirmed)throw Error('Unconfirmed owner issue');state=args.status;return {ok:true}};
 if(action==='admin_request_review_fix'){state='building';return {ok:true}};
 throw Error('Unexpected action: '+action);
}`;
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const width of [390,1366]){
   const context=await browser.newContext({viewport:{width,height:860},locale:'ja-JP'});
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/website-client.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:stub}));
   page.on('dialog',async dialog=>dialog.accept());
   await page.goto(BASE+'admin/index.html?site=1241',{waitUntil:'domcontentloaded',timeout:15000});
   await page.locator('.project-card[data-id="1241"]').waitFor({timeout:9000});
   assert.equal(await page.locator('.project-card[data-id="1241"]').evaluate(el=>el.open),true,'Site 1241 automatically opened');
   assert.equal(await page.locator('#approveSho').isDisabled(),true,'Cannot send customer URL before owner review');
   assert.equal(await page.locator('[data-confirm-issue="1"]').isVisible(),true,'Owner confirm action visible');
   await page.locator('[data-confirm-issue="1"]').click();
   await page.getByText('✓ 確認済み').waitFor({timeout:6500});
   assert.equal(await page.locator('#approveSho').isEnabled(),true,'Owner can approve only after issue confirmed');
   await page.locator('#approveSho').click();
   await page.getByText('お客様の最終確認待ちです。',{exact:false}).waitFor({timeout:6500});
   assert.equal(await page.locator('#resendCustomerReview').isVisible(),true,'LINE confirmation can be resent');
   await page.locator('#resendCustomerReview').click();
   await page.waitForTimeout(120);
   assert.deepEqual(errors,[],'Admin JavaScript runtime errors');
   const view=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));
   assert.ok(view.width<=view.viewport+6,'Admin mobile overflow');
   console.log('ADMIN_REVIEW_E2E_PASS '+JSON.stringify({width,confirmIssue:true,approvalGate:true,customerReview:true,resend:true}));
   await context.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error('ADMIN_REVIEW_E2E_FAIL',e.stack);process.exitCode=1});
