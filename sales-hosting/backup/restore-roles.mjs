// Managed CLI credentials are short-lived connection helpers, not application roles.
// Supabase's restore guide excludes their membership GRANT from a restored project.
const name='(?:cli_login_postgres|cli_login_supabase_read_only_user)';
const identifier='(?:"'+name+'"|'+name+')(?=\\s|;)';
const definitions=new RegExp('^(?:CREATE ROLE|ALTER ROLE|COMMENT ON ROLE)\\s+'+identifier,'i');
const memberships=new RegExp('^GRANT\\s+(?:'+identifier+'|[^;]+?\\s+TO\\s+'+identifier+')','i');
export function withoutEphemeralCliRoles(sql){
 if(typeof sql!=='string'||sql.length>1024*1024)throw Error('Invalid roles export');
 let excluded=0;
 const text=sql.split('\n').filter(line=>{
  if(!definitions.test(line)&&!memberships.test(line))return true;
  // Only pg_dumpall's single-line, terminated role statements are accepted here.
  if(!line.endsWith(';'))throw Error('Unexpected multiline managed CLI statement');
  excluded++;return false;
 }).join('\n');
 return {text,excluded};
}
