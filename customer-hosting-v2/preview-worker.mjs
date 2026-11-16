// Dedicated test entry point. It can only display the reserved fictional test site.
// Production routes must continue using worker.mjs, which has no host rewriting.
import {handleCustomerRequest} from './src/site-router.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const expectedHost = String(env.TEST_WORKER_HOST || '').toLowerCase();
    if (!/^sho-customer-sites-preview\.[a-z0-9-]+\.workers\.dev$/.test(expectedHost)) {
      return new Response('Test hostname is not configured', {status: 503});
    }
    if (url.hostname !== expectedHost) return new Response('Not found', {status: 404});
    // URL parameters, paths and request headers cannot select a different customer.
    url.hostname = 's9000001000.customer-preview.invalid';
    const response = await handleCustomerRequest(new Request(url, request), {
      SITES: env.SITES, CUSTOMER_BASE_DOMAIN: 'customer-preview.invalid'
    });
    const headers = new Headers(response.headers);
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    headers.set('X-SHO-Environment', 'customer-hosting-preview');
    return new Response(response.body, {status: response.status, headers});
  }
};
