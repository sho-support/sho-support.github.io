// A disposable SQL restore rehearsal, optionally sealed for the owner's backup.
// Real rows and SQL stay private; optional delivery writes only a new encrypted
// owner-only Large Object. No application writes, public artifacts or cutover.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {PROJECT,backupConnectionOptions} from './backup/connection-preflight.mjs';
import {rolesForIsolatedSupabase} from './backup/restore-roles.mjs';
import {sealPrivateDelivery,recipientFingerprint} from './backup/private-delivery.mjs';
import {extensionSecurityRestore} from './backup/restore-extension-security.mjs';

// Official Supabase Docker Hub release 17.12.0.000, immutable manifest digest.
// Same PostgreSQL major as the hosted source; no production upgrade is made.
const run=promisify(execFile),image='supabase/postgres@sha256:8630950b489ecc70563300180287a98c192a4a48f5ae00b4febdaeea1abe85de';
const require=createRequire(new URL('../customer-hosting-v2/package.json',import.meta.url)),{Client}=require('pg');
const hash=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>'"'+String(x).replaceAll('"','""')+'"';
const fail=code=>Object.assign(new Error(code),{safeCode:code});
const extensionSecuritySql=`select coalesce(jsonb_agg(to_jsonb(m) order by m.schema collate "C",m.name collate "C"),'[]'::jsonb)::text as value from (
 select n.nspname as schema,c.relname as name,e.extname as extension,c.relkind as kind,pg_get_userbyid(c.relowner) as owner,c.relacl is not null as acl_present,
  coalesce((select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(c.relacl) a),'[]'::jsonb) as grants
 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_depend d on d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e' and d.refclassid='pg_extension'::regclass
 join pg_extension e on e.oid=d.refobjid where c.relkind in ('r','v','S') and n.nspname not like 'pg_%') m`;
const metadataSql={
 sequences:"select coalesce(jsonb_agg(to_jsonb(s) order by s.schemaname collate \"C\",s.sequencename collate \"C\"),'[]'::jsonb)::text as value from pg_sequences s",
 grants:`select coalesce(jsonb_agg(to_jsonb(m) order by m.schema collate "C",m.name collate "C"),'[]'::jsonb)::text as value from (
  select n.nspname as schema,c.relname as name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) as owner,
   (select array_agg(a::text order by a::text collate "C") from unnest(c.relacl) a) as acl
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and c.relkind in ('r','p','v','m','S','f')) m`,
 routines:`select coalesce(jsonb_agg(to_jsonb(m) order by m.schema collate "C",m.name collate "C",m.arguments collate "C"),'[]'::jsonb)::text as value from (
  select n.nspname as schema,p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments,pg_get_userbyid(p.proowner) as owner,p.prosecdef,
   (select array_agg(a::text order by a::text collate "C") from unnest(p.proacl) a) as acl,pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','band_private','website_internal') and p.prokind in ('f','p','w')
   and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')) m`,
 triggers:`select coalesce(jsonb_agg(to_jsonb(m) order by m.schema collate "C",m.table_name collate "C",m.name collate "C"),'[]'::jsonb)::text as value from (
  select n.nspname as schema,c.relname as table_name,t.tgname as name,t.tgenabled,pg_get_triggerdef(t.oid) as definition from pg_trigger t
  join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname not like 'pg_%') m`
};
const proof={ok:false,purpose:'actual-sql-snapshot-empty-restore-only',project_ref:PROJECT,
 source_commit:process.env.GITHUB_SHA,run_id:process.env.GITHUB_RUN_ID,
 temporary_login_issued:false,tls_certificate_verified:false,source_read_only_verified:false,
 source_database_changed:false,database_password_changed:false,sql_snapshot_exported:false,
 sql_encryption_round_trip_verified:false,sql_empty_restore_verified:false,table_data_match:false,
 backup_retained:false,off_provider_backup_preserved:false,storage_file_bytes_restored:false,
 r2_restored:false,auth_service_login_verified:false,production_cutover:false,cleanup_verified:false};
let stage='context',dir,client,transaction=false,target,sourceKey;
async function command(file,args,options={}){
 try{return await run(file,args,{timeout:120000,maxBuffer:64*1024*1024,encoding:'buffer',...options});}
 catch(error){
  const detail=String(error?.stderr||'');
  proof.command_failure_category=[[/manifest unknown|not found: manifest|no matching manifest/i,'IMAGE_NOT_AVAILABLE'],[/permission denied/i,'PERMISSION_DENIED'],[/could not access file|extension .* is not available/i,'EXTENSION_NOT_AVAILABLE'],[/already exists/i,'DUPLICATE_OBJECT'],[/could not translate host name|network is unreachable/i,'NETWORK_UNAVAILABLE'],[/No such file or directory|not found in \$PATH|executable file not found/i,'EXECUTABLE_OR_FILE_MISSING']].find(([pattern])=>pattern.test(detail))?.[1]||'PRIVATE_COMMAND_ERROR';
  const specific=[[/permission denied to grant role/i,'ROLE_GRANT_NOT_ALLOWED'],[/permission denied to set role/i,'ROLE_SWITCH_NOT_ALLOWED'],[/permission denied for schema/i,'SCHEMA_PERMISSION_DENIED'],[/permission denied for table/i,'TABLE_PERMISSION_DENIED'],[/permission denied to create extension/i,'EXTENSION_CREATE_NOT_ALLOWED'],[/must be owner/i,'OBJECT_OWNERSHIP_NOT_ALLOWED'],[/must be superuser/i,'SUPERUSER_REQUIRED']].find(([pattern])=>pattern.test(detail));
  if(specific)proof.private_command_diagnostic=specific[1];
  const archiveIssue=[[/shared_preload_libraries/i,'EXTENSION_PRELOAD_REQUIRED'],[/could not load library|could not open extension control file/i,'EXTENSION_LIBRARY_MISSING'],[/unrecognized configuration parameter/i,'UNSUPPORTED_CONFIGURATION'],[/type .* does not exist/i,'TYPE_MISSING'],[/function .* does not exist/i,'FUNCTION_MISSING'],[/schema .* does not exist/i,'SCHEMA_MISSING'],[/column .* does not exist/i,'COLUMN_MISSING'],[/syntax error/i,'SQL_SYNTAX_NOT_ACCEPTED']].find(([pattern])=>pattern.test(detail));
  if(archiveIssue)proof.private_command_diagnostic=archiveIssue[1];
  const sqlState=detail.match(/ERROR:\s+([0-9A-Z]{5}):/);if(sqlState)proof.postgres_sqlstate=sqlState[1];
  const restoreLine=detail.match(/restore\.sql:(\d+):\s*ERROR:/);if(restoreLine)proof.restore_error_line=Number(restoreLine[1]);
  const entry=detail.match(/from TOC entry \d+; \d+ \d+ ([A-Z ]+)/);if(entry)proof.restore_entry_kind=entry[1].trim();
  const role=detail.match(/role "(postgres|supabase_admin|supabase_read_only_user|supabase_auth_admin|supabase_storage_admin|cli_login_postgres|cli_login_supabase_read_only_user)"/);if(role)proof.failed_managed_role=role[1];
  throw fail('COMMAND_NOT_VERIFIED');
 }
}
// execFile does not supply stdin; use a fixed private file for target SQL.
let queryNumber=0;
async function queryTarget(sql){
 const name='query-'+(++queryNumber)+'.sql',path=join(dir,name);
 await writeFile(path,"SET TIMEZONE='UTC';\nSET search_path=pg_catalog;\n"+sql,{mode:0o600,flag:'wx'});
 try{
  await command('docker',['cp',path,target+':/tmp/'+name]);
  await command('docker',['exec','--user','0',target,'chown','postgres:postgres','/tmp/'+name]);
  return (await command('docker',['exec',target,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-f','/tmp/'+name])).stdout.toString();
 }finally{await rm(path,{force:true});}
}
async function fingerprints(query){
 const tables=await query("select schemaname,tablename from pg_tables where schemaname not like 'pg_%' and schemaname <> 'information_schema' order by schemaname,tablename");
 const result=[];
 for(const {schemaname,tablename} of tables){
  const name=quote(schemaname)+'.'+quote(tablename);
  const [row]=await query(`select count(*)::text as row_count, coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text collate "C"),'[]'::jsonb)::text as content from ${name} r`);
  if(typeof row?.content!=='string'||Buffer.byteLength(row.content)>35*1024*1024)throw fail('TABLE_SNAPSHOT_LIMIT');
  result.push({schema:schemaname,table:tablename,count:row.row_count,digest:hash(row.content)});
 }
 return result.sort((a,b)=>{const x=a.schema+'.'+a.table,y=b.schema+'.'+b.table;return x<y?-1:x>y?1:0;});
}
try{
 if(process.env.GITHUB_REPOSITORY!=='sho-support/sho-support.github.io'||process.env.GITHUB_REF!=='refs/heads/architecture/sales-cloudflare'
  ||process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw fail('FIXED_CI_CONTEXT_REQUIRED');
 const value=process.env.SUPABASE_BACKUP_DB_URL,token=process.env.SUPABASE_BACKUP_ACCESS_TOKEN;
 const base=backupConnectionOptions(value,'not-used-for-connection');
 if(typeof token!=='string'||!/^sbp_fc[A-Za-z0-9_-]{16,4090}$/.test(token))throw fail('SCOPED_TOKEN_REQUIRED');
 dir=await mkdtemp(join(tmpdir(),'sho-hp-sql-restore-'));await mkdir(join(dir,'private'),{mode:0o700});
 stage='restore-image';await command('docker',['pull',image],{timeout:300000});
 proof.restore_image=image;
 proof.restore_image_id=(await command('docker',['image','inspect',image,'--format','{{.Id}}'])).stdout.toString().trim();
 if(!/^sha256:[a-f0-9]{64}$/.test(proof.restore_image_id))throw fail('IMAGE_ID_NOT_VERIFIED');
 stage='isolated-target';target='sho-hp-restore-'+process.env.GITHUB_RUN_ID;
 // No TCP port, external network, production service key or production password.
 const startup='set -euo pipefail; initdb -D /tmp/hp-empty-pg --username=supabase_admin --auth=trust >/tmp/hp-init.log 2>&1; exec postgres -D /tmp/hp-empty-pg -c listen_addresses= -c shared_preload_libraries=pg_net,pg_stat_statements -c pg_net.database_name=template1 -c log_statement=none -c log_min_error_statement=panic';
 await command('docker',['run','-d','--network','none','--user','postgres','--name',target,'--label','sho.hp.sql-restore-run='+process.env.GITHUB_RUN_ID,'--entrypoint','/bin/bash',image,'-c',startup]);
 let ready=false;
 for(let i=0;i<40;i++){
  try{await command('docker',['exec',target,'pg_isready','-U','supabase_admin','-d','postgres'],{timeout:3000});ready=true;break;}catch{}
  await new Promise(r=>setTimeout(r,500));
 }
 if(!ready)throw fail('EMPTY_TARGET_NOT_READY');
 delete proof.command_failure_category;
 const empty=await queryTarget("select count(*) from pg_tables where schemaname not like 'pg_%' and schemaname <> 'information_schema';");
 if(empty.trim()!=='0')throw fail('TARGET_NOT_EMPTY');
 const superuser=await queryTarget('select rolsuper::text from pg_roles where rolname=current_user;');
 if(superuser.trim()!=='true')throw fail('TARGET_BOOTSTRAP_SUPERUSER_REQUIRED');
 proof.target_bootstrap_superuser_verified=true;
 proof.empty_target_verified=true;proof.target_network_isolated=true;
 stage='temporary-source-login';
 // Match Supabase CLI's temporary login for pg_dump, while forcing every
 // source session/transaction read-only. Never change the postgres password.
 const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/cli/login-role`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({read_only:false})});
 if(response.status!==201){await response.body?.cancel();throw fail('TEMPORARY_SOURCE_LOGIN_NOT_ISSUED');}
 proof.temporary_login_issued=true;proof.temporary_login_access='cli-postgres-with-read-only-source-sessions';
 const text=await response.text();if(text.length>16384)throw fail('INVALID_LOGIN_RESPONSE');
 const login=JSON.parse(text);
 if(login?.role!=='cli_login_postgres'||typeof login.password!=='string'||!login.password.length||login.password.length>4096||/[\r\n\0]/.test(login.password)
  ||!Number.isSafeInteger(login.ttl_seconds)||login.ttl_seconds<60||login.ttl_seconds>3600)throw fail('INVALID_LOGIN_RESPONSE');
 const config={...base,user:login.role+'.'+PROJECT,password:login.password,query_timeout:90000,
  options:'-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000'};
 stage='source-connect';
 client=new Client(config);client.on('error',()=>{});await client.connect();proof.tls_certificate_verified=true;
 stage='source-role';
 await client.query('SET SESSION ROLE postgres');
 await client.query("SET TIMEZONE='UTC'");
 await client.query('SET search_path=pg_catalog');
 stage='source-transaction';
 await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');transaction=true;
 const identity=(await client.query("select current_database() as db, current_setting('server_version_num') as version, current_setting('transaction_read_only') as readonly")).rows[0];
 if(identity?.db!=='postgres'||identity.readonly!=='on'||!/^17[0-9]{4}$/.test(String(identity.version)))throw fail('SOURCE_IDENTITY_NOT_VERIFIED');
 proof.source_read_only_verified=true;
 const snapshot=(await client.query('select pg_export_snapshot() as snapshot')).rows[0]?.snapshot;
 if(!/^[0-9A-Fa-f-]{10,80}$/.test(snapshot||''))throw fail('INVALID_SOURCE_SNAPSHOT');
 stage='source-fingerprints';
 const sourceRows=await fingerprints(async sql=>(await client.query(sql)).rows);
 proof.source_table_count=sourceRows.length;
 const sourceLayout=(await client.query("select coalesce(jsonb_agg(to_jsonb(t) order by t.schemaname,t.tablename),'[]'::jsonb)::text as layout from (select schemaname,tablename,tableowner,rowsecurity from pg_tables where schemaname not like 'pg_%' and schemaname <> 'information_schema') t")).rows[0].layout;
 const sourcePolicies=(await client.query("select coalesce(jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname),'[]'::jsonb)::text as policies from pg_policies p")).rows[0].policies;
 const sourceMetadata={};for(const [kind,sql] of Object.entries(metadataSql))sourceMetadata[kind]=(await client.query(sql)).rows[0].value;
 const extensionSecurity=JSON.parse((await client.query(extensionSecuritySql)).rows[0].value);
 const supplementalSequences=(await client.query(`select s.schemaname,s.sequencename,s.last_value::text as last_value from pg_sequences s
  join pg_namespace n on n.nspname=s.schemaname join pg_class c on c.relnamespace=n.oid and c.relname=s.sequencename and c.relkind='S'
  join pg_depend d on d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e' and d.refclassid='pg_extension'::regclass
  join pg_extension e on e.oid=d.refobjid where e.extname='pg_net' and n.nspname='net' and not(c.oid=any(coalesce(e.extconfig,array[]::oid[])))
  order by s.schemaname,s.sequencename`)).rows;
 const responseCacheOwned=(await client.query("select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_depend d on d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e' join pg_extension e on e.oid=d.refobjid and d.refclassid='pg_extension'::regclass where n.nspname='net' and c.relname='_http_response' and e.extname='pg_net') as expected")).rows[0].expected;
 if(responseCacheOwned!==true)throw fail('UNEXPECTED_RESPONSE_CACHE_OWNERSHIP');
 stage='sql-snapshot';
 const ca=resolve('sales-hosting/backup/supabase-root-2021.crt'),envFile=join(dir,'private','source.env');
 await writeFile(envFile,[`PGHOST=${config.host}`,'PGPORT=5432',`PGUSER=${config.user}`,`PGPASSWORD=${config.password}`,'PGDATABASE=postgres','PGSSLMODE=verify-full','PGSSLROOTCERT=/hp-root.crt',
  'PGCONNECT_TIMEOUT=10','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000'].join('\n')+'\n',{mode:0o600,flag:'wx'});
 const sourceArgs=['run','--rm','--network','host','--label','sho.hp.sql-restore-run='+process.env.GITHUB_RUN_ID,'--env-file',envFile,'-v',ca+':/hp-root.crt:ro'];
 stage='export-db-snapshot';
 const archive=(await command('docker',[...sourceArgs,'--entrypoint','pg_dump',image,'--format=custom','--quote-all-identifiers','--role=postgres','--snapshot='+snapshot],{timeout:180000})).stdout;
 stage='export-roles';
 const rawRoles=(await command('docker',[...sourceArgs,'--entrypoint','pg_dumpall',image,'--roles-only','--no-role-passwords','--role=postgres'],{timeout:60000})).stdout;
 const roleExport=rolesForIsolatedSupabase(rawRoles.toString()),roles=Buffer.from(roleExport.text);proof.ephemeral_cli_role_statements_excluded=roleExport.excluded;proof.bootstrap_role_create_already_satisfied=roleExport.bootstrap_create_already_satisfied;
 if(archive.length<100||archive.length>35*1024*1024||roles.length<100||roles.length>1024*1024)throw fail('SQL_EXPORT_LIMIT');
 proof.sql_snapshot_exported=true;proof.archive_bytes=archive.length;proof.roles_bytes=roles.length;
 await rm(envFile,{force:true});
 await client.query('ROLLBACK');transaction=false;await client.end();client=undefined;
 stage='private-encryption-round-trip';
 sourceKey=randomBytes(32);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',sourceKey,iv);
 const payload=Buffer.from(JSON.stringify({archive:archive.toString('base64'),roles:roles.toString('base64')}));
 const ciphertext=Buffer.concat([cipher.update(payload),cipher.final()]),tag=cipher.getAuthTag();
 await writeFile(join(dir,'private','sql-rehearsal.enc'),Buffer.concat([iv,tag,ciphertext]),{mode:0o600,flag:'wx'});
 const stored=await readFile(join(dir,'private','sql-rehearsal.enc')),decipher=createDecipheriv('aes-256-gcm',sourceKey,stored.subarray(0,12));decipher.setAuthTag(stored.subarray(12,28));
 const opened=JSON.parse(Buffer.concat([decipher.update(stored.subarray(28)),decipher.final()]).toString());
 const restoredArchive=Buffer.from(opened.archive,'base64'),restoredRoles=Buffer.from(opened.roles,'base64');
 if(hash(restoredArchive)!==hash(archive)||hash(restoredRoles)!==hash(roles))throw fail('ENCRYPTION_ROUND_TRIP_NOT_VERIFIED');
 proof.sql_encryption_round_trip_verified=true;
 const archivePath=join(dir,'private','restore.dump'),rolesPath=join(dir,'private','roles.sql');
 await writeFile(archivePath,restoredArchive,{mode:0o600,flag:'wx'});await writeFile(rolesPath,restoredRoles,{mode:0o600,flag:'wx'});
 await command('docker',['cp',archivePath,target+':/tmp/restore.dump']);await command('docker',['cp',rolesPath,target+':/tmp/roles.sql']);
 await command('docker',['exec','--user','0',target,'chown','postgres:postgres','/tmp/restore.dump','/tmp/roles.sql']);
 stage='restore-roles';
 await command('docker',['exec',target,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-f','/tmp/roles.sql']);
 stage='restore-archive';
 await command('docker',['exec',target,'pg_restore','--no-tablespaces','--file=/tmp/restore.sql','/tmp/restore.dump'],{timeout:180000});
 await command('docker',['exec',target,'psql','-X','-q','--single-transaction','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','supabase_admin','-d','postgres','-f','/tmp/restore.sql'],{timeout:180000});
 proof.sql_empty_restore_verified=true;
 stage='extension-relation-security';
 const restoredExtensionSecurity=JSON.parse(JSON.parse((await queryTarget(`select coalesce(jsonb_agg(to_jsonb(hp_row)),'[]'::jsonb)::text from (${extensionSecuritySql}) hp_row;`)).trim())[0].value);
 const extensionSecuritySqlRestore=extensionSecurityRestore(extensionSecurity,restoredExtensionSecurity);
 await queryTarget(extensionSecuritySqlRestore);
 proof.extension_relation_security_supplemented=extensionSecurity.length;
 stage='extension-sequence-state';
 for(const sequence of supplementalSequences){
  if(sequence.schemaname!=='net'||!/^[-]?[0-9]{1,20}$/.test(sequence.last_value||'')){
   if(sequence.last_value===null)continue;throw fail('INVALID_EXTENSION_SEQUENCE_STATE');
  }
  const qualified=quote(sequence.schemaname)+'.'+quote(sequence.sequencename);
  await queryTarget("select pg_catalog.setval('"+qualified.replaceAll("'","''")+"'::regclass,'"+sequence.last_value+"'::bigint,true);");
 }
 proof.extension_sequence_states_supplemented=supplementalSequences.filter(s=>s.last_value!==null).length;
 stage='restored-fingerprints';
 const targetQuery=async sql=>JSON.parse((await queryTarget(`select coalesce(jsonb_agg(to_jsonb(hp_row)),'[]'::jsonb)::text from (${sql}) hp_row;`)).trim());
 const targetRows=await fingerprints(targetQuery);
 // pg_dump does not copy non-configuration extension tables. pg_net's HTTP
 // response cache has a documented TTL and is recreated empty; do not replay it.
 const cache=targetRows.find(t=>t.schema==='net'&&t.table==='_http_response');
 if(cache?.count!=='0')throw fail('UNEXPECTED_RESTORED_RESPONSE_CACHE');
 const durable=rows=>rows.filter(t=>t.schema!=='net'||t.table!=='_http_response');
 const sourceDurable=durable(sourceRows),targetDurable=durable(targetRows);
 proof.comparison_scope='durable_sql_tables_except_pg_net_http_response_cache';proof.durable_source_table_count=sourceDurable.length;
 proof.non_durable_cache_exclusions=[{schema:'net',table:'_http_response',source_rows:sourceRows.find(t=>t.schema==='net'&&t.table==='_http_response')?.count,restored_rows:cache.count,reason:'pg_net_ttl_response_cache'}];
 if(JSON.stringify(targetDurable)!==JSON.stringify(sourceDurable)){
  proof.table_data_differences=sourceDurable.flatMap(s=>{const t=targetDurable.find(x=>x.schema===s.schema&&x.table===s.table);return !t||t.count!==s.count||t.digest!==s.digest?[{schema:s.schema,table:s.table,source_rows:s.count,restored_rows:t?.count??null,kind:!t?'missing':t.count!==s.count?'count':'content'}]:[];});
  proof.unexpected_restored_tables=targetRows.filter(t=>!sourceRows.some(s=>s.schema===t.schema&&s.table===t.table)).map(t=>({schema:t.schema,table:t.table}));
  throw fail('RESTORED_TABLE_DATA_MISMATCH');
 }
 proof.table_data_match=true;
 const layout=(await targetQuery("select coalesce(jsonb_agg(to_jsonb(t) order by t.schemaname,t.tablename),'[]'::jsonb)::text as layout from (select schemaname,tablename,tableowner,rowsecurity from pg_tables where schemaname not like 'pg_%' and schemaname <> 'information_schema') t"))[0].layout;
 const policies=(await targetQuery("select coalesce(jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname),'[]'::jsonb)::text as policies from pg_policies p"))[0].policies;
 if(layout!==sourceLayout||policies!==sourcePolicies)throw fail('RESTORED_OWNERS_OR_RLS_MISMATCH');
 for(const [kind,sql] of Object.entries(metadataSql)){
  const restored=(await targetQuery(sql))[0].value;
  if(restored!==sourceMetadata[kind]){
   proof.metadata_mismatch=kind;
   const expected=JSON.parse(sourceMetadata[kind]),actual=JSON.parse(restored),key=r=>[r.schema,r.name,r.arguments||r.table_name||''].join('.');
   proof.metadata_difference_fields=expected.flatMap(s=>{const t=actual.find(x=>key(x)===key(s));return !t?[{schema:s.schema,name:s.name,fields:['missing']}]:Object.keys(s).some(k=>JSON.stringify(s[k])!==JSON.stringify(t[k]))?[{schema:s.schema,name:s.name,fields:Object.keys(s).filter(k=>JSON.stringify(s[k])!==JSON.stringify(t[k]))}]:[];});
   throw fail('RESTORED_SECURITY_METADATA_MISMATCH');
  }
  proof[kind+'_match']=true;
 }
 proof.table_owners_and_rls_match=true;
 if(process.env.HP_SQL_BACKUP_RETAIN==='true'){
  stage='private-owner-delivery';
  const recipient=await readFile(new URL('./backup/recovery-recipient.pem',import.meta.url),'utf8');
  const fingerprint=recipientFingerprint(recipient);
  if(fingerprint!=='88a0dc3d153b25ad499b646014d28aea55348c9fb575017097e0bbdb8f3910e3')throw fail('RECOVERY_RECIPIENT_NOT_VERIFIED');
  const ownerPayload=Buffer.from(JSON.stringify({schema:1,kind:'database-snapshot',project_ref:PROJECT,created_at:new Date().toISOString(),source_commit:process.env.GITHUB_SHA,run_id:process.env.GITHUB_RUN_ID,
   archive:archive.toString('base64'),roles:roles.toString('base64'),archive_sha256:hash(archive),roles_sha256:hash(roles),managed_sequences:supplementalSequences,extension_relation_security:extensionSecurity,extension_relation_security_sql:extensionSecuritySqlRestore,
   source_table_fingerprints:sourceRows,source_security_metadata:sourceMetadata,verification:{...proof}}));
  const sealed=sealPrivateDelivery(ownerPayload,recipient,{project_ref:PROJECT,source_commit:process.env.GITHUB_SHA,run_id:process.env.GITHUB_RUN_ID});
  if(sealed.length>70*1024*1024)throw fail('PRIVATE_DELIVERY_LIMIT');
  const writer=new Client({...config,options:'-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000'});writer.on('error',()=>{});let writing=false;
  try{
   await writer.connect();await writer.query('SET SESSION ROLE postgres');await writer.query('BEGIN READ WRITE');writing=true;
   // Only a new opaque encrypted database object is written. No application
   // table, schema, service configuration or pre-existing object is modified.
   const oid=Number((await writer.query('select pg_catalog.lo_from_bytea(0,$1) as oid',[sealed])).rows[0]?.oid);
   if(!Number.isInteger(oid)||oid<16384||oid>4294967295)throw fail('INVALID_DELIVERY_OBJECT');
   await writer.query(`REVOKE ALL ON LARGE OBJECT ${oid} FROM PUBLIC,anon,authenticated,authenticator,service_role,supabase_read_only_user`);
   const access=(await writer.query(`select pg_catalog.has_largeobject_privilege('anon',${oid},'SELECT') as anon,pg_catalog.has_largeobject_privilege('authenticated',${oid},'SELECT') as customer,pg_catalog.has_largeobject_privilege('service_role',${oid},'SELECT') as service_role,pg_catalog.has_largeobject_privilege('supabase_read_only_user',${oid},'SELECT') as readonly`)).rows[0];
   if(Object.values(access).some(x=>x!==false))throw fail('PRIVATE_DELIVERY_ACCESS_NOT_VERIFIED');
   proof.private_delivery={oid,encrypted_bytes:sealed.length,sha256:hash(sealed),recipient_fingerprint:fingerprint,nonowner_read_denied:true,committed:false};
   await writer.query('COMMIT');writing=false;proof.private_delivery.committed=true;proof.source_database_changed=true;proof.source_application_tables_changed=false;
  }finally{if(writing)await writer.query('ROLLBACK').catch(()=>{});await writer.end();}
 }
 proof.ok=true;
}catch(error){
 proof.failed_stage=stage;
 if(['28P01','28000','42501','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EHOSTUNREACH','CERT_HAS_EXPIRED','SELF_SIGNED_CERT_IN_CHAIN','ERR_TLS_CERT_ALTNAME_INVALID'].includes(error?.code))proof.source_error_code=error.code;
 proof.reason=['FIXED_CI_CONTEXT_REQUIRED','SCOPED_TOKEN_REQUIRED','EMPTY_TARGET_NOT_READY','TARGET_NOT_EMPTY','TEMPORARY_SOURCE_LOGIN_NOT_ISSUED','SOURCE_CONNECTION_NOT_VERIFIED','INVALID_LOGIN_RESPONSE','SOURCE_IDENTITY_NOT_VERIFIED','INVALID_SOURCE_SNAPSHOT','TABLE_SNAPSHOT_LIMIT','SQL_EXPORT_LIMIT','UNEXPECTED_RESPONSE_CACHE_OWNERSHIP','UNEXPECTED_RESTORED_RESPONSE_CACHE','ENCRYPTION_ROUND_TRIP_NOT_VERIFIED','RESTORED_TABLE_DATA_MISMATCH','RESTORED_OWNERS_OR_RLS_MISMATCH','RESTORED_SECURITY_METADATA_MISMATCH'].includes(error?.safeCode)?error.safeCode:'SQL_RESTORE_REHEARSAL_NOT_VERIFIED';
}finally{
 let cleaned=true;
 if(transaction&&client)try{await client.query('ROLLBACK');}catch{cleaned=false;}
 if(client)try{await client.end();}catch{cleaned=false;}
 if(target)try{
  const ids=(await command('docker',['ps','-aq','--filter','label=sho.hp.sql-restore-run='+process.env.GITHUB_RUN_ID])).stdout.toString().trim().split(/\s+/).filter(Boolean);
  if(ids.some(id=>!/^([a-f0-9]{12}|[a-f0-9]{64})$/.test(id)))throw Error('Invalid private container identity');
  if(ids.length)await command('docker',['rm','-f',...ids]);
  const remaining=(await command('docker',['ps','-aq','--filter','label=sho.hp.sql-restore-run='+process.env.GITHUB_RUN_ID])).stdout.toString().trim();if(remaining)throw Error('Private container remains');
 }catch{cleaned=false;}
 sourceKey?.fill(0);
 if(dir)try{await rm(dir,{recursive:true,force:true});}catch{cleaned=false;}
 proof.cleanup_verified=cleaned;if(!cleaned){proof.ok=false;proof.reason='PRIVATE_REHEARSAL_CLEANUP_NOT_VERIFIED';}
 console.log('HP_SQL_RESTORE_REHEARSAL_RESULT',JSON.stringify(proof));if(!proof.ok)process.exitCode=1;
}
