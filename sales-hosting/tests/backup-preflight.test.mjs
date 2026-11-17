import test from 'node:test';
import assert from 'node:assert/strict';
import {backupConnectionOptions,checkBackupConnection,PROJECT} from '../backup/connection-preflight.mjs';
const password='synthetic-secret:@/?#%',host='aws-1-ap-northeast-1.pooler.supabase.com';
const uri=`postgresql://postgres.${PROJECT}:${encodeURIComponent(password)}@${host}:5432/postgres`;
const row={database_name:'postgres',postgres_version_num:'170011',transaction_read_only:'on',database_bytes:'13940403',hp_orders:'1',auth_users:'1',storage_objects:'9'};
function fixture({error,override={}}={}){
 const calls=[];let config;
 return {calls,get config(){return config;},createClient(value){config=value;return {on(){},async connect(){calls.push('connect');if(error)throw error;},async query(sql){calls.push(sql);return {rows:[{...row,...override}]};},async end(){calls.push('end');}};}};
}
test('only the fixed Tokyo session pooler and project are accepted; TLS and session read-only cannot be overridden by URI parameters',()=>{
 const c=backupConnectionOptions(uri+'?sslmode=disable&options=-c%20default_transaction_read_only%3Doff');
 assert.equal(c.password,password);assert.equal(c.host,host);assert.equal(c.port,5432);assert.equal(c.user,'postgres.'+PROJECT);
 assert.equal(c.ssl.rejectUnauthorized,true);assert.match(c.options,/default_transaction_read_only=on/);
 assert.throws(()=>backupConnectionOptions('postgresql://postgres:'+encodeURIComponent(password)+'@db.'+PROJECT+'.supabase.co:5432/postgres'));
 const separate=backupConnectionOptions(uri.replace(encodeURIComponent(password),'[YOUR-PASSWORD]'),password);assert.equal(separate.password,password);assert.equal(separate.ssl.rejectUnauthorized,true);
});
test('missing, malformed, placeholder and wrong-target settings never create a client',async()=>{
 for(const value of ['',null,'not-a-uri',uri.replace(host,'evil.invalid'),uri.replace(':5432/',':6543/'),uri.replace(PROJECT,'other-project'),uri.replace(/\/postgres$/,'/other'),uri.replace(encodeURIComponent(password),'[YOUR-PASSWORD]')]){
  const f=fixture();const result=await checkBackupConnection({value,createClient:f.createClient});assert.equal(result.ok,false);assert.equal(f.calls.length,0);
 }
});
test('a successful check reads only aggregate metadata inside a read-only transaction and always closes it',async()=>{
 const f=fixture(),result=await checkBackupConnection({value:uri,createClient:f.createClient});assert.equal(result.ok,true);assert.equal(result.read_only_transaction_verified,true);assert.equal(result.tls_certificate_verified,true);
 assert.equal(f.calls[1],'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.match(f.calls[2],/^select /);assert.deepEqual(f.calls.slice(-2),['ROLLBACK','end']);
 assert.equal(result.database_exported,false);assert.equal(result.restore_verified,false);assert.equal(result.configuration_changed,false);
 assert.ok(!JSON.stringify(result).includes(password));assert.ok(!JSON.stringify(result).includes(uri));assert.ok(!JSON.stringify(result).includes(host));
});
test('authentication, TLS and permission errors are sanitized and never retried or logged as successful backup',async()=>{
 for(const code of ['28P01','42501','SELF_SIGNED_CERT_IN_CHAIN','ECONNREFUSED','UNKNOWN']){
  const f=fixture({error:Object.assign(new Error('private '+uri),{code,safeCode:uri})});const result=await checkBackupConnection({value:uri,createClient:f.createClient});assert.equal(result.ok,false);assert.equal(result.connection_verified,false);assert.equal(f.calls.filter(x=>x==='connect').length,1);assert.deepEqual(f.calls.slice(-1),['end']);assert.ok(!JSON.stringify(result).includes(password));assert.ok(!JSON.stringify(result).includes(host));
 }
});
test('wrong database, unsupported engine or writable transactions cannot pass and are rolled back',async()=>{
 for(const override of [{database_name:'other'},{postgres_version_num:'180001'},{transaction_read_only:'off'},{storage_objects:'bad'}]){
  const f=fixture({override}),result=await checkBackupConnection({value:uri,createClient:f.createClient});assert.equal(result.ok,false);assert.deepEqual(f.calls.slice(-2),['ROLLBACK','end']);
 }
});
