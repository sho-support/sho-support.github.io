'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const msg=(m,error=false)=>{const el=$('reset-message');el.textContent=m;el.classList.toggle('error',error)};
 const cfg=window.BAND_CRM_CONFIG;
 if(!cfg||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.url)
    ||!cfg.publishableKey?.startsWith('sb_publishable_')||!window.supabase?.createClient){
  msg('接続設定が見つかりません。管理者へ確認してください。',true);return;
 }
 const client=window.supabase.createClient(cfg.url,cfg.publishableKey,
  {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 let allowed=false;
 async function checkSession(){
  const {data,error}=await client.auth.getUser();
  allowed=!error&&!!data?.user;
  $('reset-form').hidden=!allowed;
  msg(allowed?'新しいパスワードを設定してください。':'リンクが無効か期限切れです。ログイン画面から再設定メールを送り直してください。',!allowed);
 }
 client.auth.onAuthStateChange((event)=>{
  if(event==='PASSWORD_RECOVERY'||event==='SIGNED_IN'){
   // Avoid calling auth.getUser synchronously inside the auth callback.
   setTimeout(()=>{checkSession()},0);
  }
 });
 checkSession();
 $('reset-form').addEventListener('submit',async e=>{
  e.preventDefault();const btn=$('reset-submit');if(btn.disabled||!allowed)return;
  const password=$('password').value;
  if(password.length<12||password!==$('password-confirm').value){
   msg('12文字以上で、確認用と一致するパスワードを入力してください。',true);return;
  }
  btn.disabled=true;
  try{
   const {data,error:userError}=await client.auth.getUser();
   if(userError||!data?.user)throw new Error('session expired');
   const {error}=await client.auth.updateUser({password});
   if(error)throw error;
   msg('パスワードを変更しました。ログイン画面から新しいパスワードでログインしてください。');
   $('reset-form').hidden=true;
   await client.auth.signOut();
  }catch(e){msg('変更に失敗しました。認証リンクの有効期限やパスワードを確認してください。',true)}
  finally{btn.disabled=false}
 });
})();