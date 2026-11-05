'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const origin='https://sho-web-support.netlify.app';
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const check=[
   ['/','SHO WEB SUPPORT'],
   ['/website-order.html','ホームページ制作のお申込み'],
   ['/website-order-confirm.html','制作申込み内容の確認'],
   ['/website-faq.html','よくある質問'],
   ['/website-login.html','ログイン']
 ];
 try{
  for(const [path,expected] of check){
   const context=await browser.newContext({locale:'ja-JP',viewport:{width:390,height:844}});
   const page=await context.newPage();
   const response=await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:30000});
   assert.ok(response,'No response: '+path);
   assert.equal(response.status(),200,'Public page HTTP error '+path);
   const text=await page.locator('body').innerText();
   assert.ok(text.includes(expected),'The expected public content was replaced, possibly by a private access gate: '+path);
   console.log('LIVE_PUBLIC_OK',path);
   await context.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error('NETLIFY_PUBLIC_SMOKE_FAILED',e);process.exitCode=1});
