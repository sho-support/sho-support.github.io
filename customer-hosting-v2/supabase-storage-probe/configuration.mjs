const names=['CUSTOMER_R2_ACCOUNT_ID','CUSTOMER_R2_BUCKET','CUSTOMER_R2_ACCESS_KEY_ID','CUSTOMER_R2_SECRET_ACCESS_KEY'];
export function readinessSummary(get){
 const values=Object.fromEntries(names.map(n=>[n,get(n)||'']));
 return {configured:Object.fromEntries(names.map(n=>[n,Boolean(values[n])])),
   account_matches:values.CUSTOMER_R2_ACCOUNT_ID==='bdb1bb4a771be8595d5564d5d78cb1d4',
   bucket_is_preview:values.CUSTOMER_R2_BUCKET==='sho-customer-sites-preview',
   hosting_enabled:get('WEBSITE_CUSTOMER_HOSTING')==='cloudflare-r2',
   database_url_available:Boolean(get('SUPABASE_DB_URL'))};
}
