// A disposable SQL restore rehearsal, NOT a retained full-platform backup.
// Real rows and SQL are confined to the private runner filesystem/memory.
// No artifacts, outbound notifications, source writes or production restore.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {PROJECT,backupConnectionOptions} from './backup/connection-preflight.mjs';

const run=promisify(execFile),image='public.ecr.aws/supabase/postgres:17.11.0.003';
const require=createRequire(new URL('../customer-hosting-v2/package.json',import.meta.url)),{Client}=require('pg');
const hash=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>'"'+String(x).replaceAll('"','""')+'"';
const fail=code=>Object.assign(new Error(code),{safeCode:code});
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
  throw fail('COMMAND_NOT_VERIFIED');
 }
}
// execFile does not supply stdin; use a fixed private file for target SQL.
let queryNumber=0;
async function queryTarget(sql){
 const name='query-'+(++queryNumber)+'.sql',path=join(dir,name);
 await writeFile(path,sql,{mode:0o600,flag:'wx'});
 try{
  await command('docker',['cp',path,target+':/tmp/'+name]);
  await command('docker',['exec','--user','0',target,'chown','postgres:postgres','/tmp/'+name]);
  return (await command('docker',['exec',target,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','hp_restore_admin','-d','postgres','-f','/tmp/'+name])).stdout.toString();
 }finally{await rm(path,{force:true});}
}
async function fingerprints(query){
 const tables=await query("select schemaname,tablename from pg_tables where schemaname not like 'pg_%' and schemaname <> 'information_schema' order by schemaname,tablename");
 const result=[];
 for(const {schemaname,tablename} of tables){
  const name=quote(schemaname)+'.'+quote(tablename);
  const [row]=await query(`select count(*)::text as row_count, coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb)::text as content from ${name} r`);
  if(typeof row?.content!=='string'||Buffer.byteLength(row.content)>35*1024*1024)throw fail('TABLE_SNAPSHOT_LIMIT');
  result.push({schema:schemaname,table:tablename,count:row.row_count,digest:hash(row.content)});
 }
 return result;
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
 const startup='set -euo pipefail; initdb -D /tmp/hp-empty-pg --username=hp_restore_admin --auth=trust >/tmp/hp-init.log 2>&1; exec postgres -D /tmp/hp-empty-pg -c listen_addresses= -c shared_preload_libraries= -c log_statement=none -c log_min_error_statement=panic';
 await command('docker',['run','-d','--network','none','--user','postgres','--name',target,'--entrypoint','/bin/bash',image,'-c',startup]);
 let ready=false;
 for(let i=0;i<40;i++){
  try{await command('docker',['exec',target,'pg_isready','-U','hp_restore_admin','-d','postgres'],{timeout:3000});ready=true;break;}catch{}
  await new Promise(r=>setTimeout(r,500));
 }
 if(!ready)throw fail('EMPTY_TARGET_NOT_READY');
 const empty=await queryTarget("select count(*) from pg_tables where schemaname not like 'pg_%' and schemaname <> 'information_schema';");
 if(empty.trim()!=='0')throw fail('TARGET_NOT_EMPTY');
 proof.empty_target_verified=true;proof.target_network_isolated=true;
 stage='temporary-source-login';
 const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/cli/login-role`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({read_only:false})});
 if(response.status!==201){await response.body?.cancel();throw fail('TEMPORARY_SOURCE_LOGIN_NOT_ISSUED');}
 proof.temporary_login_issued=true;
 const text=await response.text();if(text.length>16384)throw fail('INVALID_LOGIN_RESPONSE');
 const login=JSON.parse(text);
 if(login?.role!=='cli_login_postgres'||typeof login.password!=='string'||!login.password.length||login.password.length>4096||/[\r\n\0]/.test(login.password)
  ||!Number.isSafeInteger(login.ttl_seconds)||login.ttl_seconds<60||login.ttl_seconds>3600)throw fail('INVALID_LOGIN_RESPONSE');
 const config={...base,user:login.role+'.'+PROJECT,password:login.password,query_timeout:90000,
  options:'-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000'};
 client=new Client(config);client.on('error',()=>{});await client.connect();proof.tls_certificate_verified=true;
 await client.query('SET SESSION ROLE postgres');
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
 stage='sql-snapshot';
 const ca=resolve('sales-hosting/backup/supabase-root-2021.crt'),envFile=join(dir,'private','source.env');
 await writeFile(envFile,[`PGHOST=${config.host}`,'PGPORT=5432',`PGUSER=${config.user}`,`PGPASSWORD=${login.password}`,'PGDATABASE=postgres','PGSSLMODE=verify-full','PGSSLROOTCERT=/hp-root.crt',
  'PGCONNECT_TIMEOUT=10','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000'].join('\n')+'\n',{mode:0o600,flag:'wx'});
 const sourceArgs=['run','--rm','--network','host','--env-file',envFile,'-v',ca+':/hp-root.crt:ro'];
 stage='export-db-snapshot';
 const archive=(await command('docker',[...sourceArgs,'--entrypoint','pg_dump',image,'--format=custom','--quote-all-identifiers','--role=postgres','--snapshot='+snapshot],{timeout:180000})).stdout;
 stage='export-roles';
 const roles=(await command('docker',[...sourceArgs,'--entrypoint','pg_dumpall',image,'--roles-only','--no-role-passwords','--role=postgres'],{timeout:60000})).stdout;
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
 stage='empty-sql-restore';
 await command('docker',['exec',target,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','hp_restore_admin','-d','postgres','-f','/tmp/roles.sql']);
 await command('docker',['exec',target,'pg_restore','--exit-on-error','--single-transaction','--no-tablespaces','-U','hp_restore_admin','-d','postgres','/tmp/restore.dump'],{timeout:180000});
 proof.sql_empty_restore_verified=true;
 stage='restored-fingerprints';
 const targetQuery=async sql=>JSON.parse((await queryTarget(`select coalesce(jsonb_agg(to_jsonb(hp_row)),'[]'::jsonb)::text from (${sql}) hp_row;`)).trim());
 const targetRows=await fingerprints(targetQuery);
 if(JSON.stringify(targetRows)!==JSON.stringify(sourceRows))throw fail('RESTORED_TABLE_DATA_MISMATCH');
 proof.table_data_match=true;
 const layout=(await targetQuery("select coalesce(jsonb_agg(to_jsonb(t) order by t.schemaname,t.tablename),'[]'::jsonb)::text as layout from (select schemaname,tablename,tableowner,rowsecurity from pg_tables where schemaname not like 'pg_%' and schemaname <> 'information_schema') t"))[0].layout;
 const policies=(await targetQuery("select coalesce(jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname),'[]'::jsonb)::text as policies from pg_policies p"))[0].policies;
 if(layout!==sourceLayout||policies!==sourcePolicies)throw fail('RESTORED_OWNERS_OR_RLS_MISMATCH');
 proof.table_owners_and_rls_match=true;proof.ok=true;
}catch(error){
 proof.failed_stage=stage;
 proof.reason=['FIXED_CI_CONTEXT_REQUIRED','SCOPED_TOKEN_REQUIRED','EMPTY_TARGET_NOT_READY','TARGET_NOT_EMPTY','TEMPORARY_SOURCE_LOGIN_NOT_ISSUED','INVALID_LOGIN_RESPONSE','SOURCE_IDENTITY_NOT_VERIFIED','INVALID_SOURCE_SNAPSHOT','TABLE_SNAPSHOT_LIMIT','SQL_EXPORT_LIMIT','ENCRYPTION_ROUND_TRIP_NOT_VERIFIED','RESTORED_TABLE_DATA_MISMATCH','RESTORED_OWNERS_OR_RLS_MISMATCH'].includes(error?.safeCode)?error.safeCode:'SQL_RESTORE_REHEARSAL_NOT_VERIFIED';
}finally{
 let cleaned=true;
 if(transaction&&client)try{await client.query('ROLLBACK');}catch{cleaned=false;}
 if(client)try{await client.end();}catch{cleaned=false;}
 if(target)try{await command('docker',['rm','-f',target]);}catch{cleaned=false;}
 sourceKey?.fill(0);
 if(dir)try{await rm(dir,{recursive:true,force:true});}catch{cleaned=false;}
 proof.cleanup_verified=cleaned;if(!cleaned){proof.ok=false;proof.reason='PRIVATE_REHEARSAL_CLEANUP_NOT_VERIFIED';}
 console.log('HP_SQL_RESTORE_REHEARSAL_RESULT',JSON.stringify(proof));if(!proof.ok)process.exitCode=1;
}
