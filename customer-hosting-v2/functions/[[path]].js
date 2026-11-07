import {handleCustomerRequest} from "../src/site-router.mjs";

export async function onRequest(context) {
  return handleCustomerRequest(context.request,context.env);
}
