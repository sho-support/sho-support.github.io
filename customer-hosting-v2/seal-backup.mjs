// Offline only. No credentials, database connections or uploads are performed.
import {lstat,readFile,writeFile,readdir,mkdir,realpath,link,unlink,rm} from 'node:fs/promises';
import {resolve,relative,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sealBackupPackage,openBackupPackage} from './src/backup-package.mjs';
const repo=resolve(fileURLToPath(new URL('../',import.meta.url)));
const within=(p,root)=>p===root||p.startsWith(root+sep);
async function outsideRepo(path){const absolute=resolve(path),parent=await realpath(dirname(absolute));const canonical=join(parent,absolute.split(sep).at(-1));if(within(canonical,repo))throw Error('Production backup files and keys must remain outside the source repository');return canonical;}
async function regular(path){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink())throw Error('Only ordinary private files are accepted');return s;}
async function key(path){await regular(path);const bytes=new Uint8Array(await readFile(path));if(bytes.length!==32)throw Error('Use a separate raw 32-byte key file');return bytes;}
async function collect(root){
 const files=[];let total=0;
 async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){
  const path=join(dir,e.name);if(e.isSymbolicLink())throw Error('Backup input cannot contain symlinks');
  if(e.isDirectory())await walk(path);else if(e.isFile()){
   const info=await regular(path);total+=info.size;if(total>35*1024*1024||files.length>=5000)throw Error('Initial backup source limit exceeded');
   files.push({path:relative(root,path).split(sep).join('/'),bytes:new Uint8Array(await readFile(path))});
  }else throw Error('Unsupported backup input file');
 }}await walk(root);return files;
}
async function exclusiveWrite(path,bytes){
 const temporary=join(dirname(path),'.sho-backup-'+crypto.randomUUID());
 try{await writeFile(temporary,bytes,{flag:'wx',mode:0o600});await link(temporary,path);}finally{await unlink(temporary).catch(()=>{});}
}
try{
 const [action,input,output,keyPath,...extra]=process.argv.slice(2);
 if(action==='keygen'&&input&&!output){await exclusiveWrite(await outsideRepo(input),crypto.getRandomValues(new Uint8Array(32)));console.log('Private backup key file created. Its contents are not displayed.');}
 else if(['pack','unpack'].includes(action)&&input&&output&&keyPath&&!extra.length){
  const kpath=await outsideRepo(keyPath),target=await outsideRepo(output),src=await outsideRepo(input);
  if(within(kpath,src)||within(kpath,target)||target===kpath||src===kpath)throw Error('Keep the encryption key outside the archive and extraction paths');
  const k=await key(kpath);
  if(action==='pack'){
   const info=await lstat(src);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(src)!==src)throw Error('Expected an ordinary backup input directory');
   if(within(target,src))throw Error('Keep the encrypted output outside the input directory');
   const result=await sealBackupPackage(await collect(src),k);await exclusiveWrite(target,result.envelope);
   console.log('Encrypted package prepared; source completeness still requires inventory review. '+JSON.stringify(result.summary));
  }else{
   const info=await regular(src);if(info.size>64*1024*1024+512)throw Error('Encrypted input is too large');
   const result=await openBackupPackage(new Uint8Array(await readFile(src)),k);
   await mkdir(target,{mode:0o700});
   try{for(const file of result.files){const path=join(target,file.path);await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,file.bytes,{flag:'wx',mode:0o600});}}
   catch(e){await rm(target,{recursive:true,force:true});throw e;}
   console.log('Authenticated files extracted to a new local directory. No database restore was executed. '+JSON.stringify(result.summary));
  }
 }else throw Error('Usage: seal-backup.mjs keygen <key-file> | pack <input-dir> <archive> <key-file> | unpack <archive> <new-output-dir> <key-file>');
}catch(e){console.error('Backup operation refused. '+(e?.code==='EEXIST'?'The output already exists and was not overwritten.':e?.message||'Unknown failure'));process.exitCode=1;}
