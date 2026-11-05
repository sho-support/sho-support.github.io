const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'), path=require('node:path');
(async()=>{
 const stage=await import(pathToFileURL(path.resolve(__dirname,'../supabase/functions/website-worker/staged-full.mjs')).href);
 const plan={description:'架空バンドの公式サイト',pages:[
  {path:'index.html',title:'TOP | DEMO',purpose:'home',sections:[]},
  {path:'live.html',title:'LIVE | DEMO',purpose:'shows',sections:[]},
  {path:'about.html',title:'ABOUT | DEMO',purpose:'bio',sections:[]}]};
 const danger=[
  '<a class="button" href="https://sho-support.github.io/website-preview.html?id=abc&amp;key=SECRETDONOTLEAK">LIVE情報を見る</a>',
  "<a href='https://sho-support.github.io/website-customer-review.html?key=ANOTHERSECRET' target='_blank'>ABOUT</a>",
  '<a href="missing.html">準備中</a>',
  '<a href="javascript:alert(1)">準備中</a>',
  '<a href="live.html">LIVEへ</a>',
  '<a href="https://www.youtube.com/watch?v=test123">公式動画</a>'
 ].join('');
 const clean=stage.sanitizeFullPageLinks(danger,plan);
 assert.ok(clean.includes('<a class="button" href="live.html">LIVE情報を見る</a>'),'preview URL rewritten to real LIVE page');
 assert.ok(clean.includes('<a href=\'about.html\'>ABOUT</a>'),'customer-review link rewritten and target removed');
 assert.ok(!clean.includes('SECRETDONOTLEAK')&&!clean.includes('ANOTHERSECRET'),'secrets must not appear');
 assert.ok(!clean.includes('missing.html')&&!clean.includes('javascript:'),'broken/unsafe links removed');
 assert.ok(clean.includes('href="https://www.youtube.com/watch?v=test123"'),'legitimate external URL preserved');
 const state=stage.initialFullState();
 state.plan=plan;
 state.css='body{color:#ddd}@media(max-width:640px){body{color:white}}';
 state.pages={
  'index.html':'<section><h1>DEMO</h1>'+danger+'</section>',
  'live.html':'<section><h1>LIVE</h1></section>',
  'about.html':'<section><h1>ABOUT</h1></section>'
 };
 const mock={site:{site_name:'DEMO'},intake:{payload:{fields:{}}},assets:[]};
 const files=stage.completedFullFiles(state,mock);
 assert.equal(files.length,5);
 for(const file of files.filter(f=>f.path.endsWith('.html'))){
  assert.ok(!/(?:SECRETDONOTLEAK|ANOTHERSECRET|missing\.html|javascript:)/.test(file.content),'completed site is safe '+file.path);
  assert.ok(file.content.includes('href="style.css"'),'shared CSS '+file.path);
  assert.ok(file.content.includes('src="site.js"'),'shared JS '+file.path);
 }
 console.log('STAGED_LINK_SECURITY_QA_PASS: preview token removed, invalid links replaced, valid external links retained');
})().catch(e=>{console.error('STAGED_LINK_SECURITY_QA_FAIL',e.stack||e);process.exitCode=1});
