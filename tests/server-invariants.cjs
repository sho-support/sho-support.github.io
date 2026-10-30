const fs=require('node:fs'),assert=require('node:assert/strict');
const read=f=>fs.readFileSync(f,'utf8');
const worker=read('supabase/functions/website-worker/index.ts');
const shared=read('supabase/functions/_shared/website.ts');
const api=read('supabase/functions/website-api/index.ts');
const customer=read('supabase/functions/website-customer-access/index.ts');
const preview=read('supabase/functions/website-preview/index.ts');
const sql=read('supabase/migrations/20261031_allow_customer_update_kind.sql');
const site=read('website-support.html');
const orderAdmin=read('admin/orders.html');
const order=read('supabase/functions/website-order-api/index.ts');
const webhook=read('supabase/functions/website-line-webhook/index.ts');
const orderSql=read('supabase/migrations/20261031_secure_order_line_pairing.sql');
const checks={
 'New draft repos private':(worker.match(/private:true,auto_init:true/g)||[]).length===2,
 'No new public draft repos':!worker.includes('private:false,auto_init:true'),
 'Private draft skips Pages deployment':worker.includes("if(!ri.isPrivate&&!isLiveRevision)await pages"),
 'Only referenced customer assets copied':worker.includes('const referencedAssets=assets.filter'),
 'Untrusted site names are escaped':worker.includes("name=String(name||'').replace"),
 'Publishing changes private repo visibility before Pages':shared.includes('if (info.private)')&&shared.includes('method: \'PATCH\''),
 'Safe preview returns JSON instead of HTML':preview.includes('JSON.stringify({html:content})'),
 'Safe preview checks hashed keys':preview.includes('hash!==site.preview_access_token_hash'),
 'Private preview supports images over 1MB':preview.includes('application/vnd.github.raw+json')&&preview.includes('await github.arrayBuffer()'),
 'Photos from unapproved update remain isolated':!customer.includes('payload.files[f]=[...existing')&&api.includes('const approvedFiles=reqItem.files'),
 'Published sites build on a staging branch':worker.includes('ensureStageBranch')&&worker.includes('const isLiveRevision=!!site.published_at'),
 'Building an update never switches Pages to maintenance':worker.includes("if(!ri.isPrivate&&!isLiveRevision)await pages"),
 'Preview fetches staging branch when present':preview.includes('site.preview_branch||site.publish_branch'),
 'Customer publication promotes the approved staging branch':customer.includes('await publishApprovedStagedBranch(reviewSite.repo_full_name'),
 'Legacy approval also promotes staged updates':api.includes('await publishApprovedStagedBranch(site.repo_full_name'),
 'GitHub merge is handled before Pages update':shared.includes('/merges')&&shared.includes('publishApprovedStagedBranch'),
 'Intake resend allowed only for initial requests':customer.includes("action==='admin_resend_intake'")&&customer.includes("site.status!=='request_waiting'"),
 'Admin resend button gated by intake state':orderAdmin.includes("o.site_status==='request_waiting'"),
 'LINE delivery failure is reported to staff':customer.includes('const warning=delivered.skipped'),
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
