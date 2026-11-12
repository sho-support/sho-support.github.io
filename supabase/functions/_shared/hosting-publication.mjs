import {activateRelease,deactivateRelease,fencePublication,readPublication,verifyStagedRelease}
  from './hosting-release-publisher.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');

export class PublicationUncertainError extends Error {
  constructor(operationId,cause){super('Publication result needs reconciliation',{cause});this.name='PublicationUncertainError';this.operationId=operationId;}
}

// db is a server-side service-role adapter, never a browser client. R2 is scoped to one public site ID.
// A SQL claim is durable across the external call. There is no timeout that silently unlocks it.
export function createHostingPublisher({db,storeForSite}){
  if(!db||typeof storeForSite!=='function')throw new Error('Server database and scoped R2 store required');
  const rpc=async(name,args)=>db.rpc('website_hosting_'+name,args);
  const uncertain=async(id,cause)=>{
    try{await rpc('mark_uncertain',{p_operation:id,p_error:'external_result_unknown'});}catch{/* A DB outage must retain the original durable lock. */}
    return new PublicationUncertainError(id,cause);
  };
  async function authorize(op){
    const [latest,h]=await Promise.all([db.operation(op.operation_id),db.hosting(op.site_id)]);
    return !!latest&&!!h&&['writing','reconcile'].includes(latest.state)
      &&h.active_operation_id===op.operation_id&&latest.actor_id===op.actor_id
      &&latest.site_id===op.site_id&&latest.kind===op.kind&&latest.release_id===op.release_id;
  }
  async function verifyRelease(bucket,op){
    if(op.kind==='private')return;
    const r=await db.release(op.site_id,op.release_id);
    if(!r||!r.approved_at||(op.kind==='rollback'&&!r.published_at))throw new Error('Approved release identity is missing');
    const manifest=await verifyStagedRelease({bucket,siteId:op.public_site_id,releaseId:op.release_id});
    const body=await bucket.get(`sites/${op.public_site_id}/release-manifests/${op.release_id}.json`);
    if(!body||await hash(await body.text())!==r.manifest_sha256)throw new Error('Frozen release manifest changed');
    return manifest;
  }
  const matches=(p,op)=>!!p&&p.publication_id===op.operation_id&&p.site_id===op.public_site_id
    &&p.status===(op.kind==='private'?'private':'live')&&p.release===op.release_id;
  const fenced=(p,op)=>!!p&&p.publication_id===op.fence_id&&p.site_id===op.public_site_id
    &&p.status===(op.base_pointer?.status??'private')&&p.release===(op.base_pointer?.release??null);
  async function finish(op,bucket,pointer,isFence=false){
    if(isFence?!fenced(pointer,op):!matches(pointer,op))throw new Error('Unconfirmed publication pointer');
    if(!isFence)await verifyRelease(bucket,op);
    const result=await rpc('finalize',{p_operation:op.operation_id,p_pointer:pointer,p_fenced:isFence});
    return {ok:true,operation_id:op.operation_id,state:result.state,public_url:op.public_url,release_id:pointer.release};
  }
  async function operationContext(siteId,operationId,actorId){
    const [op,h]=await Promise.all([db.operation(operationId),db.hosting(siteId)]);
    if(!op||!h||op.site_id!==siteId||op.actor_id!==actorId)throw new Error('Publication operation not found for this administrator');
    // Revalidate current administrator membership even for an idempotent recovery request.
    await rpc('require_admin',{p_actor:actorId});
    return {...op,public_site_id:h.public_site_id,public_url:h.public_url};
  }
  async function reconcile({siteId,operationId,actorId}){
    if(!uuid.test(operationId||'')||!uuid.test(actorId||''))throw new Error('Valid operation and administrator IDs required');
    const op=await operationContext(siteId,operationId,actorId);
    if(['committed','fenced'].includes(op.state))return {ok:true,operation_id:op.operation_id,state:op.state,public_url:op.public_url,release_id:op.result_pointer?.release??null};
    const bucket=storeForSite(op.public_site_id);
    try{
      if(!await authorize(op))throw new Error('Publication operation lock changed');
      let p=await readPublication({bucket,siteId:op.public_site_id});
      if(matches(p,op))return await finish(op,bucket,p);
      if(fenced(p,op))return await finish(op,bucket,p,true);
      // A GET showing the old state is NOT proof the timed-out write cannot still arrive.
      // Use the EXACT baseline persisted before the attempt. Never fence a freshly read winner.
      try{
        await fencePublication({bucket,siteId:op.public_site_id,expectedPointer:op.base_pointer,
          publicationId:op.fence_id,authorize:()=>authorize(op)});
      }catch{
        // Either the original write or our fence may have succeeded with a lost response.
        // An unrelated winner is never overwritten and leaves the lock for investigation.
      }
      p=await readPublication({bucket,siteId:op.public_site_id});
      if(matches(p,op))return await finish(op,bucket,p);
      if(fenced(p,op))return await finish(op,bucket,p,true);
      throw new Error('R2 publication still has an unrecognized result');
    }catch(e){throw await uncertain(op.operation_id,e);}
  }
  async function publish({siteId,actorId,releaseId,kind='publish',operationId=crypto.randomUUID()}){
    if(!uuid.test(operationId)||!uuid.test(actorId||''))throw new Error('Valid operation and administrator IDs required');
    const h=await db.hosting(siteId);
    if(!h)throw new Error('Site has no Cloudflare hosting mapping');
    const bucket=storeForSite(h.public_site_id);
    const base=await readPublication({bucket,siteId:h.public_site_id});
    const op=await rpc('claim',{p_actor:actorId,p_site:siteId,p_operation:operationId,p_kind:kind,p_release:releaseId,p_base:base});
    // A repeated operation is reconciled, NEVER sent to R2 as a second publication attempt.
    if(op.reused)return reconcile({siteId,actorId,operationId});
    try{
      await verifyRelease(bucket,op);
      const args={bucket,siteId:op.public_site_id,expectedCurrentRelease:base?.release??null,
        expectedPublicationId:base?.publication_id??null,publicationId:op.operation_id,authorize:()=>authorize(op)};
      if(kind==='private')await deactivateRelease(args);
      else await activateRelease({...args,releaseId:op.release_id});
      const current=await readPublication({bucket,siteId:op.public_site_id});
      return await finish(op,bucket,current);
    }catch(e){throw await uncertain(op.operation_id,e);}
  }
  return {publish,reconcile};
}

// Narrow PostgREST adapter: errors cannot be mistaken for empty successful responses.
export function supabaseHostingDatabase(admin){
  const one=async(table,filters)=>{
    let q=admin.from(table).select('*');for(const [key,value] of Object.entries(filters))q=q.eq(key,value);
    const {data,error}=await q.maybeSingle();if(error)throw error;return data;
  };
  return {
    rpc:async(name,args)=>{const {data,error}=await admin.rpc(name,args);if(error)throw error;return data;},
    hosting:siteId=>one('website_hosting_sites',{site_id:siteId}),
    operation:operationId=>one('website_hosting_operations',{operation_id:operationId}),
    release:(siteId,releaseId)=>one('website_hosting_releases',{site_id:siteId,release_id:releaseId})
  };
}
