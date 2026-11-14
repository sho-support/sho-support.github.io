import { CONFIRMED_RECOVERY_ORIGIN } from './_shared/auth-redirect-confirmation.ts';
import { salesOrigin, salesUrl, authRedirectReady } from './_shared/sales-origin.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const PROJECT_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ANON_KEY=Deno.env.get("SUPABASE_ANON_KEY")||"";
const BASE="https://sho-web-support.netlify.app";
const ALLOWED_ORIGINS=new Set([BASE, 'https://sho-web-support-preview.zodiac-suu.workers.dev']);
async function sha(input:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(SERVICE_KEY+"|"+input));return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");}
Deno.serve(async req=>{
  const origin=req.headers.get("origin")||"";
  const cors={"Access-Control-Allow-Origin":salesOrigin(req),"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
  const response=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8",...cors,"Cache-Control":"no-store"}});
  if(!ALLOWED_ORIGINS.has(origin))return response({error:"invalid_request"},403);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST"||!ALLOWED_ORIGINS.has(origin))return response({error:"invalid_request"},403);
  if(!PROJECT_URL||!SERVICE_KEY||!ANON_KEY)return response({error:"unavailable"},503);
  try{
    const data=await req.json();
    const email=typeof data?.email==="string"?data.email.trim().toLowerCase():"";
    if(email.length>254||email.length<5||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return response({error:"invalid_email"},400);
    if(!authRedirectReady(req,CONFIRMED_RECOVERY_ORIGIN))return response({error:"auth_redirect_not_ready"},503);
    const admin=createClient(PROJECT_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const clientIp=(req.headers.get("x-forwarded-for")||req.headers.get("cf-connecting-ip")||"unknown").split(",")[0].trim().slice(0,100);
    const ipKey=await sha("ip:"+clientIp);
    const emailKey=await sha("email:"+email);
    const {data:ipAllowed,error:ipErr}=await admin.rpc("website_password_reset_allow",{p_key:ipKey,p_max:10,p_window_seconds:3600});
    if(ipErr)return response({error:"unavailable"},503);
    if(!ipAllowed)return response({error:"rate_limited"},429);
    const {data:emailAllowed,error:emailErr}=await admin.rpc("website_password_reset_allow",{p_key:emailKey,p_max:2,p_window_seconds:86400});
    if(emailErr)return response({error:"unavailable"},503);
    if(!emailAllowed)return response({error:"rate_limited"},429);
    const redirect=new URL(salesUrl(req,"/website-password.html"));
    redirect.searchParams.set("mode","recovery");
    // Prevent arbitrary redirect origins or malformed paths.
    if(typeof data?.next==="string"){
      try{
        const next=new URL(data.next,salesOrigin(req));
        if(next.origin===salesOrigin(req)&&next.pathname.startsWith("/")&&!next.pathname.startsWith("//"))
          redirect.searchParams.set("next",next.href);
      }catch{}
    }
    const recoverUrl=PROJECT_URL+"/auth/v1/recover?redirect_to="+encodeURIComponent(redirect.href);
    const res=await fetch(recoverUrl,{method:"POST",headers:{"Content-Type":"application/json","apikey":ANON_KEY,"Authorization":"Bearer "+ANON_KEY},body:JSON.stringify({email})});
    if(!res.ok){
      if(res.status===429)return response({error:"rate_limited"},429);
      return response({error:"unavailable"},503);
    }
    return response({ok:true});
  }catch{return response({error:"unavailable"},503);}
});