import {createPublicKey,createPrivateKey,createHash,randomBytes,publicEncrypt,privateDecrypt,createCipheriv,createDecipheriv,constants} from 'node:crypto';
import {Buffer} from 'node:buffer';
const project='tyhymvgjkoebetyypspj';
const maxPayload=48*1024*1024;
const hash=b=>createHash('sha256').update(b).digest('hex');
export function recipientFingerprint(pem){
 const key=createPublicKey(pem);if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<3072)throw Error('Invalid recovery recipient');
 return hash(key.export({format:'der',type:'spki'}));
}
function context(value,fingerprint,kind){
 if(!['sql','assets'].includes(kind))throw Error('Invalid private backup component');
 const purpose=kind==='sql'?'sho-hp-private-sql-backup-v1':'sho-hp-private-assets-backup-v1';
 if(value?.project_ref!==project||!/^\d{8,20}$/.test(value.run_id||'')||!/^[a-f0-9]{40}$/.test(value.source_commit||'')||!/^[a-f0-9]{64}$/.test(fingerprint))throw Error('Invalid recovery context');
 return {schema:1,purpose,project_ref:project,source_commit:value.source_commit,run_id:value.run_id,recipient_fingerprint:fingerprint};
}
export function sealPrivateDelivery(payload,recipientPem,source,kind='sql'){
 if(!(payload instanceof Uint8Array)||payload.length===0||payload.length>maxPayload)throw Error('Invalid private backup size');
 const metadata=context(source,recipientFingerprint(recipientPem),kind),key=randomBytes(32),iv=randomBytes(12);
 try{
  const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  const ciphertext=Buffer.concat([cipher.update(payload),cipher.final()]);
  const wrapped=publicEncrypt({key:recipientPem,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
  return Buffer.from(JSON.stringify({metadata,wrapped_key:wrapped.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}));
 }finally{key.fill(0);}
}
function bytes(value,max){
 if(typeof value!=='string'||value.length>max||value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('Invalid private backup encoding');
 const decoded=Buffer.from(value,'base64');if(decoded.toString('base64')!==value)throw Error('Noncanonical private backup encoding');return decoded;
}
export function openPrivateDelivery(envelope,privatePem,expected,kind='sql'){
 let key;
 try{
  if(!(envelope instanceof Uint8Array)||envelope.length>70*1024*1024)throw Error('Invalid private backup size');
  const object=JSON.parse(Buffer.from(envelope).toString());
  if(Object.keys(object).sort().join(',')!=='ciphertext,iv,metadata,tag,wrapped_key')throw Error('Invalid private backup fields');
  const privateKey=createPrivateKey(privatePem),fp=recipientFingerprint(createPublicKey(privateKey).export({format:'pem',type:'spki'}));
  const metadata=context(object.metadata,fp,kind);
  if(JSON.stringify(metadata)!==JSON.stringify(object.metadata)||(expected.project_ref!==undefined&&expected.project_ref!==project)||metadata.source_commit!==expected.source_commit||metadata.run_id!==expected.run_id)throw Error('Wrong private backup context');
  key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},bytes(object.wrapped_key,2048));
  const iv=bytes(object.iv,32),tag=bytes(object.tag,32),ciphertext=bytes(object.ciphertext,64*1024*1024);
  if(key.length!==32||iv.length!==12||tag.length!==16||ciphertext.length===0||ciphertext.length>maxPayload)throw Error('Invalid private backup parameters');
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from(JSON.stringify(metadata)));decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext),decipher.final()]);
 }catch{throw Error('Private backup identity, context or authentication was not verified');}
 finally{key?.fill(0);}
}
