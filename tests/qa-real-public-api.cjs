const assert=require('node:assert/strict');
const base='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/';
const origin='https://sho-support.github.io';
(async()=>{
 // Read-only/invalid requests ONLY. These must never create an order, send LINE,
 // change a site, or spend money. Successful real API order testing is separate.
 const preflight=await fetch(base+'website-order-api',{
  method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'},
  signal:AbortSignal.timeout(12000)
 });
 assert.equal(preflight.status,200,'browser CORS preflight');
 assert.equal(preflight.headers.get('access-control-allow-origin'),origin,'preflight permits actual origin');
 const invalid=await fetch(base+'website-order-api',{
  method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
  body:JSON.stringify({plan:'invalid-qa',website:''}),signal:AbortSignal.timeout(12000)
 });
 assert.equal(invalid.status,400,'invalid order rejected without creating a record');
 assert.ok(['*',origin].includes(invalid.headers.get('access-control-allow-origin')),'error response readable in customer browser');
 const noAuth=await fetch(base+'website-customer-access',{
  method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
  body:JSON.stringify({action:'admin_list_orders'}),signal:AbortSignal.timeout(12000)
 });
 assert.equal(noAuth.status,401,'admin orders inaccessible without login');
 const noQuote=await fetch(base+'website-customer-access',{
  method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
  body:JSON.stringify({action:'admin_send_final_quote',order_code:'F9999',final_amount:15000,public_domain:'qa.invalid'}),signal:AbortSignal.timeout(12000)
 });
 assert.equal(noQuote.status,401,'anonymous user cannot send quotation');
 const noBank=await fetch(base+'website-customer-access',{
  method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
  body:JSON.stringify({action:'admin_save_bank_settings',bank_message:'test'}),signal:AbortSignal.timeout(12000)
 });
 assert.equal(noBank.status,401,'anonymous user cannot change payment account');
 const sig=await fetch(base+'website-line-webhook',{
  method:'POST',headers:{'Content-Type':'application/json','x-line-signature':'invalid'},
  body:'{"events":[]}',signal:AbortSignal.timeout(12000)
 });
 assert.equal(sig.status,401,'LINE webhook refuses unsigned/spoofed events');
 console.log('PUBLIC_ORDER_API_SAFETY_PASS '+JSON.stringify({
  cors:preflight.status,invalidOrder:invalid.status,noAdmin:noAuth.status,
  anonymousQuote:noQuote.status,anonymousBank:noBank.status,invalidLineSignature:sig.status
 }));
})().catch(e=>{console.error('PUBLIC_ORDER_API_SAFETY_FAIL',e.stack||e);process.exitCode=1});
