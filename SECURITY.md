# Security overview

Last reviewed: 2026-11-07

## Scope and architecture

This is a static HTML, CSS, and browser JavaScript portfolio. Vercel builds fingerprinted files into `dist/` and serves them as static assets through its CDN. There is no application server, function/API route, authentication, database, contact submission endpoint, file upload, cookie, or browser storage. The cursor construction, canvas, Web Audio clicks, and scroll reveals run locally in each visitor's browser. There is no polling or realtime socket connection.

### Attack-surface inventory

| Surface | Details |
| --- | --- |
| Routes | `/`, `/index.html`, fingerprinted CSS/JS, portrait, and resume. No API routes. |
| External origins | Google Fonts stylesheet and font files; fixed outbound GitHub and LinkedIn links. |
| User-controlled input | Customize drawer fields for name, role, bio, and email. Values remain in memory in the current tab and are not submitted or persisted. |
| DOM updates | Profile fields use `textContent`, validated `mailto:` values, and text attributes. Typewriter replay restores cloned DOM nodes; it does not parse strings as HTML. |
| Canvas and events | One `requestAnimationFrame` loop, one resize listener, passive pointer tracking, a bounded ripple list, and cursor counts restricted to 20, 56, or 100. Audio starts only after the visitor enables it and each oscillator stops promptly. |
| Secrets and configuration | No environment variables, API keys, credentials, or private configuration are required. `.env*`, `.vercel/`, and `dist/` are ignored by Git. |
| Dependencies | No package manifest, lockfile, framework, or runtime package dependencies. The build uses Node.js built-in modules only. |

## Implemented protections

- `vercel.json` applies a restrictive Content Security Policy without `unsafe-inline` or `unsafe-eval`. The one early inline script is permitted by its exact SHA-256 hash. Local scripts are same-origin; styles/fonts and connection hints are limited to Google Fonts; images are same-origin or the static data URI used by the grain texture; workers and frames are disabled.
- Inline event-handler and style attributes are prohibited by CSP. Canvas sizing uses its intrinsic dimensions and CSS, rather than JavaScript style attributes.
- `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `object-src 'none'`, and `base-uri 'self'` restrict framing, plugins, and base-URL changes.
- HSTS, `nosniff`, a strict referrer policy, a restrictive Permissions Policy, and same-origin resource policy are configured for deployed responses. Vercel also provisions HTTPS for configured domains.
- Profile inputs have type, required, and length constraints. The submit handler checks native validity and field types/lengths before updating the page. Profile strings are inserted as text, not markup; the email link remains a `mailto:` link.
- Cursor creation is allowlisted to 20/56/100. Canvas history and ripples are bounded; scroll observers are disconnected on replay. No server process or Function is kept alive for animation.
- `scripts/build.mjs` emits only the HTML and four content-hashed assets to `dist/`; Vercel publishes that directory. Fingerprinted files use immutable caching, while the HTML must revalidate. Security/deployment documentation is excluded from deployment upload.

## Findings and disposition

- **No server-side attack surface found.** Rate limiting, authentication, CORS, CSRF tokens, request-size limits, and API method restrictions do not apply because the application accepts no server requests beyond static `GET`/`HEAD` content. Client-side checks are usability/input-safety controls, not substitutes for server-side controls.
- **HTML string parsing in typewriter replay was an avoidable hardening risk.** It previously saved and restored a static `innerHTML` snapshot. The implementation now clones/restores DOM nodes and does not parse dynamic strings as HTML. The old snapshot was static template content; no exploitable untrusted HTML path was identified.
- **Unbounded cursor input was narrowed.** The UI offered fixed sizes, and the creation function now also rejects values outside the allowlist.
- **External font loading remains a dependency.** If Google Fonts is unavailable or blocked, the system font fallback keeps the portfolio usable. Loading the font stylesheet makes a request to Google Fonts from the visitor's browser.
- No `npm audit` result is available: there is no package manifest/lockfile and `npm` is not installed in the audit environment. There are no third-party JavaScript packages to audit.
- A credential-pattern scan found no credential-shaped strings or `.env*` files. The portrait has no GPS/location, serial-number, or owner EXIF values. The resume PDF contains no JavaScript, launch action, or embedded file; its catalog open action is a local GoTo page destination.

## Verification record

Completed locally:

- `node --check script.js`, `node --check scripts/build.mjs`, and `node --check scripts/verify-build.mjs`.
- `node scripts/build.mjs` generated the static production output.
- `node scripts/verify-build.mjs` verified the CSP hash, required headers, hashed assets, references, bounded cursor sizes, and absence of unsafe HTML/eval sinks. The verified output contained five files: `index.html` and four fingerprinted assets.
- Source scans verified there are no API/realtime clients, inline event/style attributes, or credential-shaped strings. PDF and portrait metadata checks completed as described above.
- A trailing-whitespace scan of the new configuration, documentation, and build scripts passed.

Limitations: the Vercel CLI is not installed in the current environment, so `vercel build --prod` and a deployed-header check were not run. A browser runtime/XSS test, OWASP ZAP scan, and third-party penetration test were not performed. Run the deployment checklist before production and verify the enforced CSP in a browser after deployment.

## Availability and remaining risks

The site depends on Vercel delivery, the project's Vercel account and domain/DNS configuration, and the visitor's browser/device. Google Fonts is an optional external dependency; GitHub and LinkedIn destinations are external. Canvas activity uses local visitor CPU and is reduced by the site's reduced-motion control/system preference. The deterministic cursor simulation is not live multi-user collaboration; if shared cursor presence becomes a requirement, Ably Channels Presence is one managed option. That would introduce a provider dependency and should use short-lived client authorization from a stateless endpoint, with rate limiting on that endpoint, rather than a long-lived Vercel Function.

No uptime guarantee is made. Hosting-provider, DNS, network, browser, and external-link availability remain outside this static project.

## Reporting

Please report a suspected issue privately to the project owner through the portfolio contact address: [nnm24is160@nmamit.in](mailto:nnm24is160@nmamit.in). Include the affected URL, reproducible steps, expected and observed behavior, and relevant screenshots or request/response details. Avoid sending secrets or personal data and allow time for a fix before public disclosure.
