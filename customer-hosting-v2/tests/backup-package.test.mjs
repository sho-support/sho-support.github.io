import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {sealBackupPackage,openBackupPackage} from '../src/backup-package.mjs';
const text=s=>new TextEncoder().encode(s),project='tyhymvgjkoebetyypspj';
async function fixture(){
 const files=['db/roles.sql','db/schema.sql','db/data.sql','db/managed-customizations.sql','platform/restore-notes.md'].map(path=>({path,bytes:text('synthetic only: '+path)}));
 const bytes=new Uint8Array([0,1,255,123]),digest=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 for(const c of ['storage','r2','github']){files.push({path:c+'/manifest.json',bytes:text(JSON.stringify({schema:1,project_ref:project,entries:[{path:'objects/fixture.bin',bytes:bytes.length,sha256:digest}]}))},{path:c+'/objects/fixture.bin',bytes});}
 return files;
}
test('a bounded encrypted package restores SQL, private material bytes, source and R2 inventories exactly',async()=>{
 const files=await fixture(),key=crypto.getRandomValues(new Uint8Array(32)),r=await sealBackupPackage(files,key),restored=await openBackupPackage(r.envelope,key);
 assert.equal(r.summary.source_completeness_verified,false);assert.deepEqual(restored.files,files);
 await assert.rejects(openBackupPackage(r.envelope,crypto.getRandomValues(new Uint8Array(32))),/authentication/);
 const tampered=r.envelope.slice();tampered[tampered.length-1]^=1;await assert.rejects(openBackupPackage(tampered,key),/authentication/);
});
test('metadata alone, missing components, wrong-project inventories and traversal never become valid backups',async()=>{
 const key=crypto.getRandomValues(new Uint8Array(32));
 const f=await fixture();await assert.rejects(sealBackupPackage(f.filter(x=>x.path!=='storage/objects/fixture.bin'),key),/actual exported file bytes/);
 await assert.rejects(sealBackupPackage(f.filter(x=>x.path!=='db/data.sql'),key),/Missing required/);
 await assert.rejects(sealBackupPackage([...f,{path:'../credentials',bytes:text('no')}],key),/Unsafe/);
 await assert.rejects(sealBackupPackage([...f,{path:'r2/untracked.bin',bytes:text('no')}],key),/Untracked/);
 const wrong=await fixture();wrong.find(x=>x.path==='storage/manifest.json').bytes=text(JSON.stringify({schema:1,project_ref:'different-project',entries:[]}));
 await assert.rejects(sealBackupPackage(wrong,key),/Wrong project/);
});
test('offline CLI never overwrites an archive or extracts into an existing directory',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sho-backup-package-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const source=join(dir,'input'),archive=join(dir,'archive.enc'),key=join(dir,'key.bin'),output=join(dir,'restored');await mkdir(source);
 for(const f of await fixture()){const path=join(source,f.path);await mkdir(join(path,'..'),{recursive:true});await writeFile(path,f.bytes);}
 const cli=new URL('../seal-backup.mjs',import.meta.url);
 const run=(...args)=>spawnSync(process.execPath,[cli.pathname,...args],{encoding:'utf8'});
 const forbidden=new URL('../temporary-qa-key-never-commit.bin',import.meta.url).pathname;
 try{assert.equal(run('keygen',forbidden).status,1,'Keys cannot be generated within the git repository');}finally{await rm(forbidden,{force:true});}
 assert.equal(run('keygen',key).status,0);assert.equal(run('pack',source,archive,key).status,0);
 const original=await readFile(archive);assert.equal(run('pack',source,archive,key).status,1);assert.deepEqual(await readFile(archive),original);
 assert.equal(run('unpack',archive,output,key).status,0);assert.equal(run('unpack',archive,output,key).status,1);
 assert.deepEqual(await readFile(join(output,'storage/objects/fixture.bin')),Buffer.from([0,1,255,123]));
});
