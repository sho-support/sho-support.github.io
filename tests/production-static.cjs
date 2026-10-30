const assert=require('node:assert/strict');
const BASE='https://sho-support.github.io/';
const pages=['website-support.html','website-order.html','website-order-confirm.html','website-faq.html','website-create.html','website-templates.html','website-template-preview.html','website-intake.html','website-customer-review.html','website-preview.html','website-update.html','website-legal.html','website-terms.html','website-privacy.html','website-update-demo.html','admin/'];
(async()=>{
 let pass=0;
 for(const path of pages){
  const r=await fetch(BASE+path,{signal:AbortSignal.timeout(18000)});
  assert.equal(r.status,200,'Production URL '+path+' HTTP status');
  assert.match(r.headers.get('content-type')||'',/text\/html/,'GitHub Pages HTML response '+path);
  const body=await r.text();
  assert.match(body,/<html|<!doctype html/i,'HTML document '+path);
  if(path==='website-support.html')assert.match(body,/class="plans-accordion"/,'Current sales page rendered');
  if(path==='website-preview.html')assert.match(body,/sandbox="allow-scripts allow-forms allow-popups"/,'Sandbox preview published');
  console.log('PASS production URL '+path);
  pass++;
 }
 console.log('PUBLIC DEPLOYMENT PASS; pages='+pass);
})().catch(err=>{console.error('PUBLIC DEPLOYMENT FAIL',err.stack||err);process.exitCode=1});
