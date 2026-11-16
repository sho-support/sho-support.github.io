import {AwsClient} from 'npm:aws4fetch@1.0.20';
import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.1.0';
import {allowedProductionR2Claims,createProductionR2Handler,verifyProductionR2} from './check.mjs';
// Checked-in code is closed. A temporary deployment pins one run, SHA and short deadline.
const run='__ALLOWED_RUN_ID__',sha='__ALLOWED_SHA__',until=Number('__ALLOWED_UNTIL__');
const keys=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'),{timeoutDuration:8000});
const env=(name:string)=>Deno.env.get(name);
Deno.serve(createProductionR2Handler({run,sha,until,verify:async(token:string)=>{
 try{
  const {payload}=await jwtVerify(token,keys,{issuer:'https://token.actions.githubusercontent.com',audience:'sho-production-r2',algorithms:['RS256'],requiredClaims:['exp','iat','nbf'],maxTokenAge:600});
  return allowedProductionR2Claims(payload,run,sha);
 }catch{return false;}
},check:async()=>{
 if(env('SUPABASE_URL')!=='https://tyhymvgjkoebetyypspj.supabase.co')return {ok:false,failed_step:'project'};
 const signer=new AwsClient({accessKeyId:env('CUSTOMER_R2_ACCESS_KEY_ID')||'',secretAccessKey:env('CUSTOMER_R2_SECRET_ACCESS_KEY')||'',service:'s3',region:'auto',retries:0});
 return verifyProductionR2({env,run,sha,sign:signer.sign.bind(signer)});
}}));
