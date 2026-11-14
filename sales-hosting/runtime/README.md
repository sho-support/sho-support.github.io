# Temporary migration adapters

These are narrowly patched copies of the actual deployed bundles retrieved on
2026-11-15. The commercial/publication implementation in `supabase/functions/`
depends on additive migrations, production domain/R2 setup and a real backup;
it must not be deployed piecemeal over the current database.

The adapters preserve each deployed `_shared/website.ts` byte for byte and its
JWT setting. They add the verified Cloudflare frontend to exact-origin checks,
include the SDK Authorization header in preflight, and generate return/viewer
links for the caller's trusted frontend. GitHub and server callers retain the
previous Netlify return links. No DNS, database schema, account or key changes.

Because the older production code does not contain the new frozen-contract
protocol, Cloudflare order writes and legacy mutations stop with
`sales_release_pending` before DB writes, LINE, AI or publication. Authenticated
read actions and the separate protected settings API can be tested. This is a
connection checkpoint, **not** a full sales release or an end-to-end pass.

Recovery/invitation mail from Cloudflare requires the exact password callback
to be checked in Supabase Auth and `WEBSITE_AUTH_REDIRECT_ORIGIN` to be set to
the verified Cloudflare origin. Until then it fails before consuming reset
limits or sending mail. No flag or Auth configuration is changed by this code.

`../runtime-baseline/*.json` preserves the original complete bundles for
rollback. `../runtime-migration.json` records versions and per-file hashes.
Deploy each adapter with `index.ts` and its own `_shared` files, keeping the
original `verify_jwt`. Never merge their distinct historical website helpers.
When the complete commercial release is ready, replace these adapters with the
tested canonical functions in one compatible release; do not remove gates by
hand or make preview URLs into permanent customer URLs.

Verification:

```sh
node --experimental-vm-modules --test sales-hosting/tests/runtime-origin.test.mjs
npm run test:routes --prefix customer-hosting-v2
npm run test:pipeline --prefix customer-hosting-v2
npm run check:edge --prefix customer-hosting-v2
```
