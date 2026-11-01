// A semi-order purchases a specific layout. Only customer content is substituted.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const str=v=>String(v??'').trim().slice(0,3000);
const themeIds=['rock','cafe','cute','minimal','premium','pop','vintage','cyber','organic','editorial'];
function url(v){try{const u=new URL(str(v));return ['https:','http:'].includes(u.protocol)?u.toString():''}catch{return ''}}
function asset(a){return a&&/^assets\/[a-z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(a.path||'')?a.path:''}
function img(a,alt){return '<img src="'+esc(asset(a))+'" alt="'+esc(alt)+'" loading="lazy" decoding="async">'}
function contactHref(v){
 const raw=str(v);
 if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw))return 'mailto:'+raw;
 if(/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(raw))return raw;
 if(/^tel:\+?[\d -]{7,20}$/i.test(raw))return raw.replace(/[ -]/g,'');
 if(/^0[\d -]{8,15}$/.test(raw))return 'tel:'+raw.replace(/[ -]/g,'');
 return url(raw);
}
function defaultContactLabel(type,v){
 const a=str(v).toLowerCase(),t=str(type).toLowerCase();
 if(t==='line'||a.includes('line.me/')||a.includes('lin.ee/'))return 'LINEで問い合わせ';
 if(t==='instagram'||a.includes('instagram.com/'))return 'Instagramで問い合わせ';
 if(t==='x'||a.includes('x.com/')||a.includes('twitter.com/'))return 'Xで問い合わせ';
 if(t==='facebook'||a.includes('facebook.com/'))return 'Facebookで問い合わせ';
 if(t==='tiktok'||a.includes('tiktok.com/'))return 'TikTokで問い合わせ';
 if(t==='youtube'||a.includes('youtube.com/')||a.includes('youtu.be/'))return 'YouTubeを見る';
 if(t==='メール'||a.includes('mailto:')||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))return 'メールで問い合わせ';
 if(t==='電話'||a.startsWith('tel:')||/^0[\d -]{8,15}$/.test(a))return '電話で問い合わせ';
 return 'Webサイトを見る';
}
function link(label,v){const href=contactHref(v);return href?'<a class="btn sub" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>':''}
function explicitCopy(notes,location){
 const lines=String(notes||'').replace(/\r/g,'').split(/[\n。]/).map(v=>v.trim()).filter(Boolean);
 const place=location==='top'?'(?:トップ|TOP|一番上|上部)':'(?:下部|一番下|フッター)';
 for(const sentence of lines){
  if(!new RegExp(place,'i').test(sentence))continue;
  const quote=sentence.match(/[「『“]([^」』”]{1,120})[」』”]/);
  if(quote)return quote[1].trim();
  const after=new RegExp(place+'(?:の方)?に(.{2,120}?)(?:って|と)?(?:書いて|載せて|表示)','i').exec(sentence);
  const before=new RegExp('(.{2,120}?)(?:って|と)'+place+'(?:の方)?に(?:書いて|載せて|表示)','i').exec(sentence);
  const value=(after?.[1]||before?.[1]||'').replace(/(?:って|と)$/,'').trim();
  if(value)return value;
 }
 return '';
}
function section(code,name,body,id){return '<section class="section" id="'+esc(id)+'"><div class="wrap section-head"><div class="section-no">'+esc(code)+'</div><div><h2>'+esc(name)+'</h2>'+body+'</div></div></section>'}
function youtubeId(v){try{const u=new URL(v),id=u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')||u.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/)?.[1]||'';return /^[\w-]{11}$/.test(id)&&(/(^|\.)youtube\.com$/.test(u.hostname)||u.hostname==='youtu.be')?id:''}catch{return ''}}
export function renderSemiTemplate(ctx){
 const data=ctx.intake?.payload||{},f=data.fields||{},checks=data.checks||{};
 const patches=(Array.isArray(data.meta?.semi_patches)?data.meta.semi_patches:[]).slice(-25);
 const latest=Object.assign({},...patches);

 const theme=str(f.template_style),name=str(latest.name_override||f.site_name||ctx.site?.site_name||'OFFICIAL WEBSITE').slice(0,90);
 if(!themeIds.includes(theme))throw Error('選択済みテンプレートを特定できません。');
 const tpl=String(ctx.templateSource||'');
 const style=tpl.match(/<style>([\s\S]*?)<\/style>/i)?.[1]||'';
 if(style.length<3500||!style.includes('body[data-theme="'+theme+'"]'))throw Error('テンプレートCSSの読み込みに失敗しました。');
 const assets=(ctx.assets||[]).filter(a=>asset(a)),of=k=>assets.filter(a=>a.field===k);
 let top=of('top_photos');const gallery=of('gallery_photos'),logo=of('logo_file')[0];
 if(latest.hero_photo_path){const chosen=top.find(x=>x.path===latest.hero_photo_path);if(chosen)top=[chosen,...top.filter(x=>x.path!==chosen.path)];}
 const nav=[],sections=[];
 const allLives=Array.isArray(data.lives)?data.lives.filter(x=>x&&(x.date||x.name||x.venue)).slice(0,50):[];
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const lives=allLives.filter(x=>!x.date||String(x.date)>=today).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
 const oldLives=allLives.filter(x=>x.date&&String(x.date)<today).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 if((!Array.isArray(checks.live_announcement)||checks.live_announcement.includes('yes'))&&allLives.length){
  const card=x=>'<article class="event"><div class="date">'+esc(str(x.date||'EVENT').replace(/-/g,'.'))+'</div><div><b>'+esc(str(x.name||'ライブ'))+'</b><span>'+esc([x.time,x.venue,x.detail].map(str).filter(Boolean).join(' / '))+'</span></div><div class="go" aria-hidden="true">↗</div></article>';
  const upcoming=lives.length?'<div class="schedule">'+lives.map(card).join('')+'</div>':'';
  const previous=oldLives.length?'<h3 class="minor-title">PAST LIVE</h3><div class="schedule">'+oldLives.slice(0,15).map(card).join('')+'</div>':'';
  sections.push(section('01 / LIVE','LIVE / EVENT',upcoming+previous,'schedule'));nav.push(['LIVE','#schedule']);
 }
 const galleryAssets=[...new Map([...gallery,...top.slice(1)].map(a=>[a.path,a])).values()].slice(0,32);
 if(galleryAssets.length){
  sections.push(section('02 / PHOTO','GALLERY','<div class="gallery gallery-count-'+Math.min(galleryAssets.length,3)+'">'+galleryAssets.map((a,i)=>'<figure class="shot">'+img(a,name+'の写真 '+(i+1))+'</figure>').join('')+'</div>','gallery'));
  nav.push(['PHOTO','#gallery']);
 }
 const members=Array.isArray(data.members)?data.members.filter(x=>str(x?.name)).slice(0,30):[];
 if(members.length){
  const cards=members.map(m=>{
   const pic=assets.find(a=>a.storage===m.photo?.path);
   return '<article class="member"><div class="avatar">'+(pic?img(pic,str(m.name)):'<span class="initial">'+esc(str(m.name).slice(0,1))+'</span>')+'</div><b>'+esc(str(m.name))+'</b><span>'+esc(str(m.part))+'</span>'+(m.bio?'<p>'+esc(str(m.bio))+'</p>':'')+'</article>';
  }).join('');
  sections.push(section('03 / PROFILE','MEMBERS / PROFILE','<div class="profile">'+cards+'</div>','profile'));nav.push(['PROFILE','#profile']);
 }
 const yt=url(f.youtube);
 if(yt){const vid=youtubeId(yt);
  sections.push(section('04 / MOVIE','MOVIE / YouTube',vid?'<div class="video video-frame"><iframe src="https://www.youtube-nocookie.com/embed/'+vid+'" title="'+esc(name+'の動画')+'" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>':'<div class="video">'+link('YouTubeを見る',yt)+'</div>','movie'));
  nav.push(['MOVIE','#movie']);
 }
 const social=[['YouTubeを見る',f.youtube],['Instagramで問い合わせ',f.instagram],['Xで問い合わせ',f.x_url],['TikTokで問い合わせ',f.tiktok],['Facebookで問い合わせ',f.facebook],[str(f.other_sns_name||'SNS'),f.other_sns]];
 const contacts=Array.isArray(data.contacts)?data.contacts.filter(x=>x?.value).map(x=>[str(x.label||defaultContactLabel(x.type,x.value)),x.value]):[];
 const buttons=[...social,...contacts].map(x=>link(x[0],x[1])).filter(Boolean);
 if(buttons.length){
  sections.push('<section class="section" id="contact"><div class="wrap contact"><div><div class="section-no">05 / CONTACT</div><h2>SNS / CONTACT</h2><p class="lead">最新情報やお問い合わせはこちらから。</p></div><div class="contact-links">'+buttons.join('')+'</div></div></section>');
  nav.push(['CONTACT','#contact']);
 }
 const requestNotes=[str(f.image_text),str(f.final_notes)].filter(Boolean).join('\n');
 const topCopy=explicitCopy(requestNotes,'top');
 const bottomCopy=explicitCopy(requestNotes,'bottom');
 const brand=logo?'<span class="brand-logo">'+img(logo,name+'のロゴ')+'</span><span class="brand-name">'+esc(name)+'</span>':'<span class="brand-name">'+esc(name)+'</span>';
 const hero=top[0]?'<div class="photo photo-live">'+img(top[0],name+' メイン写真')+'</div>':'<div class="photo photo-title">'+esc(name)+'</div>';
 const first=nav[0]||null;
 const action=first?'<div class="hero-actions"><a class="btn" href="'+first[1]+'">'+esc(first[0]==='LIVE'?'ライブ情報を見る':first[0]==='PHOTO'?'写真を見る':first[0]==='CONTACT'?'お問い合わせ':'詳しく見る')+'</a></div>':'';
 const customCSS=[
 '.photo{overflow:hidden}.photo-live{display:block}.photo-live img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1}',
 '.photo-live:before,.photo-live:after{z-index:0}.photo-title{padding:28px;text-align:center;font-size:clamp(1.6rem,4vw,3rem);font-weight:950;overflow-wrap:anywhere}',
 '.brand{display:flex;align-items:center;gap:12px}.brand-logo img{max-height:49px;max-width:70px;width:auto;height:auto;object-fit:contain}.brand-name{font-weight:950;font-size:clamp(.9rem,2vw,1.12rem);line-height:1.35;overflow-wrap:anywhere}.hero h1{font-size:clamp(2.1rem,5vw,4rem);line-height:1.14;overflow-wrap:anywhere;text-wrap:balance}',
 '.shot{position:relative;margin:0;overflow:hidden}.shot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.gallery{grid-auto-rows:minmax(155px,1fr)}.gallery-count-1{display:block;max-width:650px}.gallery-count-1 .shot{height:370px}.gallery-count-2{grid-template-columns:1fr 1fr;grid-template-rows:310px}.gallery-count-2 .shot:first-child{grid-row:auto;grid-column:auto}',
 '.member .avatar{overflow:hidden}.member .avatar img{width:100%;height:100%;object-fit:cover}.initial{font-size:2rem;color:var(--accent);font-weight:900}',
 '.member p{font-size:.84rem;color:var(--soft)}.minor-title{margin:25px 0 12px;font-size:1rem}.video-frame{min-height:0;aspect-ratio:16/9;overflow:hidden}.video-frame iframe{width:100%;height:100%;border:0}',
 '.customer-footer-note{font-size:1.05rem;font-weight:800;margin:0 0 14px;color:var(--accent)}.contact-links .btn{overflow-wrap:anywhere}.photo-live img.portrait-upload,.gallery .shot img.portrait-upload{object-fit:contain;background:var(--panel)}@media(max-width:760px){.event{grid-template-columns:85px 1fr 30px}.event .go{width:30px;height:30px}.gallery-count-1 .shot{height:285px}.gallery-count-2{grid-template-columns:1fr 1fr;grid-template-rows:190px}}'
 ].join('');
 let html='<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="'+esc(name+' 公式サイト')+'"><title>'+esc(name)+' | OFFICIAL WEBSITE</title><style>'+style+customCSS+'</style></head>'+
 '<body data-theme="'+theme+'"><header><div class="wrap head"><a class="brand" href="#top">'+brand+'</a><nav class="nav">'+nav.map(x=>'<a href="'+x[1]+'">'+esc(x[0])+'</a>').join('')+'</nav></div></header>'+
 '<main id="top"><section class="hero"><div class="wrap hero-grid"><div><div class="kicker">OFFICIAL WEBSITE</div><h1>'+esc(name)+'</h1><p>'+esc(str(latest.hero_message||topCopy||'ライブ情報や写真、最新のお知らせをお届けします。'))+'</p>'+action+'</div>'+hero+'</div></section>'+
 sections.join('')+'</main><footer><div class="wrap">'+(bottomCopy?'<p class="customer-footer-note">'+esc(bottomCopy)+'</p>':'')+'&copy; '+new Date().getUTCFullYear()+' '+esc(name)+'</div></footer>'+
 '<script>(function(){document.querySelectorAll(".photo-live img,.gallery .shot img").forEach(function(img){function fit(){if(img.naturalWidth&&img.naturalHeight&&img.naturalHeight/img.naturalWidth>1.4){img.classList.add("portrait-upload");}}if(img.complete)fit();else img.addEventListener("load",fit,{once:true});});})();</script></body></html>';
 // Apply content-only revisions inside visible text nodes. Never rewrite the fixed CSS.
 const boundary=html.indexOf('</head>')+'</head>'.length;
 let rest=html.slice(boundary);
 for(const patch of patches){
  for(const row of Array.isArray(patch?.replacements)?patch.replacements.slice(0,25):[]){
   const before=esc(str(row?.before)),after=esc(str(row?.after));
   if(!before||!after||before===after)continue;
   rest=rest.replace(/>([^<>]*)</g,(whole,node)=>'>'+node.replaceAll(before,after)+'<');
  }
 }
 html=html.slice(0,boundary)+rest;
 if(/SHO WEB SUPPORT|TEMPLATE PREVIEW|MAIN PHOTO AREA|PHOTO 02/.test(html))throw Error('テンプレート見本の不要な文字が残っています。');
 return {summary:'購入済みの「'+theme+'」テンプレートを固定したまま、お客様の素材と情報を反映しました。',files:[{path:'index.html',content:html}],model:'fixed-template',response_id:null,usage:null};
}
