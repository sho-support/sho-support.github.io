import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptBackup,decryptBackup} from '../src/backup-envelope.mjs';
test('encrypted backups restore exact bytes only under the intended key and customer scope',async()=>{
 const key=crypto.getRandomValues(new Uint8Array(32)),bytes=new TextEncoder().encode('synthetic customer data'),box=await encryptBackup(bytes,key,'customer:8100');
 assert.deepEqual(await decryptBackup(box,key,'customer:8100'),bytes);assert.ok(!new TextDecoder().decode(box).includes('synthetic customer data'));
 await assert.rejects(decryptBackup(box,crypto.getRandomValues(new Uint8Array(32)),'customer:8100'),/authentication failed/);
 await assert.rejects(decryptBackup(box,key,'customer:8101'),/authentication failed/);
 for(const at of [0,4,12,box.length-1]){const damaged=box.slice();damaged[at]^=1;await assert.rejects(decryptBackup(damaged,key,'customer:8100'),/authentication failed/);}
 await assert.rejects(decryptBackup(box.slice(0,35),key,'customer:8100'),/authentication failed/);
 const another=await encryptBackup(bytes,key,'customer:8100');assert.notDeepEqual(box,another,'Every archive needs a fresh random IV');
});
