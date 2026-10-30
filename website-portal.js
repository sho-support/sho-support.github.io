import { currentSession, websiteApi, websiteSupabase } from './website-client.js';

const loading=document.getElementById('loading');
const empty=document.getElementById('empty');
const sitesBox=document.getElementById('sites');

const labels={
  request_waiting:'要望待ち',building:'作成中',sho_review:'SHO確認中',
  customer_review:'お客様最終確認中',live:'公開中',private:'一時非公開',
  improving_private:'改良中・一時非公開'
};
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

document.getElementById('logout').onclick=async()=>{
  await websiteSupabase.auth.signOut();
  location.replace('website-login.html');
};

try{
  const session=await currentSession();
  if(!session){location.replace('website-login.html?next='+encodeURIComponent(location.href));}
  else{
    const data=await websiteApi('list_sites');
    const sites=Array.isArray(data?.sites)?data.sites:[];
    loading.classList.add('hidden');
    if(!sites.length)empty.classList.remove('hidden');
    else{
      sitesBox.innerHTML=sites.map(site=>{
        const id=encodeURIComponent(site.site_id);
        const intake='website-intake.html?id='+id+'&prod=1';
        const review='website-customer-review.html?id='+id+'&prod=1';
        return '<article class="card"><div class="siteid">SITE ID '+esc(site.site_id)+'</div><h2>'+esc(site.site_name||'ホームページ')+'</h2><span class="status">'+esc(labels[site.status]||site.status)+'</span>'+(site.adjustment_free_until?'<p class="meta">無料調整：'+esc(new Date(site.adjustment_free_until).toLocaleDateString('ja-JP'))+'まで</p>':'')+(site.update_free_until?'<p class="meta">無料更新：'+esc(new Date(site.update_free_until).toLocaleDateString('ja-JP'))+'まで（月8回）</p>':'')+'<div class="actions"><a class="btn primary" href="'+intake+'">ヒアリング・要望入力</a><a class="btn" href="'+review+'">サイト確認</a></div></article>';
      }).join('');
      sitesBox.classList.remove('hidden');
    }
  }
}catch(error){
  console.error(error);
  loading.textContent='お客様情報を読み込めませんでした。';
}
