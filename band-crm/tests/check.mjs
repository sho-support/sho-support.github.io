import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const read=(name)=>readFileSync(resolve(root,name),'utf8');
const html=read('web/index.html'),js=read('web/app.js'),css=read('web/style.css'),sql=read('database/001_band_crm.sql');
let passed=0;
const check=(label,fn)=>{fn();console.log('PASS',label);passed++};
check('All required components and local files exist',()=>{
 for(const path of ['web/app.js','web/style.css','web/_headers','web/config.example.js','database/001_band_crm.sql'])assert.ok(existsSync(resolve(root,path)),path);
 for(const id of ['login-panel','workspace','stats','leads-tab','deals-tab','payments-tab','editor','app-message'])assert.ok(html.includes('id="'+id+'"'),id);
});
check('No duplicate HTML IDs',()=>{
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(ids.length,new Set(ids).size);
});
check('No unsanitized HTML from customer data',()=>{assert.doesNotMatch(js,/\.innerHTML\s*=/);assert.match(js,/textContent=/)});
check('Only public Supabase API key expected',()=>{assert.match(js,/startsWith\('sb_publishable_'\)/);assert.doesNotMatch(js,/service_role|sb_secret_[A-Za-z0-9]+/)});
check('RLS enabled on every contact/deal/payment/admin/audit table',()=>{
 for(const t of ['band_crm_admins','band_crm_leads','band_crm_deals','band_crm_payments','band_crm_audit']){
 assert.ok(sql.includes('public.'+t),t);
 }
 assert.match(sql,/enable row level security/);
 assert.match(sql,/band_private\.is_operator\(\)/);
});
check('Anonymous customer access is revoked',()=>{assert.match(sql,/revoke all on public\.band_crm_admins from public, anon, authenticated/);assert.match(sql,/revoke all on public\.%I from public, anon, authenticated/)});
check('No pay ledger rewrite and unique payment evidence',()=>{
 assert.match(sql,/evidence_reference text not null unique/);
 assert.match(sql,/grant select,insert on public\.band_crm_payments to authenticated/);
 assert.doesNotMatch(sql,/grant [^;]*(update|delete)[^;]* on public\.band_crm_payments/);
});
check('Gross quote and actual received are different dashboard fields',()=>{
 assert.match(js,/id='stat-paid'|\$\('stat-paid'\)/);
 assert.match(js,/\$\('stat-quotes'\)/);
 assert.match(js,/payments\.filter\(x=>ym\(x\.received_on\)/);
});
check('No paid network requests or auto-deploy',()=>{
 assert.doesNotMatch(js,/fetch\(['"]https?:|autoPost\(/);
 assert.match(html,/noindex,nofollow/);
 assert.match(read('web/_headers'),/X-Robots-Tag: noindex, nofollow/);
});
check('Service minimum prices follow existing support page',()=>{
 for(const [svc,n] of Object.entries({shorts:2500,one_song:4000,full_live:8000,shoot_30:4000,shoot_60:6500}))assert.ok(js.includes(svc+':'+n),svc);
});
console.log('RESULT:',passed,'static contracts passed');
