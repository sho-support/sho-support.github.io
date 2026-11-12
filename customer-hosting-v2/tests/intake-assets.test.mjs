import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeIntakeAssets,verifyIntakeAssets} from '../../supabase/functions/_shared/intake-assets.mjs';
import {MATERIAL_LIMITS} from '../../supabase/functions/_shared/intake-assets.mjs';
import {MATERIAL_LIMITS as browserLimits,checkMaterialSelection} from '../../website-materials.js';
const image=(n=1,group='top_photos')=>({path:`1000/secure-intake/${group}/image-${n}.png`,name:`画像${n}.png`});
const payload=files=>({fields:{build_plan:'one'},files:{top_photos:files},members:[]});
test('another tenant, traversal, encoded and executable paths are rejected before any privileged read',async()=>{
  for(const path of ['1001/top_photos/a.png','10000/top_photos/a.png','1000/../1001/a.png','1000/%2e%2e/a.png','1000/a\\b.png','1000//a.png','1000/.private/a.png','1000/a.html','https://evil.example/a.png']){
    let reads=0;await assert.rejects(verifyIntakeAssets('1000',payload([{path,name:'a.png'}]),async()=>{reads++;}),/保存先|画像は/);assert.equal(reads,0);
  }
});
test('all member-photo references are checked even if omitted from files',()=>{
  assert.throws(()=>normalizeIntakeAssets('1000',{files:{},members:[{photo:{path:'1001/member/a.png',name:'photo'}}]}),/保存先/);
  const p=normalizeIntakeAssets('1000',{files:{},members:[{photo:image(1,'member_photos')}]});assert.equal(p.files.member_photos.length,1);
});
test('duplicate member references count once; references cannot borrow another input group',()=>{
  const p=normalizeIntakeAssets('1000',{files:{member_photos:[image(1,'member_photos')]},members:[{photo:image(1,'member_photos')}]});assert.equal(p.files.member_photos.length,1);
  assert.throws(()=>normalizeIntakeAssets('1000',{files:{top_photos:[image()],gallery_photos:[image()]}}),/別の入力欄/);
});
test('50 unique files pass and the 51st fails before metadata requests',async()=>{
  const p=payload(Array.from({length:50},(_,i)=>image(i)));assert.equal(normalizeIntakeAssets('1000',p).files.top_photos.length,50);
  let reads=0;await assert.rejects(verifyIntakeAssets('1000',payload([...p.files.top_photos,image(51)]),async()=>{reads++;}),/50点/);assert.equal(reads,0);
});
test('server metadata defeats forged client sizes and enforces the cumulative 30 MB limit',async()=>{
  const p=payload([1,2,3,4,5].map(n=>({...image(n),size:1})));
  await assert.rejects(verifyIntakeAssets('1000',p,async()=>({size:6_000_001,contentType:'image/png'})),/30MB/);
  const r=await verifyIntakeAssets('1000',p,async()=>({size:6_000_000,contentType:'image/png'}));assert.equal(r.totalBytes,30_000_000);assert.equal(r.fileCount,5);assert.equal(r.payload.files.top_photos[0].size,6_000_000);
});
test('empty, oversized, wrong-MIME and unreadable objects fail closed',async()=>{
  for(const metadata of [{size:0,contentType:'image/png'},{size:7_000_001,contentType:'image/png'},{size:2,contentType:'text/html'},{}])await assert.rejects(verifyIntakeAssets('1000',payload([image()]),async()=>metadata));
  await assert.rejects(verifyIntakeAssets('1000',payload([image()]),async()=>{throw new Error('private provider diagnostic');}),e=>e.status===503&&!e.message.includes('private'));
});
test('malformed groups and a flood of duplicate references cannot bypass validation',()=>{
  for(const p of [{files:[]},{files:{unknown:[]}},{files:{top_photos:'not-array'}},{members:'not-array'},payload(Array(201).fill(image()))])assert.throws(()=>normalizeIntakeAssets('1000',p));
});
test('browser preflight agrees on limits, counts retained images and validates before upload',()=>{
  assert.deepEqual(browserLimits,MATERIAL_LIMITS);
  const file={name:'photo.png',size:6_000_000,type:'image/png'};
  assert.equal(checkMaterialSelection([],Array(5).fill(file)).totalBytes,30_000_000);
  assert.throws(()=>checkMaterialSelection([{path:'8100/a.png',size:1}],Array(5).fill(file)),/30MB/);
  assert.throws(()=>checkMaterialSelection(Array.from({length:50},(_,i)=>({path:'8100/'+i+'.png',size:1})),[file]),/50点/);
  assert.equal(checkMaterialSelection([{path:'8100/a.png',size:1},{path:'8100/a.png',size:1}],[]).fileCount,1);
  for(const f of [{...file,size:0},{...file,size:7_000_001},{...file,type:'text/html'},{...file,name:'unsafe.svg'}])assert.throws(()=>checkMaterialSelection([],[f]));
});
