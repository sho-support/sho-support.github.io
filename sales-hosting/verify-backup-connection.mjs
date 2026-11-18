import {createRequire} from 'node:module';
import {checkBackupConnection} from './backup/connection-preflight.mjs';
import {checkBackupTemporaryAccess} from './backup/temporary-access.mjs';
try{
 if(process.env.GITHUB_REPOSITORY!=='sho-support/sho-support.github.io'||process.env.GITHUB_REF!=='refs/heads/architecture/sales-cloudflare'
  ||process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('Fixed first-attempt CI required');
 const require=createRequire(new URL('../customer-hosting-v2/package.json',import.meta.url));
 const {Client}=require('pg');
 const options={value:process.env.SUPABASE_BACKUP_DB_URL,createClient:config=>new Client(config)};
 const proof=process.env.SUPABASE_BACKUP_ACCESS_TOKEN
  ?await checkBackupTemporaryAccess({...options,accessToken:process.env.SUPABASE_BACKUP_ACCESS_TOKEN})
  :await checkBackupConnection({...options,passwordValue:process.env.SUPABASE_BACKUP_DB_PASSWORD});
 console.log('HP_BACKUP_CONNECTION_RESULT',JSON.stringify({...proof,source_commit:process.env.GITHUB_SHA,run_id:process.env.GITHUB_RUN_ID}));
 if(!proof.ok)process.exitCode=1;
}catch{console.error('HP_BACKUP_CONNECTION_STOPPED: No credentials, database rows, connection URLs or provider errors are logged.');process.exitCode=1;}
