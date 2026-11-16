export const SALES_ORIGIN='https://sho-web-support-preview.zodiac-suu.workers.dev';
export const WEBHOOK='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/website-line-webhook';
const origins=new Set([SALES_ORIGIN,'https://sho-web-support.netlify.app']);
const expectedBasicId='@144dlsxp';

export function allowedReadinessClaims(c,run,sha,now=Math.floor(Date.now()/1000)){
 return /^\d{8,20}$/.test(run)&&/^[a-f0-9]{40}$/.test(sha)
  &&c.repository==='sho-support/sho-support.github.io'&&c.repository_id==='1224256882'&&c.repository_owner_id==='275386651'
  &&c.ref==='refs/heads/architecture/sales-cloudflare'&&c.event_name==='push'&&c.run_attempt==='1'
  &&c.workflow_ref==='sho-support/sho-support.github.io/.github/workflows/sales-line-readiness.yml@refs/heads/architecture/sales-cloudflare'
  &&c.run_id===run&&c.sha===sha&&c.workflow_sha===sha
  &&Number.isInteger(c.exp)&&Number.isInteger(c.iat)&&c.exp>now&&c.exp<=now+600&&c.iat>=now-600&&c.iat<=now+30;
}

export function readinessAuthorization({admin,verifyCi=async(_token)=>false}){
 return async token=>{
  if(!token||token.length>12000)return null;
  if(await verifyCi(token))return {kind:'ci'};
  const result=await admin.auth.getUser(token);
  if(result.error||!result.data?.user?.id)return null;
  const user=result.data.user;
  const {data,error}=await admin.from('website_admins').select('user_id').eq('user_id',user.id).maybeSingle();
  return !error&&data?.user_id===user.id?{kind:'administrator'}:{kind:'forbidden'};
 };
}

export async function ownerLineFixture(fixture,order){
 if(fixture?.schema!==1||fixture?.purpose!=='line_connection_acceptance_only'||fixture.order_code!=='9000001001'
  ||!/^[a-f0-9]{40}$/.test(fixture.link_token||'')||order?.selections?.qa_purpose!=='line_connection_acceptance_only'
  ||!['pending_line','pending_payment'].includes(order?.status))return null;
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fixture.link_token)));
 const hash=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==order.line_link_token_hash)return null;
 const text='【HP販売・接続テスト専用／実注文ではありません】\n注文ID: '+fixture.order_code+'\n連携コード: '+fixture.link_token+'\n要望: テスト用の1ページサイト。黒背景と赤を基調に、紹介と問い合わせ欄を確認します。\n実際の契約・振込・公開は行いません。';
 return {order_code:fixture.order_code,line_linked:!!order.line_user_id,open_line_url:'https://line.me/R/oaMessage/%40144dlsxp/?'+encodeURIComponent(text),real_order:false,real_payment:false};
}

export async function checkLineConnection({token,channelId,channelSecret,fetch:transport=globalThis.fetch}){
 const proof={credential_valid:false,official_account_matches:false,webhook_configured:false,webhook_active:false,
  signed_empty_webhook_verified:false,real_message_receipt_verified:false,real_messages_sent:0,configuration_changed:false};
 let accessToken=typeof token==='string'?token:'';
 proof.authentication_mode=accessToken?'fixed':channelId&&channelSecret?'stateless':'missing';
 if(!accessToken&&(!channelId||!channelSecret))return {...proof,reason:'LINE_CREDENTIALS_MISSING'};
 async function api(path,method='GET'){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);let response;
  try{
   const exchange=path==='__stateless_token';
   response=await transport(exchange?'https://api.line.me/oauth2/v3/token':'https://api.line.me/v2/bot/'+path,{method,redirect:'error',signal:controller.signal,
    headers:exchange?{'content-type':'application/x-www-form-urlencoded'}:{authorization:'Bearer '+accessToken,'content-type':'application/json'},
    ...(method==='POST'?{body:exchange?new URLSearchParams({grant_type:'client_credentials',client_id:channelId,client_secret:channelSecret}).toString():'{}'}:{})});
   if(!response.ok)return {status:response.status};
   const reader=response.body?.getReader();if(!reader)return {status:response.status};
   const parts=[];let size=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>64000)throw Error('bounded');parts.push(value);}}
   finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   return {status:response.status,data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
  }catch{return {status:0};}
  finally{clearTimeout(timer);await response?.body?.cancel().catch(()=>{});}
 }
 if(!accessToken){
  const exchange=await api('__stateless_token','POST');
  if(exchange.status!==200||typeof exchange.data?.access_token!=='string'||!exchange.data.access_token||exchange.data.access_token.length>12000)return {...proof,reason:'LINE_AUTHENTICATION_FAILED'};
  accessToken=exchange.data.access_token;
 }
 const info=await api('info');
 proof.credential_valid=info.status===200&&typeof info.data?.basicId==='string';
 proof.official_account_matches=proof.credential_valid&&info.data.basicId===expectedBasicId;
 if(!proof.official_account_matches)return {...proof,reason:proof.credential_valid?'LINE_ACCOUNT_MISMATCH':'LINE_CREDENTIAL_NOT_VERIFIED'};
 const webhook=await api('channel/webhook/endpoint');
 proof.webhook_configured=webhook.status===200&&webhook.data?.endpoint===WEBHOOK;
 proof.webhook_active=proof.webhook_configured&&webhook.data?.active===true;
 if(!proof.webhook_active)return {...proof,reason:proof.webhook_configured?'LINE_WEBHOOK_DISABLED':'LINE_WEBHOOK_ENDPOINT_NOT_VERIFIED'};
 // LINE sends an empty signed webhook, never a customer message. Never change its URL.
 const verified=await api('channel/webhook/test','POST');
 proof.signed_empty_webhook_verified=verified.status===200&&verified.data?.success===true&&verified.data?.statusCode===200;
 return {...proof,reason:proof.signed_empty_webhook_verified?'LINE_CONNECTION_VERIFIED':'LINE_SIGNED_WEBHOOK_NOT_VERIFIED'};
}

export function createReadinessHandler({authorize,admin,env,fetch:transport=globalThis.fetch,build='unrecorded',now=()=>Date.now()}){
 let cached=null,cachedAt=0,pending=null;
 return async req=>{
  const origin=req.headers.get('origin')||'';
  const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':origins.has(origin)?origin:SALES_ORIGIN,'vary':'Origin'};
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!origins.has(origin))return json({error:'Forbidden'},403);
  if(req.method==='OPTIONS')return new Response('ok',{headers:{...headers,'access-control-allow-headers':'authorization,content-type,apikey,x-client-info','access-control-allow-methods':'GET,POST,OPTIONS'}});
  if(req.method==='GET')return json({service:'website-sales-readiness',build});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
   const bearer=/^Bearer\s+(.+)$/i.exec(req.headers.get('authorization')||'')?.[1]||'';
   const auth=await authorize(bearer);
   if(!auth)return json({error:'ログインが必要です。'},401);
   if(!['administrator','ci'].includes(auth.kind))return json({error:'管理者権限が必要です。'},403);
   const raw=await req.text();if(raw.length>1024)return json({error:'Request too large'},413);
   let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid request'},400);}
   if(body?.action==='line_check'){
    const fresh=cached&&now()-cachedAt<60000;
    if(!fresh){
     if(!pending)pending=checkLineConnection({token:env('LINE_CHANNEL_ACCESS_TOKEN'),channelId:env('LINE_CHANNEL_ID'),channelSecret:env('LINE_CHANNEL_SECRET'),fetch:transport}).then(result=>{cached=result;cachedAt=now();return result;}).finally(()=>{pending=null;});
     await pending;
    }
    return json({ok:true,line:cached,cached:!!fresh,build,real_messages_sent:0,configuration_changed:false});
   }
   if(auth.kind==='ci')return json({error:'Forbidden'},403);
   if(body?.action!=='status')return json({error:'Unsupported action'},400);
   const {data:rows,error}=await admin.from('website_settings').select('key,value').in('key',['sales_identity','commercial_policy','sales_backup_attestation','bank_transfer','bank_transfer_test','line_owner','owner_line_acceptance_fixture']);
   if(error)return json({error:'設定状態を確認できませんでした。'},503);
   const settings=Object.fromEntries((rows||[]).map(x=>[x.key,x.value]));
   const schema=await admin.from('website_hosting_sites').select('site_id',{head:true,count:'exact'}).limit(0);
   const domain=env('CUSTOMER_BASE_DOMAIN')||'';
   const stableDomain=!!domain&&domain===env('CUSTOMER_HOSTING_DOMAIN_READY')&&!/(?:workers\.dev|pages\.dev|github\.io|netlify\.app|\.invalid|\.example)$/.test(domain);
   const keys=['CUSTOMER_R2_ACCOUNT_ID','CUSTOMER_R2_BUCKET','CUSTOMER_R2_ACCESS_KEY_ID','CUSTOMER_R2_SECRET_ACCESS_KEY'];
   const productionStorage=keys.every(k=>!!env(k))&&String(env('CUSTOMER_R2_ACCOUNT_ID')||'').trim()==='bdb1bb4a771be8595d5564d5d78cb1d4'&&String(env('CUSTOMER_R2_BUCKET')||'').trim()==='sho-customer-sites-production';
   const bank=String(settings.bank_transfer?.message||'');
   let lineTest=null;
   if(settings.owner_line_acceptance_fixture?.order_code==='9000001001'){
    const {data:order,error:orderError}=await admin.from('website_orders').select('status,line_user_id,line_link_token_hash,selections').eq('order_code','9000001001').maybeSingle();
    if(!orderError)lineTest=await ownerLineFixture(settings.owner_line_acceptance_fixture,order);
   }
   return json({ok:true,build,configuration:{seller_saved:['legal_name','address','phone','contact'].every(k=>!!settings.sales_identity?.[k]),
    commercial_policy_approved:settings.commercial_policy?.enabled===true,backup_attested:settings.sales_backup_attestation?.attested===true,
    owner_notifications_configured:!!env('LINE_OWNER_USER_ID')||!!settings.line_owner?.user_id,
    test_bank_saved:!!settings.bank_transfer_test?.message,production_bank_saved:!!bank&&!/(?:テスト|架空|0000000)/.test(bank),
    hosting_schema_installed:schema.error?(['PGRST205','42P01'].includes(schema.error.code)?false:null):true,
    hosting_mode_enabled:env('WEBSITE_CUSTOMER_HOSTING')==='cloudflare-r2',production_storage_configured:productionStorage,stable_domain_configured:stableDomain},
    line_test:lineTest,order_to_delivery_live_test_verified:false,real_messages_sent:0,configuration_changed:false});
  }catch{return json({error:'接続確認を完了できませんでした。'},503);}
 };
}
