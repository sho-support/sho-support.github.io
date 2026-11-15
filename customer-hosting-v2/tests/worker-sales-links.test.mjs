import test from 'node:test';
import assert from 'node:assert/strict';
import {workerSalesLinks} from '../../supabase/functions/_shared/hosting-sales-links.mjs';
test('Cloudflare jobs send owners and previews to the current sales application',()=>{
 const links=workerSalesLinks(true,'1234','rock');
 assert.equal(links.review,'https://sho-web-support-preview.zodiac-suu.workers.dev/admin/index.html?site=1234');
 for(const url of Object.values(links))assert.equal(new URL(url).origin,'https://sho-web-support-preview.zodiac-suu.workers.dev');
});
test('the older mode preserves its existing template, preview and owner destinations',()=>{
 const links=workerSalesLinks(false,'1234','rock');
 assert.equal(links.template,'https://sho-web-support.netlify.app/website-template-preview.html?style=rock');
 assert.equal(links.preview,'https://sho-web-support.netlify.app/website-preview.html?id=1234');
 assert.equal(links.review,'https://sho-support.github.io/admin/index.html?site=1234');
});
test('site identifiers cannot turn job notifications into an external link',()=>{
 const links=workerSalesLinks(true,'x/y?next=https://evil.invalid#fragment','rock&other=value');
 for(const url of Object.values(links))assert.equal(new URL(url).origin,'https://sho-web-support-preview.zodiac-suu.workers.dev');
 assert.equal(new URL(links.review).searchParams.get('site'),'x/y?next=https://evil.invalid#fragment');
 assert.throws(()=>workerSalesLinks('true','1234'),/Explicit/);
});
