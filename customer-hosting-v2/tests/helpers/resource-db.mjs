import {PGlite} from '@electric-sql/pglite';
import {spawn} from 'node:child_process';
import {encryptBackup,decryptBackup} from '../../src/backup-envelope.mjs';
// A separate disposable database avoids colliding with the publication protocol test.
export async function resourceDatabase(){
  if(!process.env.HOSTING_QA_DATABASE_URL)return new PGlite();
  const u=new URL(process.env.HOSTING_QA_DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(u.protocol)||u.search||u.hash||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.pathname!=='/sho_hosting_qa')throw Error('Only the disposable local QA server is allowed');
  const {Client}=await import('pg'),control=new Client({connectionString:u.href});await control.connect();
  const name='sho_resource_qa_'+crypto.randomUUID().replaceAll('-','');
  await control.query('create database '+name);
  u.pathname='/'+name;const client=new Client({connectionString:u.href});await client.connect();
  const container=process.env.HOSTING_QA_PG_CONTAINER;
  if(container&&!/^[a-f0-9]{12,64}$/.test(container))throw Error('Unexpected disposable container identity');
  function command(args,input){return new Promise((resolve,reject)=>{
    const p=spawn('docker',['exec','-i',container,...args],{stdio:['pipe','pipe','pipe']}),parts=[];let bytes=0,diagnostic='';
    const timer=setTimeout(()=>{p.kill();reject(Error('Disposable backup command timed out'));},30000);
    p.on('error',reject);p.stdout.on('data',x=>{bytes+=x.length;if(bytes>8000000){p.kill();reject(Error('Synthetic backup exceeds 8MB'));}else parts.push(x);});
    p.stderr.on('data',x=>{diagnostic=(diagnostic+x).slice(-2000);});p.on('close',code=>{clearTimeout(timer);code===0?resolve(Buffer.concat(parts)):reject(Error('Disposable pg_dump/pg_restore failed: '+diagnostic));});p.stdin.on('error',()=>{});p.stdin.end(input);
  });}
  const backupRoundTrip=container?async()=>{
    const original=new Uint8Array(await command(['pg_dump','--username=hosting_qa','--no-password','--format=custom','--dbname='+name]));
    const key=crypto.getRandomValues(new Uint8Array(32)),scope='sho-web-support-application-db';
    const encrypted=await encryptBackup(original,key,scope),decrypted=await decryptBackup(encrypted,key,scope);
    if(Buffer.compare(Buffer.from(original),Buffer.from(decrypted)))throw Error('Encrypted database backup changed bytes');
    const restoredName='sho_resource_restore_'+crypto.randomUUID().replaceAll('-','');await control.query('create database '+restoredName);
    const restoredUrl=new URL(u.href);restoredUrl.pathname='/'+restoredName;const restored=new Client({connectionString:restoredUrl.href});await restored.connect();
    try{
      await command(['pg_restore','--username=hosting_qa','--no-password','--exit-on-error','--dbname='+restoredName],decrypted);
      const snapshot=async c=>(await c.query("select jsonb_build_object('limits',(select jsonb_agg(to_jsonb(t) order by id) from public.website_resource_limits t),'uploads',(select jsonb_agg(to_jsonb(t) order by reservation_id) from public.website_upload_reservations t),'charges',(select jsonb_agg(to_jsonb(t) order by request_id) from public.website_ai_charges t),'storage',(select jsonb_agg(to_jsonb(t) order by id) from storage.objects t)) as v")).rows[0].v;
      if(JSON.stringify(await snapshot(client))!==JSON.stringify(await snapshot(restored)))throw Error('Restored application records differ');
      await restored.query('set role anon');let denied=false;try{await restored.query('select * from public.website_ai_charges');}catch(e){denied=e.code==='42501';}if(!denied)throw Error('Restored anonymous privileges are unsafe');
      await restored.query('set role authenticated');denied=false;try{await restored.query("insert into storage.objects(bucket_id,name) values('website-intake-files','8100/restored-bypass.png')");}catch(e){denied=e.code==='42501';}if(!denied)throw Error('Restored Storage RLS is unsafe');
      return {encrypted_bytes:encrypted.length,dump_bytes:original.length,records_identical:true,anonymous_denied:true,storage_rls_restored:true,production_data:false};
    }finally{await restored.end();await control.query('drop database '+restoredName+' with (force)');}
  }:undefined;
  return {query:client.query.bind(client),exec:sql=>client.query(sql),
    backupRoundTrip,
    async independent(){const c=new Client({connectionString:u.href});await c.connect();return c;},
    async close(){try{await client.end();await control.query('drop database '+name+' with (force)');}finally{await control.end();}}};
}
