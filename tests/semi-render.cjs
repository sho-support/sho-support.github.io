const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const {renderSemiTemplate}=await import(path.resolve('supabase/functions/website-worker/semi-template.mjs'));
 const source=fs.readFileSync('website-template-preview.html','utf8');
 const templates=['rock','cafe','cute','minimal','premium','pop','vintage','cyber','organic','editorial'];
 const assets=[
  {field:'top_photos',path:'assets/top_photos/hero.jpg',name:'hero.jpg',storage:'site/hero.jpg'},
  {field:'gallery_photos',path:'assets/gallery_photos/gallery.jpg',name:'gallery.jpg',storage:'site/gallery.jpg'},
  {field:'logo_file',path:'assets/logo_file/logo.png',name:'logo.png',storage:'site/logo.png'}
 ];
 function ctx(theme){return {site:{site_id:'TEST-001',site_name:'撮影テスト'},intake:{payload:{fields:{site_name:'写真と音楽のサイト',template_style:theme,build_plan:'semi',image_text:'晴れた日の公園の雰囲気',youtube:'https://www.youtube.com/watch?v=abcdefghijk',instagram:'https://instagram.com/testband'},checks:{live_announcement:['yes']},members:[{name:'ギター担当',part:'Guitar',bio:'ライブで活動中です。'}],lives:[{date:'2030-04-01',name:'LIVE TEST',venue:'仙台ステージ',time:'17:00'}]}},templateSource:source,assets};}
 for(const theme of templates){
  const item=renderSemiTemplate(ctx(theme));const html=item.files[0].content;
  assert.equal(item.files.length,1);assert.equal(item.files[0].path,'index.html');assert.ok(html.length>5000);
  assert.ok(html.includes('data-theme="'+theme+'"'),'selected '+theme+' must survive');
  assert.ok(html.includes('body[data-theme="'+theme+'"]'),'CSS for theme '+theme+' must exist');
  assert.ok(html.includes('assets/top_photos/hero.jpg')&&html.includes('assets/gallery_photos/gallery.jpg')&&html.includes('assets/logo_file/logo.png'));
  assert.ok(html.includes('仙台ステージ')&&html.includes('ギター担当'));
  assert.ok(!html.includes('晴れた日の公園の雰囲気'),'mood instructions must not be public copy');
  assert.ok(!html.includes('SHO WEB SUPPORT'),'customer site must not promote platform');
  assert.ok(!html.includes('MAIN PHOTO AREA')&&!html.includes('PHOTO 02'));
  const noLogo=renderSemiTemplate({...ctx(theme),assets:assets.filter(x=>x.field!=='logo_file')}).files[0].content;
  assert.ok(noLogo.includes('写真と音楽のサイト'),'no-logo fallback is attractive text');
 }
 const revised=ctx('cyber');
 revised.intake.payload.meta={semi_patches:[{name_override:'修正版バンド公式サイト',hero_message:'活動内容をご紹介します。',replacements:[{before:'仙台ステージ',after:'新会場ライブハウス'}]}]};
 const revisedHTML=renderSemiTemplate(revised).files[0].content;
 assert.ok(revisedHTML.includes('修正版バンド公式サイト')&&revisedHTML.includes('新会場ライブハウス'));
 assert.ok(revisedHTML.includes('活動内容をご紹介します。'));
 assert.ok(revisedHTML.includes('data-theme="cyber"')&&revisedHTML.includes('body[data-theme="cyber"]'),'Revisions cannot restyle purchased template');
 assert.ok(!revisedHTML.includes('仙台ステージ'),'Old content replaced');
 const injected=ctx('cyber');injected.intake.payload.fields.site_name='<img src=x onerror=alert(1)>';injected.intake.payload.fields.instagram='javascript:alert(1)';
 const escaped=renderSemiTemplate(injected).files[0].content;
 assert.ok(!escaped.includes('<img src=x onerror=alert(1)>'));
 assert.ok(!escaped.includes('javascript:alert(1)'));
 const empty=renderSemiTemplate({...ctx('cyber'),assets:[],intake:{payload:{fields:{site_name:'画像なし',template_style:'cyber',build_plan:'semi'},checks:{live_announcement:[]},lives:[],members:[]}}}).files[0].content;
 assert.ok(empty.includes('画像なし')&&!empty.includes('src="assets/'));
 console.log('SEMI TEMPLATE PASS: all 10 themes, customer image paths, fixed aesthetics, XSS links, optional logo and empty asset fallback');
})().catch(e=>{console.error('SEMI TEMPLATE FAIL',e.stack);process.exitCode=1});
