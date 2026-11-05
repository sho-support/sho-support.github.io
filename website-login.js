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
const isAdminLogin=(()=>{
  try{return new URL(safeNext).pathname.startsWith('/admin/')}catch{return false}
})();
if(isAdminLogin){
  document.title='運営者ログイン | SHO WEB SUPPORT';
  document.getElementById('loginHeading').textContent='運営者ログイン';
  document.getElementById('loginIntro').textContent='SHO WEB SUPPORTの管理者アカウントへログインします。登録済みメールアドレスにログインリンクを送信します。';
  document.getElementById('loginNote').textContent='注文・入金・制作情報は管理者権限を持つアカウントのみ操作できます。未登録のメールアドレスでは管理画面を利用できません。';
}

try{
  const session=await currentSession();
  if(session){
    message.innerHTML='この端末ではログイン済みです。<br><a href="'+safeNext+'" style="color:#d9ae5c">'+(isAdminLogin?'運営管理画面':'お客様管理ページ')+'へ進む →</a>';
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
      options:{emailRedirectTo:safeNext,shouldCreateUser:!isAdminLogin},
    });
    if(error)throw error;
    message.textContent='ログイン用メールを送りました。メール内のリンクを開いてください。';
  }catch(error){
    console.error(error);message.textContent='ログインメールを送信できませんでした。時間を置いて再度お試しください。';
  }finally{button.disabled=false}
});
