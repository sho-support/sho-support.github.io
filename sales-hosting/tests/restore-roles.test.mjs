import test from 'node:test';
import assert from 'node:assert/strict';
import {withoutEphemeralCliRoles} from '../backup/restore-roles.mjs';
test('only the two expiring CLI helper roles and their memberships are omitted',()=>{
 const lines=['CREATE ROLE cli_login_postgres;','ALTER ROLE "cli_login_supabase_read_only_user" WITH LOGIN;',
  'GRANT postgres TO cli_login_postgres WITH INHERIT FALSE GRANTED BY supabase_admin;',
  'GRANT "supabase_read_only_user" TO "cli_login_supabase_read_only_user" WITH INHERIT TRUE GRANTED BY "supabase_admin";'];
 const result=withoutEphemeralCliRoles(lines.join('\n'));assert.equal(result.excluded,4);assert.equal(result.text,'');
});
test('application roles, grants, quoted values and similarly named roles are retained exactly',()=>{
 const sql=['CREATE ROLE app_cli_login_postgres_backup;','ALTER ROLE app_user WITH LOGIN;',
  "ALTER ROLE app_user SET application_name TO 'cli_login_postgres';",'GRANT app_user TO authenticated;',
  'GRANT postgres TO app_cli_login_postgres_backup;',"COMMENT ON ROLE app_user IS 'cli_login_postgres';",'-- GRANT postgres TO cli_login_postgres;'].join('\n');
 assert.deepEqual(withoutEphemeralCliRoles(sql),{text:sql,excluded:0});
});
test('an unexpected managed role statement cannot be silently partially removed',()=>{
 assert.throws(()=>withoutEphemeralCliRoles('ALTER ROLE cli_login_postgres SET application_name TO'));
});
