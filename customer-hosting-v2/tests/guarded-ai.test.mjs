import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuardedAI,prepareAIRequest} from '../../supabase/functions/_shared/guarded-ai.mjs';
const body=()=>({model:'gpt-6.1-sol',input:[{role:'system',content:'Japanese website generation'},{role:'user',content:'制作してください'}],reasoning:{effort:'low'},max_output_tokens:1000,text:{format:{type:'json_schema',schema:{type:'object'}}}});
const answer=(extra={})=>({id:'resp_synthetic',status:'completed',model:'gpt-6.1-sol',output_text:'{}',usage:{input_tokens:100,output_tokens:10},...extra});
function fixture({result=answer(),rejectReserve=false,rejectSettle=false,fetcher,timeoutMs}={}){
 const reserved=[],settled=[],unknown=[],requests=[];
 const ledger={reserve:async r=>{if(rejectReserve)throw Error('private database failure');reserved.push(r);return {request_id:r.requestId,reserved_micro_usd:r.inputBound*4+r.outputBound*20};},settle:async r=>{settled.push(r);if(rejectSettle)throw Error('private failure');return {settled:true,overrun:false};},uncertain:async id=>unknown.push(id)};
 const ai=createGuardedAI({key:'synthetic-not-a-real-key',ledger,timeoutMs,fetcher:async(...args)=>{requests.push(args);return fetcher?fetcher(...args):Response.json(result);}});
 return {ai,reserved,settled,unknown,requests};
}
test('all requests reserve before dispatch, force Standard/store:false and persist actual usage',async()=>{
 const f=fixture();assert.equal((await f.ai.request(body())).id,'resp_synthetic');assert.equal(f.requests.length,1);assert.equal(f.reserved.length,1);assert.equal(f.settled.length,1);
 const [url,options]=f.requests[0],request=JSON.parse(options.body);assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.redirect,'error');assert.equal(request.service_tier,'default');assert.equal(request.store,false);assert.equal(request.max_output_tokens,1000);assert.equal(f.settled[0].inputTokens,100);assert.equal(f.settled[0].requestId,f.reserved[0].requestId);
 assert.equal(f.reserved[0].inputBound,8192+new TextEncoder().encode(options.body).length);assert.match(f.reserved[0].requestHash,/^[a-f0-9]{64}$/);
});
test('unknown models, unbounded output, non-text input, tools and oversized UTF-8 input fail before reservation',()=>{
 for(const bad of [{model:'unknown-price'},{max_output_tokens:0},{max_output_tokens:16001},{max_output_tokens:undefined},{tools:[]},{store:true},{input:[{role:'user',content:[{type:'input_image',image_url:'https://example.invalid/a.png'}]}]},{input:[{role:'user',content:'あ'.repeat(100000)}]},{reasoning:{effort:'max'}}])assert.throws(()=>prepareAIRequest({...body(),...bad}));
});
test('a missing or rejected cost reservation cannot reach the paid endpoint',async()=>{
 const f=fixture({rejectReserve:true});await assert.rejects(f.ai.request(body()),e=>e.code==='AI_BUDGET'&&e.retryable===false&&!e.message.includes('private'));assert.equal(f.requests.length,0);
});
test('provider rejection and lost/invalid responses retain their reservation and never auto-retry or echo diagnostics',async()=>{
 for(const fetcher of [async()=>{throw Error('secret diagnostic');},async()=>Response.json({error:'secret diagnostic'},{status:429}),async()=>new Response('broken secret diagnostic'),async()=>Response.json(answer({usage:null})),async()=>Response.json(answer({model:'unexpected-price-model'}))]){
  const f=fixture({fetcher});await assert.rejects(f.ai.request(body()),e=>e.code==='AI_UNCERTAIN'&&e.retryable===false&&!e.message.includes('secret'));assert.equal(f.reserved.length,1);assert.equal(f.requests.length,1);assert.equal(f.unknown.length,1);assert.equal(f.settled.length,0);
 }
});
test('a lost settlement response stops without dispatching a second generation',async()=>{
 const f=fixture({rejectSettle:true});await assert.rejects(f.ai.request(body()),e=>e.code==='AI_RECORD_UNCERTAIN'&&e.retryable===false);assert.equal(f.requests.length,1);assert.equal(f.settled.length,1);
});
test('incomplete or over-limit generation is accounted and must be reviewed before retry',async()=>{
 for(const result of [answer({status:'incomplete'}),answer({usage:{input_tokens:900000,output_tokens:10}}),answer({usage:{input_tokens:100,output_tokens:1001}})]){
  const f=fixture({result});await assert.rejects(f.ai.request(body()),e=>e.retryable===false);assert.equal(f.settled.length,1);assert.equal(f.requests.length,1);
 }
});
test('oversized and stalled response bodies are bounded without losing the reserved amount',async()=>{
 const huge=fixture({fetcher:async()=>new Response('x'.repeat(2000001))});await assert.rejects(huge.ai.request(body()),e=>e.code==='AI_UNCERTAIN');assert.equal(huge.unknown.length,1);
 const keepAlive=setTimeout(()=>{},200);try{
  const stalled=fixture({timeoutMs:15,fetcher:async()=>new Response(new ReadableStream({start(){}}))});await assert.rejects(stalled.ai.request(body()),e=>e.code==='AI_UNCERTAIN');assert.equal(stalled.unknown.length,1);
 }finally{clearTimeout(keepAlive);}
});
