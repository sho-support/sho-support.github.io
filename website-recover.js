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
    const {data,error}=await websiteSupabase.functions.invoke('website-password-recovery',{body:{email:value,next:safeNext}});
    if(error){
      const httpStatus=error?.context?.status;
      let code='';
      try{const details=await error.context.clone().json();code=details?.error||'';}catch{}
      if(httpStatus===429||code==='rate_limited'){const e=new Error('rate_limited');e.status=429;throw e;}
      throw error;
    }
    if(data?.error){const e=new Error(data.error);if(data.error==='rate_limited')e.status=429;throw e;}
    form.hidden=true;
    message.textContent='送信しました。メール内のリンクからパスワードを再設定してください。受信箱と迷惑メールフォルダをご確認ください。';
    form.reset();
  }catch(error){
    if(error?.status===429||/rate.limit|too.many/i.test(String(error?.code||error?.message||''))){
      message.textContent='このメールアドレスへの再設定メールは24時間に2回までです。送信回数の上限に達した場合は24時間経過後にお試しください。';
    }else{
      message.textContent='再設定メールを送信できませんでした。送信設定または通信状態を確認してください。';
    }
  }finally{send.disabled=false;}
});
