# Netlify販売サイト移行・検証用ブランチ
This branch is an isolated **staging** configuration. Do not deploy main as the Netlify site's default branch: main/index.html belongs to Guns N' Loses.

Netlify import: repository `sho-support/sho-support.github.io`, branch `netlify-sales-staging`, build command `node scripts/build-sales-netlify.mjs`, publish directory `dist`.

The build copies SHO WEB SUPPORT sales pages, admin pages and their shared assets, and sets `dist/index.html` to the sales landing page. Links to the original band website stay on GitHub Pages. No customer content, private credentials or Supabase source files are copied into dist.

**Do not switch the official URL or accept paid orders yet.** Before publication check:
1. Full route navigation and form flows on desktop/mobile; verify no 404 or broken external links.
2. Supabase Auth redirect allowlist for the new Netlify host; use actual host name, not guessed domain.
3. Supabase Edge Functions CORS/auth/origin checks and order creation (one disposable TEST order only).
4. LINE order-pairing, customer invite and production administrator login.
5. Admin order list and quote flow; no bank details in GitHub.
6. Domain ownership and URL policy: backend currently rejects hosting-provider URLs for final customer delivery. **No change to this policy in this branch.**
7. Commercial terms, privacy notice, order email/LINE URLs and old GitHub links.
8. Remove staging noindex rule only when ready to publish.
9. GitHub Pages customer-hosting suitability for each type of site, separately from sales-hosting migration.

Known limitations: this staging config does not create a separate GitHub repository or Netlify site, and does not update production Supabase Auth configuration.
