// Customer-hosting gateway for a Cloudflare Worker on a proxied wildcard route.
// Does not deploy unless configured and explicitly released.
import {handleCustomerRequest} from "./src/site-router.mjs";
export default {
  async fetch(request,env) {
    return handleCustomerRequest(request,env);
  }
};
