// The owner-approved policy is loaded from server-side website_settings.
// No draft price or browser-supplied approved flag can authorize a quotation.
const plans={one:{name:'1ページ完結サイト',minimum:15000},semi:{name:'セミオーダーサイト',minimum:22000},full:{name:'フルオーダーサイト',minimum:30000}};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const text=(v,min,max,label)=>{if(typeof v!=='string'||v.trim().length<min||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)||/(?:__UNSET__|要確定|未承認|example\.com|仮の口座)/i.test(v))throw Error(label+'が未確定です。');return v.trim();};
const money=(v,label)=>{if(!Number.isSafeInteger(v)||v<0||v>3000000)throw Error(label+'が不正です。');return v;};
const yen=v=>v.toLocaleString('ja-JP')+'円';
export function validateCommercialPolicy(value,now=new Date()){
  if(!value||value.schema!==1||value.enabled!==true||!uuid.test(value.approved_by||'')||!Number.isFinite(Date.parse(value.approved_at))||Date.parse(value.approved_at)>+now)
    throw Error('販売条件は未承認・未設定です。正式見積りは送信できません。');
  text(value.version,3,64,'販売条件の版');
  const h=value.hosting;
  if(!h||![1,12].includes(h.initial_months)||![1,12].includes(h.renewal_months)||h.renewal!=='opt_in'||h.notice_days!==30)
    throw Error('公開維持の期間・更新方法を確定してください。');
  money(h.initial_fee_jpy,'初回公開維持費');money(h.renewal_fee_jpy,'次回公開維持費');
  for(const key of ['provider','hosting','cancellation','handover','rights','data','backup','support','update_billing'])text(value.terms?.[key],12,key==='provider'?600:450,key);
  return structuredClone(value);
}
export function quoteRequest(body){
  return {production_amount:money(Number(body.final_amount),'制作料金'),public_domain:String(body.public_domain||'').trim().toLowerCase(),
    quote_note:String(body.quote_note||'').trim().slice(0,500),delivery_terms:text(body.delivery_terms,10,240,'制作範囲・提供時期'),
    payment_deadline:text(body.payment_deadline,10,10,'お支払・申込期限')};
}
export function sameQuoteRequest(a,b){return a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k]===b[k]);}
export function makeCommercialQuote({policy,order,request,publicUrl,bankMessage,quoteId,now=new Date()}){
  const p=validateCommercialPolicy(policy,now),plan=plans[order.plan];
  if(!plan||request.production_amount<Math.max(plan.minimum,Number(order.amount_from||0)))throw Error('基本料金未満の見積りは送信できません。');
  if(!uuid.test(quoteId||''))throw Error('見積り識別子が不正です。');
  const today=new Date(+now+9*3600000).toISOString().slice(0,10),deadline=request.payment_deadline;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(deadline)||new Date(deadline+'T00:00:00Z').toISOString().slice(0,10)!==deadline||deadline<today||deadline>new Date(+now+30*86400000).toISOString().slice(0,10))throw Error('申込・支払期限は本日から30日以内の実在する日付にしてください。');
  const url=new URL(publicUrl);
  if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password||/(?:^|\.)(?:workers\.dev|github\.io|sho-support\.com|netlify\.app)$/.test(url.hostname))throw Error('顧客専用の正式URLが未確定です。');
  const update=order.plan==='one'&&order.update_plan==='unlimited'?7000:0;
  const total=request.production_amount+p.hosting.initial_fee_jpy+update;
  if(total>3000000)throw Error('見積り合計額の上限を超えています。');
  const bank=text(bankMessage,15,800,'振込先');
  const snapshot={schema:1,quote_id:quoteId,policy:p,order_code:order.order_code,plan:order.plan,update_plan:order.update_plan||'none',
    production_amount_jpy:request.production_amount,hosting_initial_fee_jpy:p.hosting.initial_fee_jpy,update_initial_fee_jpy:update,
    initial_total_jpy:total,public_url:url.href,delivery_terms:request.delivery_terms,payment_deadline:deadline,request:structuredClone(request)};
  const lines=[
    '【SHO WEB SUPPORT 正式見積り・契約条件】',
    '注文ID：'+order.order_code+'／条件版：'+p.version,'見積りID：'+quoteId,
    '制作：'+plan.name+' 1サイト／'+yen(request.production_amount)+'（税込）',
    '制作範囲・提供時期：'+request.delivery_terms,
    '正式公開URL：'+url.href,
    '公開維持：公開日から'+p.hosting.initial_months+'か月／初回 '+yen(p.hosting.initial_fee_jpy)+'（税込）',
    '次回公開維持：'+p.hosting.renewal_months+'か月 '+yen(p.hosting.renewal_fee_jpy)+'（税込）。満了30日前までに案内し、継続の申込みと入金で更新。自動更新・自動課金なし。',
    order.plan==='one'?(update?'初回内容更新料：'+yen(update)+'（税込・月8回まで）。'+p.terms.update_billing:'内容更新は別途依頼制：LIVE 1,000円／回、通常2,500円／回、月8回7,000円／月。依頼・契約がなければ請求しません。'):
      '内容更新キャンペーン：公開日から3か月、通常更新を月8回まで無料。回数は毎月1日・日本時間にリセット、繰越なし。終了後の自動有料化なし。',
    '全プラン：公開後30日間、当初の制作範囲内の無料調整。範囲外の追加は事前見積り。',
    '今回のお支払合計：'+yen(total)+'（税込）。振込手数料はご利用金融機関の定める実費をお客様負担。',
    '申込・支払期限：'+deadline+'（日本時間）。方法：銀行振込。条件への同意をLINEで返信してから、期限内にお振込みください。',
    '公開維持・URL：'+p.terms.hosting,'キャンセル・返金：'+p.terms.cancellation,
    '解約・引き渡し：'+p.terms.handover,'制作物の権利：'+p.terms.rights,
    '情報の取扱い：'+p.terms.data,'バックアップ・復旧：'+p.terms.backup,'サポート：'+p.terms.support,
    request.quote_note?'個別補足：'+request.quote_note:'',
    '事業者・連絡先：'+p.terms.provider,
    '【お振込先】',bank,'振込名義に注文ID '+order.order_code+' を添えてください。',
    '同意前に訂正・質問・キャンセルをLINEでお知らせください。同意の返信と実際の着金を確認してから制作に進みます。'
  ].filter(Boolean);
  const message=lines.join('\n');
  if(message.length>4800)throw Error('契約条件がLINE1通の安全上限を超えています。内容を削らず送付方法を確認してください。');
  return {snapshot,message,total};
}
