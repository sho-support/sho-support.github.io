const fs=require('node:fs'),assert=require('node:assert/strict');
const read=f=>fs.readFileSync(f,'utf8');
const worker=read('supabase/functions/website-worker/index.ts');
const shared=read('supabase/functions/_shared/website.ts');
const api=read('supabase/functions/website-api/index.ts');
const customer=read('supabase/functions/website-customer-access/index.ts');
const preview=read('supabase/functions/website-preview/index.ts');
const sql=read('supabase/migrations/20261031_allow_customer_update_kind.sql');
const site=read('website-support.html');
const order=read('supabase/functions/website-order-api/index.ts');
const webhook=read('supabase/functions/website-line-webhook/index.ts');
const orderSql=read('supabase/migrations/20261031_secure_order_line_pairing.sql');
const checks={
 'New draft repos private':(worker.match(/private:true,auto_init:true/g)||[]).length===2,
 'No new public draft repos':!worker.includes('private:false,auto_init:true'),
 'Private draft skips Pages deployment':worker.includes("if(!ri.isPrivate)await pages"),
 'Only referenced customer assets copied':worker.includes('const referencedAssets=assets.filter'),
 'Untrusted site names are escaped':worker.includes("name=String(name||'').replace"),
 'Publishing changes private repo visibility before Pages':shared.includes('if (info.private)')&&shared.includes('method: \'PATCH\''),
 'Safe preview returns JSON instead of HTML':preview.includes('JSON.stringify({html:content})'),
 'Safe preview checks hashed keys':preview.includes('hash!==site.preview_access_token_hash'),
 'Review uses secure client token':customer.includes("action==='review_publish'"),
 'Public update requests require owner approval':api.includes("action==='admin_start_update'"),
 'DB supports customer update jobs':sql.includes("'customer_update'"),
 'Order creation stores hashed pairing code':order.includes('line_link_token_hash:linkHash'),
 'LINE checks pairing code hash':webhook.includes('await sha256Hex(match[1].toLowerCase())'),
 'Order pairing schema recorded':orderSql.includes('line_link_token_hash'),
 'Plans are neutral':(site.match(/<details class="plan-drop">/g)||[]).length===3&&!site.includes('<details class="plan-drop reco">'),
};
for(const [label,pass] of Object.entries(checks)){assert.ok(pass,label);console.log('PASS '+label)}
console.log('SERVER SOURCE INVARIANTS PASS; checks='+Object.keys(checks).length);
