import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {AwsClient} from 'aws4fetch';

const moduleUrl = new URL('../../supabase/functions/_shared/customer-r2.ts',import.meta.url);
const storeUrl = new URL('../../supabase/functions/_shared/customer-r2.mjs',import.meta.url);
async function loadWrapper(env = {}) {
  const requests = [];
  const context = vm.createContext({
    Deno:{env:{get:name=>env[name]}},
    Request,Response,Headers,Uint8Array,TextEncoder,TextDecoder,AbortController,crypto,setTimeout,clearTimeout,
    fetch:async(request,options)=>{requests.push({request,options});return new Response(null,{status:404});}
  });
  const aws = new vm.SyntheticModule(['AwsClient'],function(){this.setExport('AwsClient',AwsClient);},{context});
  const store = new vm.SourceTextModule(await readFile(storeUrl,'utf8'),{context,identifier:storeUrl.href});
  const wrapper = new vm.SourceTextModule(stripTypeScriptTypes(await readFile(moduleUrl,'utf8')),
    {context,identifier:moduleUrl.href});
  await wrapper.link(specifier=>{
    if (specifier === 'npm:aws4fetch@1.0.20') return aws;
    if (specifier === './customer-r2.mjs') return store;
    throw new Error('Unexpected Edge Function dependency');
  });
  await wrapper.evaluate();
  return {customerR2Store:wrapper.namespace.customerR2Store,requests};
}
const fakeSecrets = {
  WEBSITE_CUSTOMER_HOSTING:'cloudflare-r2',CUSTOMER_R2_ACCOUNT_ID:'0'.repeat(32),
  CUSTOMER_R2_BUCKET:'sho-sites-preview',CUSTOMER_R2_ACCESS_KEY_ID:'FAKE_TEST_KEY',
  CUSTOMER_R2_SECRET_ACCESS_KEY:'fake-test-secret-not-a-real-credential'
};

test('the actual Supabase wrapper fails closed before the hosting switch is enabled',async()=>{
  for (const flag of [undefined,'','github','true']) {
    const {customerR2Store,requests}=await loadWrapper({...fakeSecrets,WEBSITE_CUSTOMER_HOSTING:flag});
    assert.throws(()=>customerR2Store('9000001000'),/not enabled/);
    assert.equal(requests.length,0);
  }
});

test('missing server secrets and invalid account/bucket/site configuration never contact R2',async()=>{
  for (const missing of ['CUSTOMER_R2_ACCESS_KEY_ID','CUSTOMER_R2_SECRET_ACCESS_KEY',
    'CUSTOMER_R2_ACCOUNT_ID','CUSTOMER_R2_BUCKET']) {
    const {customerR2Store,requests}=await loadWrapper({...fakeSecrets,[missing]:undefined});
    assert.throws(()=>customerR2Store('9000001000'));
    assert.equal(requests.length,0);
  }
  const {customerR2Store,requests}=await loadWrapper(fakeSecrets);
  assert.throws(()=>customerR2Store('1000/../1001'));
  assert.equal(requests.length,0);
});

test('configured Supabase wrapper signs the private request and keeps it site-scoped',async()=>{
  const {customerR2Store,requests}=await loadWrapper(fakeSecrets);
  const store=customerR2Store('9000001000');
  assert.equal(await store.head('sites/9000001000/active.json'),null);
  assert.equal(requests.length,1);
  assert.equal(new URL(requests[0].request.url).hostname,'0'.repeat(32)+'.r2.cloudflarestorage.com');
  assert.match(requests[0].request.headers.get('authorization'),/AWS4-HMAC-SHA256/);
  await assert.rejects(store.get('sites/9000001001/active.json'));
  assert.equal(requests.length,1);
});
