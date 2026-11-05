const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../supabase/functions/_shared/website.ts'),'utf8');
 const start=source.indexOf('export async function linePush(');
 const end=source.indexOf('export async function notifyOwner(',start);
 assert.ok(start>=0&&end>start,'shared LINE sender exists');
 let code=source.slice(start,end)
  .replace('export async function linePush(to: string | null | undefined, text: string, retryKey?: string) {',
   'async function linePush(to,text,retryKey) {')
  .replace('const headers: Record<string,string> =','const headers =');
 assert.ok(code.includes("headers['X-Line-Retry-Key']=retryKey"),'actual code includes idempotency');
 const UUID='8d13c574-e10c-4f70-b0f0-3e2580472d5f';
 const headersFor=(accepted)=>({has:(name)=>name==='x-line-accepted-request-id'&&accepted});
 let responseStatus=200,accepted=false,lastRequest=null;
 const stubFetch=async(url,opt)=>{
  lastRequest={url,...opt};
  return{status:responseStatus,ok:responseStatus>=200&&responseStatus<300,
   headers:headersFor(accepted),text:async()=>JSON.stringify({message:'test'})};
 };
 const sender=new Function('getLineAccessToken','fetch','AbortSignal',code+';return linePush;')(
  async()=> 'test-line-token',stubFetch,AbortSignal);
 let result=await sender('recipient-id','検証テキスト',UUID);
 assert.deepEqual(result,{skipped:false,ok:true},'200 accepted');
 assert.equal(lastRequest.headers['X-Line-Retry-Key'],UUID,'retry header sent');
 assert.equal(JSON.parse(lastRequest.body).messages[0].text,'検証テキスト');
 responseStatus=409;accepted=true;
 result=await sender('recipient-id','検証テキスト',UUID);
 assert.equal(result.alreadyAccepted,true,'409 with accepted ID treated as already accepted');
 responseStatus=409;accepted=false;
 result=await sender('recipient-id','検証テキスト',UUID);
 assert.equal(result.ok,false,'409 without accepted ID not misclassified as success');
 responseStatus=200;
 await assert.rejects(sender('recipient-id','検証テキスト','not-a-uuid'),/retry key must be a UUID/);
 result=await sender('recipient-id','検証テキスト');
 assert.equal(result.ok,true,'legacy sends still function');
 assert.equal(lastRequest.headers['X-Line-Retry-Key'],undefined,'no invented retry key in legacy call');
 console.log('LINE_RETRY_QA_PASS: 200, accepted-409, ambiguous-409, header and UUID guards');
})().catch(e=>{console.error('LINE_RETRY_QA_FAIL',e.stack||e);process.exitCode=1});
