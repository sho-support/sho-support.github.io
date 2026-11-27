const magic=new Uint8Array([83,72,79,49]),maxBytes=64*1024*1024;
const scopeOK=s=>typeof s==='string'&&/^[a-z0-9][a-z0-9:_-]{2,63}$/.test(s);
function validate(bytes,key,scope,limit=maxBytes){if(!(bytes instanceof Uint8Array)||bytes.length>limit||!(key instanceof Uint8Array)||key.length!==32||!scopeOK(scope))throw Error('Invalid encrypted backup input');}
export async function encryptBackup(bytes,key,scope){
 validate(bytes,key,scope);
 const iv=crypto.getRandomValues(new Uint8Array(12)),header=new TextEncoder().encode(JSON.stringify({version:1,scope}));
 const k=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']);
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:header,tagLength:128},k,bytes));
 const out=new Uint8Array(8+header.length+12+ciphertext.length);out.set(magic);new DataView(out.buffer).setUint32(4,header.length);out.set(header,8);out.set(iv,8+header.length);out.set(ciphertext,20+header.length);return out;
}
export async function decryptBackup(envelope,key,scope){
 try{
  validate(envelope,key,scope,maxBytes+512);if(envelope.length<40||!magic.every((b,i)=>envelope[i]===b))throw Error();
  const length=new DataView(envelope.buffer,envelope.byteOffset,envelope.byteLength).getUint32(4);if(length<1||length>256||envelope.length<length+36)throw Error();
  const header=envelope.slice(8,8+length),data=JSON.parse(new TextDecoder().decode(header));
  if(data.version!==1||data.scope!==scope||Object.keys(data).length!==2)throw Error();
  const iv=envelope.slice(8+length,20+length),k=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:header,tagLength:128},k,envelope.slice(20+length)));
 }catch{throw Error('Backup authentication failed; restore refused');}
}
