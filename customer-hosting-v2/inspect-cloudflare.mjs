import {inspectCloudflare} from './src/cloudflare-inventory.mjs';

const required = process.argv.includes('--require-private-preview');
const requireToken = required || process.argv.includes('--require-token');
const token = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
try {
  if (!token) {
    console.log(JSON.stringify({read_only:true,status:'not_configured',required_secret:'CLOUDFLARE_API_TOKEN'}));
    if (requireToken) process.exitCode = 1;
  } else {
    const result = await inspectCloudflare({token,
      accountId:process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || undefined,
      bucketName:process.env.CF_PREVIEW_BUCKET?.trim() || undefined});
    console.log(JSON.stringify(result,null,2));
    if (required && !result.configured_bucket_verified) {
      console.error('PRIVATE_STANDARD_PREVIEW_BUCKET_NOT_VERIFIED');
      process.exitCode = 1;
    }
    if (required && result.candidate_preview_host !== process.env.CF_PREVIEW_HOST) {
      console.error('VERIFIED_WORKERS_SUBDOMAIN_DOES_NOT_MATCH_PREVIEW_HOST');
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(JSON.stringify({read_only:true,status:'not_verified',code:error?.code || 'INVENTORY_FAILED',http_status:error?.status || null}));
  process.exitCode = 1;
}
