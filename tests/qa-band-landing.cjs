const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const base='https://sho-support.github.io/band-homepage.html';
(async()=>{
 const proof='grid-template-columns:minmax(0,1fr);gap:30px';
 let live='',lastStatus=0;
 for(let attempt=0;attempt<45;attempt++){
   const sep=base.includes('?')?'&':'?';
   const u=base+sep+'mobile_audit='+encodeURIComponent(process.env.GITHUB_SHA||'20261105')+'_'+attempt;
   const response=await fetch(u,{headers:{'Cache-Control':'no-cache'}});
   lastStatus=response.status;
   if(response.ok){live=await response.text();if(live.includes(proof))break}
   await new Promise(ok=>setTimeout(ok,4000));
 }
 assert.equal(lastStatus,200,'sales landing is reachable over HTTPS');
 assert.ok(live.includes(proof),'public GitHub Pages must serve the new mobile CSS');
 assert.ok(!live.includes('rotate(1deg)'),'crooked showcase transform removed from public page');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const results=[];
 const screenDir=path.resolve('qa-band-shots');
 fs.mkdirSync(screenDir,{recursive:true});
 try{
  for(const [label,width,height] of [
   ['mobile-320',320,740],['mobile-360',360,780],['mobile-390',390,844],
   ['mobile-430',430,932],['tablet-768',768,1024],['desktop-1366',1366,900]
  ]){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,locale:'ja-JP',isMobile:width<=430,hasTouch:width<=430});
   const page=await context.newPage();
   const errors=[];
   page.on('pageerror',e=>errors.push(String(e.message)));
   await page.goto(base+'?v='+encodeURIComponent(process.env.GITHUB_SHA||'20261105'),{waitUntil:'domcontentloaded',timeout:45000});
   await page.evaluate(()=>document.fonts.ready);
   await page.waitForTimeout(250);
   const report=await page.evaluate(()=>{
    const width=window.innerWidth;
    const bounds=sel=>{
     const e=document.querySelector(sel);if(!e)return null;
     const r=e.getBoundingClientRect();
     return {left:r.left,right:r.right,width:r.width,height:r.height};
    };
    const selectors=['.header','.brand','.toplinks .cta','.hero-grid','.hero h1','.hero p',
      '.hero-tags','.hero-tags span','.hero .actions','.hero .actions a','.showcase','.preview','.section-top h2'];
    const bad=[];
    for(const selector of selectors){
     for(const el of document.querySelectorAll(selector)){
      const r=el.getBoundingClientRect();
      if(r.left<-2||r.right>width+2)bad.push({selector,left:Math.round(r.left),right:Math.round(r.right)});
     }
    }
    for(const el of document.querySelectorAll('.hero h1,.hero p,.hero .eyebrow,.hero-tags span')){
     const nodes=[];
     const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
     while(walker.nextNode())nodes.push(walker.currentNode);
     for(const node of nodes){
      if(!node.textContent.trim())continue;
      const r=document.createRange();r.selectNodeContents(node);
      for(const rect of r.getClientRects()){
       if(rect.width>0&&(rect.left<-2||rect.right>width+2))bad.push({
        selector:el.className||el.tagName,fragment:node.textContent.trim().slice(0,25),
        left:Math.round(rect.left),right:Math.round(rect.right)
       });
      }
     }
    }
    const card=document.querySelector('.showcase');
    const cs=card&&getComputedStyle(card);
    return {viewport:width,htmlWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,
      headline:document.querySelector('.hero h1')?.innerText,
      examples:document.querySelector('.showcase .chrome')?.innerText,
      tilted:cs?.transform||null,
      rects:Object.fromEntries(selectors.slice(0,10).map(x=>[x,bounds(x)])),
      bad};
   });
   assert.ok(report.headline?.includes('SNSだけでは伝わらない'),'headline visible in DOM at '+label);
   assert.ok(report.headline?.includes('バンドの世界観'),'complete headline in DOM at '+label);
   assert.equal(report.tilted,'none','actual example card is level at '+label);
   assert.ok(report.htmlWidth<=report.viewport+2,'page horizontally overflows at '+label+JSON.stringify(report));
   assert.deepEqual(report.bad,[],'text or blocks clip outside viewport at '+label+': '+JSON.stringify(report.bad));
   assert.deepEqual(errors,[],'client JavaScript errors at '+label);
   await page.screenshot({path:path.join(screenDir,label+'.png'),fullPage:true,animations:'disabled'});
   results.push({viewport:width,documentWidth:report.htmlWidth,tilt:report.tilted,bad:report.bad});
   console.log('BAND_LANDING_AUDIT '+label+' '+JSON.stringify(report));
   await context.close();
  }
 }finally{await browser.close()}
 console.log('BAND_LANDING_MOBILE_QA_PASS '+JSON.stringify(results));
})().catch(e=>{console.error('BAND_LANDING_MOBILE_QA_FAIL',e.stack||e);process.exitCode=1});
