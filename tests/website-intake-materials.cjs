// Actual intake HTML and browser File objects; every service operation is a local mock.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {mkdirSync}=require('node:fs');
const {join}=require('node:path');
const base='http://127.0.0.1:8765/',endpoint='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-customer-access';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
const file=name=>({name,mimeType:'image/png',buffer:png});
const client=`
 window.__materialUploads=[];
 export async function requireWebsiteSession(){throw new Error('Unexpected login');}
 export async function websiteApi(){throw new Error('Unexpected authenticated API');}
 export async function uploadWebsiteFile(){throw new Error('Unexpected legacy upload');}
 export const websiteSupabase={storage:{from:bucket=>({uploadToSignedUrl:async(path,token,file)=>{if(bucket!=='website-intake-files'||token!=='synthetic-upload-token')throw new Error('Invalid mocked upload');window.__materialUploads.push({path,name:file.name,size:file.size});return {error:null};}})}};
`;
new Function(client.replace(/\bexport\s+/g,''));
(async()=>{
 const browser=await chromium.launch({headless:true});let checks=0;
 const check=(condition,label)=>{assert.ok(condition,label);checks++;};
 try{
  for(const width of [320,360,390,430,768,1366]){
   const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
   let saved={},tickets=0;const requests=[],external=[],errors=[];
   await context.route('**/*',async route=>{
    const request=route.request(),url=request.url();
    if(url===base+'website-client.js')return route.fulfill({status:200,contentType:'text/javascript',body:client});
    if(url.startsWith(base))return route.continue();
    if(url===endpoint){
     const headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type','access-control-allow-methods':'POST, OPTIONS'};
     if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
     const body=request.postDataJSON();requests.push(body);assert.equal(body.site_id,'8100');
     let result;
     if(body.action==='load')result={site:{status:'request_waiting'},order:{plan:'one'},intake:{payload:saved}};
     else if(body.action==='signed_upload')result={path:'8100/secure-intake/'+body.folder+'/'+(++tickets)+'-'+body.file_name,token:'synthetic-upload-token'};
     else if(body.action==='save_draft'){saved=body.payload;result={ok:true,last_saved_at:'2026-11-12T12:00:00Z'};}
     else throw new Error('Unexpected mocked request '+body.action);
     return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(result)});
    }
    external.push(url);return route.abort();
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'website-intake.html?id=8100&prod=1&key=synthetic-access-key-only',{waitUntil:'domcontentloaded'});
   await page.locator('.member').waitFor({state:'attached'});
   check((await page.locator('#materialLimits').innerText()).includes('50点・30MB'),'Limits are visible at '+width);
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow at '+width);
   await page.locator('[name="top_photos"]').setInputFiles(Array.from({length:51},(_,i)=>file('photo-'+i+'.png')));
   await page.locator('#saveTop').click();await page.waitForFunction(()=>document.getElementById('topStatus').textContent.includes('50点'));
   check(tickets===0&&await page.evaluate(()=>window.__materialUploads.length===0),'51 files rejected before any upload at '+width);
   await page.locator('[name="top_photos"]').setInputFiles(Array.from({length:50},(_,i)=>file('photo-'+i+'.png')));
   await page.locator('.card[data-section="1"] > summary').click();
   await page.locator('#memberPages').check();await page.locator('.member input[type="file"]').first().setInputFiles(file('member.png'));
   await page.locator('#saveTop').click();await page.waitForFunction(()=>document.getElementById('topStatus').textContent.includes('50点'));
   check(tickets===0,'Member photos share the same total file limit at '+width);
   if(width===390){
    await page.locator('[name="top_photos"]').setInputFiles([1,2,3,4,5].map(n=>({name:'large-'+n+'.png',mimeType:'image/png',buffer:Buffer.alloc(6_000_001)})));
    await page.locator('#saveTop').click();await page.waitForFunction(()=>document.getElementById('topStatus').textContent.includes('30MB'));
    check(tickets===0,'Combined byte limit rejected before upload');
    await page.locator('[name="top_photos"]').setInputFiles({name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(7_000_001)});
    await page.locator('#saveTop').click();await page.waitForFunction(()=>document.getElementById('topStatus').textContent.includes('7MB'));
    check(tickets===0,'Per-file limit rejected before upload');
   }
   await page.locator('[name="top_photos"]').setInputFiles(file('valid.png'));
   await page.locator('#saveTop').click();await page.waitForFunction(()=>window.__materialUploads.length===2&&document.getElementById('topStatus').textContent==='一時保存しました');
   check(tickets===2,'A valid image and member photo upload at '+width);
   check(saved.files.top_photos.length===1&&saved.files.member_photos.length===1,'Both groups saved at '+width);
   check(saved.members[0].photo.size===png.length&&saved.files.member_photos[0].size===png.length,'Member size is retained for later selections');
   check(saved.files.top_photos[0].path.startsWith('8100/')&&saved.files.member_photos[0].path.startsWith('8100/'),'Only this customer paths saved');
   await page.locator('#saveTop').click();await page.waitForFunction(()=>document.getElementById('topStatus').textContent==='一時保存しました');
   check(tickets===2,'Repeated saves do not re-upload cleared selections');
   check(!errors.length,'No script errors: '+errors.join(';'));
   check(external.every(url=>url==='https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'),'No real external service request');
   if(process.env.QA_SCREENSHOTS_DIR){mkdirSync(process.env.QA_SCREENSHOTS_DIR,{recursive:true});await page.screenshot({path:join(process.env.QA_SCREENSHOTS_DIR,'intake-materials-'+width+'.png'),fullPage:true});}
   if(process.env.QA_INLINE_SCREENSHOTS==='true'&&width===390){
    const data=(await page.screenshot({type:'jpeg',quality:50,fullPage:false})).toString('base64'),total=Math.ceil(data.length/8000);
    for(let i=0;i<total;i++)console.log('SHO_UI_IMAGE intake-materials-'+width+' '+i+'/'+total+' '+data.slice(i*8000,(i+1)*8000));
   }
   await context.close();
  }
  console.log('INTAKE MATERIALS PASS; assertions='+checks);
 }finally{await browser.close();}
})().catch(e=>{console.error('INTAKE MATERIALS FAILURE:',e.stack||e);process.exitCode=1;});
