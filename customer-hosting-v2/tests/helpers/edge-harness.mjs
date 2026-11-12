import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

export function postgrestFixture(sql){
  const word=s=>{if(!/^[a-z_]+$/.test(s))throw new Error('Unsafe fixture SQL identifier');return s;};
  const client={
    rpc:async(name,args)=>{try{
      const entries=Object.entries(args);
      const r=await sql.query('select public.'+word(name)+'('+entries.map(([key],i)=>word(key)+' => $'+(i+1)).join(',')+') as r',entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v));
      return {data:r.rows[0].r,error:null};
    }catch(error){return {data:null,error};}},
    from(table){
      word(table);let filters=[],updates=null,limit=null;
      const run=async single=>{try{
        const values=[];let query;
        if(updates){query='update public.'+table+' set '+Object.entries(updates).map(([k,v])=>{values.push(v);return word(k)+'=$'+values.length;}).join(',');}
        else query='select * from public.'+table;
        if(filters.length)query+=' where '+filters.map(([k,v])=>{values.push(v);return word(k)+'=$'+values.length;}).join(' and ');
        if(updates)query+=' returning *';else if(limit)query+=' limit '+limit;
        const r=await sql.query(query,values);
        if(single&&r.rows.length>1)throw new Error('Fixture query returned multiple rows');
        return {data:single?r.rows[0]??null:r.rows,error:null};
      }catch(error){return {data:null,error};}};
      const b={select(){return b;},eq(k,v){filters.push([k,v]);return b;},limit(n){limit=n;return b;},
        update(v){updates=v;return b;},maybeSingle(){return run(true);},single(){return run(true);},then(ok,no){return run(false).then(ok,no);}};
      return b;
    }
  };
  return client;
}

export async function edgeHarness({slug,admin,bucket,users={},env={},legacyHelper=false,fetcher,roleResolver}){
  let handler;const messages=[],background=[],requests=[];
  const helpers={
    adminClient:()=>admin,corsHeaders:{'Access-Control-Allow-Origin':'*'},
    json:(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}),
    getUser:async req=>users[req.headers.get('authorization')?.replace(/^Bearer /,'')]??null,
    siteRole:roleResolver||(async()=>{throw new Error('Unexpected legacy role route');}),
    linePush:async(to,text,retryKey)=>{messages.push({to,text,retryKey});return {ok:!!to,skipped:!to};},
    notifyOwner:async text=>{messages.push({to:'fixture-owner',text});return {ok:true};},
    triggerWebsiteWorker:async siteId=>{background.push(siteId);return {ok:true};},
    setGithubPagesSource:async()=>{throw new Error('Legacy Pages route reached');},
    setGithubPagesDomain:async()=>{throw new Error('Legacy Pages route reached');},
    publishApprovedStagedBranch:async()=>{throw new Error('Legacy merge route reached');},
    verifyWebsiteBeforeDelivery:async()=>{throw new Error('Mutable GitHub quality route reached');},
    requireStablePublicationUrl:async()=>{throw new Error('Legacy public URL route reached');},
    normalizeCustomerHostname:()=>{throw new Error('Legacy custom domain route reached');},
    freeWebsiteUrl:()=>{throw new Error('Legacy free URL route reached');},
    resolveFreeWebsiteUrl:async()=>{throw new Error('Legacy free URL lookup reached');}
  };
  const context=vm.createContext({Request,Response,Headers,URL,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,structuredClone,
    AbortController,AbortSignal,crypto,setTimeout,clearTimeout,atob,btoa,
    console:{log(){},warn(){},error(){}},
    Deno:{env:{get:name=>env[name]},serve:fn=>{handler=fn;}},EdgeRuntime:{waitUntil:p=>{background.push(p);}},
    fetch:async(...args)=>{requests.push(args);if(fetcher)return fetcher(...args);throw new Error('External network request blocked in Edge Function test');}});
  const cache=new Map();
  const synthetic=(id,exports)=>{if(!cache.has(id))cache.set(id,new vm.SyntheticModule(Object.keys(exports),function(){for(const[k,v]of Object.entries(exports))this.setExport(k,v);},{context,identifier:id}));return cache.get(id);};
  const get=async url=>{
    if(cache.has(url))return cache.get(url);
    if(url.endsWith('/_shared/website.ts')&&!legacyHelper)return synthetic(url,helpers);
    if(url.endsWith('/_shared/customer-r2.ts'))return synthetic(url,{customerR2Store:id=>({
      get:(key,...x)=>{if(!key.startsWith('sites/'+id+'/'))throw new Error('Cross-site test store read');return bucket.get(key,...x);},
      head:(key,...x)=>{if(!key.startsWith('sites/'+id+'/'))throw new Error('Cross-site test store head');return bucket.head(key,...x);},
      put:(key,...x)=>{if(!key.startsWith('sites/'+id+'/'))throw new Error('Cross-site test store write');return bucket.put(key,...x);}
    })});
    if(url.startsWith('https://esm.sh/@supabase/supabase-js@'))return synthetic(url,{createClient:()=>admin});
    if(!url.startsWith('file:'))throw new Error('Unapproved Edge Function import: '+url);
    let code=await readFile(new URL(url),'utf8');if(url.endsWith('.ts'))code=stripTypeScriptTypes(code);
    const module=new vm.SourceTextModule(code,{context,identifier:url});cache.set(url,module);return module;
  };
  const root=new URL(`../../../supabase/functions/${slug}`,import.meta.url).href;
  const module=await get(root);await module.link((specifier,ref)=>get(new URL(specifier,ref.identifier).href));await module.evaluate();
  return {handler,module,messages,background,requests};
}
