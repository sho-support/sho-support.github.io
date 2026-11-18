// pg_dump recreates extension members through CREATE EXTENSION. Their original
// owner can differ from the isolated bootstrap owner, so preserve it explicitly.
const supported=new Map([
 ['extensions.pg_stat_statements','pg_stat_statements'],
 ['extensions.pg_stat_statements_info','pg_stat_statements'],
 ['net._http_response','pg_net'],['net.http_request_queue','pg_net'],
 ['net.http_request_queue_id_seq','pg_net'],
 ['vault.decrypted_secrets','supabase_vault'],['vault.secrets','supabase_vault']
]);
const quote=x=>'"'+String(x).replaceAll('"','""')+'"';
const privileges=new Set(['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN','USAGE']);
export function extensionSecurityRestore(source,target){
 if(!Array.isArray(source)||source.length!==supported.size||!Array.isArray(target))throw Error('Unexpected extension relations');
 const seen=new Set(),sql=['BEGIN;'];
 for(const relation of source){
  const id=relation.schema+'.'+relation.name;
  if(seen.has(id)||supported.get(id)!==relation.extension||!['r','v','S'].includes(relation.kind)
   ||!['postgres','supabase_admin'].includes(relation.owner)||relation.acl_present!==true||!Array.isArray(relation.grants)||!relation.grants.length)throw Error('Unexpected extension security');
  seen.add(id);
  const existing=target.find(t=>t.schema===relation.schema&&t.name===relation.name);
  if(!existing||existing.extension!==relation.extension||existing.kind!==relation.kind||!Array.isArray(existing.grants))throw Error('Missing extension target');
  const grantees=new Set(['PUBLIC']);
  for(const grant of [...relation.grants,...existing.grants]){
   if(typeof grant.grantee!=='string'||!grant.grantee.length||grant.grantee.includes('\0'))throw Error('Invalid extension grantee');
   grantees.add(grant.grantee);
  }
  const object=quote(relation.schema)+'.'+quote(relation.name),kind=relation.kind==='S'?'SEQUENCE':relation.kind==='v'?'VIEW':'TABLE';
  sql.push(`ALTER ${kind} ${object} OWNER TO ${quote(relation.owner)};`,`SET LOCAL ROLE ${quote(relation.owner)};`,
   `REVOKE ALL PRIVILEGES ON ${relation.kind==='S'?'SEQUENCE':'TABLE'} ${object} FROM ${[...grantees].map(g=>g==='PUBLIC'?'PUBLIC':quote(g)).join(',')} CASCADE;`);
  for(const grant of relation.grants){
   if(grant.grantor!==relation.owner||!privileges.has(grant.privilege)||typeof grant.grantable!=='boolean'
    ||grant.grantee==='PUBLIC'&&grant.grantable||relation.kind==='S'&&!['SELECT','UPDATE','USAGE'].includes(grant.privilege))throw Error('Unsupported extension grant');
   sql.push(`GRANT ${grant.privilege} ON ${relation.kind==='S'?'SEQUENCE':'TABLE'} ${object} TO ${grant.grantee==='PUBLIC'?'PUBLIC':quote(grant.grantee)}${grant.grantable?' WITH GRANT OPTION':''} GRANTED BY ${quote(grant.grantor)};`);
  }
  sql.push('RESET ROLE;');
 }
 sql.push('COMMIT;');return sql.join('\n');
}
