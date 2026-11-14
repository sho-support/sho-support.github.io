import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.1.0';
import {allowedProbeClaims} from './policy.mjs';
import {readinessSummary} from './configuration.mjs';
// No database, Storage, R2 or customer operation. Returns only named boolean flags.
const ALLOWED_RUN_ID='__ALLOWED_RUN_ID__',ALLOWED_SHA='__ALLOWED_SHA__';
const keys=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'),{timeoutDuration:8000});
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return Response.json({error:'Method not allowed'},{status:405});
 const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
 if(!token||token.length>12000)return Response.json({error:'Unauthorized'},{status:401});
 try{
  const {payload}=await jwtVerify(token,keys,{issuer:'https://token.actions.githubusercontent.com',audience:'sho-resource-preview',algorithms:['RS256'],requiredClaims:['exp','iat','nbf'],maxTokenAge:600});
  if(!allowedProbeClaims(payload,ALLOWED_RUN_ID,ALLOWED_SHA))return Response.json({error:'Forbidden'},{status:403});
 }catch{return Response.json({error:'Unauthorized'},{status:401});}
 if(Deno.env.get('SUPABASE_URL')!=='https://tyhymvgjkoebetyypspj.supabase.co')return Response.json({error:'Unexpected project'},{status:503});
 return Response.json({ok:true,run_id:ALLOWED_RUN_ID,source_commit:ALLOWED_SHA,purpose:'configuration-only',
  ...readinessSummary((name:string)=>Deno.env.get(name)),production_data_accessed:false,external_customer_requests:0});
});
