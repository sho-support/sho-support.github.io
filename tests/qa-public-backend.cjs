'use strict';
const assert=require('node:assert/strict');
const base='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/';
const origin='https://sho-web-support.netlify.app';
(async()=>{
 const cases=[
   {name:'reject invalid plan',path:'website-order-api',body:{plan:'bogus',update_plan:'none'},codes:[400]},
   {name:'reject invalid update enum',path:'website-order-api',body:{plan:'one',update_plan:'not-a-plan'},codes:[400]},
   {name:'reject invalid semi template',path:'website-order-api',body:{plan:'semi',template_style:'not-a-template',update_plan:'free3'},codes:[400]},
   {name:'deny anonymous operator publication',path:'website-customer-access',body:{action:'admin_publish_site',site_id:'1000'},codes:[401,403]},
   {name:'deny anonymous quote',path:'website-customer-access',body:{action:'admin_send_final_quote',order_code:'1000'},codes:[401,403]},
   {name:'deny anonymous free URL resolve',path:'website-customer-access',body:{action:'admin_resolve_free_url',order_code:'1000'},codes:[401,403]},
   {name:'deny anonymous customer invitations',path:'website-api',body:{action:'admin_invite_customer',site_id:'1000',customer_email:'qa@example.invalid'},codes:[401,403]},
   {name:'reject review approval without access key',path:'website-customer-access',body:{action:'review_approve',site_id:'99998888',key:''},codes:[403,404]},
   {name:'reject review revision without access key',path:'website-customer-access',body:{action:'review_revision',site_id:'99998888',key:'',detail:'QA request'},codes:[403,404]},
   {name:'deny anonymous portal review revision',path:'website-api',body:{action:'review_action',site_id:'99998888',review_action:'revision',detail:'QA request'},codes:[401,403]},
   {name:'deny anonymous portal review publish',path:'website-api',body:{action:'review_action',site_id:'99998888',review_action:'publish'},codes:[401,403]},
 ];
 for(const item of cases){
  const ctrl=AbortSignal.timeout(20000);
  const response=await fetch(base+item.path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(item.body),signal:ctrl});
  assert.ok(item.codes.includes(response.status),item.name+' unexpected HTTP '+response.status);
  console.log('EDGE_SECURITY_PASS',item.name,response.status);
 }
 const opt=await fetch(base+'website-order-api',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST'},signal:AbortSignal.timeout(20000)});
 assert.equal(opt.status,200,'order form preflight failed');
 assert.equal(opt.headers.get('access-control-allow-origin'),origin,'order form origin rejected');
 console.log('EDGE_CORS_PASS',opt.status);
})().catch(e=>{console.error('EDGE_SECURITY_FAILED',e);process.exitCode=1});
