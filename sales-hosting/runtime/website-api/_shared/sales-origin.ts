// Only these verified frontends may supply a return origin. A request header is
// never used as a URL without an exact match, including its scheme and port.
export const LEGACY_SALES_ORIGIN = 'https://sho-web-support.netlify.app';
export const CLOUDFLARE_SALES_ORIGIN = 'https://sho-web-support-preview.zodiac-suu.workers.dev';
export const SALES_ORIGINS = new Set([
  LEGACY_SALES_ORIGIN,
  CLOUDFLARE_SALES_ORIGIN,
  'https://sho-support.github.io',
]);

export function salesOrigin(req: Request): string {
  const origin = req.headers.get('origin') || '';
  // Existing GitHub/server callers previously received Netlify links. Preserve
  // that behavior; only the new verified frontend selects a new return origin.
  return origin === CLOUDFLARE_SALES_ORIGIN ? origin : LEGACY_SALES_ORIGIN;
}

export function salesUrl(req: Request, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('Invalid sales return path');
  }
  const result = new URL(path, salesOrigin(req));
  if (result.origin !== salesOrigin(req)) throw new Error('Invalid sales return origin');
  return result.href;
}

// Setting this flag is a separate, explicit step AFTER the Auth redirect
// allowlist has been checked. Never send mail that silently falls back to an
// unrelated SITE_URL when a new frontend has not been configured in Auth.
export function authRedirectReady(req: Request, confirmedOrigin: string): boolean {
  return salesOrigin(req) !== CLOUDFLARE_SALES_ORIGIN || confirmedOrigin === CLOUDFLARE_SALES_ORIGIN;
}
