import test from 'node:test';
import assert from 'node:assert/strict';
import {stageRelease, activateRelease} from '../src/release-publisher.mjs';

const a='aaaaaaaaaaaa', b='bbbbbbbbbbbb';
const homepage='<!doctype html><html lang="ja"><body><h1>Ready</h1></body></html>';
class MockBucket {
  constructor(){this.objects=new Map();this.sequence=0;this.failAt='';this.injectConflict=false;}
  async head(key){const o=this.objects.get(key);return o?{size:o.size,httpEtag:o.etag,customMetadata:o.customMetadata}:null;}
  async get(key){const o=this.objects.get(key);return o?{size:o.size,httpEtag:o.etag,text:async()=>o.content}:null;}
  async put(key,value,{onlyIf,customMetadata}={}){
    if(key===this.failAt)throw new Error('Injected upload outage');
    const old=this.objects.get(key),ifNone=onlyIf?.get('If-None-Match'),ifMatch=onlyIf?.get('If-Match');
    if((ifNone==='*' && old)||(ifMatch&&(!old||old.etag!==ifMatch)))return null;
    if(this.injectConflict&&key.endsWith('/active.json')){this.injectConflict=false;return null;}
    const content=typeof value==='string'?value:new TextDecoder().decode(value);
    const etag=`"v${++this.sequence}"`,size=new TextEncoder().encode(content).byteLength;
    this.objects.set(key,{content,size,etag,customMetadata});return {size,httpEtag:etag};
  }
}
const files=[{path:'index.html',content:homepage},{path:'assets/main.css',content:'body{color:red}'}];
const publisher=(bucket,id='1000',release=a)=>stageRelease({bucket,siteId:id,releaseId:release,files});
const activate=(bucket,release=a,previous=null,authorize=async()=>true)=>activateRelease({bucket,siteId:'1000',releaseId:release,expectedCurrentRelease:previous,authorize});

test('staging stores assets without exposing a live pointer',async()=>{
 const bkt=new MockBucket();await publisher(bkt);
 assert.equal(await bkt.get('sites/1000/active.json'),null);
 assert.ok(await bkt.get(`sites/1000/releases/${a}/index.html`));
});
test('a repeated release ID cannot overwrite an already staged asset',async()=>{
 const bkt=new MockBucket();await publisher(bkt);
 await assert.rejects(publisher(bkt),/already exists/);
});
test('an interrupted staged upload cannot change a previously live site',async()=>{
 const bkt=new MockBucket();await publisher(bkt,'1000',a);await activate(bkt,a,null);
 bkt.failAt=`sites/1000/releases/${b}/assets/main.css`;
 await assert.rejects(publisher(bkt,'1000',b),/Injected upload outage/);
 const p=JSON.parse((await bkt.get('sites/1000/active.json')).text?await(await bkt.get('sites/1000/active.json')).text():'{}');
 assert.equal(p.release,a);
});
test('public activation rejects absent or negative server authorization',async()=>{
 const bkt=new MockBucket();await publisher(bkt);
 await assert.rejects(activate(bkt,a,null,async()=>false),/not authorized/);
 await assert.rejects(activateRelease({bucket:bkt,siteId:'1000',releaseId:a,expectedCurrentRelease:null}),/not authorized/);
 assert.equal(await bkt.get('sites/1000/active.json'),null);
});
test('a successfully staged and authorized release becomes visible',async()=>{
 const bkt=new MockBucket();await publisher(bkt);
 const result=await activate(bkt,a,null);
 assert.equal(result.previous_release,null);
 assert.deepEqual(JSON.parse(await(await bkt.get('sites/1000/active.json')).text()),{status:'live',release:a});
});
test('an update needs the exact previous published release',async()=>{
 const bkt=new MockBucket();await publisher(bkt,'1000',a);await publisher(bkt,'1000',b);await activate(bkt,a,null);
 await assert.rejects(activate(bkt,b,null),/changed/);
 await assert.rejects(activate(bkt,b,b),/changed/);
 await activate(bkt,b,a);
 assert.equal(JSON.parse(await(await bkt.get('sites/1000/active.json')).text()).release,b);
});
test('a lost-update race never overwrites a concurrent publication',async()=>{
 const bkt=new MockBucket();await publisher(bkt,'1000',a);await publisher(bkt,'1000',b);await activate(bkt,a,null);
 bkt.injectConflict=true;
 await assert.rejects(activate(bkt,b,a),/Concurrent publication conflict/);
 assert.equal(JSON.parse(await(await bkt.get('sites/1000/active.json')).text()).release,a);
});
test('an authorized rollback reuses an existing immutable release',async()=>{
 const bkt=new MockBucket();await publisher(bkt,'1000',a);await publisher(bkt,'1000',b);
 await activate(bkt,a,null);await activate(bkt,b,a);await activate(bkt,a,b);
 assert.equal(JSON.parse(await(await bkt.get('sites/1000/active.json')).text()).release,a);
});
test('activation refuses missing staged site, invalid identifiers and unexpected storage',async()=>{
 const bkt=new MockBucket();await assert.rejects(activate(bkt,a,null),/completion manifest/);
 await assert.rejects(publisher(bkt,'1',a),/Invalid site ID/);
 await assert.rejects(activateRelease({bucket:{},siteId:'1000',releaseId:a,expectedCurrentRelease:null,authorize:async()=>true}),/R2 binding/);
});

test('a partial upload cannot be activated even when index.html was stored',async()=>{
 const bkt=new MockBucket();bkt.failAt=`sites/1000/releases/${a}/assets/main.css`;
 await assert.rejects(publisher(bkt),/Injected upload outage/);
 assert.ok(await bkt.head(`sites/1000/releases/${a}/index.html`));
 await assert.rejects(activate(bkt),/completion manifest/);
 assert.equal(await bkt.get('sites/1000/active.json'),null);
});

test('a failed completion marker leaves all staged files private',async()=>{
 const bkt=new MockBucket();bkt.failAt=`sites/1000/release-manifests/${a}.json`;
 await assert.rejects(publisher(bkt),/Injected upload outage/);
 await assert.rejects(activate(bkt),/completion manifest/);
 assert.equal(await bkt.get('sites/1000/active.json'),null);
});

test('activation checks every staged asset again',async()=>{
 const bkt=new MockBucket();await publisher(bkt);
 bkt.objects.delete(`sites/1000/releases/${a}/assets/main.css`);
 await assert.rejects(activate(bkt),/missing or changed/);
 assert.equal(await bkt.get('sites/1000/active.json'),null);
});

test('same-size corruption with a different content digest is refused',async()=>{
 const bkt=new MockBucket();await publisher(bkt);
 bkt.objects.get(`sites/1000/releases/${a}/assets/main.css`).customMetadata.sha256='0'.repeat(64);
 await assert.rejects(activate(bkt),/missing or changed/);
});

test('another customer completion manifest cannot authorize this release',async()=>{
 const bkt=new MockBucket();await publisher(bkt,'1001',a);
 bkt.objects.set(`sites/1000/release-manifests/${a}.json`,bkt.objects.get(`sites/1001/release-manifests/${a}.json`));
 await assert.rejects(activate(bkt),/does not match target/);
});

test('concurrent staging of the same release never overwrites a winner',async()=>{
 const bkt=new MockBucket();
 const results=await Promise.allSettled([publisher(bkt),publisher(bkt)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await activate(bkt);
 assert.equal(JSON.parse(await(await bkt.get('sites/1000/active.json')).text()).release,a);
});
