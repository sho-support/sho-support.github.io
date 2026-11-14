export function cloudflareHostingEnabled(): boolean {
  const mode=Deno.env.get('WEBSITE_CUSTOMER_HOSTING')||'';
  if(mode&&mode!=='cloudflare-r2')throw new Error('Unknown customer hosting provider; publication stopped');
  return mode==='cloudflare-r2';
}
export function blockLegacyPages(): void {
  if(cloudflareHostingEnabled())throw new Error('GitHub Pages publication is disabled for Cloudflare customer hosting');
}
