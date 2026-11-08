# Vercel deployment checklist

## Project configuration

- Connect this repository to Vercel with the project root set to this directory.
- The checked-in `vercel.json` runs `node scripts/build.mjs` and publishes only `dist/`.
- Backend serverless functions (`api/admin/*`, `api/cron/*`, `api/public/*`) use standard Node.js ES modules without heavy third-party runtime dependencies.
- Configure all required environment variables in Vercel Project Settings (see `.env.example` and `SUPABASE_KEEPALIVE_AND_PUBLISHING.md`).
- For production, configure: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and `VERCEL_DEPLOY_HOOK_URL`.
- Use the Vercel-provided HTTPS endpoint. Add a custom domain in Project Settings and complete the DNS verification before sharing it.

## Before each deployment

Run from the project root:

```sh
node --check script.js
node --check scripts/build.mjs
node --check scripts/verify-build.mjs
node scripts/build.mjs
node scripts/verify-build.mjs
```

For a local Vercel production build, install and link the Vercel CLI once, then run:

```sh
npm install --global vercel
vercel login
vercel link
vercel pull --yes --environment=production
vercel build --prod
```

Review `.vercel/output`/the CLI build result before deploying. To deploy that already-built output:

```sh
vercel deploy --prebuilt --prod
```

Alternatively, connect the Git repository in Vercel. Preview deployments can be checked before merging to the configured production branch.

## After deployment

Replace `YOUR_DOMAIN` with the Vercel production hostname or configured custom domain:

```sh
curl --silent --show-error --head https://YOUR_DOMAIN/
curl --silent --show-error --head http://YOUR_DOMAIN/
```

Check the HTTPS response for CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, Referrer-Policy, Permissions-Policy, CORP, and HTML revalidation. The HTTP response should redirect to HTTPS. Copy one fingerprinted asset URL from the deployed page source and check that it returns `Cache-Control: public, max-age=31536000, immutable` and a JavaScript/CSS/image/PDF content type.

In a browser, confirm there are no CSP errors; navigate all sections; test Replay Build, all cursor counts and modes, sound, reduced motion, and scroll-triggered construction at desktop and mobile sizes. The profile editor exists only in the development source: the production build removes its markup, styles, and event handlers, and `node scripts/verify-build.mjs` verifies their absence from `dist/`. These are post-deployment browser checks; the local verification script does not replace them.

## Operations and availability

- Each deployment builds static output; the animation does not need a running Node.js process, Function, polling loop, or background worker.
- A failed Google Fonts request falls back to system fonts. The external GitHub and LinkedIn links require those services to be reachable.
- No API rate limiting is configured because there are no API endpoints. Do not add client-side limits and describe them as server protection.
- No realtime synchronization is currently implemented. If shared cursor presence becomes a requirement, Ably Channels Presence is one managed option; keep any token-minting endpoint stateless and rate limited, not connected indefinitely.
- Vercel, DNS, account access, visitor network/device, and external services remain availability dependencies; this configuration does not guarantee 100% uptime.
