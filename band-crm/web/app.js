'use strict';
/* Private admin only. Real authorization resides in Postgres RLS, not the UI. */
(() => {
  const $ = id => document.getElementById(id);
  const CONFIG = window.BAND_CRM_CONFIG;
  const SERVICE = { shorts:'告知Shorts',one_song:'ライブ1曲',full_live:'フルライブ',shoot_30:'撮影30分程度',shoot_60:'撮影60分程度',other:'その他・個別見積' };
  const FLOOR = { shorts:2500,one_song:4000,full_live:8000,shoot_30:4000,shoot_60:6500,other:1 };
  const LSTAGE = {new:'未対応',approached:'案内済み',replied:'返信あり',quoted:'見積済み',booked:'受注',lost:'見送り'};
  const DSTAGE = {draft:'見積作成中',sent:'見積送付済み',accepted:'見積承諾済み',in_progress:'制作中',delivered:'納品済み',completed:'完了',cancelled:'キャンセル'};
  const channelLabels = {line:'LINE',instagram:'Instagram',facebook:'Facebook',email:'メール',other:'その他'};
  const money = n => '¥'+Number(n||0).toLocaleString('ja-JP');
  const today = () => new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
  const ym = d => (d||'').slice(0,7);
  let client, user=null, admin=false, leads=[],deals=[],payments=[], currentTab='leads', editing=null;
  const el=(tag,cls,text)=>{const a=document.createElement(tag);if(cls)a.className=cls;if(text!==undefined)a.textContent=String(text);return a};
  const showMessage=(id,msg,isError=false)=>{const e=$(id);e.textContent=msg;e.classList.toggle('error',isError)};
  const options=(items,chosen='')=>items.map(([v,t])=>({value:v,label:t,selected:chosen===v}));
  const toList=obj=>Object.entries(obj).map(([v,t])=>[v,t]);
  const controls={
    lead:[
      ['name','お名前 / 呼び名','text',true,100],['organization','バンド・団体名','text',false,120],
      ['channel','連絡手段','select',true,toList(channelLabels)],['handle','連絡先（任意）','text',false,200],
      ['stage','営業状況','select',true,toList(LSTAGE)],['next_action_on','次の連絡予定日','date'],
      ['notes','相談・営業メモ','textarea',false,4000]
    ],
    deal:[
      ['lead_id','お客様','select',true,[]],['title','案件名','text',true,160],
      ['service','メニュー','select',true,toList(SERVICE)],['amount_yen','見積額（円）','number',true],
      ['tax_mode','税込・税別','select',true,[['','必ず選択'],['included','税込'],['excluded','税別']]],
      ['status','進行状況','select',true,toList(DSTAGE)],['delivery_due','納品予定日','date'],
      ['scope','制作・納品内容','textarea',false,4000],['revision_terms','修正・キャンセル条件','textarea',false,1000]
    ],
    payment:[
      ['deal_id','対象の案件','select',true,[]],['amount_yen','実入金（円）/ 返金はマイナス','number',true],
      ['method','入金方法','select',true,[['bank_transfer','銀行振込'],['cash','現金'],['other','その他']]],
      ['evidence_reference','明細照合番号（重複不可）','text',true,160],['received_on','入金・返金日','date',true],
      ['reason','返金・訂正理由（マイナスの場合必須）','textarea',false,500]
    ]
  };
  function nodeFields(fields,record={}){
    const root=$('modal-fields');root.replaceChildren();
    for(const [key,label,type,required,extra] of fields){
      const wrap=el('label',(type==='textarea'||key==='scope'||key==='notes'||key==='reason')?'wide':'');
      wrap.textContent=label;
      let input;
      if(type==='select'){
        input=el('select');
        let items=extra;
        if(key==='lead_id')items=[['','対象の顧客を選択'],...leads.map(x=>[x.id,x.name+(x.organization?' / '+x.organization:'')])];
        if(key==='deal_id')items=[['','対象の案件を選択'],...deals.filter(x=>x.status!=='cancelled').map(x=>[x.id,x.title+' / '+money(x.amount_yen)])];
        for(const [value,text] of items){const option=el('option','',text);option.value=value;input.append(option)}
      }else if(type==='textarea')input=el('textarea');
      else {input=el('input');input.type=type;if(type==='number')input.step='1';if(typeof extra==='number' && type==='text')input.maxLength=extra}
      input.name=key;input.id='edit-'+key;input.required=!!required;
      if(record[key]!==undefined&&record[key]!==null)input.value=String(record[key]);
      else if(key==='received_on')input.value=today();
      else if(key==='stage')input.value='new';
      else if(key==='status')input.value='draft';
      else if(key==='channel')input.value='line';
      else if(key==='method')input.value='bank_transfer';
      if(type==='number')input.min=key==='amount_yen'?'-100000000':undefined;
      if(fields===controls.deal && record.id
          && payments.some(p=>p.deal_id===record.id)
          && ['lead_id','title','service','amount_yen','tax_mode'].includes(key)){
        input.disabled=true;
      }
      wrap.append(input);root.append(wrap);
    }
    if(fields===controls.payment){
      const info=el('p','info wide','入金済みの銀行明細等を確認して登録。記録後の削除・上書きはできません。訂正はマイナス金額で追記します。');
      root.append(info);
    }
    if(fields===controls.deal && record.id && payments.some(p=>p.deal_id===record.id)){
      root.append(el('p','info wide','入金記録があるため顧客・案件名・サービス・見積金額・税区分は固定です。制作状況や納期の変更は可能です。'));
    }
  }
  function openEditor(kind,record=null){
    if(kind==='deal'&&!leads.length){showMessage('app-message','先に見込み客を登録してください。',true);switchTab('leads');return}
    if(kind==='payment'&&!deals.length){showMessage('app-message','先に案件を作成してください。',true);switchTab('deals');return}
    editing={kind,id:record?.id||null};
    $('modal-label').textContent=kind==='lead'?'CUSTOMER':kind==='deal'?'QUOTE / PROJECT':'PAYMENT EVIDENCE';
    $('modal-title').textContent=(record?'編集：':'新規登録：')+({lead:'見込み客',deal:'見積・案件',payment:'実入金・返金'}[kind]);
    $('save-modal').textContent=record?'変更を保存':'登録する';
    nodeFields(controls[kind],record||{});showMessage('editor-message','');
    $('editor').showModal();
  }
  async function loadPages(name){
    const output=[];for(let i=0;i<20;i++){
      const {data,error}=await client.from(name).select('*').order('created_at',{ascending:false}).range(i*500,(i+1)*500-1);
      if(error)throw error;
      output.push(...(data||[]));if((data||[]).length<500)return output;
    }
    throw Error('件数が多いため先頭10,000件までに制限しています。データの表示方法を確認してください。');
  }
  async function checkPermission(){
    const session=(await client.auth.getUser());user=session.data?.user||null;
    if(session.error||!user){admin=false;return false}
    const {data,error}=await client.from('band_crm_admins').select('user_id').eq('user_id',user.id).maybeSingle();
    if(error)throw error;
    admin=!!data;return admin;
  }
  async function start(){
    try{
      const ok=await checkPermission();$('login-panel').hidden=ok;$('workspace').hidden=!ok;$('signout').hidden=!ok;
      $('connection-status').textContent=ok?'認証済み・管理者権限確認':'管理者専用';
      if(ok)await refreshData();
      else if(user)showMessage('login-message','このアカウントにはBand Support管理権限がありません。',true);
    }catch(e){$('login-panel').hidden=false;$('workspace').hidden=true;showMessage('login-message','認証・管理権限の確認に失敗しました。接続状態を確認してください。',true)}
  }
  async function refreshData(){
    if(!admin)return;
    showMessage('app-message','読み込み中…');
    try{
      const [l,d,p]=await Promise.all([loadPages('band_crm_leads'),loadPages('band_crm_deals'),loadPages('band_crm_payments')]);
      leads=l;deals=d;payments=p;drawAll();showMessage('app-message','更新しました。');return true;
    }catch(e){showMessage('app-message','データを取得できません。接続と管理権限を確認してください。',true);return false}
  }
  function drawStats(){
    const month=today().slice(0,7);
    const received=payments.filter(x=>ym(x.received_on)===month).reduce((n,x)=>n+x.amount_yen,0);
    const total=payments.reduce((n,x)=>n+x.amount_yen,0);
    const pipeline=deals.filter(x=>['draft','sent'].includes(x.status)).reduce((n,x)=>n+x.amount_yen,0);
    $('stat-paid').textContent=money(received);$('stat-quotes').textContent=money(pipeline);
    $('stat-leads').textContent=String(leads.length);
    $('stat-active').textContent=String(deals.filter(x=>['sent','accepted','in_progress','delivered'].includes(x.status)).length);
    $('goal-label').textContent=money(total)+' / ¥10,000';$('goal-progress').value=Math.min(10000,Math.max(0,total));
  }
  function pill(text,klass=''){return el('span','pill '+klass,text)}
  function cardHeader(title,desc){const div=el('div');div.append(el('h3','',title),el('p','desc',desc));return div}
  function empty(message){return el('p','empty',message)}
  function drawLeads(){
    const root=$('leads-list');root.replaceChildren();const query=$('lead-filter').value.trim().toLowerCase();const stage=$('lead-stage-filter').value;
    const rows=leads.filter(x=>(!stage||x.stage===stage)&&[x.name,x.organization,x.notes].join(' ').toLowerCase().includes(query));
    if(!rows.length){root.append(empty('まだ対象の見込み客がありません。最初の3〜5組から登録しよう。'));return}
    for(const lead of rows){
      const a=el('article','record'),body=cardHeader(lead.name,lead.organization||'団体名なし'),meta=el('div','meta');
      meta.append(pill(LSTAGE[lead.stage]||lead.stage,lead.stage==='booked'?'good':''),pill(channelLabels[lead.channel]||lead.channel));
      if(lead.next_action_on)meta.append(pill('次の連絡 '+lead.next_action_on,'warn'));
      if(lead.notes)body.append(el('p','desc',lead.notes.slice(0,100)));
      body.append(meta);const actions=el('div','actions'),edit=el('button','small-btn','編集');edit.type='button';edit.addEventListener('click',()=>openEditor('lead',lead));actions.append(edit);a.append(body,actions);root.append(a)
    }
  }
  function drawDeals(){
    const root=$('deals-list');root.replaceChildren();const query=$('deal-filter').value.trim().toLowerCase();const stage=$('deal-stage-filter').value;
    const rows=deals.filter(x=>{const lead=leads.find(l=>l.id===x.lead_id);return(!stage||x.status===stage)&&[x.title,lead?.name,lead?.organization].join(' ').toLowerCase().includes(query)});
    if(!rows.length){root.append(empty('案件はまだありません。見込み客を選んで見積を作成しよう。'));return}
    for(const deal of rows){
      const lead=leads.find(x=>x.id===deal.lead_id),a=el('article','record'),body=cardHeader(deal.title,(lead?.name||'顧客情報なし')+' / '+SERVICE[deal.service]),meta=el('div','meta');
      meta.append(pill(DSTAGE[deal.status]||deal.status,['accepted','completed'].includes(deal.status)?'good':''));
      if(deal.delivery_due)meta.append(pill('納期 '+deal.delivery_due,'warn'));
      const cash=payments.filter(p=>p.deal_id===deal.id).reduce((n,p)=>n+p.amount_yen,0);
      meta.append(pill('実入金 '+money(cash)));
      body.append(meta);const actions=el('div','actions');actions.append(el('strong','amount',money(deal.amount_yen)));
      const quote=el('button','small-btn','見積文コピー');quote.addEventListener('click',()=>copyQuote(deal));
      const edit=el('button','small-btn','編集');edit.addEventListener('click',()=>openEditor('deal',deal));actions.append(quote,edit);a.append(body,actions);root.append(a)
    }
  }
  function drawPayments(){
    const root=$('payments-list');root.replaceChildren();if(!payments.length){root.append(empty('実入金の記録はまだありません。見積の金額は売上に加算されません。'));return}
    for(const pay of payments){const deal=deals.find(x=>x.id===pay.deal_id),a=el('article','record'),body=cardHeader(deal?.title||'案件不明',pay.received_on+' / '+pay.method+' / 照合番号 '+pay.evidence_reference),meta=el('div','meta');if(pay.reason)meta.append(el('span','muted tiny','訂正理由：'+pay.reason));body.append(meta);const amount=el('strong','amount',money(pay.amount_yen));if(pay.amount_yen>=0)amount.style.color='var(--green)';a.append(body,amount);root.append(a)}
  }
  function drawAll(){drawStats();drawLeads();drawDeals();drawPayments()}
  function switchTab(which){
    currentTab=which;
    for(const tab of ['leads','deals','payments','help']){
      $(tab+'-tab').hidden=tab!==which;
      const button=document.querySelector('[data-tab="'+tab+'"]');button.classList.toggle('active',tab===which);button.setAttribute('aria-current',tab===which?'page':'false');
    }
  }
  function validate(kind,data){
    if(kind==='lead'){if(!data.name?.trim())throw Error('お名前を入力してください。');return}
    if(kind==='deal'){
      const amount=Number(data.amount_yen);if(!Number.isSafeInteger(amount)||amount<FLOOR[data.service]||amount>100000000)throw Error('料金表の最低料金以上の整数金額を入力してください。');
      if(!data.tax_mode)throw Error('税込・税別を必ず選択してください。');
      if(!leads.some(l=>l.id===data.lead_id))throw Error('登録済みの顧客を選択してください。');return;
    }
    const yen=Number(data.amount_yen);
    if(!Number.isSafeInteger(yen)||yen===0||Math.abs(yen)>100000000)throw Error('0以外の整数金額を入力してください。');
    if(yen<0&&(!data.reason||data.reason.trim().length<8))throw Error('返金・訂正には8文字以上の理由が必要です。');
    if(!data.evidence_reference||data.evidence_reference.trim().length<6)throw Error('明細照合番号を6文字以上入力してください。');
    if(data.received_on>today())throw Error('将来の日付を入金確認日にできません。');
    const selectedDeal=deals.find(d=>d.id===data.deal_id);
    if(!selectedDeal)throw Error('登録済みの案件を選択してください。');
    if(yen>0&&['draft','cancelled'].includes(selectedDeal.status))throw Error('見積作成中・キャンセル済みの案件には入金を記録できません。');
    const net=payments.filter(p=>p.deal_id===selectedDeal.id).reduce((sum,p)=>sum+p.amount_yen,0);
    if(yen<0&&net+yen<0)throw Error('既に記録した入金額を超える返金・訂正はできません。');
  }
  async function save(e){
    e.preventDefault();if(!editing||!admin)return;
    const button=$('save-modal');if(button.disabled)return;
    const kind=editing.kind,values=Object.fromEntries(new FormData($('editor-form')).entries());
    // The modal form owns all inputs: a wrapper <form> also contains modal buttons.
    for(const control of $('modal-fields').querySelectorAll('[name]'))values[control.name]=control.value;
    if(kind==='deal'||kind==='payment')values.amount_yen=Number(values.amount_yen);
    if(kind==='lead'&&!values.next_action_on)values.next_action_on=null;
    if(kind==='deal'&&!values.delivery_due)values.delivery_due=null;
    try{validate(kind,values)}catch(err){showMessage('editor-message',err.message,true);return}
    const table={lead:'band_crm_leads',deal:'band_crm_deals',payment:'band_crm_payments'}[kind];
    if(kind==='payment'){
      if(!confirm('実際の入出金を照合しましたか？ この記録は削除・編集できません。'))return;
      values.evidence_reference=values.evidence_reference.trim();values.verified_by=user.id;
    }
    button.disabled=true;showMessage('editor-message','保存中…');
    let saved=false;
    try{
      const query=editing.id
        ?client.from(table).update(values).eq('id',editing.id).select('id')
        :client.from(table).insert(values).select('id');
      const {data:rows,error}=await query;
      if(error)throw error;
      // A successful HTTP response with zero affected rows is not a successful update.
      if(!Array.isArray(rows)||rows.length!==1)throw new Error('WRITE_NOT_CONFIRMED');
      saved=true;
      $('editor').close();editing=null;
      switchTab(kind==='lead'?'leads':kind==='deal'?'deals':'payments');
      const refreshed=await refreshData();
      if(!refreshed)showMessage('app-message','登録は完了しています。一覧の更新に失敗したため、同じ内容を再登録せず「更新」を押してください。',true);
    }catch(err){
      if(saved){
        showMessage('app-message','登録は完了しています。画面の再読込に失敗しました。二重登録を避けるため再送信せず履歴を確認してください。',true);
      }else{
        showMessage('editor-message',err?.code==='23505'
          ?'明細照合番号が既に登録されています。入力し直さず履歴を更新して確認してください。'
          :'登録結果を確認できません。通信断の場合は既に保存された可能性があります。履歴を確認してから再試行してください。',true);
      }
    }finally{button.disabled=false}
  }
  async function copy(value){
    try{await navigator.clipboard.writeText(value);showMessage('app-message','コピーしました。')}
    catch(e){showMessage('app-message','コピーできませんでした。ブラウザのコピー権限を確認してください。',true)}
  }
  function copyQuote(deal){
    const lead=leads.find(x=>x.id===deal.lead_id);
    const msg=['【Band Support お見積り】',
      'ご依頼者：'+(lead?.name||'ご依頼者様'),
      '案件：'+deal.title,
      'メニュー：'+SERVICE[deal.service],
      'お見積額：'+money(deal.amount_yen)+'（'+(deal.tax_mode==='included'?'税込':'税別')+'）',
      '制作内容：'+(deal.scope||'別途相談'),
      '予定納期：'+(deal.delivery_due||'ご相談'),
      '修正・キャンセル条件：'+(deal.revision_terms||'お見積り確定前にご案内'),
      '',
      '内容をご確認のうえ、ご返信ください。ご承諾後にお支払い先とお支払い期限を個別にご案内します。入金確認後に作業を開始します。',
      '※交通費・入場料等の追加費用がある場合は着手前にお知らせします。'].join('\n');
    copy(msg);
  }
  function csvEscape(v){let s=String(v??'');if(typeof v==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}
  function exportCsv(){
    const data=[['種別','ID','顧客/案件','ステータス','金額','日付','備考']];
    for(const lead of leads)data.push(['営業',lead.id,lead.name,lead.stage,'',lead.created_at,lead.organization]);
    for(const d of deals)data.push(['見積/案件',d.id,d.title,d.status,d.amount_yen,d.created_at,d.tax_mode]);
    for(const p of payments)data.push(['実入金/返金',p.id,deals.find(d=>d.id===p.deal_id)?.title||'',p.method,p.amount_yen,p.received_on,p.evidence_reference]);
    const csv='\ufeff'+data.map(a=>a.map(csvEscape).join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='band-support-backup-'+today()+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    showMessage('app-message','CSVを書き出しました。個人情報を含むため、保存場所を適切に管理してください。')
  }
  async function exportFullBackup(){
    if(!admin){showMessage('app-message','管理者ログインが必要です。',true);return}
    const button=$('export-full');if(button.disabled)return;button.disabled=true;
    showMessage('app-message','最新の顧客・案件・入金・監査履歴を取得しています…');
    try{
      const [latestLeads,latestDeals,latestPayments,audit]=await Promise.all([
        loadPages('band_crm_leads'),loadPages('band_crm_deals'),
        loadPages('band_crm_payments'),loadPages('band_crm_audit')
      ]);
      // Do not silently export a partial backup when any table fetch fails.
      const backup={
        format:'SHO_BAND_SUPPORT_CRM_BACKUP_V1',
        created_at:new Date().toISOString(),timezone:'Asia/Tokyo',
        data:{leads:latestLeads,deals:latestDeals,payments:latestPayments,audit}
      };
      const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='band-support-full-backup-'+today()+'.json';
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      showMessage('app-message','JSON保存を開始しました。顧客の個人情報が含まれるため、共有せず安全な場所へ保管してください。');
    }catch(e){showMessage('app-message','全データを取得できなかったため保存しませんでした。接続と管理権限を確認してください。',true)}
    finally{button.disabled=false}
  }
  if(!CONFIG||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(CONFIG.url)||!CONFIG.publishableKey?.startsWith('sb_publishable_')){
    showMessage('login-message','Supabase接続設定が未完了です。公開用キーを確認してください。',true);return;
  }
  if(!window.supabase?.createClient){showMessage('login-message','認証ライブラリを読み込めませんでした。ネット接続を確認してください。',true);return}
  client=window.supabase.createClient(CONFIG.url,CONFIG.publishableKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  $('login-form').addEventListener('submit',async e=>{
    e.preventDefault();const button=$('login-submit');if(button.disabled)return;button.disabled=true;
    try{
      const {error}=await client.auth.signInWithPassword({email:$('login-email').value.trim(),password:$('login-password').value});
      if(error)throw error;await start();
    }catch(e){showMessage('login-message','ログインできません。メールアドレスとパスワードを確認してください。',true)}
    finally{button.disabled=false}
  });
  $('forgot-password').addEventListener('click',async()=>{
    const email=$('login-email').value.trim();
    if(!email||!$('login-email').checkValidity()){
      showMessage('login-message','再設定メールを送る宛先を先に入力してください。',true);return;
    }
    const button=$('forgot-password');if(button.disabled)return;button.disabled=true;
    try{
      // The redirect must be explicitly allowed in Supabase Auth URL Configuration.
      const redirectTo=new URL('./reset.html',window.location.href).href;
      const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo});
      if(error)throw error;
      showMessage('login-message','登録済みのアドレスであれば再設定メールが届きます。メールをご確認ください。');
    }catch(e){showMessage('login-message','再設定メールを送信できませんでした。送信元設定・制限を確認し、時間をおいて再試行してください。',true)}
    finally{button.disabled=false}
  });
  $('signout').addEventListener('click',async()=>{await client.auth.signOut();user=null;admin=false;leads=[];deals=[];payments=[];await start()});
  $('refresh').addEventListener('click',refreshData);$('export').addEventListener('click',exportCsv);
  $('export-full').addEventListener('click',exportFullBackup);
  $('new-lead').addEventListener('click',()=>openEditor('lead'));
  $('new-deal').addEventListener('click',()=>openEditor('deal'));
  $('new-payment').addEventListener('click',()=>openEditor('payment'));
  for(const btn of document.querySelectorAll('[data-tab]'))btn.addEventListener('click',()=>switchTab(btn.dataset.tab));
  for(const id of ['lead-filter','lead-stage-filter'])$(id).addEventListener('input',drawLeads);
  for(const id of ['deal-filter','deal-stage-filter'])$(id).addEventListener('input',drawDeals);
  $('close-modal').addEventListener('click',()=>$('editor').close());
  $('cancel-modal').addEventListener('click',()=>$('editor').close());
  $('editor-form').addEventListener('submit',save);
  $('copy-outreach').addEventListener('click',()=>copy('ライブ映像の編集依頼を受け付けています！\n\n告知Shorts：2,500円〜\nライブ1曲：4,000円〜\nフルライブ：8,000円〜\n\n撮影済み素材から編集できます。まずは用途・素材の長さ・希望納期を教えてください。\nご相談：https://line.me/R/ti/p/@383oceah'));
  client.auth.onAuthStateChange((_event,_session)=>{if(_event==='SIGNED_OUT'){user=null;admin=false;$('login-panel').hidden=false;$('workspace').hidden=true}});
  start();
})();
