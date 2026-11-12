import {encryptBackup,decryptBackup} from './backup-envelope.mjs';
const scope='sho-web-support-full-backup-v1',project='tyhymvgjkoebetyypspj',maxBytes=35*1024*1024,maxFiles=5000;
const required=['db/roles.sql','db/schema.sql','db/data.sql','db/managed-customizations.sql','platform/restore-notes.md','storage/manifest.json','r2/manifest.json','github/manifest.json'];
const pathOK=p=>typeof p==='string'&&p.length<=500&&!/[\\\u0000-\u001f]/.test(p)&&!p.startsWith('/')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!s.includes(':')&&!s.includes('%'));
const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
const base64=b=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
const bytes=s=>{if(typeof s!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))throw Error('Invalid package encoding');return Uint8Array.from(atob(s),x=>x.charCodeAt(0));};
async function validate(files){
 if(!Array.isArray(files)||files.length>maxFiles)throw Error('Backup package file count is invalid');
 const seen=new Map();let total=0;
 for(const f of files){
  if(!pathOK(f.path)||seen.has(f.path)||!(f.bytes instanceof Uint8Array))throw Error('Unsafe or duplicate backup path');
  total+=f.bytes.length;if(total>maxBytes)throw Error('Initial backup package exceeds the 35 MiB safety limit');seen.set(f.path,f.bytes);
 }
 for(const name of required)if(!seen.has(name))throw Error('Missing required backup component: '+name);
 for(const component of ['storage','r2','github']){
  let m;try{m=JSON.parse(new TextDecoder().decode(seen.get(component+'/manifest.json')));}catch{throw Error('Invalid component inventory');}
  if(m.schema!==1||m.project_ref!==project||!Array.isArray(m.entries)||m.entries.length>maxFiles)throw Error('Wrong project or component inventory');
  const referenced=new Set();
  for(const entry of m.entries){
   if(!pathOK(entry.path)||entry.path==='manifest.json'||referenced.has(entry.path))throw Error('Unsafe or duplicate inventory path');
   const b=seen.get(component+'/'+entry.path);referenced.add(entry.path);
   if(!b||b.length!==entry.bytes||await hash(b)!==entry.sha256)throw Error('Backup inventory does not match the actual exported file bytes');
  }
  for(const path of seen.keys())if(path.startsWith(component+'/')&&path!==component+'/manifest.json'&&!referenced.has(path.slice(component.length+1)))throw Error('Untracked backup file is outside the component inventory');
 }
 return {file_count:seen.size,source_bytes:total};
}
export async function sealBackupPackage(files,key){
 const summary=await validate(files);
 const payload={schema:1,project_ref:project,created_at:new Date().toISOString(),files:files.map(f=>({path:f.path,bytes:base64(f.bytes)}))};
 const plaintext=new TextEncoder().encode(JSON.stringify(payload));
 const envelope=await encryptBackup(plaintext,key,scope);
 const restored=await openBackupPackage(envelope,key);
 if(restored.summary.file_count!==summary.file_count)throw Error('Encrypted package round-trip failed');
 return {envelope,summary:{...summary,encrypted_bytes:envelope.length,source_completeness_verified:false}};
}
export async function openBackupPackage(envelope,key){
 let p;try{p=JSON.parse(new TextDecoder().decode(await decryptBackup(envelope,key,scope)));}catch{throw Error('Backup authentication or package decoding failed');}
 if(p.schema!==1||p.project_ref!==project||!Array.isArray(p.files)||p.files.length>maxFiles)throw Error('Wrong backup project or package version');
 const files=p.files.map(f=>({path:f.path,bytes:bytes(f.bytes)}));
 return {files,summary:await validate(files)};
}
