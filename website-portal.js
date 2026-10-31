import { currentSession, websiteApi, websiteSupabase } from './website-client.js';

const loading=document.getElementById('loading');
const empty=document.getElementById('empty');
const sitesBox=document.getElementById('sites');

const labels={
  request_waiting:'要望待ち',building:'作成中',sho_review:'運営確認中',
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
        const live=site.status==='live';
        const actions=live?'<a class="btn primary" href="'+esc(site.public_url||'#')+'" target="_blank" rel="noopener noreferrer">完成サイトを見る</a><a class="btn" href="https://line.me/R/oaMessage/%40144dlsxp/?'+encodeURIComponent('SITE ID '+site.site_id+' のホームページを更新したいです。')+'" target="_blank" rel="noopener noreferrer">更新についてLINEで相談</a>':
          site.status==='request_waiting'?'<a class="btn primary" href="'+intake+'">制作内容を入力する</a>':
          site.status==='customer_review'?'<a class="btn primary" href="'+review+'">サイト確認・公開</a>':'<span class="meta">制作・確認処理中です。案内をお待ちください。</span>';
        return '<article class="card"><div class="siteid">SITE ID '+esc(site.site_id)+'</div><h2>'+esc(site.site_name||'ホームページ')+'</h2><span class="status">'+esc(labels[site.status]||site.status)+'</span>'+(site.adjustment_free_until?'<p class="meta">無料調整：'+esc(new Date(site.adjustment_free_until).toLocaleDateString('ja-JP'))+'まで</p>':'')+(site.update_free_until?'<p class="meta">無料更新：'+esc(new Date(site.update_free_until).toLocaleDateString('ja-JP'))+'まで（月8回）</p>':'')+'<div class="pageviews" data-site-views="'+esc(site.site_id)+'">'+(live?'ページ表示回数を取得中…':'ページ表示回数：公開後から集計')+'</div><div class="actions">'+actions+'</div></article>';
      }).join('');
      sitesBox.classList.remove('hidden');
      for(const site of sites.filter(x=>x.status==='live')){
        const target=[...sitesBox.querySelectorAll('[data-site-views]')].find(x=>x.dataset.siteViews===site.site_id);
        if(!target)continue;
        try{const result=await websiteApi('site_view_stats',{site_id:site.site_id});
          target.textContent='ページ表示回数：累計 '+Number(result.views_total||0).toLocaleString()+' 回 ／ 今日 '+Number(result.views_today||0).toLocaleString()+' 回（公開後から集計・同一人の複数表示を含みます）';
        }catch{target.textContent='ページ表示回数は現在取得できません。'}
      }

    }
  }
}catch(error){
  console.error(error);
  loading.textContent='お客様情報を読み込めませんでした。';
}
