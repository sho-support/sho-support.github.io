import test from 'node:test';
import assert from 'node:assert/strict';
import {exportStorageAssets,exportR2Assets,parseR2Page,allowedAssetBackupClaims} from '../backup/assets-export.mjs';
const run='12345678901';
test('only the exact private backup workflow run, source SHA, owner, branch and fresh OIDC claims are accepted',()=>{
 const sha='a'.repeat(40),now=1700000000,c={repository:'sho-support/sho-support.github.io',repository_id:'1224256882',repository_owner_id:'275386651',ref:'refs/heads/architecture/sales-cloudflare',event_name:'push',run_attempt:'1',run_id:run,sha,workflow_sha:sha,workflow_ref:'sho-support/sho-support.github.io/.github/workflows/sales-assets-backup.yml@refs/heads/architecture/sales-cloudflare',iat:now,exp:now+300};
 assert.equal(allowedAssetBackupClaims(c,run,sha,now),true);
 for(const k of ['repository','repository_id','repository_owner_id','ref','event_name','run_attempt','run_id','sha','workflow_sha','workflow_ref'])assert.equal(allowedAssetBackupClaims({...c,[k]:'wrong'},run,sha,now),false,k);
 for(const change of [{iat:now+31},{iat:now-601},{exp:now},{exp:now+601}])assert.equal(allowedAssetBackupClaims({...c,...change},run,sha,now),false);
});
function storageFixture({corrupt=false,existing=false}={}){
 const source='private-source',qa='hp-backup-qa-'+run,buckets=new Map([[source,{id:source,public:false}]]),files=new Map([[source,new Map([['folder/画像.png',Buffer.from('private fixture')]])]]),mutations=[];
 if(existing){buckets.set(qa,{id:qa,public:false});files.set(qa,new Map());}
 const okay=data=>({data,error:null});
 const storage={
  listBuckets:async()=>okay([...buckets.values()]),getBucket:async id=>buckets.has(id)?okay(buckets.get(id)):{data:null,error:{status:404}},
  createBucket:async(id,options)=>{if(buckets.has(id))throw Error('existing');mutations.push(['create',id]);buckets.set(id,{id,public:options.public});files.set(id,new Map());return okay({id});},
  deleteBucket:async id=>{assert.equal(id,qa);assert.equal(files.get(id).size,0);mutations.push(['delete',id]);buckets.delete(id);files.delete(id);return okay({message:'deleted'});},
  from:id=>({
   list:async(prefix='',{limit=1000,offset=0}={})=>{
    const rows=new Map();for(const [path,body] of files.get(id)||[]){
     if(prefix&&!path.startsWith(prefix+'/'))continue;const rest=prefix?path.slice(prefix.length+1):path,name=rest.split('/')[0];
     rows.set(name,rest.includes('/')?{id:null,name,metadata:null}:{id:'stable-'+path,name,metadata:{size:body.length,mimetype:'image/png'}});
    }return okay([...rows.values()].sort((a,b)=>a.name<b.name?-1:1).slice(offset,offset+limit));
   },
   download:async path=>okay(new Blob([id===qa&&corrupt?Buffer.from('bad'):files.get(id).get(path)],{type:'image/png'})),
   upload:async(path,body,options)=>{assert.equal(id,qa);assert.equal(options.upsert,false);assert.equal(files.get(id).has(path),false);mutations.push(['upload',id,path]);files.get(id).set(path,Buffer.from(body));return okay({path});},
   remove:async paths=>{assert.equal(id,qa);for(const path of paths){files.get(id).delete(path);mutations.push(['remove',id,path]);}return okay([]);}
  })};
 return {storage,buckets,files,mutations,source,qa};
}
test('real Storage byte copies use only a new private QA bucket, retain metadata and verify cleanup',async()=>{
 const f=storageFixture();const result=await exportStorageAssets({storage:f.storage,run,fetch:async url=>{assert.match(url,/\/object\/public\/hp-backup-qa-/);return new Response('',{status:404});}});
 assert.equal(result.proof.storage_object_count,1);assert.equal(result.proof.storage_file_bytes_restored,true);assert.equal(result.proof.qa_bucket_cleanup_verified,true);
 assert.equal(Buffer.from(result.objects[0].body,'base64').toString(),'private fixture');assert.equal(result.objects[0].path,'folder/画像.png');
 assert.equal(f.buckets.has(f.qa),false);assert.equal(f.files.get(f.source).get('folder/画像.png').toString(),'private fixture');
 assert.ok(f.mutations.every(x=>x[1]===f.qa));
});
test('Storage verification failure cleans only this test bucket; an existing bucket is never reused',async()=>{
 const f=storageFixture({corrupt:true});await assert.rejects(exportStorageAssets({storage:f.storage,run,fetch:async()=>new Response('',{status:404})}));
 assert.equal(f.buckets.has(f.qa),false);assert.equal(f.files.get(f.source).size,1);
 const old=storageFixture({existing:true});await assert.rejects(exportStorageAssets({storage:old.storage,run}));assert.deepEqual(old.mutations,[]);assert.equal(old.buckets.has(old.qa),true);
});
const page=(key,body,more=false)=>'<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>'+more+'</IsTruncated>'+(key?'<Contents><Key>'+encodeURIComponent(key)+'</Key><Size>'+body.length+'</Size><ETag>&quot;etag&quot;</ETag><LastModified>2026-11-18T00:00:00Z</LastModified></Contents>':'')+(more?'<NextContinuationToken>next&amp;one</NextContinuationToken>':'')+'</ListBucketResult>';
test('R2 lists every page twice, exports exact bytes and metadata, and makes GET requests only',async()=>{
 const objects=new Map([['sites/1/画像.png',Buffer.from('image')],['sites/1/manifest.json',Buffer.from('{}')]]),calls=[];
 const result=await exportR2Assets({sign:async req=>req,fetch:async req=>{
  calls.push({method:req.method,url:req.url});const url=new URL(req.url);
  if(url.searchParams.has('list-type'))return new Response(url.searchParams.has('continuation-token')?page('sites/1/manifest.json',objects.get('sites/1/manifest.json')):page('sites/1/画像.png',objects.get('sites/1/画像.png'),true));
  const key=decodeURIComponent(url.pathname.split('/').slice(2).join('/'));return new Response(objects.get(key),{headers:{'content-type':'application/octet-stream','x-amz-meta-test':'fixture'}});
 }});
 assert.equal(result.proof.r2_object_count,2);assert.equal(result.proof.r2_pagination_complete,true);assert.equal(result.proof.r2_source_writes,false);
 assert.equal(calls.filter(c=>new URL(c.url).searchParams.has('list-type')).length,4);assert.ok(calls.every(c=>c.method==='GET'));
 assert.equal(result.objects[0].metadata['x-amz-meta-test'],'fixture');assert.equal(result.objects.find(o=>o.key.endsWith('.png')).sha256.length,64);
});
test('R2 refuses malformed XML, missing keys, traversal, unknown pagination and wrong signers',async()=>{
 for(const xml of ['<!DOCTYPE x>'+page(null,''),page(null,'').replace('<IsTruncated>false</IsTruncated>',''),page(null,'').replace('</ListBucketResult>','<Contents><Size>0</Size></Contents></ListBucketResult>'),page('../secret',Buffer.alloc(0)),page('x',Buffer.alloc(0),true).replace(/<NextContinuationToken>.*?<\/NextContinuationToken>/,'')])assert.throws(()=>parseR2Page(xml));
 await assert.rejects(exportR2Assets({sign:async()=>new Request('https://example.invalid/'),fetch:async()=>{throw Error('must not fetch');}}));
});
