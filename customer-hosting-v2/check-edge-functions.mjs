import {lstat,readFile,realpath,symlink,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url)),modules=root+'node_modules';
const target=fileURLToPath(new URL('./node_modules',import.meta.url));
let made=false;
try{
  let exists=true;try{await lstat(modules);}catch(e){if(e.code==='ENOENT')exists=false;else throw e;}
  if(!exists){await symlink(target,modules,'dir');made=true;}
  for(const [name,version] of [['@supabase/supabase-js','2.57.4'],['aws4fetch','1.0.20']]){
    const p=JSON.parse(await readFile(modules+'/'+name+'/package.json','utf8'));
    if(p.version!==version)throw new Error('Unexpected Edge Function QA dependency: '+name);
  }
  const args=['--yes','deno@2.9.6','check','--config','deno.qa.json','--no-remote','--no-lock',
    '../supabase/functions/_shared/edge-runtime.d.ts',
    ...['website-api','website-customer-access','website-worker','website-preview'].map(x=>'../supabase/functions/'+x+'/index.ts'),
    'supabase-storage-probe/index.ts'];
  const child=spawn('npx',args,{cwd:fileURLToPath(new URL('./',import.meta.url)),stdio:'inherit'});
  process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
}finally{
  if(made&&await realpath(modules)===await realpath(target))await unlink(modules);
}
