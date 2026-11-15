export function setupPasswordVisibility(root=document){
  const controls=[];
  for(const button of root.querySelectorAll('button[data-password-toggle]')){
    const input=root.getElementById(button.getAttribute('aria-controls'));
    if(!input||input.tagName!=='INPUT'||input.type!=='password')continue;
    const label=button.dataset.passwordLabel||'パスワード';
    function setVisible(visible){
      input.type=visible?'text':'password';
      button.textContent=visible?'非表示':'表示';
      button.setAttribute('aria-pressed',String(visible));
      button.setAttribute('aria-label',label+(visible?'を隠す':'を表示'));
    }
    setVisible(false);
    button.addEventListener('click',()=>setVisible(input.type==='password'));
    input.form?.addEventListener('reset',()=>setVisible(false));
    controls.push(()=>setVisible(false));
  }
  root.addEventListener('visibilitychange',()=>{
    if(root.hidden)for(const hide of controls)hide();
  });
}
