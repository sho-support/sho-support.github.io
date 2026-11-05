const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const origin=(process.env.SALES_BASE_URL||'https://sho-support.github.io/').replace(/\/?$/, '/');
const names=[
 'band-homepage.html','website-support.html','website-create.html',
 'website-templates.html','website-template-preview.html?style=rock',
 'website-template-preview.html?style=cyber',
 'website-template-preview.html?style=cafe','website-template-preview.html?style=cute',
 'website-template-preview.html?style=minimal','website-template-preview.html?style=premium',
 'website-template-preview.html?style=pop','website-template-preview.html?style=vintage',
 'website-template-preview.html?style=organic','website-template-preview.html?style=editorial',
 'website-templates.html?mode=sample','website-order.html?plan=semi&template=rock',
 'website-order.html?plan=full','website-order.html?plan=one','website-order.html',
 'website-faq.html','website-legal.html','website-terms.html',
 'website-privacy.html','website-update-demo.html','sho-support.html','support.html'
];
const views=[320,360,390,430,768,1366];
const bads=[],checks=[],linkSet=new Set(),screens=path.resolve(process.env.SALES_SHOT_DIR||'qa-sales-flow-shots');
fs.mkdirSync(screens,{recursive:true});
function label(u){return u.split('?')[0].replace('.html','')}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
 for(const width of views){
  const context=await browser.newContext({viewport:{width,height:900},locale:'ja-JP',deviceScaleFactor:1,
   isMobile:width<=430,hasTouch:width<=430});
  for(const slug of names){
   const p=await context.newPage(),pageErrors=[];
   p.on('pageerror',e=>pageErrors.push(String(e.message)));
   const response=await p.goto(origin+slug,{waitUntil:'domcontentloaded',timeout:45000});
   await p.evaluate(()=>document.fonts.ready);
   await p.waitForTimeout(180);
   const m=await p.evaluate(()=>{
    const vw=window.innerWidth, root=document.documentElement;
    const anomalies=[],badImages=[];
    for(const t of ['main','header','footer']){
     const parent=document.querySelector(t);if(!parent)continue;
     const walk=document.createTreeWalker(parent,NodeFilter.SHOW_TEXT);
     for(let node;node=walk.nextNode();){
      const el=node.parentElement;if(!el||!node.textContent.trim())continue;
      if(el.closest('script,style,noscript,template,svg,[hidden],[aria-hidden="true"]'))continue;
      const st=getComputedStyle(el);if(st.display==='none'||st.visibility==='hidden'||Number(st.opacity)===0)continue;
      const parentBox=el.getBoundingClientRect();if(parentBox.width<=0||parentBox.height<=0)continue;
      let clippedScroll=false;
      for(let a=el.parentElement;a&&a!==document.body;a=a.parentElement){
       const o=getComputedStyle(a).overflowX;
       if((o==='auto'||o==='scroll')&&a.scrollWidth>a.clientWidth+3){clippedScroll=true;break;}
      }
      if(clippedScroll)continue;
      const r=document.createRange();r.selectNodeContents(node);
      for(const q of r.getClientRects()){
       if(q.width<1||q.height<1)continue;
       if(q.left< -3||q.right>vw+3){
        anomalies.push({text:node.textContent.trim().slice(0,45),left:Math.round(q.left),right:Math.round(q.right),parent:el.tagName.toLowerCase()+'.'+el.className});
        if(anomalies.length>45)break;
       }
      }
      if(anomalies.length>45)break;
     }
    }
    for(const img of document.images){
     const r=img.getBoundingClientRect();if(r.width>0&&r.height>0&&r.top<window.innerHeight+100&&img.complete&&!img.naturalWidth)
      badImages.push({src:img.getAttribute('src')?.slice(0,80),alt:img.alt});
    }
    return {
     innerWidth:vw,docWidth:root.scrollWidth,bodyWidth:document.body.scrollWidth,
     badText:anomalies.slice(0,12),badTextCount:anomalies.length,badImages,
     h1:document.querySelector('h1')?.textContent?.replace(/\s+/g,' ').trim().slice(0,80)||'',
     links:[...document.querySelectorAll('a[href]')].filter(a=>a.getClientRects().length&&getComputedStyle(a).visibility!=='hidden').map(a=>a.href),
     cardTilt:(()=>{const el=document.querySelector('.showcase');return el?getComputedStyle(el).transform:null})()
    };
   });
   for(const link of m.links){
    const u=new URL(link);if(u.origin===new URL(origin).origin&&u.pathname.endsWith('.html'))linkSet.add(u.href.split('#')[0]);
   }
   const declaredTheme=slug.startsWith('website-template-preview.html?style=')?slug.split('style=')[1]:null;
   const actualTheme=declaredTheme?await p.locator('body').getAttribute('data-theme'):null;
   const check={screen:width,url:slug,http:response?.status(),h1:m.h1,
     themeOk:declaredTheme?actualTheme===declaredTheme:null,
     scroll:m.docWidth>m.innerWidth+3?m.docWidth-m.innerWidth:0,
     badTextCount:m.badTextCount,badText:m.badText,badImages:m.badImages,
     errors:pageErrors,cardTilt:m.cardTilt};
   checks.push(check);
   if(check.http!==200||check.themeOk===false||check.scroll||check.badTextCount||check.badImages.length||check.errors.length||m.cardTilt&&m.cardTilt!=='none')bads.push(check);
   if((width===390||width===320||width===1366)&&
       ['band-homepage.html','website-support.html','website-create.html','website-templates.html','website-order.html','website-faq.html','website-update-demo.html','sho-support.html','support.html'].includes(slug)||
       (width===390&&slug.startsWith('website-template-preview.html?style='))){
    await p.screenshot({path:path.join(screens,slug.replace(/[^A-Za-z0-9_-]+/g,'-')+'-'+width+'.png'),fullPage:true,animations:'disabled',timeout:45000});
   }
   console.log('SALES_PAGE_AUDIT',JSON.stringify(check));
   await p.close();
  }
  await context.close();
 }
 const page=await browser.newPage({viewport:{width:390,height:844},locale:'ja-JP'});
 await page.goto(origin+'website-order.html',{waitUntil:'domcontentloaded'});
 await page.evaluate(()=>localStorage.removeItem('sho_web_order_v3'));
 await page.reload({waitUntil:'domcontentloaded'});
 assert.equal(await page.locator('#finalBtn').isDisabled(),true,'Order disabled until requirements selected');
 await page.locator('.plan[data-plan="one"] .plan-select').click();
 await page.locator('.update-option[data-update="none"]').click();
 assert.equal(await page.locator('#finalBtn').isEnabled(),true,'one-page route ready');
 assert.match(await page.locator('#sumTotal').innerText(),/15,000/,'one price');
 await page.locator('#finalBtn').click();
 await page.waitForURL(/website-order-confirm\.html/,{timeout:10000});
 assert.match(await page.locator('#amount').innerText(),/15,000/,'one confirm amount');
 assert.equal(await page.locator('#orderBtn').isDisabled(),true,'no accidental order submit');
 await page.screenshot({path:path.join(screens,'website-order-confirm-390.png'),fullPage:true});
 console.log('SALES_ORDER_ROUTE_PASS one 15000, confirm has disabled send before terms approval');
 await page.goto(origin+'website-order.html',{waitUntil:'domcontentloaded'});
 await page.locator('.plan[data-plan="semi"] .plan-select').click();
 assert.equal(await page.locator('#finalBtn').isDisabled(),true,'template required');
 await page.locator('.template[data-template="rock"]').click();
 assert.equal(await page.locator('#finalBtn').isEnabled(),true,'semi selected');
 assert.match(await page.locator('#sumTotal').innerText(),/22,000/,'semi price');
 await page.locator('#finalBtn').click();
 await page.waitForURL(/website-order-confirm\.html/,{timeout:10000});
 assert.match(await page.locator('#template').innerText(),/Rock Stage/,'semi template carried');
 console.log('SALES_ORDER_ROUTE_PASS semi 22000, rock template');
 await page.goto(origin+'website-order.html',{waitUntil:'domcontentloaded'});
 await page.locator('.plan[data-plan="full"] .plan-select').click();
 assert.equal(await page.locator('#finalBtn').isEnabled(),true,'full selected');
 assert.match(await page.locator('#sumTotal').innerText(),/30,000/,'full price');
 await page.locator('#finalBtn').click();
 await page.waitForURL(/website-order-confirm\.html/,{timeout:10000});
 assert.match(await page.locator('#amount').innerText(),/30,000/,'full confirm amount');
 console.log('SALES_ORDER_ROUTE_PASS full 30000');
 await page.goto(origin+'website-templates.html',{waitUntil:'domcontentloaded'});
 assert.equal(await page.locator('.card').count(),10,'ten templates');
 await page.locator('.card').first().click();
 assert.match(await page.locator('#goOrder').getAttribute('href'),/template=rock/,'selected template linked');
 console.log('SALES_TEMPLATE_SELECTION_PASS ten templates');
 // Long notes used to clip the image export: measure actual drawn rows vs canvas height.
 const last='【末尾の文字まで保存されることを確認】';
 const longNote='写真の掲載順序を調整したいです。'.repeat(64)+last;
 await page.evaluate(note=>{
   localStorage.setItem('sho_web_order_v3',JSON.stringify({
     plan:'full',template:'',update:'free3',domain:false,extraRequest:note
   }));
 },longNote);
 await page.goto(origin+'website-order-confirm.html',{waitUntil:'domcontentloaded'});
 await page.evaluate(()=>{
   window.__orderPngRows=[];
   const original=CanvasRenderingContext2D.prototype.fillText;
   CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...other){
     window.__orderPngRows.push({text:String(text),y,canvasHeight:this.canvas.height/2});
     return original.call(this,text,x,y,...other);
   };
 });
 await page.locator('#downloadBtn').click();
 const drawn=await page.evaluate(()=>window.__orderPngRows);
 assert.ok(drawn.length>20,'long order notes produce 20+ wrapped output rows');
 assert.ok(drawn.some(line=>line.text.includes('末尾の文字まで')),'last note line must be printed');
 assert.ok(drawn.every(line=>line.y<line.canvasHeight-16),'all printed rows fit within PNG height');
 console.log('ORDER_PNG_LONG_NOTE_QA_PASS',JSON.stringify({
   drawnLines:drawn.length,lastLine:drawn[drawn.length-1].text.slice(0,65),
   lastY:drawn[drawn.length-1].y,canvasHeight:drawn[drawn.length-1].canvasHeight
 }));
 const broken=[];
 for(const href of linkSet){
   const resp=await page.request.get(href,{maxRedirects:4,timeout:12000}).catch(e=>({status:()=>0,error:String(e)}));
   if(resp.status()!==200)broken.push({href,status:resp.status()});
 }
 await page.close();
 const summary={pages:names.length,viewports:views,checks:checks.length,
   layoutFailures:bads.length,linkedHtml:linkSet.size,broken,failures:bads};
 fs.writeFileSync(path.join(screens,'audit.json'),JSON.stringify(summary,null,2));
 console.log('SALES_FLOW_QA_SUMMARY',JSON.stringify({pages:summary.pages,viewports:summary.viewports,checks:summary.checks,layoutFailures:bads.length,linksChecked:linkSet.size,brokenLinks:broken.length}));
 for(const b of bads)console.error('SALES_LAYOUT_FAILURE '+JSON.stringify(b));
 for(const l of broken)console.error('SALES_LINK_FAILURE '+JSON.stringify(l));
 assert.equal(bads.length,0,'Sales pages must have zero clipped text and JS errors');
 assert.deepEqual(broken,[],'Internal sales links must be accessible');
 console.log('SALES_FLOW_QA_PASS');
 }finally{await browser.close()}
})().catch(e=>{console.error('SALES_FLOW_QA_FAIL',e.stack||e);process.exitCode=1});
