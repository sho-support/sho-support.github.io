import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, extname, basename, dirname, resolve } from 'node:path';

const root = process.cwd();
const output = join(root, 'dist');
const legacyOrigin = 'https://sho-support.github.io/';
const extraPages = new Set(['sho-support.html', 'support.html', 'band-homepage.html']);
const extraFiles = new Set(['website-client.js', 'website-config.js', 'website-track.js']);
const legacyPages = new Set(['index.html', 'about.html', 'gallery.html', 'support-us.html', 'support_payment_update.html']);

if (!existsSync(join(root, 'website-support.html'))) throw new Error('Missing website-support.html');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const files = readdirSync(root).filter(name =>
  (/^website-[\w.-]+\.(html|js|css)$/.test(name)) || extraPages.has(name) || extraFiles.has(name)
);
for (const file of files) {
  const source = join(root, file);
  const target = join(output, file);
  if (extname(file) === '.html') {
    let html = readFileSync(source, 'utf8');
    // Preserve the band portfolio's existing GitHub Pages destination.
    for (const legacy of legacyPages) {
      html = html.replaceAll('href="' + legacy, 'href="' + legacyOrigin + legacy);
      html = html.replaceAll("href='" + legacy, "href='" + legacyOrigin + legacy);
    }
    writeFileSync(target, html);
  } else {
    copyFileSync(source, target);
  }
}
cpSync(join(root, 'admin'), join(output, 'admin'), { recursive: true });
copyFileSync(join(output, 'website-support.html'), join(output, 'index.html'));

// Ensure all local HTML link targets resolve in the selected deploy package.
const failures = [];
function checkHtml(file) {
  const html = readFileSync(file, 'utf8');
  const refs = [...html.matchAll(/(?:href|src)=["']([^"'#]+)["']/g)].map(x => x[1]);
  for (const ref of refs) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(ref)) continue;
    const pathname = ref.split(/[?#]/)[0];
    if (!pathname) continue;
    const resolved = resolve(dirname(file), pathname);
    if (!existsSync(resolved)) failures.push(basename(file) + ': ' + ref);
  }
}
for (const f of readdirSync(output)) if (f.endsWith('.html')) checkHtml(join(output, f));
for (const f of readdirSync(join(output, 'admin'))) if (f.endsWith('.html')) checkHtml(join(output, 'admin', f));
if (failures.length) throw new Error('Missing local assets:\n' + failures.join('\n'));
// Pre-deploy regression checks: prevent common ordering failures from being published.
const orderHtml = readFileSync(join(root, 'website-order.html'), 'utf8');
const confirmHtml = readFileSync(join(root, 'website-order-confirm.html'), 'utf8');
const recoverHtml = readFileSync(join(root, 'website-recover.html'), 'utf8');
const recoverJs = readFileSync(join(root, 'website-recover.js'), 'utf8');
const adminOrders = readFileSync(join(root, 'admin', 'orders.html'), 'utf8');
const checks = [
  ['three order plans', ['one','semi','full'].every(p => orderHtml.includes('data-plan="' + p + '"'))],
  ['ten selectable templates', (orderHtml.match(/data-template="/g) || []).length === 10],
  ['initial selections empty', orderHtml.includes("state={plan:'',template:'',update:''")],
  ['explicit order editing', confirmHtml.includes('website-order.html?resume=1')],
  ['only explicit resume restores draft', orderHtml.includes("get('resume')==='1'")],
  ['full-order update defaults', orderHtml.includes("deepPlan==='semi'||deepPlan==='full'")],
  ['all basic prices match', [orderHtml, confirmHtml].every(s => s.includes('one:15000,semi:22000,full:30000'))],
  ['one-page monthly addition', [orderHtml,confirmHtml].every(s => s.includes("state.update==='unlimited'?7000:0"))],
  ['pay-as-you-go choice', orderHtml.includes("['none','都度払い")],
  ['monthly update choice', orderHtml.includes("['unlimited','月額プラン")],
  ['order receipt recovery', confirmHtml.includes('sho_web_order_pending_v1')],
  ['browser password recovery page', recoverHtml.includes('id="recoverForm"')],
  ['recover form hides on success', recoverJs.includes('form.hidden=true')],
  ['numeric order admin example', adminOrders.includes('placeholder="例：1000"')],
];
const broken = checks.filter(([,ok]) => !ok).map(([name]) => name);
if (broken.length) throw new Error('Sales regression checks failed: ' + broken.join(', '));
console.log('Sales regression checks passed (' + checks.length + ').');
console.log('Netlify sales staging ready (' + files.length + ' top-level files + admin).');
