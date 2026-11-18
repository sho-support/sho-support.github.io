import test from 'node:test';
import assert from 'node:assert/strict';
import {extensionSecurityRestore} from '../backup/restore-extension-security.mjs';
const rows=()=>[['extensions','pg_stat_statements','pg_stat_statements','v'],['extensions','pg_stat_statements_info','pg_stat_statements','v'],
 ['net','_http_response','pg_net','r'],['net','http_request_queue','pg_net','r'],['net','http_request_queue_id_seq','pg_net','S'],
 ['vault','decrypted_secrets','supabase_vault','v'],['vault','secrets','supabase_vault','r']].map(([schema,name,extension,kind])=>({schema,name,extension,kind,owner:'postgres',acl_present:true,
 grants:[{grantee:'postgres',grantor:'postgres',privilege:'SELECT',grantable:true},{grantee:'PUBLIC',grantor:'postgres',privilege:'SELECT',grantable:false}]}));
test('isolated restore retains owners, grantors, grant options and removes extra target grants',()=>{
 const source=rows(),target=rows();target[0].grants.push({grantee:'old"reader',privilege:'UPDATE',grantor:'supabase_admin',grantable:false});
 const sql=extensionSecurityRestore(source,target);
 assert.match(sql,/ALTER VIEW "extensions"\."pg_stat_statements" OWNER TO "postgres"/);
 assert.match(sql,/FROM PUBLIC,"postgres","old""reader" CASCADE/);
 assert.match(sql,/TO "postgres" WITH GRANT OPTION GRANTED BY "postgres"/);
 assert.match(sql,/GRANT SELECT ON SEQUENCE "net"\."http_request_queue_id_seq"/);
 assert.ok(sql.startsWith('BEGIN;'));assert.ok(sql.endsWith('COMMIT;'));
});
test('unsupported extensions, objects, grantors and public grant options fail closed',()=>{
 for(const mutate of [s=>s[0].extension='other',s=>s[0].name='other',s=>s[0].grants[0].grantor='other',s=>s[0].grants[1].grantable=true,s=>s[4].grants[0].privilege='INSERT']){
  const source=rows();mutate(source);assert.throws(()=>extensionSecurityRestore(source,rows()));
 }
 assert.throws(()=>extensionSecurityRestore(rows().slice(1),rows()));
 assert.throws(()=>extensionSecurityRestore(rows(),rows().slice(1)));
});
