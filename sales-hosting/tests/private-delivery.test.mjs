import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {sealPrivateDelivery,openPrivateDelivery,recipientFingerprint} from '../backup/private-delivery.mjs';
const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const source={project_ref:'tyhymvgjkoebetyypspj',source_commit:'a'.repeat(40),run_id:'12345678900'};
const payload=Buffer.from('synthetic database fixture only; not customer data');
test('the private payload is authenticated to the owner recovery key and exact project/run/source',()=>{
 const envelope=sealPrivateDelivery(payload,keys.publicKey,source);assert.ok(!envelope.toString().includes(payload.toString()));
 assert.deepEqual(openPrivateDelivery(envelope,keys.privateKey,source),payload);assert.match(recipientFingerprint(keys.publicKey),/^[a-f0-9]{64}$/);
 assert.throws(()=>openPrivateDelivery(envelope,keys.privateKey,{...source,run_id:'98765432100'}));
 assert.throws(()=>openPrivateDelivery(envelope,keys.privateKey,{...source,source_commit:'b'.repeat(40)}));
 assert.throws(()=>openPrivateDelivery(envelope,keys.privateKey,{...source,project_ref:'wrong'}));
});
test('realistic binary archive sizes and a different strong recovery key are handled safely',()=>{
 const large=Buffer.alloc(900*1024,0x5a),envelope=sealPrivateDelivery(large,keys.publicKey,source);
 assert.deepEqual(openPrivateDelivery(envelope,keys.privateKey,source),large);
 const other=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 assert.throws(()=>openPrivateDelivery(envelope,other.privateKey,source));
});
test('ciphertext, authentication tag, metadata tampering and extra fields cannot be accepted',()=>{
 const original=JSON.parse(sealPrivateDelivery(payload,keys.publicKey,source));
 for(const field of ['ciphertext','tag','iv']){
  const tampered=structuredClone(original);const b=Buffer.from(tampered[field],'base64');b[0]^=1;tampered[field]=b.toString('base64');
  assert.throws(()=>openPrivateDelivery(Buffer.from(JSON.stringify(tampered)),keys.privateKey,source));
 }
 for(const change of [o=>o.metadata.project_ref='anotherprojectxxxxx',o=>o.metadata.recipient_fingerprint='0'.repeat(64),o=>o.metadata.purpose='other',o=>o.extra='unexpected']){
  const o=structuredClone(original);change(o);assert.throws(()=>openPrivateDelivery(Buffer.from(JSON.stringify(o)),keys.privateKey,source));
 }
});
test('weak recipients, empty payloads, malformed encoding and wrong projects fail closed',()=>{
 const weak=generateKeyPairSync('rsa',{modulusLength:1024,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 assert.throws(()=>recipientFingerprint(weak.publicKey));assert.throws(()=>sealPrivateDelivery(Buffer.alloc(0),keys.publicKey,source));
 assert.throws(()=>sealPrivateDelivery(payload,keys.publicKey,{...source,project_ref:'wrong'}));
 const object=JSON.parse(sealPrivateDelivery(payload,keys.publicKey,source));object.wrapped_key='invalid!';
 assert.throws(()=>openPrivateDelivery(Buffer.from(JSON.stringify(object)),keys.privateKey,source));
});
test('assets and SQL envelopes have distinct authenticated purposes',()=>{
 const envelope=sealPrivateDelivery(payload,keys.publicKey,source,'assets');
 assert.deepEqual(openPrivateDelivery(envelope,keys.privateKey,source,'assets'),payload);
 assert.throws(()=>openPrivateDelivery(envelope,keys.privateKey,source));
 assert.throws(()=>sealPrivateDelivery(payload,keys.publicKey,source,'other'));
});
