import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../preview-worker.mjs';

const host = 'sho-customer-sites-preview.test-account.workers.dev';
const env = {TEST_WORKER_HOST: host, SITES: {async get(key) {
  if (key === 'sites/9000001000/active.json') return {text: async()=>JSON.stringify({status:'live',release:'aaaaaaaaaaaa'})};
  if (key === 'sites/9000001000/releases/aaaaaaaaaaaa/index.html') return {body:'Fictional test site'};
  if (key.startsWith('sites/9000001000/releases/aaaaaaaaaaaa/')) return null;
  throw new Error('Unexpected customer path: ' + key);
}}};

test('preview displays only the fictional reserved site', async()=>{
  const response = await worker.fetch(new Request('https://' + host + '/?site=1000'), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'Fictional test site');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
  assert.equal(response.headers.get('X-SHO-Environment'), 'customer-hosting-preview');
});
test('preview fails closed until its exact hostname is configured', async()=>{
  assert.equal((await worker.fetch(new Request('https://' + host), {...env, TEST_WORKER_HOST:''})).status,503);
  assert.equal((await worker.fetch(new Request('https://s1000.sho-support.com'), env)).status,404);
});
test('preview has no upload or arbitrary customer selection route', async()=>{
  assert.equal((await worker.fetch(new Request('https://' + host + '/', {method:'PUT',body:'test'}),env)).status,405);
  assert.equal((await worker.fetch(new Request('https://' + host + '/sites/1000/active.json'),env)).status,404);
});
