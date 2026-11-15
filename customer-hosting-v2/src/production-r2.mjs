// Fixed HP production bucket only. No objects, credentials, public URLs or Workers are created.
export const PRODUCTION_R2_ACCOUNT='bdb1bb4a771be8595d5564d5d78cb1d4';
export const PRODUCTION_R2_BUCKET='sho-customer-sites-production';
const base='https://api.cloudflare.com/client/v4/accounts/'+PRODUCTION_R2_ACCOUNT+'/r2/buckets';
const fail=code=>Object.assign(new Error(code),{code});

export async function prepareProductionR2({token,accountId,createIfAbsent=false,fetch:transport=globalThis.fetch}){
  if(accountId!==PRODUCTION_R2_ACCOUNT||typeof token!=='string'||!/^[A-Za-z0-9_-]{20,256}$/.test(token)
    ||typeof createIfAbsent!=='boolean'||typeof transport!=='function')throw fail('INVALID_PRODUCTION_R2_CONFIGURATION');
  const proof={account_id:accountId,bucket:PRODUCTION_R2_BUCKET,ready:false,created:false,creation_attempted:false,
    objects_written:false,public_access_changed:false,worker_changed:false,credentials_created:false};
  async function request(url,method='GET'){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);let r;
    try{
      r=await transport(url,{method,redirect:'error',signal:controller.signal,
        headers:{authorization:'Bearer '+token,accept:'application/json','content-type':'application/json','cf-r2-jurisdiction':'default'},
        ...(method==='POST'?{body:JSON.stringify({name:PRODUCTION_R2_BUCKET,locationHint:'apac',storageClass:'Standard'})}:{})});
      if([401,403,404].includes(r.status))return {status:r.status};
      if(![200,201].includes(r.status))throw fail('PRODUCTION_R2_HTTP_ERROR');
      if(Number(r.headers.get('content-length')||0)>1048576)throw fail('PRODUCTION_R2_RESPONSE_TOO_LARGE');
      const reader=r.body?.getReader();if(!reader)throw fail('INVALID_PRODUCTION_R2_RESPONSE');
      const chunks=[];let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576)throw fail('PRODUCTION_R2_RESPONSE_TOO_LARGE');chunks.push(value);}}
      finally{reader.releaseLock();}
      const bytes=new Uint8Array(size);let at=0;for(const x of chunks){bytes.set(x,at);at+=x.byteLength;}
      let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail('INVALID_PRODUCTION_R2_RESPONSE');}
      if(data?.success!==true||!Object.hasOwn(data,'result'))throw fail('INVALID_PRODUCTION_R2_RESPONSE');
      return {status:r.status,result:data.result};
    }catch(error){throw fail(/^PRODUCTION_R2_|^INVALID_PRODUCTION_R2_/.test(error?.code||'')?error.code:'PRODUCTION_R2_TRANSPORT_ERROR');}
    finally{clearTimeout(timer);await r?.body?.cancel().catch(()=>{});}
  }
  const target=base+'/'+PRODUCTION_R2_BUCKET;
  let detail=await request(target);
  if([401,403].includes(detail.status))return {...proof,status:'permission_blocked',stage:'inspect',http_status:detail.status};
  if(detail.status===404){
    if(!createIfAbsent)return {...proof,status:'absent'};
    proof.creation_attempted=true;
    let created;
    try{created=await request(base,'POST');}
    catch{return {...proof,status:'creation_uncertain',automatic_retry_allowed:false};}
    if([401,403].includes(created.status))return {...proof,status:'permission_blocked',stage:'create',http_status:created.status};
    if(created.status===404)return {...proof,status:'creation_not_verified',automatic_retry_allowed:false};
    proof.created=true;
    detail=await request(target);
  }
  if(detail.status!==200||detail.result?.name!==PRODUCTION_R2_BUCKET
    ||detail.result?.storage_class!=='Standard'||!['default',undefined].includes(detail.result?.jurisdiction))throw fail('PRODUCTION_R2_BUCKET_MISMATCH');
  const managed=await request(target+'/domains/managed'),custom=await request(target+'/domains/custom');
  if([managed,custom].some(x=>[401,403].includes(x.status)))return {...proof,status:'permission_blocked',stage:'verify_private_access'};
  if(managed.status!==200||typeof managed.result?.enabled!=='boolean'||custom.status!==200
    ||!Array.isArray(custom.result?.domains)||custom.result.domains.some(x=>typeof x?.enabled!=='boolean'))throw fail('INVALID_PRODUCTION_R2_DOMAINS');
  const privateAccess=managed.result.enabled===false&&custom.result.domains.every(x=>x.enabled===false);
  return {...proof,status:privateAccess?'private_bucket_verified':'public_access_requires_review',ready:privateAccess,
    storage_class:'Standard',r2_dev_enabled:managed.result.enabled,enabled_custom_domain_count:custom.result.domains.filter(x=>x.enabled).length};
}
