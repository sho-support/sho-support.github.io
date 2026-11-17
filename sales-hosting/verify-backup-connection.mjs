import {createRequire} from 'node:module';
import {checkBackupConnection} from './backup/connection-preflight.mjs';
try{
 if(process.env.GITHUB_REPOSITORY!=='sho-support/sho-support.github.io'||process.env.GITHUB_REF!=='refs/heads/architecture/sales-cloudflare'
  ||process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('Fixed first-attempt CI required');
 const require=createRequire(new URL('../customer-hosting-v2/package.json',import.meta.url));
 const {Client}=require('pg');
 const proof=await checkBackupConnection({value:process.env.SUPABASE_BACKUP_DB_URL,passwordValue:process.env.SUPABASE_BACKUP_DB_PASSWORD,createClient:config=>new Client(config)});
 console.log('HP_BACKUP_CONNECTION_RESULT',JSON.stringify({...proof,source_commit:process.env.GITHUB_SHA,run_id:process.env.GITHUB_RUN_ID}));
 if(!proof.ok)process.exitCode=1;
}catch{console.error('HP_BACKUP_CONNECTION_STOPPED: No credentials, database rows, connection URLs or provider errors are logged.');process.exitCode=1;}
