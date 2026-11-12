import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {stageRelease,activateRelease,deactivateRelease,readPublication,fencePublication} from '../src/release-publisher.mjs';
import {handleCustomerRequest} from '../src/site-router.mjs';

const a='aaaaaaaaaaaa',b='bbbbbbbbbbbb',c='cccccccccccc';
const yes=async()=>true;
const files=[{path:'index.html',content:'<!doctype html><html><body>Recovery fixture</body></html>'}];
function delayedPointer(raw,id) {
  let release,entered;
  const gate=new Promise(resolve=>{release=resolve;});
  const waiting=new Promise(resolve=>{entered=resolve;});
  let held=false;
  return {waiting,release,bucket:{get:(...args)=>raw.get(...args),head:(...args)=>raw.head(...args),
    async put(key,...args){
      if(key===`sites/${id}/active.json`&&!held){held=true;entered();await gate;}
      return raw.put(key,...args);
    }
  }};
}

test('publication fencing protects recovery against real R2 content-derived ETags',async t=>{
  const runtime=new Miniflare(convertV4MiniflareOptions({
    modules:['../worker.mjs','../src/site-router.mjs'].map(path=>({type:'ESModule',path:fileURLToPath(new URL(path,import.meta.url))})),
    compatibilityDate:'2026-11-07',r2Buckets:{SITES:'recovery-local-only'},bindings:{CUSTOMER_BASE_DOMAIN:'recovery.invalid'}
  }));
  try{
    const raw=await runtime.getR2Bucket('SITES');
    const stage=(id,release)=>stageRelease({bucket:raw,siteId:id,releaseId:release,files});
    const activate=(id,release,previous,bucket=raw)=>activateRelease({bucket,siteId:id,releaseId:release,expectedCurrentRelease:previous,authorize:yes});
    const read=id=>readPublication({bucket:raw,siteId:id});
    await t.test('same pointer bytes repeat their ETag, but rollback uses a fresh operation ID',async()=>{
      const key='sites/1000/active.json';
      const before=await raw.put(key,'{"status":"private","release":null}');
      await raw.put(key,'{"status":"private","release":"aaaaaaaaaaaa"}');
      const again=await raw.put(key,'{"status":"private","release":null}');
      assert.equal(before.httpEtag,again.httpEtag,'This fixture must model content-derived ETags');
      await stage('1000',a);await stage('1000',b);await stage('1000',c);
      await activate('1000',a,null);
      const first=await read('1000');
      const hold=delayedPointer(raw,'1000');
      const late=activate('1000',c,a,hold.bucket);
      await hold.waiting;
      try{
        await activate('1000',b,a);await activate('1000',a,b);
        const rolledBack=await read('1000');
        assert.notEqual(rolledBack.publication_id,first.publication_id);
        assert.notEqual(rolledBack.etag,first.etag);
      }finally{hold.release();}
      await assert.rejects(late,/Concurrent publication conflict/);
      assert.equal((await read('1000')).release,a);
    });
    await t.test('a recovery barrier prevents a delayed conditional update after the old page was observed',async()=>{
      await stage('1001',a);await stage('1001',b);await activate('1001',a,null);
      const baseline=await read('1001'),hold=delayedPointer(raw,'1001');
      const late=activate('1001',b,a,hold.bucket);await hold.waiting;
      try{
        const fenced=await fencePublication({bucket:raw,siteId:'1001',expectedPointer:baseline,authorize:yes});
        assert.equal(fenced.release,a);assert.notEqual(fenced.publication_id,baseline.publication_id);
      }finally{hold.release();}
      await assert.rejects(late,/Concurrent publication conflict/);
      assert.equal((await read('1001')).release,a);
    });
    await t.test('an absent baseline is fenced with a private pointer before allowing a fresh publication',async()=>{
      await stage('1002',a);
      const hold=delayedPointer(raw,'1002'),late=activate('1002',a,null,hold.bucket);await hold.waiting;
      let fenced;
      try{fenced=await fencePublication({bucket:raw,siteId:'1002',expectedPointer:null,authorize:yes});}
      finally{hold.release();}
      await assert.rejects(late,/Concurrent publication conflict/);
      assert.equal((await read('1002')).status,'private');
      assert.equal((await handleCustomerRequest(new Request('https://s1002.recovery.invalid/'),{SITES:raw,CUSTOMER_BASE_DOMAIN:'recovery.invalid'})).status,404);
      await activateRelease({bucket:raw,siteId:'1002',releaseId:a,expectedCurrentRelease:null,
        expectedPublicationId:fenced.publication_id,authorize:yes});
      assert.equal((await read('1002')).release,a);
    });
    await t.test('recovery never overwrites an update that already won',async()=>{
      await stage('1003',a);await stage('1003',b);await activate('1003',a,null);
      const baseline=await read('1003');await activate('1003',b,a);
      await assert.rejects(fencePublication({bucket:raw,siteId:'1003',expectedPointer:baseline,authorize:yes}),/Concurrent publication conflict/);
      assert.equal((await read('1003')).release,b);
      await assert.rejects(fencePublication({bucket:raw,siteId:'1004',expectedPointer:baseline,authorize:yes}),/does not match site/);
      await assert.rejects(fencePublication({bucket:raw,siteId:'1003',expectedPointer:await read('1003'),authorize:async()=>false}),/not authorized/);
    });
    await t.test('suspension hides content and stale operation IDs cannot republish it',async()=>{
      await stage('1005',a);await activate('1005',a,null);const before=await read('1005');
      await assert.rejects(deactivateRelease({bucket:raw,siteId:'1005',expectedCurrentRelease:a,authorize:async()=>false}),/not authorized/);
      const hidden=await deactivateRelease({bucket:raw,siteId:'1005',expectedCurrentRelease:a,expectedPublicationId:before.publication_id,authorize:yes});
      assert.equal(hidden.status,'private');
      assert.equal((await handleCustomerRequest(new Request('https://s1005.recovery.invalid/'),{SITES:raw,CUSTOMER_BASE_DOMAIN:'recovery.invalid'})).status,404);
      await assert.rejects(activateRelease({bucket:raw,siteId:'1005',releaseId:a,expectedCurrentRelease:a,
        expectedPublicationId:before.publication_id,authorize:yes}),/Current release changed/);
      await activateRelease({bucket:raw,siteId:'1005',releaseId:a,expectedCurrentRelease:a,
        expectedPublicationId:hidden.publication_id,authorize:yes});
      assert.equal((await read('1005')).status,'live');
    });
  }finally{await runtime.dispose();}
});
