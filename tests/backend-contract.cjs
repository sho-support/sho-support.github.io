const assert=require('node:assert/strict');
const BASE='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/';
const SITE='SHO-TEST-001';
const KEY='invalid_invalid_invalid_invalid';
const ORIGIN='https://sho-support.github.io';
(async()=>{
 const tests=[
  {name:'preview rejects invalid key',uri:'website-preview?id='+SITE+'&key='+KEY,init:{method:'GET'},expected:403},
  {name:'customer access rejects invalid key',uri:'website-customer-access',init:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'load',site_id:SITE,key:KEY})},expected:403},
  {name:'customer admin requires login',uri:'website-customer-access',init:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'admin_list_orders'})},expected:401},
  {name:'invalid order does not create an order',uri:'website-order-api',init:{method:'POST',headers:{'Content-Type':'application/json',Origin:ORIGIN},body:JSON.stringify({plan:'invalid',update_plan:'none',website:''})},expected:400},
  {name:'unsigned LINE webhook rejected',uri:'website-line-webhook',init:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:[]})},expected:401},
  {name:'authenticated site API rejects anonymous requests',uri:'website-api',init:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'list_sites'})},expected:401}
 ];
 for(const t of tests){
  const r=await fetch(BASE+t.uri,{...t.init,signal:AbortSignal.timeout(15000)});
  assert.equal(r.status,t.expected,t.name+' status '+r.status+' expected '+t.expected);
  if(t.name.startsWith('preview'))assert.equal(r.headers.get('access-control-allow-origin'),ORIGIN,'Preview CORS for website');
  console.log('PASS '+t.name+' ('+r.status+')');
 }
 console.log('BACKEND CONTRACT PASS; tests='+tests.length);
})().catch(err=>{console.error('BACKEND CONTRACT FAIL',err.stack||err);process.exitCode=1});
