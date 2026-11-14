import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeHarness} from './helpers/edge-harness.mjs';
const key='synthetic-customer-access-key-only',siteId='8100';
const keyHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))),b=>b.toString(16).padStart(2,'0')).join('');
const image=n=>({path:`8100/secure-intake/top_photos/${n}.png`,name:`photo-${n}.png`,size:1});
for(const slug of ['website-customer-access','website-api'])test(`${slug}: actual handlers reject material attacks before private reads, writes or notifications`,async()=>{
 const writes=[],reads=[];let metadata={size:1,contentType:'image/png'};
 const order={order_code:'P_FAKE',site_id:siteId,plan:'one',customer_access_token_hash:keyHash};
 const admin={
  storage:{from:bucket=>{assert.equal(bucket,'website-intake-files');return {info:async path=>{reads.push(path);return {data:metadata,error:null};}};}},
  from:table=>{const filters={};const b={select(){return b;},eq(k,v){filters[k]=v;return b;},
   async single(){return b.maybeSingle();},async maybeSingle(){assert.equal(filters.site_id,siteId);if(table==='website_orders')return {data:order,error:null};if(table==='website_sites')return {data:{site_id:siteId,status:'request_waiting'},error:null};throw new Error('Unexpected read '+table);},
   async upsert(value){assert.equal(table,'website_intakes');writes.push(value);return {error:null};}};return b;}
 };
 const h=await edgeHarness({slug:slug+'/index.ts',admin,users:{customer:{id:'synthetic-owner'}},roleResolver:async()=> 'owner',env:{WEBSITE_CUSTOMER_HOSTING:'cloudflare-r2'}});
 async function send(action,payload){const response=await h.handler(new Request('https://fixtureproject.supabase.co/functions/v1/'+slug,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer customer'},body:JSON.stringify({action,site_id:siteId,key,payload})}));return {status:response.status,body:await response.json()};}
 for(const action of ['save_draft','submit_intake']){
  for(const payload of [{files:{top_photos:[{path:'8101/private/photo.png',name:'photo.png'}]}},{files:{},members:[{photo:{path:'8101/private/member.png',name:'member.png'}}]}]){
   const r=await send(action,payload);assert.equal(r.status,400,JSON.stringify(r));assert.match(r.body.error,/保存先/);
  }
  assert.equal((await send(action,{files:{top_photos:Array.from({length:51},(_,i)=>image(i))}})).status,413);
 }
 assert.equal(reads.length,0);assert.equal(writes.length,0);
 metadata={size:6_000_001,contentType:'image/png'};
 const huge=await send('submit_intake',{files:{top_photos:[1,2,3,4,5].map(image)}});assert.equal(huge.status,413);assert.match(huge.body.error,/30MB/);assert.equal(writes.length,0);
 metadata={size:1,contentType:'text/html'};
 assert.equal((await send('submit_intake',{files:{top_photos:[image(1)]}})).status,400);assert.equal(writes.length,0);
 const valid=await send('save_draft',{files:{top_photos:[image(1),image(1)]}});assert.equal(valid.status,200,JSON.stringify(valid));assert.equal(writes.length,1);assert.equal(writes[0].payload.files.top_photos.length,1);
 assert.equal(h.messages.length,0);assert.equal(h.background.length,0);assert.equal(h.requests.length,0);
});
