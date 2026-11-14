import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {stageRelease, activateRelease, exportStagedRelease} from '../src/release-publisher.mjs';
import {handleCustomerRequest} from '../src/site-router.mjs';
import {runPreviewLifecycle,scopedPreviewStore} from '../src/preview-lifecycle.mjs';

const first = 'aaaaaaaaaaaa', second = 'bbbbbbbbbbbb', third = 'cccccccccccc';
const files = [{path:'index.html', content:'<!doctype html><html lang="ja"><body><h1>Release A</h1></body></html>'},
  {path:'assets/main.css',content:'body{color:red}'}];
const stage = (bucket, release, content = files) => stageRelease({bucket,siteId:'9000001000',releaseId:release,files:content});
const activate = (bucket, release, previous) => activateRelease({
  bucket,siteId:'9000001000',releaseId:release,expectedCurrentRelease:previous,authorize:async()=>true
});

test('the real remote-verification scenario passes on an isolated actual workerd R2 binding', async()=>{
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules:['../preview-worker.mjs','../src/site-router.mjs'].map(path=>({
      type:'ESModule',path:fileURLToPath(new URL(path,import.meta.url))
    })),compatibilityDate:'2026-11-07',r2Buckets:{SITES:'reserved-fixture-only'},
    bindings:{TEST_WORKER_HOST:'sho-customer-sites-preview.local-test.workers.dev'}
  }));
  try {
    const bucket = await runtime.getR2Bucket('SITES');
    const read = (path,options)=>runtime.dispatchFetch('https://sho-customer-sites-preview.local-test.workers.dev'+path,options);
    const proof=await runPreviewLifecycle({bucket,read});
    assert.equal(proof.checks.length,9);
    assert.ok(proof.usage.writes<=24);
    assert.equal(proof.production_approval_verified,false);
    // A deliberate repeat can only replace our own synthetic fixture.
    const repeated=await runPreviewLifecycle({bucket,read});
    assert.equal(repeated.checks[0],'existing_fictional_fixture_verified');
    await bucket.put('sites/9000001000/active.json',JSON.stringify({status:'live',release:'eeeeeeeeeeee'}));
    await bucket.put('sites/9000001000/releases/eeeeeeeeeeee/index.html','Unknown customer content');
    await assert.rejects(runPreviewLifecycle({bucket,read}),/PREVIEW_BASELINE_NOT_OWNED/);
  } finally {await runtime.dispose();}
});

test('live test transport forbids other keys, limits spend and stops after an unknown write',async()=>{
  let calls=0;
  const raw={async put(){calls++;throw new Error('network outcome unknown');},async get(){calls++;return null;}};
  const scoped=scopedPreviewStore(raw);
  await assert.rejects(scoped.get('sites/1000/active.json'),/OUTSIDE_RESERVED/);
  await assert.rejects(scoped.get('sites/9000001000/secret.json'),/OUTSIDE_RESERVED/);
  assert.equal(calls,0);
  await assert.rejects(scoped.put('sites/9000001000/active.json','{}'),/outcome unknown/);
  await assert.rejects(scoped.get('sites/9000001000/active.json'),/OUTCOME_UNKNOWN/);
  assert.equal(calls,1);
  const limited=scopedPreviewStore({get:async()=>null},{maxReads:1});
  await limited.get('sites/9000001000/active.json');
  await assert.rejects(limited.get('sites/9000001000/active.json'),/BUDGET_EXCEEDED/);
});

test('release lifecycle uses actual local workerd and R2 bindings', async t => {
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules:['../worker.mjs','../src/site-router.mjs'].map(path=>({
      type:'ESModule',path:fileURLToPath(new URL(path,import.meta.url))
    })),
    compatibilityDate:'2026-11-07',
    r2Buckets:{SITES:'local-preview-only',RESTORE:'local-restore-only'},
    bindings:{CUSTOMER_BASE_DOMAIN:'customer-preview.invalid'}
  }));
  try {
    const bucket = await runtime.getR2Bucket('SITES');
    const read = (path = '/') => runtime.dispatchFetch('https://s9000001000.customer-preview.invalid' + path);
    await t.test('staged assets stay private until the complete release is authorized', async()=>{
      await stage(bucket,first);
      assert.equal((await read()).status,404);
      await assert.rejects(activateRelease({bucket,siteId:'9000001000',releaseId:first,
        expectedCurrentRelease:null,authorize:async()=>false}),/not authorized/);
      await activate(bucket,first,null);
      assert.match(await(await read()).text(),/Release A/);
    });
    await t.test('conditional R2 writes reject a lost update', async()=>{
      await stage(bucket,second,[{...files[0],content:files[0].content.replace('Release A','Release B')},files[1]]);
      await stage(bucket,third,[{...files[0],content:files[0].content.replace('Release A','Release C')},files[1]]);
      const results = await Promise.allSettled([activate(bucket,second,first),activate(bucket,third,first)]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(results.filter(r=>r.status==='rejected').length,1);
    });
    await t.test('rollback restores the previous HTML and assets', async()=>{
      const state = JSON.parse(await(await bucket.get('sites/9000001000/active.json')).text());
      await activate(bucket,first,state.release);
      const page=await read();
      assert.equal(page.headers.get('X-SHO-Release'),first);
      assert.match(await page.text(),/Release A/);
      assert.equal(await(await read('/assets/main.css')).text(),'body{color:red}');
    });
    await t.test('exported bytes restore to a separate empty R2 bucket', async()=>{
      const backup=await exportStagedRelease({bucket,siteId:'9000001000',releaseId:first});
      const restored=await runtime.getR2Bucket('RESTORE');
      await stage(restored,first,backup.files);
      await activate(restored,first,null);
      const page=await handleCustomerRequest(new Request('https://s9000001000.customer-preview.invalid/'),{
        SITES:restored,CUSTOMER_BASE_DOMAIN:'customer-preview.invalid'
      });
      assert.equal(page.status,200);
      assert.equal(await page.text(),files[0].content);
    });
    await t.test('an incomplete release cannot activate on the real R2 implementation', async()=>{
      const incomplete='dddddddddddd';
      await bucket.put(`sites/9000001000/releases/${incomplete}/index.html`,files[0].content);
      await assert.rejects(activate(bucket,incomplete,first),/completion manifest/);
      assert.match(await(await read()).text(),/Release A/);
    });
  } finally {
    await runtime.dispose();
  }
});
