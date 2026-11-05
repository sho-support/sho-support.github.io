'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),shots=path.resolve(__dirname,'../test-results/sales');
fs.mkdirSync(shots,{recursive:true});
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  const relative=pathname==='/'?'index.html':pathname.slice(1);
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);res.end();return}
  fs.readFile(file,(error,data)=>{
    if(error){res.writeHead(404);res.end('Not found');return}
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data)
  });
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const cases=[
    {id:'one-monthly',plan:'one',update:'unlimited',price:'22,000'},
    {id:'one-once-1',plan:'one',update:'none',price:'15,000'},
    {id:'one-once-2',plan:'one',update:'none',price:'15,000'},
    {id:'semi-rock',plan:'semi',template:'rock',price:'22,000'},
    {id:'semi-premium',plan:'semi',template:'premium',price:'22,000'},
    {id:'semi-cyber',plan:'semi',template:'cyber',price:'22,000'},
    {id:'full-1',plan:'full',price:'30,000'},
    {id:'full-2',plan:'full',price:'30,000'},
    {id:'full-3',plan:'full',price:'30,000'}
  ];
  const results=[];
  try{
    for(const [viewport,width,height] of [['desktop',1366,900],['mobile',390,844]]){
      for(const test of cases){
        const context=await browser.newContext({viewport:{width,height},locale:'ja-JP'});
        const page=await context.newPage(),errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(base+'/website-order.html',{waitUntil:'load'});
        assert.equal(await page.locator('.plan.selected').count(),0,'no initial plan selection');
        assert.equal(await page.locator('#finalBtn').isDisabled(),true,'incomplete new order cannot be submitted');
        await page.locator('[data-plan="'+test.plan+'"] button.plan-select').click();
        if(test.template)await page.locator('[data-template="'+test.template+'"] .swatch').click();
        if(test.update)await page.locator('[data-update="'+test.update+'"]').click();
        assert.equal(await page.locator('#finalBtn').isEnabled(),true,'valid plan selection enables confirmation');
        const amount=(await page.locator('#sumTotal').innerText()).replace(/\s+/g,'');
        assert.ok(amount.includes(test.price),test.id+' amount '+amount);
        const w=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
        assert.ok(w.scroll<=w.client+5,'horizontal overflow: '+test.id+'/'+viewport);
        await page.screenshot({path:path.join(shots,test.id+'-'+viewport+'.png'),fullPage:true});
        await page.locator('#finalBtn').click();
        await page.waitForURL('**/website-order-confirm.html',{timeout:10000});
        const text=await page.locator('body').innerText();
        assert.ok(text.includes(test.price),'confirmation price missing '+test.id);
        assert.deepEqual(errors,[],'JavaScript errors '+test.id+'/'+viewport);
        results.push({case:test.id,viewport,price:test.price,result:'PASS'});
        await context.close();
      }
    }
    console.log(JSON.stringify({total:results.length,results},null,2));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error('SALES_UI_QA_FAILED',error);process.exitCode=1});
