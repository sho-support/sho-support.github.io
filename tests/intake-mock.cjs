const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const BASE='http://127.0.0.1:8765/';
const API='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-customer-access';
const stub=[
"export async function requireWebsiteSession(){return {user:{id:'test'}}}",
"export async function websiteApi(){throw new Error('Unexpected legacy website API call')}",
"export async function uploadWebsiteFile(){return 'test-upload'}",
"export const websiteSupabase={storage:{from:()=>({uploadToSignedUrl:async()=>({error:null})})}}"
].join('\n');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await context.route('**/*',route=>{
   const url=route.request().url();
   if(url.startsWith(BASE)||url.startsWith(API)||url.startsWith('data:'))return route.continue();
   return route.abort();
  });
  await context.route('**/website-client.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:stub}));
  const records=[],page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.route(API,async route=>{
   const req=route.request().postDataJSON();
   records.push(req);
   let result={ok:true,last_saved_at:new Date().toISOString()};
   if(req.action==='load')result={ok:true,site:{site_id:'9991',site_name:'テスト',status:'request_waiting'},intake:{payload:{fields:{},members:[],lives:[],contacts:[],files:{top_photos:[],gallery_photos:[],logo_file:[]}}},order:{plan:'semi',template_style:'rock'}};
   if(req.action==='signed_upload')result={ok:true,path:'9991/secure-intake/'+req.folder+'/mock-'+req.file_name,token:'mock-token'};
   if(req.action==='submit_intake')result={ok:true,submitted_at:new Date().toISOString()};
   await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(result)});
  });
  await page.goto(BASE+'website-intake.html?id=9991&prod=1&key=abcdefghijklmnopqrstuvwxyz',{waitUntil:'domcontentloaded'});
  await page.locator('#members .member').first().waitFor({state:'attached',timeout:15000});
  await page.locator('details.card').evaluateAll(list=>list.forEach(detail=>detail.open=true));
  assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('semi-mode')),true,'Semi order mode is active');
  assert.equal(await page.locator('#colorPrefWrap').isVisible(),false,'Semi-order colors are fixed to the template');
  assert.equal(await page.locator('#liveSection').isVisible(),true,'LIVE section is enabled by default');
  assert.equal(await page.locator('#memberSection').isVisible(),false,'Optional member pages are initially hidden');
  assert.equal(await page.locator('#featureSectionLabel').textContent(),'03 SNS・連絡先','Semi-order suppresses structural changes');
  assert.ok((await page.locator('input[name="gallery_photos"]').getAttribute('multiple'))!==null,'Gallery permits multiple photos');
  await page.locator('input[name="gallery_photos"]').setInputFiles({name:'gallery.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10])});
  assert.equal(await page.locator('[name="features"][value="写真ギャラリー"]').isChecked(),true,'Gallery auto-enables when photo selected');

  await page.locator('#memberPages').check();
  await page.locator('#memberSection').evaluate(el=>{el.open=true;});
  await page.locator('input[name="site_name"]').fill('テストサイト');
  await page.locator('#members .member input[data-mf="name"]').first().fill('テストメンバー');
  await page.locator('#members .member input[data-mf="part"]').first().fill('ギター');
  const fakePng={name:'portrait.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10])};
  await page.locator('#members .member input[type="file"]').first().setInputFiles(fakePng);
  await page.locator('input[name="rights"]').check();
  await page.locator('input[name="privacy"]').check();
  const section1=page.locator('[data-section="1"]');
  await section1.locator('[name="section_complete"]').check();
  assert.equal(await section1.evaluate(el=>el.open),false,'Completed accordion automatically closes');
  await page.locator('[data-section="1"] summary').click();
  await page.locator('#previewBtn').click();
  await page.locator('#confirmSend').waitFor({timeout:15000});
  assert.equal(await page.locator('#savePreviewImage').count(),1,'Confirmation can be saved as an image');
  const fileReq=records.find(x=>x.action==='signed_upload'&&x.folder==='member_photos');
  assert.ok(fileReq,'Member photo signed upload was requested');
  const saved=records.filter(x=>x.action==='save_draft').slice(-1)[0];
  assert.ok(saved,'Draft was saved');
  assert.equal(saved.payload.fields.build_plan,'semi','Order plan is locked for customer');
  assert.equal(saved.payload.fields.template_style,'rock','Ordered template locked');
  assert.deepEqual(saved.payload.checks.member_pages,['yes'],'Member pages explicitly opted in');
  assert.equal(saved.payload.members[0].photo?.path,'9991/secure-intake/member_photos/mock-portrait.png','Uploaded photo attached to member');
  assert.equal(saved.payload.files.member_photos[0].name,'portrait.png','Member photo passed into worker payload');
  await page.locator('#confirmSend').click();
  await page.getByText('運営へ送信しました。').waitFor({timeout:15000});
  assert.equal(await page.locator('#confirmSend').innerText(),'運営へ送信しました','Submit button shows confirmed state');
  const submitted=records.find(x=>x.action==='submit_intake');
  assert.ok(submitted,'Intake submission called');
  assert.equal(submitted.payload.members[0].photo.name,'portrait.png');
  assert.deepEqual(errors,[],'No client-side exceptions');
  console.log('SECURE INTAKE FLOW PASS; member photo upload and profile saved, submitted');
 }finally{await browser.close()}
})().catch(err=>{console.error('SECURE INTAKE FLOW FAIL',err.stack||err);process.exitCode=1});
