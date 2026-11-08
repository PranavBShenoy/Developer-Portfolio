# Supabase Keepalive & Static Publishing Architecture

This document describes the implementation, operational boundaries, and deployment requirements for the Supabase Free tier keepalive mechanism and the Option A static publishing workflow.

---

## 1. Publishing Workflow (Option A: Static Rebuild)

To combine dynamic content management via Supabase with high-performance, network-free static delivery at the edge:

```
[ Admin Dashboard ]
       │
       ▼
[ POST /api/admin/publish or rollback ]
       │
       ├─► Executes transactional RPC (publish_pending_drafts / rollback_to_snapshot)
       │
       ├─► (Optional) POST to VERCEL_DEPLOY_HOOK_URL
       │         │
       │         ▼
       │   [ Vercel Static Build (node scripts/build.mjs) ]
       │         │
       │         ├─► Reads every published CMS content type from Supabase:
       │         │   - site_settings (profile, contact, bio, metrics)
       │         │   - projects (cards, summaries, tags, links)
       │         │   - skill_categories & skills
       │         │   - experiences (roles, descriptions, tags)
       │         │   - certifications (credentials, issuers, marks)
       │         │   (via PostgREST using SUPABASE_ANON_KEY)
       │         │
       │         ├─► Pre-renders static HTML with complete published content
       │         │
       │         ├─► Emits fingerprinted assets to dist/
       │         │
       │         └─► Deploys static files to Vercel Edge CDN
       │
       ▼
[ Public Visitors ]
       │
       ▼
Reads static pre-rendered HTML from Vercel Edge CDN
(Zero client-side API requests, 100% network-free frontend script.js)
```

### Build-Time Production Safety
- **Fail-Safe Build Execution:** If production credentials (`SUPABASE_URL` and `SUPABASE_ANON_KEY`) are configured but any Supabase query fails (network error, HTTP non-200, invalid JSON), the build **fails immediately and exits with code 1**. It will **never** silently deploy stale repository defaults when production credentials are configured.
- **Local Development Fallback:** When `SUPABASE_URL` is omitted (e.g. offline local development), `scripts/build.mjs` safely retains baseline repository markup.

---

## 2. Supabase Keepalive Architecture

### Purpose
Supabase projects on the Free tier pause automatically after 7 days of inactivity. To maintain database responsiveness during periods without visitor or admin dashboard activity, a scheduled health-check endpoint is provided at `/api/cron/keepalive`.

### Service Boundaries & Execution Path
- **Target Services:** The health-check query runs against **PostgREST** and the underlying **PostgreSQL** database engine.
- **Supabase Storage Boundary:** This check does **NOT** touch Supabase Storage (which is an independent service with its own storage buckets). It exercises database and REST API connectivity only.
- **Database Role & Privileges:** Queries PostgREST strictly using the unprivileged `SUPABASE_ANON_KEY`. The `SUPABASE_SERVICE_ROLE_KEY` is never used or exposed.
- **Query Footprint:**
  ```http
  GET /rest/v1/site_settings?is_current_published=eq.true&is_tombstone=eq.false&select=version,updated_at&limit=1
  ```
  - Read-only: Zero database mutations, zero write amplification, zero WAL bloat.
  - Minimal payload: Single row, two scalar columns (`version`, `updated_at`).
- **Authorization:** Requires `Authorization: Bearer ${CRON_SECRET}`. Fails closed with 500 if unconfigured, or 401 if missing or invalid.
- **Edge Caching Prevention:** `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`, `X-Robots-Tag: noindex, nofollow, noarchive`.

---

## 3. Vercel Plan Compatibility & Scheduling Constraints

### Vercel Hobby Plan (Once-Daily Limitation)
Vercel enforces a strict platform limit on the **Hobby plan**: cron jobs can run at most **once per day**. Any schedule more frequent than once daily (such as `0 */6 * * *`) is rejected during deployment validation with:
```
Error: Cron expressions on Hobby accounts can only be scheduled once a day.
```

To guarantee compatibility with Vercel Hobby accounts:
- `vercel.json` is configured with:
  ```json
  "crons": [
    {
      "path": "/api/cron/keepalive",
      "schedule": "0 4 * * *"
    }
  ]
  ```
  This executes once daily at 04:00 UTC.

### Running More Frequent Checks (e.g., Every 6 Hours)
If your deployment requires more frequent checks (e.g. every 6 hours to guard against unexpected pausing):

1. **Option A: Vercel Pro Plan**
   If upgraded to Vercel Pro, `vercel.json` can be changed to `"schedule": "0 */6 * * *"`.
2. **Option B: External Scheduler (Recommended for Hobby Plan)**
   Keep `vercel.json` at once-daily and set up an external scheduler to call `/api/cron/keepalive` with the `CRON_SECRET` bearer header:
   - **GitHub Actions Scheduled Workflow:**
     ```yaml
     name: Supabase Keepalive Ping
     on:
       schedule:
         - cron: '0 */6 * * *'
       workflow_dispatch:
     jobs:
       ping:
         runs-on: ubuntu-latest
         steps:
           - name: Invoke Keepalive Endpoint
             run: |
               curl -fsS -X GET "https://pranav-shenoy-portfolio.vercel.app/api/cron/keepalive" \
                 -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
     ```
   - **External Cron Services:** Cron-job.org, Cloudflare Workers Cron, or UptimeRobot sending a GET request with `Authorization: Bearer ${CRON_SECRET}` every 6 hours.

---

## 4. Operational Limitations & Guarantees

> [!WARNING]
> **Supabase Free Tier Activity Policy Limitation**
> While periodic synthetic read queries against PostgREST and PostgreSQL generate genuine API and database query activity, **Supabase does NOT officially guarantee that external synthetic HTTP requests will permanently satisfy all platform activity criteria.**
> 
> Specifically:
> - Supabase's internal activity monitoring heuristics may evaluate interactive dashboard logins, project metric changes, or billing account status.
> - Synthetic read queries do not guarantee that Supabase will never pause a project if Supabase alters its inactivity threshold policies.
> - Upstream DNS or internet outages could prevent scheduled pings from arriving for extended periods.
> - Administrators should periodically log into the Supabase project dashboard to verify ongoing project health and ensure database resources remain allocated.
