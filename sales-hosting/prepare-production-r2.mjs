import {mkdir,writeFile} from 'node:fs/promises';
import {prepareProductionR2} from '../customer-hosting-v2/src/production-r2.mjs';
const out=new URL('../test-results/sales-production-r2.json',import.meta.url);
try{
  if(process.env.GITHUB_REPOSITORY!=='sho-support/sho-support.github.io'
    ||process.env.GITHUB_REF!=='refs/heads/architecture/sales-cloudflare'
    ||process.env.GITHUB_EVENT_NAME!=='push'||!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||''))throw Object.assign(new Error(),{code:'FIXED_HP_BRANCH_REQUIRED'});
  const proof={checked_at:new Date().toISOString(),source_commit:process.env.GITHUB_SHA,
    ...await prepareProductionR2({token:process.env.CLOUDFLARE_API_TOKEN,accountId:process.env.CLOUDFLARE_ACCOUNT_ID,createIfAbsent:true})};
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});await writeFile(out,JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof));
  if(!proof.ready&&proof.status!=='permission_blocked')process.exitCode=1;
}catch(error){console.error(JSON.stringify({ready:false,status:'not_verified',code:error?.code||'PRODUCTION_R2_PREPARATION_FAILED'}));process.exitCode=1;}
