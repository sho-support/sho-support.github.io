import { websiteSupabase } from './website-client.js';
const form=document.getElementById('recoverForm');
const send=document.getElementById('send');
const message=document.getElementById('message');
const email=document.getElementById('email');
const params=new URLSearchParams(location.search);
const requested=params.get('next');
const safeNext=(()=>{
  const fallback=new URL('website-portal.html',location.href).href;
  if(!requested)return fallback;
  try{const url=new URL(requested,location.href);return url.origin===location.origin&&url.protocol==='https:'?url.href:fallback}catch{return fallback}
})();
const back=new URL('website-login.html',location.href);
back.searchParams.set('next',safeNext);
document.getElementById('back').href=back.href;
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const value=email.value.trim().toLowerCase();
  if(!email.validity.valid||!value)return;
  send.disabled=true;message.textContent='送信しています…';
  try{
    const destination=new URL('website-password.html',location.href);
    destination.searchParams.set('mode','recovery');
    destination.searchParams.set('next',safeNext);
    const {error}=await websiteSupabase.auth.resetPasswordForEmail(value,{redirectTo:destination.href});
    if(error)throw error;
    message.textContent='再設定メールを送信しました。受信箱と迷惑メールフォルダを確認してください。メールのリンクは一度だけ利用してください。';
    form.reset();
  }catch(error){
    if(error?.status===429||/rate.limit|too.many/i.test(String(error?.code||error?.message||''))){
      message.textContent='送信回数の制限に達しました。連続送信せず、時間を置いてからお試しください。';
    }else{
      message.textContent='再設定メールを送信できませんでした。送信設定または通信状態を確認してください。';
    }
  }finally{send.disabled=false;}
});
