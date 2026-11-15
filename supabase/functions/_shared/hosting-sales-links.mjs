import {CLOUDFLARE_SALES_ORIGIN,LEGACY_SALES_ORIGIN} from './sales-origin.ts';

// Server jobs have no browser Origin header. Pick their management links from
// the selected hosting mode, preserving the older route until the cutover.
export function workerSalesLinks(cloudflare,siteId,style=''){
 if(typeof cloudflare!=='boolean')throw Error('Explicit hosting mode required');
 const frontend=cloudflare?CLOUDFLARE_SALES_ORIGIN:LEGACY_SALES_ORIGIN;
 return {
  template:frontend+'/website-template-preview.html?style='+encodeURIComponent(style),
  preview:frontend+'/website-preview.html?id='+encodeURIComponent(siteId),
  review:(cloudflare?CLOUDFLARE_SALES_ORIGIN:'https://sho-support.github.io')+'/admin/index.html?site='+encodeURIComponent(siteId)
 };
}
