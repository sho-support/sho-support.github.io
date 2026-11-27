import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createR2S3Store } from './customer-r2.mjs';

// Not wired into production handlers until approvals/DB recovery and live R2 tests pass.
// Credentials must be bucket-scoped Object Read & Write keys in Edge Function Secrets.
export function customerR2Store(siteId: string) {
  if (Deno.env.get('WEBSITE_CUSTOMER_HOSTING') !== 'cloudflare-r2') {
    throw new Error('Cloudflare customer hosting is not enabled');
  }
  const accountId = Deno.env.get('CUSTOMER_R2_ACCOUNT_ID');
  const bucketName = Deno.env.get('CUSTOMER_R2_BUCKET');
  const accessKeyId = Deno.env.get('CUSTOMER_R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('CUSTOMER_R2_SECRET_ACCESS_KEY');
  if (!accessKeyId || !secretAccessKey) throw new Error('R2 server credentials are not configured');
  const signer = new AwsClient({accessKeyId, secretAccessKey, region: 'auto', service: 's3', retries: 0});
  return createR2S3Store({accountId, bucketName, siteId, sign: signer.sign.bind(signer)});
}
