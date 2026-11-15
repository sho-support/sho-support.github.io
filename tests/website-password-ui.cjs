// Local Auth mocks only. Never changes a hosted password or sends a recovery email.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {mkdirSync}=require('node:fs');
const {join}=require('node:path');
const base='http://127.0.0.1:8765/',widths=[320,360,390,430,768,1366];
const stub=`
 const user={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.invalid'};
 window.__passwordCalls=[];
 export async function currentSession(){return location.pathname.endsWith('website-login.html')?null:{user};}
 export const websiteSupabase={auth:{
   onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},
   async getUser(){return {data:{user},error:null};},
   async updateUser({password}){window.__passwordCalls.push({action:'update',length:password.length});return {error:null};},
   async signOut(){window.__passwordCalls.push({action:'signOut'});return {error:null};},
   async signInWithPassword({password}){window.__passwordCalls.push({action:'login',length:password.length});return {error:{status:400,code:'synthetic_auth_rejection'}};}
 }};
`;
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.QA_BROWSER_EXECUTABLE?{executablePath:process.env.QA_BROWSER_EXECUTABLE}: {})});
 let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++;};
 try{for(const width of widths){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.route('**/*',route=>{
   const url=route.request().url();
   if(url===base+'website-client.js')return route.fulfill({status:200,contentType:'text/javascript',body:stub});
   return url.startsWith(base)||url.startsWith('data:')?route.continue():route.abort();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const name of ['website-login.html','website-password.html?mode=recovery']){
   await page.goto(base+name,{waitUntil:'domcontentloaded'});
   const isReset=name.includes('password.html'),input=page.locator('#password'),eye=page.locator('[aria-controls="password"]');
   await eye.waitFor();await page.waitForFunction(()=>window.__passwordCalls!==undefined);
   check(await input.getAttribute('type')==='password','Password initially masked');
   check(await input.getAttribute('minlength')==='8','Eight-character minimum');
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+3),'No horizontal overflow '+name+' '+width);
   check(await page.locator('h1').evaluate(h=>{const range=document.createRange();range.selectNodeContents(h);return range.getClientRects().length===1;}),'Heading never leaves a single-character second line '+name+' '+width);
   const geometry=await eye.evaluate(button=>{const b=button.getBoundingClientRect(),svg=button.querySelector('svg').getBoundingClientRect(),field=button.parentElement.getBoundingClientRect();return {hit:b.width,height:b.height,icon:svg.width,iconHeight:svg.height,inside:b.left>=field.left&&b.right<=field.right+1};});
   check(geometry.icon<=18&&geometry.iconHeight<=18,'Eye stays compact');
   check(geometry.hit>=44&&geometry.height>=44&&geometry.inside,'Touch target stays usable inside the field');
   if(isReset){check(!(await page.locator('#passwordRules').innerText()).includes('128'),'Maximum length is not added to visible instructions');}
   if(process.env.QA_SCREENSHOTS_DIR){mkdirSync(process.env.QA_SCREENSHOTS_DIR,{recursive:true});await page.screenshot({path:join(process.env.QA_SCREENSHOTS_DIR,(isReset?'password-reset-':'password-login-')+width+'.png'),fullPage:true});}
   await input.fill('Qa8!test');
   if(isReset)await page.locator('#confirm').fill('Qa8!test');
   await eye.click();
   check(await input.getAttribute('type')==='text','Eye reveals the entered value');
   check(await eye.getAttribute('aria-pressed')==='true'&&(await eye.getAttribute('aria-label')).includes('隠す'),'Accessible revealed state');
   check(await page.evaluate(()=>window.__passwordCalls.length===0),'Eye never submits the form');
   if(isReset)check(await page.locator('#confirm').getAttribute('type')==='password','Confirmation visibility is independent');
   await eye.press('Enter');check(await input.getAttribute('type')==='password','Keyboard can mask the password again');
   await eye.click();await page.evaluate(()=>document.querySelector('form').reset());
   check(await input.getAttribute('type')==='password'&&await input.inputValue()==='','Reset clears and masks the value');
   await input.fill('Qa8!tes');
   if(isReset)await page.locator('#confirm').fill('Qa8!tes');else await page.locator('#email').fill('fixture@example.invalid');
   await page.locator(isReset?'#save':'#loginBtn').click();
   check(await page.evaluate(()=>window.__passwordCalls.length===0),'Seven characters cannot reach Auth');
   await input.fill('Qa8!test');
   if(isReset){
    await page.locator('#confirm').fill('Mismatch');await page.locator('#save').click();
    check((await page.locator('#message').innerText()).includes('一致'),'Mismatched confirmation is explained');
    check(await page.evaluate(()=>window.__passwordCalls.length===0),'Mismatched values never reach Auth');
    await page.locator('#confirm').fill('Qa8!test');await page.locator('#save').click();
    await page.waitForFunction(()=>window.__passwordCalls.some(x=>x.action==='signOut'));
    check(await page.evaluate(()=>window.__passwordCalls.filter(x=>x.action==='update'&&x.length===8).length===1),'Exactly eight characters can be set');
    check(await input.inputValue()===''&&await input.getAttribute('type')==='password','Successful reset erases and masks both fields');
    check(await page.locator('#settingsForm').isHidden(),'Successful reset closes the form');
   }else{
    await page.locator('#loginBtn').click();await page.waitForFunction(()=>window.__passwordCalls.length===1);
    check(await page.evaluate(()=>window.__passwordCalls[0].action==='login'&&window.__passwordCalls[0].length===8),'Eight characters can reach the mocked login');
    await page.locator('#loginForm').evaluate(form=>form.reset());
   }
  }
  check(errors.length===0,'No script failures: '+errors.join(';'));await context.close();
 }}finally{await browser.close();}
 console.log('PASSWORD_UI_QA_PASS',JSON.stringify({checks,widths,real_password_changes:0,real_auth_requests:0}));
})().catch(e=>{console.error('PASSWORD_UI_QA_FAIL',e.stack||e);process.exitCode=1;});
