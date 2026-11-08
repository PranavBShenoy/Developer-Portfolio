/**
 * Backend & CMS Architecture Test Suite
 * Validates database migrations, security rules, rate limiters, PDF worker,
 * auth contracts, CDN cache revocation, token operation scope, and resume selection.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const pass = (condition, label) => {
  if (!condition) {
    failures.push(label);
    console.error(`  FAIL: ${label}`);
  } else {
    console.log(`  PASS: ${label}`);
  }
};

console.log('--- 1. Testing Database Migrations & Immutability Rules ---');
{
  const m1 = await readFile(path.join(root, 'migrations/001_initial_schema.sql'), 'utf8');
  const m2 = await readFile(path.join(root, 'migrations/002_immutability_triggers.sql'), 'utf8');
  const m3 = await readFile(path.join(root, 'migrations/003_rls_policies.sql'), 'utf8');
  const m4 = await readFile(path.join(root, 'migrations/004_publication_rpcs.sql'), 'utf8');
  const m5 = await readFile(path.join(root, 'migrations/005_seed_data.sql'), 'utf8');
  const m6 = await readFile(path.join(root, 'migrations/006_certification_images_and_dates.sql'), 'utf8');

  // Verify core versioned tables
  const versionedTables = [
    'site_settings',
    'skill_categories',
    'skills',
    'projects',
    'experiences',
    'certifications',
    'media_assets'
  ];

  for (const tbl of versionedTables) {
    pass(m1.includes(`CREATE TABLE IF NOT EXISTS public.${tbl}`), `Table public.${tbl} is declared`);
    pass(m1.includes(`CONSTRAINT uq_${tbl}_entity_version UNIQUE (entity_id, version)`), `Compound UNIQUE(entity_id, version) on ${tbl}`);
    pass(m1.includes(`uq_${tbl}_current`), `Single published partial unique index on ${tbl}`);
    pass(m1.includes(`uq_${tbl}_draft`), `Single draft partial unique index on ${tbl}`);
  }

  // Issue 3: Schema verification for designated resume
  pass(m1.includes('is_primary_resume BOOLEAN NOT NULL DEFAULT false'), 'media_assets has is_primary_resume column');
  pass(m1.includes('CONSTRAINT chk_resume_mime_type CHECK (NOT is_primary_resume OR mime_type = \'application/pdf\')'), 'chk_resume_mime_type enforces designated resume must be a PDF');
  pass(m1.includes('uq_media_assets_primary_published_resume'), 'Unique partial index enforces at most ONE published primary resume');
  pass(m1.includes('uq_media_assets_primary_draft_resume'), 'Unique partial index enforces at most ONE draft primary resume');

  // Issue 2: Publishing token operation scope & immutability trigger checks
  pass(m2.includes('CREATE SCHEMA IF NOT EXISTS private;'), 'Private schema created for publishing security context');
  pass(m2.includes('CREATE TABLE IF NOT EXISTS private.authorized_publication_context'), 'Private publication authorization context table created');
  pass(m2.includes('CREATE OR REPLACE FUNCTION public.enforce_content_version_immutability()'), 'Immutability trigger function declared');
  pass(m2.includes('SECURITY DEFINER'), 'Immutability trigger uses SECURITY DEFINER');
  pass(m2.includes("search_path = pg_catalog, extensions, public, private, pg_temp"), 'Immutability trigger fixes search_path against injection');
  pass(m2.includes('trg_audit_logs_immutable'), 'Append-only mutation prevention trigger on audit_logs');
  pass(m2.includes('trg_snapshots_immutable'), 'Append-only mutation prevention trigger on publication_snapshots');

  // Token verification components in trigger
  pass(m2.includes("extensions.digest(decode(v_token_raw, 'hex'), 'sha256') != v_stored_hash"), 'Trigger verifies SHA-256 token hash against stored hash');
  pass(m2.includes("clock_timestamp() > v_expires_at"), 'Trigger verifies token has not expired');
  pass(m2.includes("tx_id = txid_current()"), 'Trigger binds token authorization strictly to txid_current()');
  pass(m2.includes("v_stored_admin_id != ("), 'Trigger verifies token matches active authenticated administrator identity');
  pass(m2.includes("IF v_consumed THEN"), 'Trigger blocks replay of already consumed tokens');
  pass(m2.includes("v_operation_type != 'PUBLISH'"), 'Trigger rejects draft/tombstone promotion when token is not PUBLISH');
  pass(m2.includes("v_operation_type != 'ROLLBACK'"), 'Trigger rejects direct published record insert when token is not ROLLBACK');
  pass(m2.includes("CONTENT_ALTERATION_DENIED"), 'Trigger prevents content column alteration when archiving published records');

  // Verify RLS policies
  pass(m3.includes('CREATE OR REPLACE FUNCTION public.is_admin()'), 'public.is_admin() function declared');
  pass(m3.includes('SECURITY DEFINER'), 'public.is_admin() is SECURITY DEFINER');
  pass(m3.includes('ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;'), 'RLS enabled on admin_users');
  for (const tbl of versionedTables) {
    pass(m3.includes(`ALTER TABLE public.${tbl} ENABLE ROW LEVEL SECURITY;`), `RLS enabled on public.${tbl}`);
  }
  pass(m3.includes('projects_public_select') && m3.includes('projects_admin_select'), 'Projects RLS policies declared');
  pass(m3.includes('categories_public_select') && m3.includes('categories_admin_select'), 'Skill categories RLS policies declared');
  pass(m3.includes('skills_public_select') && m3.includes('skills_admin_select'), 'Skills RLS policies declared');
  pass(m3.includes('experiences_public_select') && m3.includes('experiences_admin_select'), 'Experiences RLS policies declared');
  pass(m3.includes('certifications_public_select') && m3.includes('certifications_admin_select'), 'Certifications RLS policies declared');
  pass(m3.includes('settings_public_select') && m3.includes('settings_admin_select'), 'Settings RLS policies declared');
  pass(m3.includes('media_public_select') && m3.includes('media_admin_select'), 'Media assets RLS policies declared');

  // Verify Publication RPCs
  pass(m4.includes('CREATE OR REPLACE FUNCTION public.publish_pending_drafts'), 'publish_pending_drafts RPC declared');
  pass(m4.includes('CREATE OR REPLACE FUNCTION public.rollback_to_snapshot'), 'rollback_to_snapshot RPC declared');
  pass(m4.includes("REVOKE ALL ON FUNCTION public.publish_pending_drafts(INT, TEXT) FROM PUBLIC, anon;"), 'publish_pending_drafts revoked from anon');
  pass(m4.includes("GRANT EXECUTE ON FUNCTION public.publish_pending_drafts(INT, TEXT) TO authenticated"), 'publish_pending_drafts granted to authenticated');
  pass(m4.includes("REVOKE ALL ON FUNCTION public.rollback_to_snapshot(INT, INT, TEXT) FROM PUBLIC, anon;"), 'rollback_to_snapshot revoked from anon');
  pass(m4.includes("GRANT EXECUTE ON FUNCTION public.rollback_to_snapshot(INT, INT, TEXT) TO authenticated"), 'rollback_to_snapshot granted to authenticated');

  // Verify Seed Data
  pass(m5.includes('INSERT INTO public.publication_snapshots'), 'Initial baseline publication snapshot v1 seeded');
  pass(m5.includes('INSERT INTO public.site_settings'), 'Baseline site settings seeded');
  pass(m5.includes('INSERT INTO public.projects'), 'Baseline projects seeded');
  pass(m5.includes('pranav-shenoy-resume.pdf') && m5.includes('true, clock_timestamp()'), 'Initial seed designates single primary published resume');

  // Verify Migration 006 (Certifications images, dates, and credential URLs)
  pass(m6.includes('ALTER TABLE public.certifications') && m6.includes('certificate_image_url TEXT'), 'Migration 006 adds certificate_image_url column');
  pass(m6.includes('date TEXT') && m6.includes('credential_url TEXT'), 'Migration 006 adds date and credential_url columns');
  pass(m6.includes('CREATE OR REPLACE FUNCTION public.rollback_to_snapshot') && m6.includes('certificate_image_url, date, credential_url'), 'Migration 006 updates rollback_to_snapshot for certificate images');
}

console.log('\n--- 2. Testing Shared Security Libraries ---');
{
  const { parseCookies, createSessionCookies, createClearSessionCookies } = await import('../lib/auth.js');
  const { checkRateLimit, getClientIp } = await import('../lib/rate-limit.js');
  const { validatePdfResume } = await import('../lib/pdf-validator.js');

  // Cookie generation & parsing
  const cookieHeaders = createSessionCookies('access_token_abc', 'refresh_token_xyz');
  pass(cookieHeaders.length === 2, 'createSessionCookies returns two Set-Cookie directives');
  pass(cookieHeaders[0].includes('admin_at=access_token_abc') && cookieHeaders[0].includes('HttpOnly') && cookieHeaders[0].includes('SameSite=Strict'), 'admin_at cookie has HttpOnly and SameSite=Strict');
  pass(cookieHeaders[1].includes('admin_rt=refresh_token_xyz') && cookieHeaders[1].includes('HttpOnly'), 'admin_rt cookie has HttpOnly');

  const cookieReq = { headers: { cookie: 'admin_at=my_access_token; admin_rt=my_refresh_token; other=123' } };
  const parsed = parseCookies(cookieReq);
  pass(parsed.admin_at === 'my_access_token', 'parseCookies extracts admin_at');
  pass(parsed.admin_rt === 'my_refresh_token', 'parseCookies extracts admin_rt');

  const cleared = createClearSessionCookies();
  pass(cleared.every(c => c.includes('Max-Age=0')), 'createClearSessionCookies sets Max-Age=0');

  // Rate Limiting fallback logic when Upstash is not configured
  const mockReq = { headers: { 'x-forwarded-for': '203.0.113.195, 10.0.0.1' }, socket: {} };
  const ip = getClientIp(mockReq);
  pass(ip === '203.0.113.195', 'getClientIp extracts leftmost non-private IP');

  const rlResult = await checkRateLimit('test_user', 5, 60, false);
  pass(rlResult.allowed === true && rlResult.limit === 5, 'checkRateLimit falls back gracefully to in-memory development mock');

  // PDF Validator with legitimate portfolio resume
  try {
    const realResumeBuffer = await readFile(path.join(root, 'assets/pranav-shenoy-resume.pdf'));
    const pdfRes = await validatePdfResume(realResumeBuffer);
    pass(pdfRes && pdfRes.numPages >= 1 && pdfRes.numPages <= 5, `validatePdfResume accepts real portfolio resume (${pdfRes.numPages} pages)`);
  } catch (err) {
    pass(false, `validatePdfResume failed on portfolio resume: ${err.message}`);
  }

  // Malicious PDF with prohibited /Launch directive
  const maliciousPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Launch << /F (cmd.exe) >> >>\nendobj\n%%EOF');
  try {
    await validatePdfResume(maliciousPdf);
    pass(false, 'validatePdfResume should have rejected PDF with /Launch');
  } catch (err) {
    pass(err.code === 'UNSAFE_PDF_CONTENT', 'validatePdfResume rejects PDF containing forbidden /Launch action');
  }
}

console.log('\n--- 3. Testing CDN Cache Revocation & Public Media Endpoints ---');
{
  const mediaHandler = (await import('../lib/public/media/[id].js')).default;
  const resumeHandler = (await import('../lib/public/resume.js')).default;

  function createMockRes() {
    return {
      statusCode: 200,
      headers: {},
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
      send(data) {
        this.body = data;
        return this;
      },
      end() {
        return this;
      }
    };
  }

  // 1. Media Delivery Cache Policy: Must prevent CDN caching of private media
  const mediaReq = { method: 'GET', url: '/api/public/media/50000000-0000-0000-0000-000000000001', headers: {} };
  const resMedia = createMockRes();
  await mediaHandler(mediaReq, resMedia);
  const mediaCache = resMedia.headers['cache-control'] || '';
  pass(mediaCache.includes('no-store') && mediaCache.includes('no-cache') && mediaCache.includes('must-revalidate'), 'media delivery sets private no-store no-cache must-revalidate');
  pass(resMedia.headers['pragma'] === 'no-cache', 'media delivery sets Pragma: no-cache');

  // 2. Immediate Revocation Test on Unpublish / Tombstone
  // Simulating an unannounced or unpublished/tombstoned asset ID
  const unpublishedReq = { method: 'GET', url: '/api/public/media/non-existent-or-unpublished', headers: {} };
  const resUnpublished = createMockRes();
  await mediaHandler(unpublishedReq, resUnpublished);
  pass(resUnpublished.statusCode === 404, 'Unpublished or tombstoned asset immediately returns 404');
  pass(resUnpublished.headers['cache-control'].includes('no-store'), 'Unpublished response sets no-store to prevent edge caching');

  // 3. Conditional Request Handling (If-None-Match) after unpublish
  // If client sends stale ETag for an unpublished asset, origin must NOT return 304; it must return 404
  const staleConditionalReq = {
    method: 'GET',
    url: '/api/public/media/non-existent-or-unpublished',
    headers: { 'if-none-match': '"stale-etag-hash"' }
  };
  const resStale = createMockRes();
  await mediaHandler(staleConditionalReq, resStale);
  pass(resStale.statusCode === 404, 'Conditional request for unpublished asset returns 404 (terminating cached delivery)');

  // 4. Resume Delivery & Cache Revocation
  const resResume = createMockRes();
  const resumeReq = { method: 'GET', headers: {} };
  await resumeHandler(resumeReq, resResume);
  const resumeCache = resResume.headers['cache-control'] || '';
  pass(resumeCache.includes('no-store') && resumeCache.includes('no-cache'), 'Resume delivery sets no-store no-cache for instant revocation');
  pass(resResume.headers['content-security-policy'] === "default-src 'none'; sandbox;", 'Resume delivery enforces strict sandbox CSP');
}

console.log('\n--- 4. Testing Resume Selection & Inconsistent State Guard ---');
{
  const resumeHandler = (await import('../lib/public/resume.js')).default;
  const resumeSource = await readFile(path.join(root, 'lib/public/resume.js'), 'utf8');

  // Verify explicit query for single designated primary resume
  pass(resumeSource.includes('is_primary_resume=eq.true'), 'Resume handler explicitly filters for is_primary_resume=eq.true');
  pass(resumeSource.includes('is_current_published=eq.true'), 'Resume handler filters for is_current_published=eq.true');
  pass(resumeSource.includes('is_tombstone=eq.false'), 'Resume handler excludes tombstoned records');

  // Verify deterministic behavior when 0 resumes are published
  pass(resumeSource.includes("code: 'RESUME_NOT_PUBLISHED'") && resumeSource.includes("status(404)"), 'Handler deterministically returns 404 RESUME_NOT_PUBLISHED when 0 resumes published');

  // Verify error when inconsistent data exists (> 1 published resumes)
  pass(resumeSource.includes("records.length > 1") && resumeSource.includes("code: 'INCONSISTENT_RESUME_STATE'") && resumeSource.includes("status(500)"), 'Handler returns 500 INCONSISTENT_RESUME_STATE rather than arbitrary pick if duplicates exist');

  // Verify validation that designated asset is a published PDF
  pass(resumeSource.includes("resumeAsset.mime_type !== 'application/pdf'") && resumeSource.includes("code: 'INVALID_RESUME_MIME_TYPE'"), 'Handler rejects non-PDF designated asset with INVALID_RESUME_MIME_TYPE');
}

console.log('\n--- 5. Testing Administrative API Endpoints Contract & Safety ---');
{
  const meHandler = (await import('../lib/admin/auth/me.js')).default;
  const loginHandler = (await import('../lib/admin/auth/login.js')).default;
  const previewHandler = (await import('../lib/admin/content/preview.js')).default;
  const publicContentHandler = (await import('../lib/public/content.js')).default;

  function createMockRes() {
    return {
      statusCode: 200,
      headers: {},
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
      send(data) {
        this.body = data;
        return this;
      },
      end() {
        return this;
      }
    };
  }

  // Test /api/admin/auth/me without cookies
  const unauthReq = { method: 'GET', headers: {} };
  const res1 = createMockRes();
  await meHandler(unauthReq, res1);
  pass(res1.statusCode === 401 && res1.body.code === 'UNAUTHENTICATED', 'GET /api/admin/auth/me returns 401 UNAUTHENTICATED without cookie');

  // Test /api/admin/content/preview without auth
  const res2 = createMockRes();
  await previewHandler(unauthReq, res2);
  pass(res2.statusCode === 401, 'GET /api/admin/content/preview returns 401 without auth');

  // Test /api/admin/auth/login without payload
  const emptyLoginReq = { method: 'POST', body: {}, headers: {} };
  const res3 = createMockRes();
  await loginHandler(emptyLoginReq, res3);
  pass(res3.statusCode === 400 && res3.body.error.toLowerCase().includes('email and password'), 'POST /api/admin/auth/login rejects empty payload');

  // Test public content handler (returns baseline static fallback when DB is disconnected)
  const pubReq = { method: 'GET', headers: {} };
  const res4 = createMockRes();
  await publicContentHandler(pubReq, res4);
  pass(res4.statusCode === 200 && res4.body && res4.body.projects && res4.body.projects.length >= 7, 'GET /api/public/content returns fallback published portfolio catalog');
  pass(res4.headers['cache-control'] && res4.headers['cache-control'].includes('s-maxage=300'), 'GET /api/public/content has edge caching s-maxage=300');
}

console.log('\n--- 6. Testing Admin UI Bundle & Leak Prevention ---');
{
  const adminHtml = await readFile(path.join(root, 'dist/admin/index.html'), 'utf8');
  const adminCss = await readFile(path.join(root, 'dist/admin/admin.css'), 'utf8');
  const adminJs = await readFile(path.join(root, 'dist/admin/admin.js'), 'utf8');
  const publicHtml = await readFile(path.join(root, 'dist/index.html'), 'utf8');

  pass(adminHtml.includes('id="auth-gate"') && adminHtml.includes('id="admin-app"'), 'Admin HTML contains auth gate and app structures');
  pass(adminCss.includes('.auth-gate') && adminCss.includes('.admin-layout'), 'Admin CSS contains complete layout selectors');
  pass(adminJs.includes('checkAuthSession') && adminJs.includes('/api/admin/publish'), 'Admin JS contains auth & publication triggers');

  // Verify zero leak of admin identifiers into public HTML
  const adminForbiddenInPublic = ['auth-gate', 'admin-sidebar', 'btn-publish-all', 'stat-live-version'];
  for (const term of adminForbiddenInPublic) {
    pass(!publicHtml.includes(term), `Public HTML does not contain admin term "${term}"`);
  }
}

if (failures.length) {
  console.error(`\nBackend test suite failed with ${failures.length} errors.`);
  process.exitCode = 1;
} else {
  console.log('\nAll Backend & CMS test suite assertions passed successfully!');
}
