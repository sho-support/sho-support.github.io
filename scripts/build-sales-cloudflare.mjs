// Reuse the existing sales-only package and its price/link regression checks.
import './build-sales-netlify.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const config = JSON.parse(readFileSync('sales-hosting/wrangler.preview.json', 'utf8'));
assert.equal(config.name, 'sho-web-support-preview');
assert.equal(config.workers_dev, true);
assert.equal(config.preview_urls, false);
assert.deepEqual(config.routes, []);
assert.equal(config.assets.directory, '../dist-cloudflare');
assert.deepEqual(Object.keys(config).sort(), ['$schema', 'assets', 'compatibility_date', 'name', 'preview_urls', 'routes', 'workers_dev'].sort());
assert.deepEqual(Object.keys(config.assets).sort(), ['directory', 'html_handling']);

const target = 'dist-cloudflare';
rmSync(target, { recursive: true, force: true });
cpSync('dist', target, { recursive: true });
const headers = '/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n';
writeFileSync(join(target, '_headers'), headers);
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = join(dir, entry.name);
    assert(!entry.isSymbolicLink(), 'No symlinks in deploy package');
    if (entry.isDirectory()) { walk(name); continue; }
    const path = relative(target, name).replaceAll('\\', '/');
    if (path === '_headers') continue;
    assert(/^(?:index\.html|website-[\w.-]+\.(?:html|js|css)|(?:sho-support|support|band-homepage)\.html|admin\/[\w.-]+\.html)$/.test(path), `Unexpected deploy file: ${path}`);
    const bytes = readFileSync(name);
    assert(statSync(name).size <= 25 * 1024 * 1024, `Oversized asset: ${path}`);
    files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
}
walk(target);
assert(files.some(f => f.path === 'admin/sales-settings.html'));
assert(files.some(f => f.path === 'website-hosting-offer.js'));
assert(files.length < 20000);
files.sort((a, b) => a.path.localeCompare(b.path));
mkdirSync('test-results/sales-cloudflare', { recursive: true });
writeFileSync('test-results/sales-cloudflare/package.json', JSON.stringify({
  source_commit: process.env.GITHUB_SHA || null,
  preview_only: true,
  worker_script: false,
  customer_r2_bindings: false,
  production_dns_routes: false,
  files,
}, null, 2) + '\n');
console.log(`Cloudflare sales preview prepared: ${files.length} static files + _headers. No Worker code or storage bindings.`);
