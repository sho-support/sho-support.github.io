import {generateKeyPairSync,createHash} from 'node:crypto';
import {openPrivateDelivery} from './backup/private-delivery.mjs';
const endpoint='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-backup-crypto-check';
const proof={ok:false,purpose:'edge-to-node-backup-crypto-interoperability',source_commit:process.env.GITHUB_SHA,run_id:process.env.GITHUB_RUN_ID,customer_data_accessed:false,source_data_changed:false,private_keys_exposed:false};
let stage='context';
async function json(url,options={}){const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok){await r.body?.cancel();throw Error('HTTP');}const raw=await r.text();if(raw.length>1024*1024)throw Error('Response limit');return JSON.parse(raw);}
try{
 if(process.env.GITHUB_REPOSITORY!=='sho-support/sho-support.github.io'||process.env.GITHUB_REF!=='refs/heads/architecture/sales-cloudflare'||process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('Context');
 stage='pinned-deployment';let ready=false;for(let i=0;i<31;i++){try{const x=await json(endpoint);ready=x.service==='website-backup-crypto-check'&&x.build===process.env.GITHUB_SHA;}catch{}if(ready)break;if(i<30)await new Promise(r=>setTimeout(r,5000));}if(!ready)throw Error('Pinned check unavailable');
 stage='oidc';const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);if(url.protocol!=='https:'||!url.hostname.endsWith('.actions.githubusercontent.com'))throw Error('Issuer');url.searchParams.set('audience','sho-hp-backup-crypto-check');const token=await json(url.href,{headers:{authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}});if(typeof token.value!=='string'||token.value.length>12000)throw Error('OIDC');
 stage='synthetic-edge-encryption';const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const result=await json(endpoint,{method:'POST',headers:{authorization:'Bearer '+token.value,'content-type':'application/json'},body:JSON.stringify({action:'verify',public_key:keys.publicKey})});
 if(result.source_commit!==process.env.GITHUB_SHA||result.run_id!==process.env.GITHUB_RUN_ID||result.customer_data_accessed!==false||result.source_data_changed!==false||typeof result.envelope!=='string'||result.envelope.length>512*1024)throw Error('Invalid synthetic result');
 stage='strict-node-decryption';const sealed=Buffer.from(result.envelope,'base64'),expected={project_ref:'tyhymvgjkoebetyypspj',source_commit:process.env.GITHUB_SHA,run_id:process.env.GITHUB_RUN_ID};
 const actual=openPrivateDelivery(sealed,keys.privateKey,expected,'assets'),fixture=Buffer.alloc(131072,0x5a),hash=b=>createHash('sha256').update(b).digest('hex');if(actual.length!==fixture.length||hash(actual)!==hash(fixture))throw Error('Synthetic contents mismatch');
 const altered=JSON.parse(sealed),tag=Buffer.from(altered.tag,'base64');tag[0]^=1;altered.tag=tag.toString('base64');let rejected=false;try{openPrivateDelivery(Buffer.from(JSON.stringify(altered)),keys.privateKey,expected,'assets');}catch{rejected=true;}if(!rejected)throw Error('Tag accepted');
 proof.fixture_bytes=fixture.length;proof.rsa_oaep_sha256_interoperability_verified=true;proof.aes_gcm_integrity_verified=true;proof.tampering_rejected=true;proof.ok=true;actual.fill(0);
}catch{proof.failed_stage=stage;}
console.log('HP_BACKUP_CRYPTO_INTEROP_RESULT',JSON.stringify(proof));if(!proof.ok)process.exitCode=1;
