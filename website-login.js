import { websiteSupabase, currentSession } from './website-client.js';

const form=document.getElementById('loginForm');
const email=document.getElementById('email');
const password=document.getElementById('password');
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
const recoveryLink=new URL('website-recover.html',location.href);
recoveryLink.searchParams.set('next',safeNext);
document.getElementById('forgotPassword').href=recoveryLink.href;
const isAdminLogin=(()=>{
  try{return new URL(safeNext).pathname.startsWith('/admin/')}catch{return false}
})();
if(isAdminLogin){
  document.title='運営者ログイン | SHO WEB SUPPORT';
  document.getElementById('loginHeading').textContent='運営者ログイン';
  document.getElementById('loginIntro').textContent='管理者のメールアドレスとパスワードでログインします。';
  document.getElementById('loginNote').textContent='注文・入金・制作情報は管理者権限を持つアカウントのみ操作できます。未登録のメールアドレスでは管理画面を利用できません。';
}else{
  document.getElementById('loginHeading').textContent='お客様ログイン';
  document.getElementById('loginIntro').textContent='登録済みのメールアドレスとパスワードでログインします。';
  document.getElementById('loginNote').textContent='ログイン後は、自分が参加しているSITE IDだけが表示されます。同じサイトを複数人で編集する場合は、それぞれのメールアドレスを同じSITE IDへ追加できます。';
}

try{
  const session=await currentSession();
  if(session){
    message.textContent='ログイン済みのため、管理画面を開きます…';
    location.replace(safeNext);
  }
}catch(error){console.error(error)}

form.addEventListener('submit',async e=>{
  e.preventDefault();
  const value=email.value.trim().toLowerCase();
  if(!value||!email.validity.valid){message.textContent='正しいメールアドレスを入力してください。';return}
  if(!password.value){message.textContent='パスワードを入力してください。';return;}
  button.disabled=true;message.textContent='ログイン中…';
  try{
    const {error}=await websiteSupabase.auth.signInWithPassword({email:value,password:password.value});
    if(error)throw error;
    // Leave the value until navigation so the browser can offer its password manager.
    location.assign(safeNext);
  }catch(error){
    console.error('Sign-in failed:',error?.code||error?.status||'auth_error');
    if(error?.status===429||/rate.limit|too.many/i.test(String(error?.code||error?.message||''))){
      message.textContent='ログイン試行回数が多いため一時的に制限されています。時間を置いて再度お試しください。';
    }else{
      message.textContent='ログインできませんでした。メールアドレス・パスワード、または初回設定の有無を確認してください。';
    }
  }finally{button.disabled=false}
});
