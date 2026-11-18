import test from 'node:test';
import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import {backupConnectionOptions,checkBackupConnection,PROJECT} from '../backup/connection-preflight.mjs';
import {checkBackupTemporaryAccess} from '../backup/temporary-access.mjs';
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
 const root=new X509Certificate(c.ssl.ca);assert.equal(root.ca,true);assert.equal(root.fingerprint256,'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
 assert.equal(c.ssl.checkServerIdentity,undefined);assert.equal(c.ssl.servername,undefined);
 assert.throws(()=>backupConnectionOptions('postgresql://postgres:'+encodeURIComponent(password)+'@db.'+PROJECT+'.supabase.co:5432/postgres'));
 const separate=backupConnectionOptions(uri.replace(encodeURIComponent(password),'[YOUR-PASSWORD]'),password);assert.equal(separate.password,password);assert.equal(separate.ssl.rejectUnauthorized,true);
});
test('missing, malformed, placeholder and wrong-target settings never create a client',async()=>{
 for(const value of ['',null,'not-a-uri',uri.replace(host,'evil.invalid'),uri.replace(':5432/',':6543/'),uri.replace(PROJECT,'other-project'),uri.replace(/\/postgres$/,'/other'),uri.replace(encodeURIComponent(password),'[YOUR-PASSWORD]'),uri.replace(encodeURIComponent(password),'[YOUR-DATABASE-PASSWORD]')]){
  const f=fixture();const result=await checkBackupConnection({value,createClient:f.createClient});assert.equal(result.ok,false);assert.equal(f.calls.length,0);
 }
});

const scopedToken='sbp_fc'+'synthetic_limited_token_value_12345';
const temporaryLogin={role:'cli_login_supabase_read_only_user',password:'synthetic-temporary-secret:/ @%',ttl_seconds:300};
const placeholderUri=uri.replace(encodeURIComponent(password),'[YOUR-DATABASE-PASSWORD]');
test('scoped token mints only a read-only temporary login for the fixed project; no root password or broad JIT changes',async()=>{
 const f=fixture(),calls=[];
 const proof=await checkBackupTemporaryAccess({value:placeholderUri,accessToken:scopedToken,createClient:f.createClient,request:async(url,options)=>{
  calls.push({url,options});return Response.json(temporaryLogin,{status:201});
 }});
 assert.equal(calls.length,1);assert.equal(calls[0].url,`https://api.supabase.com/v1/projects/${PROJECT}/cli/login-role`);
 assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.redirect,'error');assert.deepEqual(JSON.parse(calls[0].options.body),{read_only:true});
 assert.equal(f.config.user,temporaryLogin.role+'.'+PROJECT);assert.equal(f.config.password,temporaryLogin.password);assert.equal(f.config.ssl.rejectUnauthorized,true);
 assert.deepEqual(f.calls.slice(0,3),['connect','SET SESSION ROLE supabase_read_only_user','BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY']);
 assert.deepEqual(f.calls.slice(-2),['ROLLBACK','end']);assert.equal(proof.ok,true);assert.equal(proof.temporary_login_issued,true);
 assert.equal(proof.configuration_changed,true);assert.equal(proof.database_password_changed,false);assert.equal(proof.database_exported,false);assert.equal(proof.restore_verified,false);
 for(const secret of [scopedToken,temporaryLogin.password,password,placeholderUri,host])assert.ok(!JSON.stringify(proof).includes(secret));
});
test('wrong targets, unscoped tokens, redirects and provider errors fail closed without leaking credentials or retrying',async()=>{
 for(const opts of [{value:uri.replace(host,'evil.invalid')},{accessToken:'sbp_'+'legacy_full_access_example_value'}]){
  const f=fixture();let requests=0;const proof=await checkBackupTemporaryAccess({value:placeholderUri,accessToken:scopedToken,...opts,createClient:f.createClient,request:async()=>{requests++;throw Error('must not call');}});
  assert.equal(proof.ok,false);assert.equal(requests,0);assert.equal(f.calls.length,0);
 }
 for(const status of [302,401,403,429,500]){
  const f=fixture();let requests=0;const proof=await checkBackupTemporaryAccess({value:placeholderUri,accessToken:scopedToken,createClient:f.createClient,request:async()=>{
   requests++;return Response.json({private:scopedToken,password:temporaryLogin.password},{status,headers:{Location:'https://evil.invalid'}});
  }});
  assert.equal(requests,1);assert.equal(f.calls.length,0);assert.equal(proof.ok,false);assert.equal(proof.temporary_login_issued,false);
  assert.ok(!JSON.stringify(proof).includes(scopedToken));assert.ok(!JSON.stringify(proof).includes(temporaryLogin.password));
 }
});
test('temporary credential contract, lifetime and response size are checked before opening a database connection',async()=>{
 for(const login of [{...temporaryLogin,role:'cli_login_postgres'},{...temporaryLogin,password:''},{...temporaryLogin,ttl_seconds:0},{...temporaryLogin,ttl_seconds:86400},{...temporaryLogin,ttl_seconds:'300'},null]){
  const f=fixture();const proof=await checkBackupTemporaryAccess({value:uri,accessToken:scopedToken,createClient:f.createClient,request:async()=>Response.json(login,{status:201})});
  assert.equal(proof.ok,false);assert.equal(proof.temporary_login_issued,true);assert.equal(proof.configuration_changed,true);assert.equal(f.calls.length,0);
 }
 const f=fixture();const proof=await checkBackupTemporaryAccess({value:placeholderUri,accessToken:scopedToken,createClient:f.createClient,request:async()=>new Response('x'.repeat(17000),{status:201})});
 assert.equal(proof.ok,false);assert.equal(f.calls.length,0);
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
