import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectCloudflare} from '../src/cloudflare-inventory.mjs';

const account = '0'.repeat(32), token = 'FAKE_TOKEN_FOR_UNIT_TESTS_ONLY_000';
const bucketName = 'sho-customer-sites-preview', base = `/accounts/${account}`;
const bucketPath = base + '/r2/buckets/' + bucketName;
function fixture(overrides = {}, options = {}) {
  const requests = [];
  const routes = new Map(Object.entries({
    '/accounts?per_page=50&page=1':{result:[{id:account,name:'private-person@example.invalid'}]},
    [base + '/workers/scripts']:{result:[{id:'unrelated-private-worker'}]},
    [base + '/workers/subdomain']:{result:{subdomain:'sho-test-account'}},
    [base + '/r2/buckets?per_page=100']:{result:{buckets:[{name:bucketName},{name:'unrelated-private-customer'}]}},
    [bucketPath]:{result:{name:bucketName,storage_class:'Standard'}},
    [bucketPath + '/domains/managed']:{result:{enabled:false,domain:'private-test.r2.dev'}},
    [bucketPath + '/domains/custom']:{result:{domains:[]}},
    ...overrides
  }));
  const fetch = async (url, init) => {
    requests.push({url,init});
    const route = url.slice('https://api.cloudflare.com/client/v4'.length);
    assert.equal(new URL(url).origin,'https://api.cloudflare.com');
    assert.ok(routes.has(route),'Unexpected inventory route: ' + route);
    const payload = routes.get(route);
    if (payload instanceof Response) return payload;
    return Response.json({success:true,...payload});
  };
  return {requests,run:params=>inspectCloudflare({token,fetch,...options,...params})};
}

test('inventory uses only authenticated GETs and identifies a private Standard preview bucket',async()=>{
  const {run,requests} = fixture();
  const result = await run({accountId:account,bucketName});
  assert.equal(result.read_only,true);
  assert.equal(result.configured_bucket_verified,true);
  assert.equal(result.preview_worker_exists,false);
  assert.equal(result.worker_count,1);
  assert.equal(result.candidate_preview_host,'sho-customer-sites-preview.sho-test-account.workers.dev');
  assert.equal(result.preview_buckets[0].name,bucketName);
  assert.ok(requests.length>=6);
  for (const {url,init} of requests) {
    assert.equal(init.method,'GET');
    assert.equal(init.redirect,'error');
    assert.equal(init.headers.get('authorization'),'Bearer '+token);
    assert.equal(init.body,undefined);
    assert.ok(init.signal instanceof AbortSignal);
    assert.ok(!url.includes(token));
    if(url.includes('/r2/'))assert.equal(init.headers.get('cf-r2-jurisdiction'),'default');
  }
  const output = JSON.stringify(result);
  for(const privateValue of [token,'private-person','unrelated-private-worker','unrelated-private-customer','private-test.r2.dev']) {
    assert.ok(!output.includes(privateValue));
  }
});

test('one API-visible account can be discovered without an account-ID secret',async()=>{
  const {run,requests} = fixture();
  const result = await run();
  assert.equal(result.account_id,account);
  assert.equal(result.configured_bucket_verified,false); // discovery does not approve a deployment bucket
  assert.equal(requests[0].url,'https://api.cloudflare.com/client/v4/accounts?per_page=50&page=1');
});

test('zero, multiple or incompletely paged accounts require an explicit account ID',async()=>{
  for (const payload of [{result:[]},{result:[{id:account},{id:'1'.repeat(32)}]},
    {result:[{id:account}],result_info:{total_pages:2}}]) {
    const {run,requests}=fixture({'/accounts?per_page=50&page=1':payload});
    await assert.rejects(run(),error=>error.code==='EXPLICIT_CLOUDFLARE_ACCOUNT_ID_REQUIRED');
    assert.equal(requests.length,1);
  }
});

test('untrusted configuration is rejected before any request',async()=>{
  const {run,requests}=fixture();
  for (const invalid of [{accountId:'../another'},{accountId:'https://evil.invalid'},
    {bucketName:'sho-prod-preview'},{bucketName:'other-bucket'},{token:'bad\nheader'},{timeoutMs:30001}]) {
    await assert.rejects(run(invalid),error=>error.code==='INVALID_INVENTORY_CONFIGURATION');
  }
  assert.equal(requests.length,0);
});

test('managed public access or an enabled custom domain prevents private-bucket verification',async()=>{
  const cases=[
    {[bucketPath+'/domains/managed']:{result:{enabled:true}}},
    {[bucketPath+'/domains/custom']:{result:{domains:[{domain:'hidden-customer.invalid',enabled:true}]}}}
  ];
  for(const overrides of cases) {
    const {run}=fixture(overrides);
    const result=await run({accountId:account,bucketName});
    assert.equal(result.configured_bucket_verified,false);
    assert.equal(result.preview_buckets[0].private_access_verified,false);
    assert.ok(!JSON.stringify(result).includes('hidden-customer.invalid'));
  }
});

test('unknown access state is rejected and a non-Standard storage class is not approved',async()=>{
  const broken=fixture({[bucketPath+'/domains/managed']:{result:{enabled:'false'}}});
  await assert.rejects(broken.run({accountId:account,bucketName}),error=>error.code==='INVALID_CLOUDFLARE_INVENTORY_RESPONSE');
  for(const storage_class of [undefined,'InfrequentAccess']) {
    const {run}=fixture({[bucketPath]:{result:{name:bucketName,storage_class}}});
    assert.equal((await run({accountId:account,bucketName})).configured_bucket_verified,false);
  }
});

test('a pre-existing test Worker is reported and a missing subdomain is never created',async()=>{
  const {run,requests}=fixture({
    [base+'/workers/scripts']:{result:[{id:'sho-customer-sites-preview'}]},
    [base+'/workers/subdomain']:new Response(null,{status:404})
  });
  const result=await run({accountId:account,bucketName});
  assert.equal(result.preview_worker_exists,true);
  assert.equal(result.candidate_preview_host,null);
  assert.ok(requests.every(({init})=>init.method==='GET'));
});

test('R2 cursor pagination is bounded, encoded and complete',async()=>{
  const cursor='next/page?x=one';
  const {run,requests}=fixture({
    [base+'/r2/buckets?per_page=100']:{result:{buckets:[{name:'private-other'}]},result_info:{cursor}},
    [base+'/r2/buckets?per_page=100&cursor='+encodeURIComponent(cursor)]:{result:{buckets:[{name:bucketName}]}}
  });
  const result=await run({accountId:account,bucketName});
  assert.equal(result.default_jurisdiction_bucket_count,2);
  assert.equal(result.configured_bucket_verified,true);
  assert.ok(requests.some(({url})=>url.endsWith('cursor=next%2Fpage%3Fx%3Done')));
});

test('repeating cursors and possible unpaged bucket lists cannot silently omit resources',async()=>{
  const looping=fixture({
    [base+'/r2/buckets?per_page=100']:{result:{buckets:[],cursor:'same'}},
    [base+'/r2/buckets?per_page=100&cursor=same']:{result:{buckets:[],cursor:'same'}}
  });
  await assert.rejects(looping.run({accountId:account}),error=>error.code==='INCOMPLETE_R2_BUCKET_INVENTORY');
  const missingCursor=fixture({[base+'/r2/buckets?per_page=100']:{
    result:{buckets:Array.from({length:100},(_,i)=>({name:'other-'+i}))}
  }});
  await assert.rejects(missingCursor.run({accountId:account}),error=>error.code==='INCOMPLETE_R2_BUCKET_INVENTORY');
});

test('HTTP denial, redirects and service errors are not retried and never echo provider bodies',async()=>{
  for(const status of [302,403,429,503]) {
    let attempts=0;
    await assert.rejects(inspectCloudflare({token,fetch:async()=>{
      attempts++;return new Response('private provider body '+token,{status});
    }}),error=>{
      assert.equal(error.status,status);
      assert.equal(error.code,'CLOUDFLARE_INVENTORY_HTTP_ERROR');
      assert.ok(!error.message.includes(token));
      return true;
    });
    assert.equal(attempts,1);
  }
});

test('malformed and oversized responses fail closed without leaking their contents',async()=>{
  for(const response of [new Response('private invalid JSON '+token),
    Response.json({success:false,errors:[{message:token}]}),
    new Response('x',{headers:{'content-length':String(1024*1024+1)}}),
    new Response('x'.repeat(1024*1024+1))]) {
    await assert.rejects(inspectCloudflare({token,fetch:async()=>response}),error=>{
      assert.ok(!error.message.includes(token));return true;
    });
  }
});

test('stalled body reads have a deadline and raw transport diagnostics are suppressed',async()=>{
  await assert.rejects(inspectCloudflare({token,timeoutMs:25,fetch:async(url,init)=>new Response(new ReadableStream({
    start(controller){init.signal.addEventListener('abort',()=>controller.error(new Error(token)),{once:true});}
  }))}),error=>error.code==='CLOUDFLARE_INVENTORY_TRANSPORT_ERROR'&&!error.message.includes(token));
  await assert.rejects(inspectCloudflare({token,fetch:async()=>{throw new Error(token);}}),
    error=>error.code==='CLOUDFLARE_INVENTORY_TRANSPORT_ERROR'&&!error.message.includes(token));
});

test('the CLI reports missing configuration without contacting Cloudflare',()=>{
  const file=fileURLToPath(new URL('../inspect-cloudflare.mjs',import.meta.url));
  const optional=spawnSync(process.execPath,[file],{env:{},encoding:'utf8'});
  assert.equal(optional.status,0);
  assert.equal(JSON.parse(optional.stdout).status,'not_configured');
  for(const option of ['--require-token','--require-private-preview']) {
    const required=spawnSync(process.execPath,[file,option],{env:{},encoding:'utf8'});
    assert.equal(required.status,1);
    assert.equal(JSON.parse(required.stdout).status,'not_configured');
  }
});
