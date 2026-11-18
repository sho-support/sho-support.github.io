import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {backupConnectionOptions,PROJECT} from './backup/connection-preflight.mjs';
const require=createRequire(new URL('../customer-hosting-v2/package.json',import.meta.url)),{Client}=require('pg');
const endpoint=`https://${PROJECT}.supabase.co/functions/v1/website-private-assets-backup`;
const proof={ok:false,purpose:'private-storage-and-r2-assets-backup',project_ref:PROJECT,source_commit:process.env.GITHUB_SHA,run_id:process.env.GITHUB_RUN_ID,
 database_password_changed:false,source_application_tables_changed:false,source_files_deleted:false,source_public_access_changed:false,production_cutover:false,off_provider_backup_preserved:false};
let stage='context',client,transaction=false;
const quote=s=>'"'+s.replaceAll('"','""')+'"';
async function json(url,options={}){
 const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(140000)});
 if(!response.ok){let problem;try{const raw=await response.text();if(raw.length<1000)problem=JSON.parse(raw);}catch{}const e=Error('HTTP_'+response.status);if(['authentication','configuration','storage-export-and-restore','r2-export','owner-encryption'].includes(problem?.stage))e.safeStage=problem.stage;throw e;}
 const raw=await response.text();if(raw.length>70*1024*1024)throw Error('Response limit');return JSON.parse(raw);
}
try{
 if(process.env.GITHUB_REPOSITORY!=='sho-support/sho-support.github.io'||process.env.GITHUB_REF!=='refs/heads/architecture/sales-cloudflare'
  ||process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('Context');
 const base=backupConnectionOptions(process.env.SUPABASE_BACKUP_DB_URL,'not-used-for-connection'),access=process.env.SUPABASE_BACKUP_ACCESS_TOKEN;
 if(typeof access!=='string'||!/^sbp_fc[A-Za-z0-9_-]{16,4090}$/.test(access))throw Error('Scoped token');
 stage='pinned-deployment';let ready=false;
 for(let i=0;i<31;i++){
  try{const r=await json(endpoint);ready=r.service==='website-private-assets-backup'&&r.build===process.env.GITHUB_SHA;}catch{}
  if(ready)break;if(i<30)await new Promise(r=>setTimeout(r,5000));
 }
 if(!ready)throw Error('Pinned deployment unavailable');
 stage='oidc';const tokenUrl=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
 if(tokenUrl.protocol!=='https:'||!tokenUrl.hostname.endsWith('.actions.githubusercontent.com'))throw Error('Issuer');
 tokenUrl.searchParams.set('audience','sho-hp-private-assets-backup');
 const token=await json(tokenUrl.href,{headers:{authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}});
 if(typeof token.value!=='string'||token.value.length>12000)throw Error('OIDC token');
 stage='assets-export-and-empty-bucket-restore';
 const result=await json(endpoint,{method:'POST',headers:{authorization:'Bearer '+token.value,'content-type':'application/json'},body:'{"action":"export"}'}),p=result.proof;
 const required=['ok','storage_pagination_complete','storage_source_unchanged','storage_file_bytes_restored','storage_hashes_match','qa_bucket_private','qa_bucket_cleanup_verified','r2_pagination_complete','r2_source_unchanged','r2_bytes_exported'];
 if(!p||p.project_ref!==PROJECT||p.source_commit!==process.env.GITHUB_SHA||p.run_id!==process.env.GITHUB_RUN_ID||required.some(k=>p[k]!==true)
  ||p.source_files_deleted!==false||p.source_public_access_changed!==false||p.r2_source_writes!==false||p.customer_notifications_sent!==false||p.production_cutover!==false
  ||p.storage_bucket_count!==2||p.storage_object_count!==9||p.storage_bytes!==4186232||p.r2_object_count!==0||p.r2_bytes!==0)throw Error('Asset inventory or recovery not verified');
 if(typeof result.envelope!=='string'||result.envelope.length>68*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(result.envelope))throw Error('Envelope encoding');
 const sealed=Buffer.from(result.envelope,'base64');if(sealed.toString('base64')!==result.envelope)throw Error('Envelope encoding');
 const metadata=JSON.parse(sealed).metadata;
 if(metadata?.purpose!=='sho-hp-private-assets-backup-v1'||metadata.project_ref!==PROJECT||metadata.source_commit!==process.env.GITHUB_SHA||metadata.run_id!==process.env.GITHUB_RUN_ID
  ||metadata.recipient_fingerprint!=='88a0dc3d153b25ad499b646014d28aea55348c9fb575017097e0bbdb8f3910e3')throw Error('Envelope identity');
 proof.assets={...p};
 stage='temporary-private-transfer-login';
 const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/cli/login-role`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+access,'content-type':'application/json'},body:'{"read_only":false}'});
 if(response.status!==201){await response.body?.cancel();throw Error('Temporary login unavailable');}
 const raw=await response.text();if(raw.length>16384)throw Error('Invalid login');const login=JSON.parse(raw);
 if(login?.role!=='cli_login_postgres'||typeof login.password!=='string'||!login.password.length||login.password.length>4096||/[\r\n\0]/.test(login.password)
  ||!Number.isSafeInteger(login.ttl_seconds)||login.ttl_seconds<60||login.ttl_seconds>3600)throw Error('Invalid login');
 client=new Client({...base,user:login.role+'.'+PROJECT,password:login.password,options:'-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000'});client.on('error',()=>{});
 stage='private-encrypted-transfer';await client.connect();await client.query('SET SESSION ROLE postgres');await client.query('BEGIN READ WRITE');transaction=true;
 const oid=Number((await client.query('select pg_catalog.lo_from_bytea(0,$1) as oid',[sealed])).rows[0]?.oid);
 if(!Number.isInteger(oid)||oid<16384||oid>4294967295)throw Error('Invalid delivery object');
 await client.query(`REVOKE ALL ON LARGE OBJECT ${oid} FROM PUBLIC,anon,authenticated,authenticator,service_role,supabase_read_only_user`);
 const acl=(await client.query(`select pg_get_userbyid(m.lomowner)='postgres' as owner_matches,
  not exists(select 1 from aclexplode(m.lomacl) a where a.grantee<>m.lomowner) as owner_only_acl,
  not exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated','service_role','supabase_read_only_user') and (r.rolsuper or pg_has_role(r.oid,m.lomowner,'USAGE'))) as no_owner_inheritance,
  current_setting('lo_compat_privileges')='off' as compatibility_off from pg_largeobject_metadata m where m.oid=${oid}`)).rows[0];
 if(!acl||Object.values(acl).some(x=>x!==true))throw Error('Private access not verified');
 for(const role of ['anon','authenticated','service_role']){
  await client.query('SAVEPOINT hp_delivery_access');await client.query('SET LOCAL ROLE '+quote(role));let denied=false;
  try{await client.query(`select pg_catalog.lo_get(${oid},0,1)`);}catch(error){if(error?.code==='42501')denied=true;else throw error;}
  await client.query('ROLLBACK TO SAVEPOINT hp_delivery_access');await client.query('RELEASE SAVEPOINT hp_delivery_access');if(!denied)throw Error('Private access not denied');
 }
 proof.private_delivery={oid,encrypted_bytes:sealed.length,sha256:createHash('sha256').update(sealed).digest('hex'),recipient_fingerprint:metadata.recipient_fingerprint,owner_only_acl_verified:true,read_denial_roles_tested:3,committed:false};
 await client.query('COMMIT');transaction=false;proof.private_delivery.committed=true;proof.temporary_transfer_object_created=true;proof.ok=true;
}catch(error){proof.failed_stage=stage;if(error?.safeStage)proof.edge_failed_stage=error.safeStage;if(/^[0-9A-Z]{5}$/.test(error?.code||''))proof.postgres_sqlstate=error.code;}
finally{
 if(transaction&&client)await client.query('ROLLBACK').catch(()=>{});if(client)await client.end().catch(()=>{});
 console.log('HP_PRIVATE_ASSETS_BACKUP_RESULT',JSON.stringify(proof));if(!proof.ok)process.exitCode=1;
}
