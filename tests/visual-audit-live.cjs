const {chromium}=require('playwright');
const BASE='https://sho-support.github.io/';
const PAGES=[
 {name:'landing-top',path:'website-support.html',selector:null},
 {name:'landing-price',path:'website-support.html',selector:'.plans-accordion'},
 {name:'landing-update',path:'website-support.html',selector:'.update-prices'},
 {name:'landing-example',path:'website-support.html',selector:'.site-shot'},
 {name:'templates',path:'website-templates.html',selector:'.template-grid'},
 {name:'order-plans',path:'website-order.html',selector:'.plan-grid'},
 {name:'faq',path:'website-faq.html',selector:null}
];
const stats=[];
const sleep=(t)=>new Promise(resolve=>setTimeout(resolve,t));
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const [label,width] of [['mobile',390],['desktop',1366]]){
   const ctx=await browser.newContext({viewport:{width,height:850},deviceScaleFactor:1,locale:'ja-JP'});
   const page=await ctx.newPage();
   page.on('pageerror',err=>stats.push({type:'runtime-error',context:label,detail:String(err.message)}));
   for(const config of PAGES){
    const r=await page.goto(BASE+config.path,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(900);
    const status=r?.status()||0;
    const inspected=await page.evaluate(()=>{
     const boxes=[...document.querySelectorAll('h1,h2,h3,button,a,input,summary')].filter(e=>{
      const r=e.getBoundingClientRect(),style=getComputedStyle(e);
      return style.visibility!=='hidden'&&style.display!=='none'&&r.width&&r.height&&r.top<document.documentElement.scrollHeight&&r.right>document.documentElement.clientWidth+3;
     }).slice(0,12).map(e=>({text:(e.textContent||'').trim().slice(0,45),tag:e.tagName,right:Math.round(e.getBoundingClientRect().right)}));
     const images=[...document.querySelectorAll('img')].filter(e=>e.complete&&!e.naturalWidth&&e.getBoundingClientRect().width).map(e=>e.getAttribute('src')).slice(0,15);
     return{pageWidth:document.documentElement.scrollWidth,viewWidth:document.documentElement.clientWidth,h1:document.querySelector('h1')?.innerText,brokenImages:images,overflowNodes:boxes};
    });
    stats.push({type:'page',context:label,name:config.name,http:status,...inspected});
    if(config.selector){
     const loc=page.locator(config.selector).first();
     if(await loc.count())await loc.scrollIntoViewIfNeeded();
    }else await page.evaluate(()=>window.scrollTo(0,0));
    await sleep(200);
    const bytes=await page.screenshot({type:'jpeg',quality:46,animations:'disabled'});
    console.log('SHOT_BEGIN '+label+'-'+config.name+' '+bytes.length+' '+bytes.toString('base64')+' SHOT_END');
   }
   await ctx.close();
  }
  console.log('VISUAL_AUDIT_JSON '+JSON.stringify(stats));
 }finally{await browser.close()}
})().catch(error=>{console.error('VISUAL_AUDIT_FAIL',error.stack||error);process.exitCode=1});
