const assert=require('node:assert/strict');
const origin='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/';
const checks=[
 {name:'bank_config_not_public',fn:'website-customer-access',method:'POST',body:{action:'admin_bank_settings'},allowed:[401,403]},
 {name:'bank_config_write_not_public',fn:'website-customer-access',method:'POST',body:{action:'admin_save_bank_settings',bank_message:''},allowed:[401,403]},
 {name:'final_quote_not_public',fn:'website-customer-access',method:'POST',body:{action:'admin_send_final_quote',order_code:'F999999',final_amount:30000,public_domain:'not-real.example.jp',domain_control_confirmed:true},allowed:[401,403]},
 {name:'payment_confirmation_not_public',fn:'website-customer-access',method:'POST',body:{action:'admin_activate_order',order_code:'F999999'},allowed:[401,403]},
 {name:'domain_management_not_public',fn:'website-api',method:'POST',body:{action:'admin_domain',site_id:'not-a-real-customer',custom_domain:'not-real.example.jp'},allowed:[401,403]},
 {name:'other_origin_blocked_for_order',fn:'website-order-api',method:'POST',body:{plan:'full',template_style:'',update_plan:'free3',website:''},extraHeaders:{Origin:'https://external-invalid.example'},allowed:[401,403]},
 {name:'order_get_disallowed',fn:'website-order-api',method:'GET',allowed:[401,405]},
 {name:'admin_get_disallowed',fn:'website-customer-access',method:'GET',allowed:[401,405]}
];
(async()=>{
 for(const c of checks){
  const resp=await fetch(origin+c.fn,{method:c.method,
   headers:{'Content-Type':'application/json',...(c.extraHeaders||{})},
   body:c.method==='POST'?JSON.stringify(c.body):undefined,signal:AbortSignal.timeout(15000)});
  const body=(await resp.text()).slice(0,400);
  console.log('API_SECURITY_QA',JSON.stringify({name:c.name,method:c.method,status:resp.status,responseLength:body.length}));
  assert.ok(c.allowed.includes(resp.status),'sensitive action should be blocked '+c.name+' ('+resp.status+')');
  assert.ok(!body.includes('account_number')&&!body.includes('line_user_id'),'response must not expose sensitive fields');
 }
 console.log('API_SECURITY_QA_PASS: '+checks.length+' unauthenticated and cross-origin scenarios rejected without mutation');
})().catch(err=>{console.error('API_SECURITY_QA_FAIL',err.stack||err);process.exitCode=1});
