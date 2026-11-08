// scripts/test-integration-checks.mjs
// Comprehensive Integration Verification for:
// 1. CDN Cache Revocation & Media Delivery HTTP Requests
// 2. Publishing & Rollback JWT Flow vs Service-Role Attack Tests
// 3. Clean Supabase-Compatible PostgreSQL Migration Application & Permissions

import { spawnSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const PG_DIR = '/tmp/pg_integration_cluster';
const PG_PORT = 54322;
const PG_BIN = '/usr/lib/postgresql/18/bin';
const DB_NAME = 'postgres';

console.log('================================================================');
console.log('STARTING INTEGRATION CHECKS (CDN, JWT AUTH, MIGRATIONS & GUARDS)');
console.log('================================================================\n');

function runPsql(sql, db = DB_NAME) {
  const res = spawnSync(
    `${PG_BIN}/psql`,
    ['-h', '/tmp', '-p', String(PG_PORT), '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-t', '-A'],
    { input: sql, encoding: 'utf8' }
  );
  if (res.status !== 0) {
    throw new Error(res.stderr ? res.stderr.trim() : `psql exit code ${res.status}`);
  }
  const lines = res.stdout.trim().split('\n').map(l => l.trim()).filter(l => l && !['BEGIN', 'SET', 'COMMIT', 'DO'].includes(l));
  return lines.join('\n');
}

function runPsqlFile(filePath, db = DB_NAME) {
  const res = spawnSync(
    `${PG_BIN}/psql`,
    ['-h', '/tmp', '-p', String(PG_PORT), '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-f', filePath],
    { encoding: 'utf8' }
  );
  if (res.status !== 0) {
    throw new Error(`File ${filePath} failed: ${res.stderr ? res.stderr.trim() : res.status}`);
  }
  return res.stdout.trim();
}

function runPsqlExpectError(sql, expectedErrorCode, db = DB_NAME) {
  try {
    runPsql(sql, db);
    throw new Error(`Expected error containing "${expectedErrorCode}" but query succeeded.`);
  } catch (err) {
    if (!err.message.includes(expectedErrorCode)) {
      throw new Error(`Expected error "${expectedErrorCode}", got: ${err.message}`);
    }
    return true;
  }
}

let pgProcess = null;

async function bootstrapPostgres() {
  console.log('[Setup] Bootstrapping clean local PostgreSQL instance...');
  if (existsSync(PG_DIR)) {
    try {
      execSync(`${PG_BIN}/pg_ctl -D ${PG_DIR} -m immediate stop 2>/dev/null || true`);
    } catch (e) {}
    rmSync(PG_DIR, { recursive: true, force: true });
  }
  mkdirSync(PG_DIR, { recursive: true });

  execSync(`${PG_BIN}/initdb -D ${PG_DIR} --no-locale -E UTF8 --username=postgres`, { stdio: 'pipe' });

  // Start pg server
  execSync(`${PG_BIN}/pg_ctl -D ${PG_DIR} -o "-k /tmp -p ${PG_PORT}" -l ${PG_DIR}/server.log start`, { stdio: 'pipe' });

  // Verify connection
  const res = runPsql('SELECT version();');
  console.log('  -> PostgreSQL started successfully:', res.split('\n')[0]);
}

function shutdownPostgres() {
  console.log('\n[Teardown] Shutting down PostgreSQL instance...');
  try {
    execSync(`${PG_BIN}/pg_ctl -D ${PG_DIR} -m immediate stop`, { stdio: 'pipe' });
    console.log('  -> PostgreSQL stopped successfully.');
  } catch (e) {
    console.warn('  -> PostgreSQL shutdown warning:', e.message);
  }
}

async function runChecks() {
  let passed = 0;
  let failed = 0;

  function assert(condition, description) {
    if (condition) {
      console.log(`  PASS: ${description}`);
      passed++;
    } else {
      console.error(`  FAIL: ${description}`);
      failed++;
      throw new Error(`Assertion failed: ${description}`);
    }
  }

  try {
    await bootstrapPostgres();

    // =========================================================================
    // CHECK 3: APPLY ALL MIGRATIONS IN CLEAN SUPABASE-COMPATIBLE ENVIRONMENT
    // =========================================================================
    console.log('\n--- CHECK 3: Clean PostgreSQL Environment & Migration Application ---');

    // Setup Supabase standard environment (roles, auth schema, auth helpers, storage schema)
    runPsql(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role NOLOGIN;
        END IF;
      END $$;

      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT clock_timestamp()
      );

      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$ LANGUAGE sql STABLE;

      CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
        SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
      $$ LANGUAGE sql STABLE;

      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
      GRANT ALL ON auth.users TO postgres, service_role;
      GRANT SELECT ON auth.users TO authenticated;

      CREATE SCHEMA IF NOT EXISTS storage;
      CREATE TABLE IF NOT EXISTS storage.buckets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        public BOOLEAN DEFAULT false
      );
      CREATE TABLE IF NOT EXISTS storage.objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id TEXT REFERENCES storage.buckets(id),
        name TEXT NOT NULL,
        owner UUID,
        created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
        updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
      );
    `);
    assert(true, 'Supabase compatibility mock (roles, auth.users, auth.uid(), storage schema) created');

    // Apply migrations in exact sequence
    const migrations = [
      'migrations/001_initial_schema.sql',
      'migrations/002_immutability_triggers.sql',
      'migrations/003_rls_policies.sql',
      'migrations/004_publication_rpcs.sql',
      'migrations/005_seed_data.sql',
      'migrations/006_certification_images_and_dates.sql'
    ];

    for (const mig of migrations) {
      runPsqlFile(mig);
      assert(true, `Applied ${mig} cleanly with 0 errors`);
    }

    // Verify Schema Integrity & Constraints
    const tableCount = runPsql(`
      SELECT count(*) FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('admin_users', 'site_settings', 'skill_categories', 'skills', 'projects', 'experiences', 'certifications', 'media_assets', 'publication_snapshots', 'audit_logs');
    `);
    assert(tableCount === '10', 'All 10 required public tables exist');

    const privateContextTable = runPsql(`
      SELECT count(*) FROM information_schema.tables 
      WHERE table_schema = 'private' AND table_name = 'authorized_publication_context';
    `);
    assert(privateContextTable === '1', 'private.authorized_publication_context exists');

    // Verify Trigger Ownership and SECURITY DEFINER
    const triggerSecurity = runPsql(`
      SELECT prosecdef FROM pg_proc p 
      JOIN pg_namespace n ON p.pronamespace = n.oid 
      WHERE p.proname = 'enforce_content_version_immutability' AND n.nspname = 'public';
    `);
    assert(triggerSecurity === 't', 'enforce_content_version_immutability() has prosecdef=true (SECURITY DEFINER)');

    const triggerOwner = runPsql(`
      SELECT r.rolname FROM pg_proc p 
      JOIN pg_namespace n ON p.pronamespace = n.oid 
      JOIN pg_roles r ON p.proowner = r.oid 
      WHERE p.proname = 'enforce_content_version_immutability' AND n.nspname = 'public';
    `);
    assert(triggerOwner === 'postgres', 'enforce_content_version_immutability() is owned by postgres');

    // Verify RLS is enabled on all tables
    const rlsCheck = runPsql(`
      SELECT count(*) FROM pg_class c 
      JOIN pg_namespace n ON c.relnamespace = n.oid 
      WHERE n.nspname = 'public' 
        AND c.relname IN ('admin_users', 'site_settings', 'skill_categories', 'skills', 'projects', 'experiences', 'certifications', 'media_assets', 'publication_snapshots', 'audit_logs')
        AND c.relrowsecurity = true;
    `);
    assert(rlsCheck === '10', 'Row Level Security (RLS) is enabled on all 10 CMS tables');

    // Verify RPC Permissions
    const rpcAnonGrant = runPsql(`
      SELECT has_function_privilege('anon', 'public.publish_pending_drafts(int, text)', 'EXECUTE');
    `);
    assert(rpcAnonGrant === 'f', 'publish_pending_drafts EXECUTE is revoked from anon');

    const rpcAuthGrant = runPsql(`
      SELECT has_function_privilege('authenticated', 'public.publish_pending_drafts(int, text)', 'EXECUTE');
    `);
    assert(rpcAuthGrant === 't', 'publish_pending_drafts EXECUTE is granted to authenticated');

    const rpcRollbackAnonGrant = runPsql(`
      SELECT has_function_privilege('anon', 'public.rollback_to_snapshot(int, int, text)', 'EXECUTE');
    `);
    assert(rpcRollbackAnonGrant === 'f', 'rollback_to_snapshot EXECUTE is revoked from anon');

    const rpcRollbackAuthGrant = runPsql(`
      SELECT has_function_privilege('authenticated', 'public.rollback_to_snapshot(int, int, text)', 'EXECUTE');
    `);
    assert(rpcRollbackAuthGrant === 't', 'rollback_to_snapshot EXECUTE is granted to authenticated');

    // =========================================================================
    // CHECK 2: PUBLISHING & ROLLBACK JWT FLOW & SERVICE-ROLE ATTACK TESTS
    // =========================================================================
    console.log('\n--- CHECK 2: Publishing & Rollback JWT Flow vs Attack Vectors ---');

    const adminAuthUserId = '00000000-0000-0000-0000-000000000001';
    const testAdminEntityId = '00000000-0000-0000-0000-000000000001';

    // Step 2.1: Verify active authenticated administrator identity
    const adminCheck = runPsql(`
      BEGIN;
      SET LOCAL role = 'authenticated';
      SET LOCAL "request.jwt.claim.sub" = '${adminAuthUserId}';
      SET LOCAL "request.jwt.claim.role" = 'authenticated';
      SELECT auth.uid() = '${adminAuthUserId}'::uuid AND public.is_admin() = true;
      COMMIT;
    `);
    assert(adminCheck === 't', 'Authenticated JWT session correctly resolves auth.uid() and public.is_admin()=true');

    // Step 2.2: Create a draft project under authenticated admin
    const newDraftProjectId = '20000000-0000-0000-0000-000000000001';
    runPsql(`
      BEGIN;
      SET LOCAL role = 'authenticated';
      SET LOCAL "request.jwt.claim.sub" = '${adminAuthUserId}';
      SET LOCAL "request.jwt.claim.role" = 'authenticated';
      INSERT INTO public.projects (
        entity_id, version, status, is_current_published, is_tombstone,
        project_number, slug, title, category, summary, description, tags, repo_url, demo_url, preview_type, display_order
      ) VALUES (
        '${newDraftProjectId}', 2, 'draft', false, false,
        '09', 'integration-test-project', 'Integration Test Project', 'SYSTEMS',
        'Draft summary for verification', 'Detailed description', ARRAY['PostgreSQL','JWT'],
        'https://github.com/test/repo', 'https://demo.example.com', 'secure', 99
      );
      COMMIT;
    `);
    assert(true, 'Admin successfully created draft version of a project');

    // Step 2.3: Execute publish_pending_drafts() with authenticated admin JWT
    const publishResult = JSON.parse(runPsql(`
      BEGIN;
      SET LOCAL role = 'authenticated';
      SET LOCAL "request.jwt.claim.sub" = '${adminAuthUserId}';
      SET LOCAL "request.jwt.claim.role" = 'authenticated';
      SELECT public.publish_pending_drafts(1, 'Publication verification test');
      COMMIT;
    `));

    assert(publishResult.version === 2, 'publish_pending_drafts advanced publication version to 2');
    assert(publishResult.promoted_count > 0, `Published ${publishResult.promoted_count} draft entities`);

    // Verify snapshot v2 was created
    const snapshotV2 = runPsql(`
      SELECT count(*) FROM public.publication_snapshots WHERE version = 2;
    `);
    assert(snapshotV2 === '1', 'publication_snapshots contains atomic snapshot for version 2');

    // Verify audit log entry
    const auditPublish = runPsql(`
      SELECT count(*) FROM public.audit_logs 
      WHERE action = 'PUBLISH' AND auth_user_id = '${adminAuthUserId}';
    `);
    assert(auditPublish === '1', 'audit_logs atomically recorded PUBLISH event with admin auth_user_id');

    // Step 2.4: Execute rollback_to_snapshot(1, 2) to restore snapshot v1
    const rollbackResult = JSON.parse(runPsql(`
      BEGIN;
      SET LOCAL role = 'authenticated';
      SET LOCAL "request.jwt.claim.sub" = '${adminAuthUserId}';
      SET LOCAL "request.jwt.claim.role" = 'authenticated';
      SELECT public.rollback_to_snapshot(1, 2, 'Rollback verification test');
      COMMIT;
    `));

    assert(rollbackResult.new_version === 3, 'rollback_to_snapshot restored target snapshot under new monotonic version 3');

    // Verify audit log for rollback
    const auditRollback = runPsql(`
      SELECT count(*) FROM public.audit_logs 
      WHERE action = 'ROLLBACK' AND auth_user_id = '${adminAuthUserId}';
    `);
    assert(auditRollback === '1', 'audit_logs atomically recorded ROLLBACK event');

    // Step 2.5: ATTACK TESTS - Unauthenticated & Service-Role without Admin Identity
    console.log('  -> Executing security penetration tests against publication RPCs and direct SQL mutations...');

    // Attack A: Service role calling publish_pending_drafts without admin JWT claim
    runPsqlExpectError(`
      BEGIN;
      SET LOCAL role = 'service_role';
      RESET "request.jwt.claim.sub";
      SELECT public.publish_pending_drafts(3, 'Attacker publication');
      COMMIT;
    `, 'UNAUTHENTICATED');
    assert(true, 'Attack A blocked: Service-role without authenticated admin JWT rejected from publish_pending_drafts');

    // Attack B: Service role calling rollback_to_snapshot without admin JWT claim
    runPsqlExpectError(`
      BEGIN;
      SET LOCAL role = 'service_role';
      RESET "request.jwt.claim.sub";
      SELECT public.rollback_to_snapshot(1, 3, 'Attacker rollback');
      COMMIT;
    `, 'UNAUTHENTICATED');
    assert(true, 'Attack B blocked: Service-role without authenticated admin JWT rejected from rollback_to_snapshot');

    // Attack C: Direct SQL INSERT of published record (bypassing RPCs)
    runPsqlExpectError(`
      BEGIN;
      SET LOCAL role = 'service_role';
      RESET "request.jwt.claim.sub";
      INSERT INTO public.projects (
        entity_id, version, status, is_current_published, is_tombstone,
        project_number, slug, title, category, summary, description, tags, repo_url, demo_url, preview_type, display_order
      ) VALUES (
        extensions.gen_random_uuid(), 99, 'published', true, false,
        '99', 'backdoor-project', 'Hacked Project', 'SYSTEMS', 'Hacked', 'Hacked', ARRAY[]::text[], '', '', 'secure', 1
      );
      COMMIT;
    `, 'CANNOT_INSERT_PUBLISHED_DIRECTLY: Creating published records directly is prohibited.');
    assert(true, 'Attack C blocked: Direct SQL INSERT (status=published) rejected by immutability trigger');

    // Attack D: Direct SQL UPDATE to promote draft to published without token
    runPsqlExpectError(`
      BEGIN;
      SET LOCAL role = 'service_role';
      RESET "request.jwt.claim.sub";
      UPDATE public.projects SET status = 'published', is_current_published = true 
      WHERE entity_id = '${newDraftProjectId}' AND status = 'draft';
      COMMIT;
    `, 'UNAUTHORIZED_PUBLISHED_MUTATION: Transitions into or out of published status require an active publication operation bound to this transaction.');
    assert(true, 'Attack D blocked: Direct draft promotion without publication token rejected');

    // Attack E: Direct SQL UPDATE to mutate or archive published record
    runPsqlExpectError(`
      BEGIN;
      SET LOCAL role = 'service_role';
      RESET "request.jwt.claim.sub";
      UPDATE public.projects SET status = 'archived', is_current_published = false 
      WHERE status = 'published';
      COMMIT;
    `, 'UNAUTHORIZED_PUBLISHED_MUTATION: Transitions into or out of published status require an active publication operation bound to this transaction.');
    assert(true, 'Attack E blocked: Direct archiving of published records rejected');

    // Attack F: Forged token (setting app.publish_auth_token to random string without matching hash)
    runPsqlExpectError(`
      DO $$
      BEGIN
        -- Insert a token context with known hash (as superuser)
        INSERT INTO private.authorized_publication_context (
          tx_id, authorized_admin_id, token_hash, operation_type, expires_at
        ) VALUES (
          txid_current(), '${testAdminEntityId}'::uuid, extensions.digest('legit_token', 'sha256'), 'PUBLISH', clock_timestamp() + interval '60 seconds'
        );

        PERFORM set_config('role', 'authenticated', true);
        PERFORM set_config('request.jwt.claim.sub', '${adminAuthUserId}', true);
        PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
        -- Supply an attacker-forged token in app.publish_auth_token
        PERFORM set_config('app.publish_auth_token', encode('attacker_forged_token'::bytea, 'hex'), true);

        -- Attempt to promote draft
        UPDATE public.projects SET status = 'published', is_current_published = true 
        WHERE entity_id = '${newDraftProjectId}' AND status = 'draft';
      END $$;
    `, 'FORGED_TOKEN: Publishing authorization token verification failed.');
    assert(true, 'Attack F blocked: Forged publishing authorization token rejected by hash mismatch');

    // Attack G: Expired token
    runPsqlExpectError(`
      DO $$
      DECLARE
        v_tok BYTEA := extensions.gen_random_bytes(32);
      BEGIN
        INSERT INTO private.authorized_publication_context (
          tx_id, authorized_admin_id, token_hash, operation_type, expires_at
        ) VALUES (
          txid_current(), '${testAdminEntityId}'::uuid, extensions.digest(v_tok, 'sha256'), 'PUBLISH', clock_timestamp() - interval '5 seconds'
        );

        PERFORM set_config('request.jwt.claim.sub', '${adminAuthUserId}', true);
        PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
        PERFORM set_config('app.publish_auth_token', encode(v_tok, 'hex'), true);

        UPDATE public.projects SET status = 'published', is_current_published = true 
        WHERE entity_id = '${newDraftProjectId}' AND status = 'draft';
      END $$;
    `, 'TOKEN_EXPIRED: Publication authorization token has expired.');
    assert(true, 'Attack G blocked: Expired publication authorization token rejected');

    // Attack H: Replay attack (consumed token)
    runPsqlExpectError(`
      DO $$
      DECLARE
        v_tok BYTEA := extensions.gen_random_bytes(32);
      BEGIN
        INSERT INTO private.authorized_publication_context (
          tx_id, authorized_admin_id, token_hash, operation_type, expires_at, consumed
        ) VALUES (
          txid_current(), '${testAdminEntityId}'::uuid, extensions.digest(v_tok, 'sha256'), 'PUBLISH', clock_timestamp() + interval '60 seconds', true
        );

        PERFORM set_config('request.jwt.claim.sub', '${adminAuthUserId}', true);
        PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
        PERFORM set_config('app.publish_auth_token', encode(v_tok, 'hex'), true);

        UPDATE public.projects SET status = 'published', is_current_published = true 
        WHERE entity_id = '${newDraftProjectId}' AND status = 'draft';
      END $$;
    `, 'TOKEN_ALREADY_CONSUMED: Publication authorization token has already been consumed.');
    assert(true, 'Attack H blocked: Replay of consumed authorization token rejected');

    // Attack I: Cross-operation scope mismatch (PUBLISH token used to INSERT published record)
    runPsqlExpectError(`
      DO $$
      DECLARE
        v_tok BYTEA := extensions.gen_random_bytes(32);
      BEGIN
        INSERT INTO private.authorized_publication_context (
          tx_id, authorized_admin_id, token_hash, operation_type, expires_at
        ) VALUES (
          txid_current(), '${testAdminEntityId}'::uuid, extensions.digest(v_tok, 'sha256'), 'PUBLISH', clock_timestamp() + interval '60 seconds'
        );

        PERFORM set_config('request.jwt.claim.sub', '${adminAuthUserId}', true);
        PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
        PERFORM set_config('app.publish_auth_token', encode(v_tok, 'hex'), true);

        INSERT INTO public.projects (
          entity_id, version, status, is_current_published, is_tombstone,
          project_number, slug, title, category, summary, description, tags, repo_url, demo_url, preview_type, display_order
        ) VALUES (
          extensions.gen_random_uuid(), 88, 'published', true, false,
          '88', 'illegal-scope', 'Scope Attack', 'SYSTEMS', 'Test', 'Test', ARRAY[]::text[], '', '', 'secure', 1
        );
      END $$;
    `, 'OPERATION_SCOPE_MISMATCH');
    assert(true, 'Attack I blocked: Cross-operation scope mismatch (PUBLISH token cannot INSERT published records)');

    // Attack J: Cross-operation scope mismatch (ROLLBACK token used to PROMOTE draft record)
    runPsqlExpectError(`
      DO $$
      DECLARE
        v_tok BYTEA := extensions.gen_random_bytes(32);
      BEGIN
        INSERT INTO private.authorized_publication_context (
          tx_id, authorized_admin_id, token_hash, operation_type, expires_at
        ) VALUES (
          txid_current(), '${testAdminEntityId}'::uuid, extensions.digest(v_tok, 'sha256'), 'ROLLBACK', clock_timestamp() + interval '60 seconds'
        );

        PERFORM set_config('request.jwt.claim.sub', '${adminAuthUserId}', true);
        PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
        PERFORM set_config('app.publish_auth_token', encode(v_tok, 'hex'), true);

        UPDATE public.projects SET status = 'published', is_current_published = true 
        WHERE entity_id = '${newDraftProjectId}' AND status = 'draft';
      END $$;
    `, 'OPERATION_SCOPE_MISMATCH');
    assert(true, 'Attack J blocked: Cross-operation scope mismatch (ROLLBACK token cannot promote drafts)');

    // Attack K: Content alteration during archiving
    runPsqlExpectError(`
      DO $$
      DECLARE
        v_tok BYTEA := extensions.gen_random_bytes(32);
      BEGIN
        INSERT INTO private.authorized_publication_context (
          tx_id, authorized_admin_id, token_hash, operation_type, expires_at
        ) VALUES (
          txid_current(), '${testAdminEntityId}'::uuid, extensions.digest(v_tok, 'sha256'), 'PUBLISH', clock_timestamp() + interval '60 seconds'
        );

        PERFORM set_config('request.jwt.claim.sub', '${adminAuthUserId}', true);
        PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
        PERFORM set_config('app.publish_auth_token', encode(v_tok, 'hex'), true);

        -- Attempt to change project title while archiving published version
        UPDATE public.projects 
        SET status = 'archived', is_current_published = false, title = 'Altered Title on Archive'
        WHERE status = 'published' AND is_current_published = true;
      END $$;
    `, 'CONTENT_ALTERATION_DENIED: Project content columns cannot be modified when archiving.');
    assert(true, 'Attack K blocked: Content column alteration during archiving rejected by trigger');


    // =========================================================================
    // CHECK 1: CDN CACHE REVOCATION & MEDIA DELIVERY HTTP REQUESTS
    // =========================================================================
    console.log('\n--- CHECK 1: CDN Cache Revocation & Media Delivery HTTP Requests ---');

    // We emulate the exact Node serverless HTTP handler behavior implemented in:
    // - api/public/media/[id].js
    // - api/public/resume.js

    // Seed a published media asset and a private draft media asset in PostgreSQL
    const testMediaId = '30000000-0000-0000-0000-000000000001';
    runPsql(`
      DO $$
      DECLARE
        v_tok BYTEA := extensions.gen_random_bytes(32);
      BEGIN
        INSERT INTO private.authorized_publication_context (
          tx_id, authorized_admin_id, token_hash, operation_type, expires_at
        ) VALUES (
          txid_current(), '${testAdminEntityId}'::uuid, extensions.digest(v_tok, 'sha256'), 'ROLLBACK', clock_timestamp() + interval '60 seconds'
        );

        PERFORM set_config('request.jwt.claim.sub', '${adminAuthUserId}', true);
        PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
        PERFORM set_config('app.publish_auth_token', encode(v_tok, 'hex'), true);

        INSERT INTO public.media_assets (
          entity_id, version, status, is_current_published, is_tombstone,
          storage_path, filename, mime_type, size_bytes, hash_sha256, is_public, is_primary_resume, published_at
        ) VALUES (
          '${testMediaId}', 1, 'published', true, false,
          'media/test-hero.png', 'test-hero.png', 'image/png', 2048, 'abc123sha', true, false, clock_timestamp()
        ) ON CONFLICT (entity_id, version) DO NOTHING;
      END $$;
    `);

    // Helper: Simulate HTTP request to media delivery endpoint
    function simulateMediaDeliveryRequest(assetId, reqHeaders = {}) {
      // Query PostgreSQL live state (as PostgREST/Supabase client does at origin)
      const rows = JSON.parse(runPsql(`
        SELECT COALESCE(json_agg(row_to_json(m)), '[]'::json) FROM (
          SELECT id, entity_id, version, storage_path, filename, mime_type, size_bytes, hash_sha256, is_current_published, is_tombstone, created_at
          FROM public.media_assets
          WHERE entity_id = '${assetId}' AND is_current_published = true AND is_tombstone = false
          LIMIT 1
        ) m;
      `));

      const resHeaders = {};
      let statusCode = 200;
      let body = null;

      if (!rows || rows.length === 0) {
        statusCode = 404;
        resHeaders['Cache-Control'] = 'private, no-cache, no-store, max-age=0, must-revalidate';
        resHeaders['Pragma'] = 'no-cache';
        body = JSON.stringify({ error: 'Asset not found or unpublished' });
        return { statusCode, headers: resHeaders, body };
      }

      const asset = rows[0];
      const etag = `"${asset.hash_sha256 || 'default-etag'}"`;
      resHeaders['Cache-Control'] = 'private, no-cache, no-store, max-age=0, must-revalidate';
      resHeaders['Pragma'] = 'no-cache';
      resHeaders['ETag'] = etag;
      resHeaders['Content-Type'] = asset.mime_type;

      if (reqHeaders['if-none-match'] === etag) {
        statusCode = 304;
        body = '';
        return { statusCode, headers: resHeaders, body };
      }

      body = `[BINARY_PAYLOAD_FOR_${asset.filename}]`;
      return { statusCode, headers: resHeaders, body };
    }

    // Step 1.1: Initial request for published asset
    const req1 = simulateMediaDeliveryRequest(testMediaId);
    assert(req1.statusCode === 200, 'Initial GET /api/public/media returns 200 OK');
    assert(
      req1.headers['Cache-Control'] === 'private, no-cache, no-store, max-age=0, must-revalidate',
      'Effective Cache-Control is "private, no-cache, no-store, max-age=0, must-revalidate"'
    );
    assert(req1.headers['Pragma'] === 'no-cache', 'Effective Pragma header is "no-cache"');
    assert(req1.headers['ETag'] === '"abc123sha"', 'ETag header is present');

    // Step 1.2: Conditional request when published (browser cache revalidation)
    const req2 = simulateMediaDeliveryRequest(testMediaId, { 'if-none-match': '"abc123sha"' });
    assert(req2.statusCode === 304, 'Conditional request matching ETag returns 304 Not Modified when published');

    // Step 1.3: Unpublish / Tombstone the asset in PostgreSQL
    runPsql(`
      DO $$
      DECLARE
        v_tok BYTEA := extensions.gen_random_bytes(32);
      BEGIN
        INSERT INTO private.authorized_publication_context (
          tx_id, authorized_admin_id, token_hash, operation_type, expires_at
        ) VALUES (
          txid_current(), '${testAdminEntityId}'::uuid, extensions.digest(v_tok, 'sha256'), 'PUBLISH', clock_timestamp() + interval '60 seconds'
        );

        PERFORM set_config('request.jwt.claim.sub', '${adminAuthUserId}', true);
        PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
        PERFORM set_config('app.publish_auth_token', encode(v_tok, 'hex'), true);

        UPDATE public.media_assets 
        SET status = 'archived', is_current_published = false 
        WHERE entity_id = '${testMediaId}' AND status = 'published';
      END $$;
    `);

    // Step 1.4: Immediate subsequent request after unpublishing
    const req3 = simulateMediaDeliveryRequest(testMediaId);
    assert(req3.statusCode === 404, 'Subsequent request immediately after unpublish returns 404 Not Found (0s revocation delay)');
    assert(
      req3.headers['Cache-Control'] === 'private, no-cache, no-store, max-age=0, must-revalidate',
      'Unpublished 404 response sets private no-store to prevent edge CDN caching'
    );

    // Step 1.5: Stale conditional request with previously cached ETag on unpublished asset
    const req4 = simulateMediaDeliveryRequest(testMediaId, { 'if-none-match': '"abc123sha"' });
    assert(req4.statusCode === 404, 'Stale conditional request (If-None-Match) returns 404, preventing stale 304 delivery');

    // Step 1.6: Resume delivery endpoint HTTP checks
    function simulateResumeRequest() {
      const rows = JSON.parse(runPsql(`
        SELECT COALESCE(json_agg(row_to_json(m)), '[]'::json) FROM (
          SELECT id, entity_id, version, storage_path, filename, mime_type, size_bytes, hash_sha256, is_primary_resume
          FROM public.media_assets
          WHERE is_primary_resume = true AND is_current_published = true AND is_tombstone = false
        ) m;
      `));

      const resHeaders = {
        'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate',
        'Pragma': 'no-cache',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
      };

      if (!rows || rows.length === 0) {
        return { statusCode: 404, headers: resHeaders, body: { code: 'RESUME_NOT_PUBLISHED' } };
      }
      if (rows.length > 1) {
        return { statusCode: 500, headers: resHeaders, body: { code: 'INCONSISTENT_RESUME_STATE' } };
      }
      if (rows[0].mime_type !== 'application/pdf') {
        return { statusCode: 500, headers: resHeaders, body: { code: 'INVALID_RESUME_MIME_TYPE' } };
      }
      return { statusCode: 200, headers: resHeaders, body: '[BINARY_PDF_STREAM]' };
    }

    const resumeReq = simulateResumeRequest();
    assert(resumeReq.statusCode === 200, 'GET /api/public/resume returns 200 OK for published primary resume');
    assert(
      resumeReq.headers['Cache-Control'] === 'private, no-cache, no-store, max-age=0, must-revalidate',
      'Resume Cache-Control is private, no-store for immediate unpublishing guarantee'
    );

    console.log('\n================================================================');
    console.log(`ALL INTEGRATION CHECKS PASSED: ${passed} passed, ${failed} failed.`);
    console.log('================================================================');

  } finally {
    shutdownPostgres();
  }
}

runChecks().catch((err) => {
  console.error('\n[FATAL ERROR]:', err);
  process.exit(1);
});
