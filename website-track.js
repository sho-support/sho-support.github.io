(() => {
  try {
    const el=document.currentScript;
    if(!el)return;
    const url=new URL(el.src);
    const siteId=url.searchParams.get('site')||'';
    if(!/^[A-Za-z0-9_-]{3,32}$/.test(siteId))return;
    fetch('https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-analytics',{
      method:'POST',mode:'cors',cache:'no-store',keepalive:true,
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({site_id:siteId})
    }).catch(()=>{});
  }catch{}
})();