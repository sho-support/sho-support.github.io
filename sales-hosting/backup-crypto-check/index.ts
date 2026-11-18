import {Buffer} from 'node:buffer';
import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.1.0';
import {allowedAssetBackupClaims} from '../backup/assets-export.mjs';
import {sealPrivateDeliveryWebCrypto} from '../backup/private-delivery.mjs';
// This check encrypts a fixed synthetic fixture only; it reads no project data,
// environment credentials, user keys, buckets or databases. Checked-in is closed.
const run='__ALLOWED_RUN_ID__',sha='__ALLOWED_SHA__',until=Number('__ALLOWED_UNTIL__');
const keys=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'),{timeoutDuration:8000});
Deno.serve(async req=>{
 const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
 if(!/^\d{8,20}$/.test(run)||!/^[a-f0-9]{40}$/.test(sha)||!Number.isSafeInteger(until)||Date.now()>until||req.headers.has('origin'))return json({error:'Closed'},403);
 if(req.method==='GET')return json({service:'website-backup-crypto-check',build:sha});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const token=/^Bearer (.+)$/.exec(req.headers.get('authorization')||'')?.[1];if(!token||token.length>12000)return json({error:'Unauthorized'},401);
 try{
  const {payload}=await jwtVerify(token,keys,{issuer:'https://token.actions.githubusercontent.com',audience:'sho-hp-backup-crypto-check',algorithms:['RS256'],requiredClaims:['exp','iat','nbf'],maxTokenAge:600});
  if(!allowedAssetBackupClaims(payload,run,sha))return json({error:'Unauthorized'},401);
  const raw=await req.text();if(raw.length>4096)return json({error:'Invalid request'},400);const body=JSON.parse(raw);
  if(body?.action!=='verify'||typeof body.public_key!=='string'||body.public_key.length>2048||Object.keys(body).sort().join(',')!=='action,public_key')return json({error:'Invalid request'},400);
  const sealed=await sealPrivateDeliveryWebCrypto(Buffer.alloc(131072,0x5a),body.public_key,{project_ref:'tyhymvgjkoebetyypspj',source_commit:sha,run_id:run},'assets');
  return json({source_commit:sha,run_id:run,envelope:sealed.toString('base64'),customer_data_accessed:false,source_data_changed:false});
 }catch{return json({error:'Synthetic crypto verification unavailable'},503);}
});
