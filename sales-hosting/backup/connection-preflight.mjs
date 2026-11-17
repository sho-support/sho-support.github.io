export const PROJECT='tyhymvgjkoebetyypspj';
const fail=code=>Object.assign(new Error(code),{safeCode:code});
const safeCodes=new Set(['BACKUP_CONNECTION_NOT_CONFIGURED','INVALID_BACKUP_CONNECTION','FIXED_SESSION_POOLER_REQUIRED','DATABASE_PASSWORD_REQUIRED','DATABASE_IDENTITY_NOT_VERIFIED','INVALID_COUNT_RESPONSE']);

export function backupConnectionOptions(value,passwordValue){
 if(typeof value!=='string'||!value.trim())throw fail('BACKUP_CONNECTION_NOT_CONFIGURED');
 if(value.length>16000)throw fail('INVALID_BACKUP_CONNECTION');
 let u,user,password;try{u=new URL(value.trim());user=decodeURIComponent(u.username);password=decodeURIComponent(u.password);}catch{throw fail('INVALID_BACKUP_CONNECTION');}
 if(!['postgres:','postgresql:'].includes(u.protocol)||user!=='postgres.'+PROJECT
  ||!/^aws-[0-9]+-ap-northeast-1\.pooler\.supabase\.com$/.test(u.hostname)
  ||u.port!=='5432'||u.pathname!=='/postgres'||u.hash)throw fail('FIXED_SESSION_POOLER_REQUIRED');
 if(typeof passwordValue==='string'&&passwordValue.length)password=passwordValue;
 if(!password||/\[(?:YOUR[-_]PASSWORD|password)\]/i.test(password))throw fail('DATABASE_PASSWORD_REQUIRED');
 return {host:u.hostname,port:5432,database:'postgres',user,password,
  ssl:{rejectUnauthorized:true},application_name:'hp-backup-connection-preflight',
  connectionTimeoutMillis:10000,query_timeout:15000,
  options:'-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000'};
}

const SQL=`select current_database() as database_name,
 current_setting('server_version_num') as postgres_version_num,
 current_setting('transaction_read_only') as transaction_read_only,
 pg_database_size(current_database()) as database_bytes,
 (select count(*) from public.website_orders) as hp_orders,
 (select count(*) from auth.users) as auth_users,
 (select count(*) from storage.objects) as storage_objects;`;

export async function checkBackupConnection({value,passwordValue,createClient}){
 const proof={ok:false,purpose:'hp-backup-connection-only',project_ref:PROJECT,
  connection_verified:false,tls_certificate_verified:false,read_only_transaction_verified:false,
  database_exported:false,restore_verified:false,configuration_changed:false};
 let client,began=false;
 try{
  const config=backupConnectionOptions(value,passwordValue);client=createClient(config);client.on?.('error',()=>{});
  await client.connect();proof.connection_verified=true;proof.tls_certificate_verified=true;
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');began=true;
  const {rows}=await client.query(SQL),row=rows?.[0];
  if(row?.database_name!=='postgres'||row.transaction_read_only!=='on'||!/^17[0-9]{4}$/.test(String(row.postgres_version_num)))throw fail('DATABASE_IDENTITY_NOT_VERIFIED');
  const counts=Object.fromEntries(['database_bytes','hp_orders','auth_users','storage_objects'].map(k=>[k,Number(row[k])]));
  if(Object.values(counts).some(x=>!Number.isSafeInteger(x)||x<0))throw fail('INVALID_COUNT_RESPONSE');
  proof.read_only_transaction_verified=true;proof.postgres_major=17;proof.counts=counts;proof.ok=true;
 }catch(error){
  proof.reason=(safeCodes.has(error?.safeCode)?error.safeCode:null)||({'28P01':'DATABASE_AUTHENTICATION_FAILED','28000':'DATABASE_AUTHENTICATION_FAILED',
   '42501':'BACKUP_READ_PERMISSION_MISSING','ENOTFOUND':'POOLER_HOST_NOT_REACHABLE','EHOSTUNREACH':'POOLER_HOST_NOT_REACHABLE',
   'ECONNREFUSED':'POOLER_HOST_NOT_REACHABLE','ETIMEDOUT':'CONNECTION_TIMED_OUT','CERT_HAS_EXPIRED':'TLS_CERTIFICATE_NOT_VERIFIED',
   'DEPTH_ZERO_SELF_SIGNED_CERT':'TLS_CERTIFICATE_NOT_VERIFIED','UNABLE_TO_VERIFY_LEAF_SIGNATURE':'TLS_CERTIFICATE_NOT_VERIFIED',
   'SELF_SIGNED_CERT_IN_CHAIN':'TLS_CERTIFICATE_NOT_VERIFIED'})[error?.code]||'BACKUP_CONNECTION_NOT_VERIFIED';
 }finally{
  if(began)try{await client.query('ROLLBACK');}catch{proof.ok=false;proof.reason='READ_ONLY_TRANSACTION_NOT_CLOSED';}
  if(client)try{await client.end();}catch{proof.ok=false;proof.reason='DATABASE_CONNECTION_NOT_CLOSED';}
 }
 return proof;
}
