import {PROJECT,backupConnectionOptions,checkBackupConnection} from './connection-preflight.mjs';

// Official beta API: /docs/reference/api/v1-create-login-role.
// Issue only the read-only counterpart. Never reset postgres, enable JIT,
// change SSL/network settings, or delete shared CLI login roles.
export async function checkBackupTemporaryAccess({value,accessToken,createClient,request=fetch}){
 const proof={ok:false,purpose:'hp-backup-connection-only',project_ref:PROJECT,credential_mode:'temporary-read-only',
  temporary_login_issued:false,connection_verified:false,tls_certificate_verified:false,read_only_transaction_verified:false,
  database_password_changed:false,database_exported:false,restore_verified:false,configuration_changed:false};
 try{
  // Validate the previously saved URI before sending any authorized API request.
  backupConnectionOptions(value,'not-used-for-connection');
  if(typeof accessToken!=='string'||!/^sbp_fc[A-Za-z0-9_-]{16,4090}$/.test(accessToken)){
   proof.reason='SCOPED_BACKUP_ACCESS_TOKEN_REQUIRED';return proof;
  }
  const response=await request(`https://api.supabase.com/v1/projects/${PROJECT}/cli/login-role`,{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
   headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({read_only:true})});
  if(response.status!==201){
   proof.reason=({401:'BACKUP_ACCESS_TOKEN_NOT_AUTHORIZED',403:'BACKUP_ACCESS_PERMISSION_MISSING',429:'BACKUP_ACCESS_RATE_LIMITED'})[response.status]||'TEMPORARY_LOGIN_NOT_ISSUED';
   await response.body?.cancel();return proof;
  }
  proof.temporary_login_issued=true;proof.configuration_changed=true;
  // Provider responses can include passwords, including on failure. Never log them.
  const reader=response.body.getReader();let size=0;const parts=[];
  try{for(;;){const {done,value:part}=await reader.read();if(done)break;size+=part.byteLength;if(size>16384)throw Error('response too large');parts.push(part);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  const login=JSON.parse(new TextDecoder().decode(bytes));
  // Reject changed API contracts, unexpected roles and long-lived credentials.
  if(!login||typeof login!=='object'||Array.isArray(login))throw Error('invalid login response');
  backupConnectionOptions(value,undefined,login);
  const result=await checkBackupConnection({value,temporaryLogin:login,createClient});
  return {...proof,...result,temporary_login_issued:true,configuration_changed:true};
 }catch{
  proof.reason='TEMPORARY_BACKUP_CONNECTION_NOT_VERIFIED';return proof;
 }
}
