import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

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
    const resolved = join(output, pathname.replace(/^\//, ''));
    if (!existsSync(resolved)) failures.push(basename(file) + ': ' + ref);
  }
}
for (const f of readdirSync(output)) if (f.endsWith('.html')) checkHtml(join(output, f));
for (const f of readdirSync(join(output, 'admin'))) if (f.endsWith('.html')) checkHtml(join(output, 'admin', f));
if (failures.length) throw new Error('Missing local assets:\n' + failures.join('\n'));
console.log('Netlify sales staging ready (' + files.length + ' top-level files + admin).');
