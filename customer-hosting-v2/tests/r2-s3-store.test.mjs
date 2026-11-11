import test from 'node:test';
import assert from 'node:assert/strict';
import {AwsClient} from 'aws4fetch';
import {createR2S3Store} from '../../supabase/functions/_shared/customer-r2.mjs';
import {stageRelease, activateRelease, exportStagedRelease} from '../src/release-publisher.mjs';
import {handleCustomerRequest} from '../src/site-router.mjs';

const accountId = '0'.repeat(32), bucketName = 'sho-sites-preview', siteId = '9000001000';
const a = 'aaaaaaaaaaaa', b = 'bbbbbbbbbbbb';
const pointer = `sites/${siteId}/active.json`;
const home = '<!doctype html><html lang="ja"><body><h1>Release A</h1></body></html>';
const files = [{path:'index.html',content:home},{path:'assets/main.css',content:'body{color:red}'}];
const onlyIf = new Headers({'If-None-Match':'*'});
const signer = () => new AwsClient({accessKeyId:'FAKE_TEST_KEY',secretAccessKey:'fake-test-secret-not-a-real-credential',service:'s3',region:'auto'});

function fixture(overrides = {}) {
  const objects = new Map(), requests = [];
  let sequence = 0;
  const aws = signer();
  const state = {objects,requests,failAt:'',dropResponse:false};
  const fetch = async (request, options) => {
    requests.push({request,options});
    const key = new URL(request.url).pathname.slice(bucketName.length + 2);
    if (key === state.failAt) return new Response('private provider error; do not echo',{status:503});
    const old = objects.get(key);
    if (request.method === 'PUT') {
      // Read the body before the atomic condition/commit, as a real object service does.
      const bytes = new Uint8Array(await request.arrayBuffer());
      const current = objects.get(key);
      if ((request.headers.get('if-none-match') === '*' && current)
          || (request.headers.has('if-match') && request.headers.get('if-match') !== current?.etag)) {
        return new Response(null,{status:412});
      }
      const metadata = [...request.headers].filter(([name])=>name.startsWith('x-amz-meta-'));
      const etag = `"v${++sequence}"`;
      objects.set(key,{bytes,etag,metadata});
      if (state.dropResponse) throw new Error('secret-bearing network diagnostic');
      return new Response(null,{status:200,headers:{etag}});
    }
    if (!old) return new Response(null,{status:404});
    return new Response(request.method === 'HEAD' ? null : old.bytes.slice(),{
      status:200,headers:{'content-length':String(old.bytes.byteLength),etag:old.etag,...Object.fromEntries(old.metadata)}
    });
  };
  state.store = createR2S3Store({accountId,bucketName,siteId,sign:aws.sign.bind(aws),fetch,...overrides});
  return state;
}
const stage = (store,release=a,content=files) => stageRelease({bucket:store,siteId,releaseId:release,files:content});
const activate = (store,release=a,previous=null,authorize=async()=>true) => activateRelease({
  bucket:store,siteId,releaseId:release,expectedCurrentRelease:previous,authorize
});

test('server R2 configuration rejects missing credentials metadata and untrusted endpoints',()=>{
  const valid = {accountId,bucketName,siteId,sign:async r=>r};
  for (const invalid of [{accountId:''},{accountId:'https://evil.invalid'}, {bucketName:'../other-bucket'},
    {bucketName:'BUCKET'}, {siteId:'1000/../1001'}, {sign:null}, {timeoutMs:0},{timeoutMs:30001}]) {
    assert.throws(()=>createR2S3Store({...valid,...invalid}),/configuration/);
  }
});

test('the adapter cannot read or write another customer or a traversal key',async()=>{
  const {store,requests} = fixture();
  for (const key of ['sites/9000001001/active.json',`sites/${siteId}/releases/${a}/../index.html`,
    `sites/${siteId}/releases/${a}/%2e%2e/index.html`,`sites/${siteId}/releases/${a}//index.html`,
    `sites/${siteId}/.env`,`sites/${siteId}/releases/main/index.html`,pointer+'?token=x']) {
    await assert.rejects(store.head(key));
    await assert.rejects(store.get(key));
    await assert.rejects(store.put(key,'private',{onlyIf}));
  }
  assert.equal(requests.length,0);
  assert.equal(store.delete,undefined);
  assert.equal(store.list,undefined);
});

test('S3 writes sign payload, conditions and metadata and do not use presigned URLs',async()=>{
  const {store,requests} = fixture();
  await store.put(pointer,'{"status":"draft"}',{onlyIf,httpMetadata:{contentType:'application/json'}});
  const {request,options} = requests[0];
  assert.equal(request.url,`https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${pointer}`);
  assert.equal(new URL(request.url).search,'');
  const auth = request.headers.get('authorization');
  assert.match(auth,/AWS4-HMAC-SHA256 Credential=FAKE_TEST_KEY\/[0-9]+\/auto\/s3\/aws4_request/);
  assert.match(auth,/SignedHeaders=[^,]*if-none-match[^,]*x-amz-meta-sha256/);
  assert.match(request.headers.get('x-amz-content-sha256'),/^[a-f0-9]{64}$/);
  assert.equal(request.headers.get('x-amz-meta-sha256'),request.headers.get('x-amz-content-sha256'));
  assert.equal(request.headers.get('content-type'),'application/json');
  assert.equal(options.redirect,'error');
  assert.ok(options.signal instanceof AbortSignal);
});

test('read and head preserve quoted ETag, sizes, digest and binary content',async()=>{
  const {store} = fixture(), key = `sites/${siteId}/releases/${a}/assets/photo.png`;
  const bytes = new Uint8Array([0,127,128,255]);
  await store.put(key,bytes,{onlyIf});
  const info = await store.head(key), object = await store.get(key);
  assert.equal(info.size,4);
  assert.equal(info.httpEtag,'"v1"');
  assert.match(info.customMetadata.sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(new Uint8Array(await object.arrayBuffer()),bytes);
  assert.deepEqual(new Uint8Array(await object.arrayBuffer()),bytes);
  assert.equal(await store.get(pointer),null);
  assert.equal(await store.head(pointer),null);
});

test('all writes require safe atomic conditions and release files are immutable',async()=>{
  const {store,requests} = fixture();
  await assert.rejects(store.put(pointer,'x'),/conditional/);
  for (const value of [new Headers({'if-match':'*'}),new Headers({'if-none-match':'*','if-match':'"v1"'}),
    new Headers({'if-match':'W/"v1"'}),new Headers({'if-none-match':'"v1"'})]) {
    await assert.rejects(store.put(pointer,'x',{onlyIf:value}),/conditional/);
  }
  await assert.rejects(store.put(`sites/${siteId}/releases/${a}/index.html`,'x',{
    onlyIf:new Headers({'if-match':'"v1"'})
  }),/conditional/);
  assert.equal(requests.length,0);
});

test('checksum and size failures occur before a network request',async()=>{
  const {store,requests} = fixture();
  await assert.rejects(store.put(pointer,'x',{onlyIf,sha256:'0'.repeat(64)}),/checksum/);
  await assert.rejects(store.put(pointer,'x',{onlyIf,customMetadata:{sha256:'0'.repeat(64)}}),/checksum/);
  await assert.rejects(store.put(pointer,'x'.repeat(4097),{onlyIf}),/size limit/);
  await assert.rejects(store.put(pointer,'',{onlyIf}),/size limit/);
  await assert.rejects(store.put(pointer,{}, {onlyIf}),/content/);
  await assert.rejects(store.put(pointer,'x',{onlyIf,customMetadata:{secret:'private\nheader'}}),/metadata/);
  assert.equal(requests.length,0);
});

test('a lost write response is ambiguous, never retried automatically or logged verbatim',async()=>{
  const state = fixture();
  state.dropResponse = true;
  await assert.rejects(state.store.put(pointer,'{"status":"draft"}',{onlyIf}),error=>{
    assert.equal(error.code,'R2_WRITE_OUTCOME_UNKNOWN');
    assert.equal(error.outcomeUnknown,true);
    assert.doesNotMatch(error.message,/secret-bearing/);
    return true;
  });
  assert.equal(state.requests.length,1);
  assert.ok(state.objects.has(pointer));
  state.dropResponse = false;
  assert.equal(await state.store.put(pointer,'different',{onlyIf}),null);
  assert.equal(await(await state.store.get(pointer)).text(),'{"status":"draft"}');
});

test('permission errors and bucket policy conflicts are distinct from failed conditions',async()=>{
  for (const status of [403,409,429,500,503]) {
    const {store,requests} = fixture({fetch:async()=>new Response('secret provider detail',{status})});
    await assert.rejects(store.put(pointer,'x',{onlyIf}),error=>{
      assert.equal(error.status,status);
      assert.equal(error.outcomeUnknown,status>=500);
      assert.doesNotMatch(error.message,/secret provider detail/);
      return true;
    });
    await assert.rejects(store.get(pointer),error=>error.status===status);
    assert.equal(requests.length,0); // the injected transport is used, not any real network
  }
});

test('redirects and changed signer destinations cannot receive signed credentials',async()=>{
  let calls=0;
  const badSigner = fixture({sign:async()=>new Request('https://evil.invalid/'),fetch:async()=>{calls++;}});
  await assert.rejects(badSigner.store.get(pointer),error=>error.code==='R2_SIGNER_REJECTED');
  assert.equal(calls,0);
  const redirect = fixture({fetch:async()=>{calls++;return new Response(null,{status:307,headers:{location:'https://evil.invalid/'}});}});
  await assert.rejects(redirect.store.get(pointer),error=>error.code==='R2_REDIRECT_REJECTED');
  assert.equal(calls,1);
});

test('oversized, truncated, unquoted-ETag and corrupted storage responses are rejected',async()=>{
  for (const headers of [
    {'content-length':'4097',etag:'"v1"'}, {'content-length':'0x10',etag:'"v1"'},
    {'content-length':'1',etag:'v1'}, {'content-length':'2',etag:'"v1"'},
    {'content-length':'1',etag:'"v1"','x-amz-meta-sha256':'0'.repeat(64)}
  ]) {
    const {store}=fixture({fetch:async()=>new Response('x',{status:200,headers})});
    await assert.rejects(store.get(pointer),error=>['R2_INVALID_RESPONSE','R2_CHECKSUM_MISMATCH'].includes(error.code));
  }
  const oversized = fixture({fetch:async()=>new Response('xx',{status:200,headers:{'content-length':'1',etag:'"v1"'}})});
  await assert.rejects(oversized.store.get(pointer),error=>error.code==='R2_INVALID_RESPONSE');
});

test('request deadlines also bound a stalled response body',async()=>{
  const {store}=fixture({timeoutMs:25,sign:async r=>r,fetch:async(request,options)=>{
    const body=new ReadableStream({start(controller){
      options.signal.addEventListener('abort',()=>controller.error(new Error('aborted')),{once:true});
    }});
    return new Response(body,{headers:{'content-length':'1',etag:'"v1"'}});
  }});
  await assert.rejects(store.get(pointer),error=>error.code==='R2_INVALID_RESPONSE');
});

test('the S3 transport preserves private staging, authorization, update, rollback and backup',async()=>{
  const {store}=fixture();
  const read=()=>handleCustomerRequest(new Request('https://s9000001000.customer-preview.invalid/'),{
    SITES:store,CUSTOMER_BASE_DOMAIN:'customer-preview.invalid'
  });
  await stage(store);
  assert.equal((await read()).status,404);
  await assert.rejects(activate(store,a,null,async()=>false),/not authorized/);
  assert.equal((await read()).status,404);
  await activate(store);
  assert.equal(await(await read()).text(),home);
  await stage(store,b,[{path:'index.html',content:home.replace('Release A','Release B')},files[1]]);
  await activate(store,b,a);
  assert.match(await(await read()).text(),/Release B/);
  await activate(store,a,b);
  assert.equal(await(await read()).text(),home);
  const backup = await exportStagedRelease({bucket:store,siteId,releaseId:a});
  assert.equal(backup.files.length,2);
  assert.equal(new TextDecoder().decode(backup.files[0].content),home);
});

test('an interrupted S3 upload leaves the old release live and the incomplete one unpublishable',async()=>{
  const state=fixture();
  await stage(state.store);await activate(state.store);
  state.failAt=`sites/${siteId}/releases/${b}/assets/main.css`;
  await assert.rejects(stage(state.store,b));
  await assert.rejects(activate(state.store,b,a),/completion manifest/);
  assert.equal(JSON.parse(await(await state.store.get(pointer)).text()).release,a);
});

test('concurrent S3 conditional publications cannot overwrite the winning release',async()=>{
  const {store}=fixture();
  await stage(store);await stage(store,b);
  const results=await Promise.allSettled([activate(store),activate(store,b)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
});
