import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.1.0';
import {allowedReadinessClaims,createReadinessHandler,readinessAuthorization} from './readiness.mjs';

// CI is disabled in the checked-in/resting bundle. A one-run deployment may
// replace these placeholders, then must restore this administrator-only bundle.
const run='__ALLOWED_RUN_ID__',sha='__ALLOWED_SHA__',build='__BUILD_SHA__';
const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
const keys=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'),{timeoutDuration:8000});
const authorize=readinessAuthorization({admin,verifyCi:async(token:string)=>{
 if(!/^\d{8,20}$/.test(run)||!/^[a-f0-9]{40}$/.test(sha))return false;
 try{const {payload}=await jwtVerify(token,keys,{issuer:'https://token.actions.githubusercontent.com',audience:'sho-line-readiness',algorithms:['RS256'],requiredClaims:['exp','iat','nbf'],maxTokenAge:600});return allowedReadinessClaims(payload,run,sha);}
 catch{return false;}
}});
Deno.serve(createReadinessHandler({authorize,admin,env:(name:string)=>Deno.env.get(name),build}));
