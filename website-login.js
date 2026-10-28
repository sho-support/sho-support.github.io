import { websiteSupabase, currentSession } from './website-client.js';

const form=document.getElementById('loginForm');
const email=document.getElementById('email');
const button=document.getElementById('loginBtn');
const message=document.getElementById('message');
const params=new URLSearchParams(location.search);
const requestedNext=params.get('next');
const safeNext=(()=>{
  if(!requestedNext)return new URL('website-portal.html',location.href).href;
  try{
    const u=new URL(requestedNext,location.href);
    return u.origin===location.origin?u.href:new URL('website-portal.html',location.href).href;
  }catch{return new URL('website-portal.html',location.href).href}
})();

try{
  const session=await currentSession();
  if(session){
    message.innerHTML='この端末ではログイン済みです。<br><a href="'+safeNext+'" style="color:#d9ae5c">お客様管理ページへ進む →</a>';
  }
}catch(error){console.error(error)}

form.addEventListener('submit',async e=>{
  e.preventDefault();
  const value=email.value.trim().toLowerCase();
  if(!value||!email.validity.valid){message.textContent='正しいメールアドレスを入力してください。';return}
  button.disabled=true;message.textContent='送信しています…';
  try{
    const {error}=await websiteSupabase.auth.signInWithOtp({
      email:value,
      options:{emailRedirectTo:safeNext,shouldCreateUser:true},
    });
    if(error)throw error;
    message.textContent='ログイン用メールを送りました。メール内のリンクを開いてください。';
  }catch(error){
    console.error(error);message.textContent='ログインメールを送信できませんでした。時間を置いて再度お試しください。';
  }finally{button.disabled=false}
});
