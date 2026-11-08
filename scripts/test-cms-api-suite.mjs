// scripts/test-cms-api-suite.mjs
// Comprehensive End-to-End Test Suite for all CMS Admin API Endpoints:
// - Projects CRUD & Tombstone Workflow
// - Skills & Categories CRUD & Tombstone Workflow
// - Experiences CRUD & Tombstone Workflow
// - Certifications CRUD & Tombstone Workflow
// - Site Settings Modification
// - Media & Resume Upload & Validation
// - Unified Draft Preview Generation
// - Transactional Publication & Rollback Execution
// - Immutable Security Audit Trail Verification

import { createServer } from 'node:http';
import { spawnSync, execSync, spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

// Import Admin Handlers directly to test full request/response cycle
import projectsHandler from '../api/admin/projects/index.js';
import projectByIdHandler from '../api/admin/projects/[id].js';
import skillsHandler from '../api/admin/skills/index.js';
import experienceHandler from '../api/admin/experience/index.js';
import certsHandler from '../api/admin/certifications/index.js';
import settingsHandler from '../api/admin/settings/index.js';
import mediaListHandler from '../api/admin/media/index.js';
import mediaUploadHandler from '../api/admin/media/upload.js';
import previewHandler from '../api/admin/content/preview.js';
import publishHandler from '../api/admin/publish/index.js';
import rollbackHandler from '../api/admin/publish/rollback.js';
import auditLogsHandler from '../api/admin/audit-logs/index.js';
import publicContentHandler from '../api/public/content.js';
import cronKeepaliveHandler from '../api/cron/keepalive.js';
import { triggerVercelDeployHook } from '../lib/deploy-hook.js';

const PG_DIR = '/tmp/pg_cms_api_cluster';
const PG_PORT = 54327;
const GATEWAY_PORT = 54328;
const PG_BIN = '/usr/lib/postgresql/18/bin';
const DB_NAME = 'postgres';
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-for-hs256';

console.log('========================================================================');
console.log('STARTING PHASE 2 CMS API & LIFECYCLE END-TO-END TEST SUITE');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// JWT Generator
// -----------------------------------------------------------------------------
function signJwt(payload, secret = JWT_SECRET) {
  const b64 = s => Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${h}.${p}.${sig}`;
}

const adminAuthUserId = '00000000-0000-0000-0000-000000000001';
const adminJwt = signJwt({
  sub: adminAuthUserId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'admin@shenoypranav.com',
  exp: Math.floor(Date.now() / 1000) + 7200
});

// -----------------------------------------------------------------------------
// Mock Next.js / Vercel Serverless Request & Response Simulator
// -----------------------------------------------------------------------------
function createMockReqRes({ method = 'GET', url = '/', headers = {}, body = null, query = {} } = {}) {
  const reqHeaders = {
    'authorization': `Bearer ${adminJwt}`,
    'cookie': `admin_at=${adminJwt}`,
    'content-type': 'application/json',
    ...headers
  };

  const req = {
    method,
    url,
    headers: reqHeaders,
    query,
    body,
    async *[Symbol.asyncIterator]() {
      if (body) {
        if (Buffer.isBuffer(body)) {
          yield body;
        } else if (typeof body === 'object') {
          yield Buffer.from(JSON.stringify(body));
        } else {
          yield Buffer.from(String(body));
        }
      }
    }
  };

  let statusCode = 200;
  const resHeaders = {};
  let responseData = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(k, v) {
      resHeaders[k] = v;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    send(data) {
      responseData = data;
      return this;
    },
    end() {
      return this;
    },
    _getResult() {
      return { statusCode, headers: resHeaders, body: responseData };
    }
  };

  return { req, res };
}

function createPublicVisitorReqRes({ method = 'GET', url = '/api/public/content', headers = {} } = {}) {
  const reqHeaders = {
    'accept': 'application/json',
    'user-agent': 'Mozilla/5.0 (Public Visitor Browser)',
    ...headers
  };

  const req = {
    method,
    url,
    headers: reqHeaders,
    query: {},
    body: null,
  };

  let statusCode = 200;
  const resHeaders = {};
  let responseData = null;

  const res = {
    status(code) { statusCode = code; return this; },
    setHeader(k, v) { resHeaders[k] = v; return this; },
    json(data) { responseData = data; return this; },
    send(data) { responseData = data; return this; },
    end() { return this; },
    _getResult() { return { statusCode, headers: resHeaders, body: responseData }; }
  };

  return { req, res };
}

// -----------------------------------------------------------------------------
// PostgREST Gateway & Local PostgreSQL Server
// -----------------------------------------------------------------------------
function runPsql(sql, db = DB_NAME) {
  const res = spawnSync(
    `${PG_BIN}/psql`,
    ['-h', '/tmp', '-p', String(PG_PORT), '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-t', '-A'],
    { input: sql, encoding: 'utf8' }
  );
  if (res.status !== 0) {
    throw new Error(res.stderr ? res.stderr.trim() : `psql exit code ${res.status}`);
  }
  const lines = res.stdout.trim().split('\n')
    .map(l => l.trim())
    .filter(l => l && !['BEGIN', 'SET', 'COMMIT', 'DO'].includes(l) && !l.startsWith('INSERT ') && !l.startsWith('UPDATE ') && !l.startsWith('DELETE '));
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

let gatewayServer = null;

function startPostgrestGateway() {
  return new Promise((resolve, reject) => {
    gatewayServer = createServer(async (req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${GATEWAY_PORT}`);
      let bodyRaw = '';
      req.on('data', chunk => { bodyRaw += chunk; });
      req.on('end', () => {
        let body = {};
        try { if (bodyRaw) body = JSON.parse(bodyRaw); } catch (e) {}

        const authHeader = req.headers['authorization'] || '';
        let payload = { role: 'anon' };
        if (authHeader.startsWith('Bearer ')) {
          try {
            const b64 = authHeader.slice(7).split('.')[1];
            payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
          } catch (e) {}
        }

        const dbRole = payload.role || 'anon';
        const subClaim = payload.sub || null;

        // 0. Supabase Auth Route (/auth/v1/user)
        if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
          if (!subClaim) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ message: 'Missing user identity in token.' }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            id: subClaim,
            email: payload.email || 'admin@shenoypranav.com',
            role: payload.role || 'authenticated'
          }));
        }

        // 1. PostgREST RPC Route
        const rpcMatch = url.pathname.match(/^\/rest\/v1\/rpc\/([a-zA-Z0-9_]+)$/);
        if (rpcMatch) {
          const rpcName = rpcMatch[1];
          let rpcArgs = '';
          if (rpcName === 'publish_pending_drafts') {
            rpcArgs = `${body.p_expected_base_version || 1}, ${body.p_notes ? `'${String(body.p_notes).replace(/'/g, "''")}'` : 'NULL'}`;
          } else if (rpcName === 'rollback_to_snapshot') {
            rpcArgs = `${body.p_target_version}, ${body.p_expected_current_version}, ${body.p_reason ? `'${String(body.p_reason).replace(/'/g, "''")}'` : 'NULL'}`;
          }

          const txSql = `
            BEGIN;
            SET LOCAL role = '${dbRole}';
            SET LOCAL "request.jwt.claims" = '${JSON.stringify(payload).replace(/'/g, "''")}';
            ${subClaim ? `SET LOCAL "request.jwt.claim.sub" = '${subClaim}';` : 'RESET "request.jwt.claim.sub";'}
            SET LOCAL "request.jwt.claim.role" = '${dbRole}';
            SELECT public.${rpcName}(${rpcArgs});
            COMMIT;
          `;
          try {
            const out = runPsql(txSql);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(out);
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ code: 'P0001', message: err.message }));
          }
        }

        // 2. PostgREST Table Queries (/rest/v1/:table)
        const tableMatch = url.pathname.match(/^\/rest\/v1\/([a-zA-Z0-9_]+)$/);
        if (tableMatch) {
          const table = tableMatch[1];
          try {
            if (req.method === 'GET') {
              // Parse basic filter queries
              const params = url.searchParams;
              let whereClause = 'WHERE true';
              for (const [k, v] of params.entries()) {
                if (k === 'order' || k === 'limit' || k === 'offset' || k === 'select') continue;
                if (v.startsWith('eq.')) {
                  const val = v.slice(3);
                  whereClause += ` AND ${k} = '${val.replace(/'/g, "''")}'`;
                }
              }
              const orderClause = params.get('order') ? `ORDER BY ${params.get('order').replace('.asc', ' ASC').replace('.desc', ' DESC')}` : '';
              const limitClause = params.get('limit') ? `LIMIT ${params.get('limit')}` : '';

              const sql = `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT * FROM public.${table} ${whereClause} ${orderClause} ${limitClause}) t;`;
              const out = runPsql(sql);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(out);
            }

            if (req.method === 'POST') {
              const row = body;
              const cols = Object.keys(row).join(', ');
              const vals = Object.values(row).map(v => {
                if (v === null) return 'NULL';
                if (typeof v === 'boolean' || typeof v === 'number') return v;
                if (Array.isArray(v)) return `ARRAY[${v.map(item => `'${String(item).replace(/'/g, "''")}'`).join(',')}]::text[]`;
                if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
                return `'${String(v).replace(/'/g, "''")}'`;
              }).join(', ');

              const sql = `WITH ins AS (INSERT INTO public.${table} (${cols}) VALUES (${vals}) RETURNING *) SELECT row_to_json(ins.*) FROM ins;`;
              const out = runPsql(sql);
              res.writeHead(201, { 'Content-Type': 'application/json' });
              return res.end(`[${out}]`);
            }

            if (req.method === 'PATCH') {
              const params = url.searchParams;
              let whereClause = 'WHERE true';
              for (const [k, v] of params.entries()) {
                if (v.startsWith('eq.')) whereClause += ` AND ${k} = '${v.slice(3).replace(/'/g, "''")}'`;
              }
              const sets = Object.entries(body).map(([k, v]) => {
                if (v === null) return `${k} = NULL`;
                if (typeof v === 'boolean' || typeof v === 'number') return `${k} = ${v}`;
                if (Array.isArray(v)) return `${k} = ARRAY[${v.map(item => `'${String(item).replace(/'/g, "''")}'`).join(',')}]::text[]`;
                if (typeof v === 'object') return `${k} = '${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
                return `${k} = '${String(v).replace(/'/g, "''")}'`;
              }).join(', ');

              const sql = `WITH upd AS (UPDATE public.${table} SET ${sets} ${whereClause} RETURNING *) SELECT row_to_json(upd.*) FROM upd;`;
              const out = runPsql(sql);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(`[${out}]`);
            }

            if (req.method === 'DELETE') {
              const params = url.searchParams;
              let whereClause = 'WHERE true';
              for (const [k, v] of params.entries()) {
                if (v.startsWith('eq.')) whereClause += ` AND ${k} = '${v.slice(3).replace(/'/g, "''")}'`;
              }
              runPsql(`DELETE FROM public.${table} ${whereClause};`);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ success: true }));
            }
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
          }
        }

        // 3. Supabase Storage Mock Route (/storage/v1/object/:bucket/*)
        const storageMatch = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
        if (storageMatch) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ Key: `${storageMatch[1]}/${storageMatch[2]}` }));
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      });
    });

    gatewayServer.listen(GATEWAY_PORT, '127.0.0.1', () => {
      resolve();
    });
    gatewayServer.on('error', reject);
  });
}

async function setup() {
  if (existsSync(PG_DIR)) {
    try { execSync(`${PG_BIN}/pg_ctl -D ${PG_DIR} -m immediate stop 2>/dev/null || true`); } catch (e) {}
    rmSync(PG_DIR, { recursive: true, force: true });
  }
  mkdirSync(PG_DIR, { recursive: true });
  execSync(`${PG_BIN}/initdb -D ${PG_DIR} --no-locale -E UTF8 --username=postgres`, { stdio: 'pipe' });
  execSync(`${PG_BIN}/pg_ctl -D ${PG_DIR} -o "-k /tmp -p ${PG_PORT}" -l ${PG_DIR}/server.log start`, { stdio: 'pipe' });

  // Roles, Schema & Migrations
  runPsql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT UNIQUE, created_at TIMESTAMPTZ DEFAULT clock_timestamp());
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon'); $$ LANGUAGE sql STABLE;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
    GRANT ALL ON auth.users TO postgres, service_role;
    GRANT SELECT ON auth.users TO authenticated;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (id TEXT PRIMARY KEY, name TEXT NOT NULL, public BOOLEAN DEFAULT false);
    CREATE TABLE IF NOT EXISTS storage.objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT REFERENCES storage.buckets(id), name TEXT NOT NULL, owner UUID, created_at TIMESTAMPTZ DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ DEFAULT clock_timestamp());
  `);

  runPsqlFile('migrations/001_initial_schema.sql');
  runPsqlFile('migrations/002_immutability_triggers.sql');
  runPsqlFile('migrations/003_rls_policies.sql');
  runPsqlFile('migrations/004_publication_rpcs.sql');
  runPsqlFile('migrations/005_seed_data.sql');
  runPsqlFile('migrations/006_certification_images_and_dates.sql');

  await startPostgrestGateway();

  process.env.SUPABASE_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
  process.env.SUPABASE_ANON_KEY = 'anon-key-mock';
  process.env.SUPABASE_SERVICE_ROLE_KEY = signJwt({ role: 'service_role', iss: 'supabase' });
}

function teardown() {
  if (gatewayServer) gatewayServer.close();
  try { execSync(`${PG_BIN}/pg_ctl -D ${PG_DIR} -m immediate stop`, { stdio: 'pipe' }); } catch (e) {}
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, label) {
    if (condition) {
      console.log(`  PASS: ${label}`);
      passed++;
    } else {
      console.error(`  FAIL: ${label}`);
      failed++;
      throw new Error(`Assertion failed: ${label}`);
    }
  }

  try {
    await setup();

    // =========================================================================
    // 1. Projects CMS API Tests
    // =========================================================================
    console.log('\n--- 1. Testing Projects CMS API & Tombstone Lifecycle ---');

    // 1.1 List Projects
    const { req: reqListProj, res: resListProj } = createMockReqRes({ method: 'GET', url: '/api/admin/projects' });
    await projectsHandler(reqListProj, resListProj);
    const projListResult = resListProj._getResult();
    assert(projListResult.statusCode === 200, 'GET /api/admin/projects returns 200 OK');
    assert(Array.isArray(projListResult.body.projects), 'Returns projects array');

    // 1.2 Create New Project Draft
    const newProjectPayload = {
      title: 'Neural Kernel Debugger',
      slug: 'neural-kernel-debugger',
      project_number: '08',
      category: 'SYSTEMS',
      summary: 'Low-level Linux kernel observability engine with neural tracing.',
      description: 'Comprehensive eBPF tracing with lightweight in-kernel embeddings.',
      tags: ['C', 'Linux', 'eBPF'],
      preview_type: 'secure',
      display_order: 8
    };

    const { req: reqCreateProj, res: resCreateProj } = createMockReqRes({
      method: 'POST',
      url: '/api/admin/projects',
      body: newProjectPayload
    });
    await projectsHandler(reqCreateProj, resCreateProj);
    const createProjResult = resCreateProj._getResult();
    assert(createProjResult.statusCode === 201, 'POST /api/admin/projects returns 201 Created');
    assert(createProjResult.body.project.status === 'draft', 'Created project has status=draft');
    assert(createProjResult.body.project.is_current_published === false, 'Created project has is_current_published=false');
    const createdProjectId = createProjResult.body.project.entity_id;

    // 1.3 Update Existing Project Draft
    const { req: reqUpdateProj, res: resUpdateProj } = createMockReqRes({
      method: 'PUT',
      url: `/api/admin/projects/${createdProjectId}`,
      query: { id: createdProjectId },
      body: { title: 'Neural Kernel Debugger (Enhanced)' }
    });
    await projectByIdHandler(reqUpdateProj, resUpdateProj);
    const updateProjResult = resUpdateProj._getResult();
    assert(updateProjResult.statusCode === 200, 'PUT /api/admin/projects/[id] returns 200 OK');
    assert(updateProjResult.body.project.title === 'Neural Kernel Debugger (Enhanced)', 'Project draft updated in-place');

    // =========================================================================
    // 2. Skills & Categories CMS API Tests
    // =========================================================================
    console.log('\n--- 2. Testing Skills & Categories CMS API ---');

    // 2.1 Create Skill Category Draft
    const { req: reqCreateCat, res: resCreateCat } = createMockReqRes({
      method: 'POST',
      url: '/api/admin/skills',
      body: { type: 'category', name: 'CLOUD & INFRASTRUCTURE', category_number: '07 / CLOUD', sort_order: 7 }
    });
    await skillsHandler(reqCreateCat, resCreateCat);
    const catResult = resCreateCat._getResult();
    assert(catResult.statusCode === 201, 'POST /api/admin/skills (category) returns 201 Created');
    assert(catResult.body.category.status === 'draft', 'Created category has status=draft');
    const createdCatId = catResult.body.category.entity_id;

    // 2.2 Create Skill Draft under that Category
    const { req: reqCreateSkill, res: resCreateSkill } = createMockReqRes({
      method: 'POST',
      url: '/api/admin/skills',
      body: { type: 'skill', category_id: createdCatId, name: 'Terraform', sort_order: 1 }
    });
    await skillsHandler(reqCreateSkill, resCreateSkill);
    const skillResult = resCreateSkill._getResult();
    assert(skillResult.statusCode === 201, 'POST /api/admin/skills (skill) returns 201 Created');
    assert(skillResult.body.skill.status === 'draft', 'Created skill has status=draft');
    const createdSkillId = skillResult.body.skill.entity_id;

    // 2.3 List Skills & Categories
    const { req: reqListSkills, res: resListSkills } = createMockReqRes({ method: 'GET', url: '/api/admin/skills' });
    await skillsHandler(reqListSkills, resListSkills);
    const listSkillsResult = resListSkills._getResult();
    assert(listSkillsResult.statusCode === 200, 'GET /api/admin/skills returns 200 OK');
    assert(listSkillsResult.body.categories.some(c => c.entity_id === createdCatId), 'Category present in listing');

    // =========================================================================
    // 3. Experiences & Certifications CMS API Tests
    // =========================================================================
    console.log('\n--- 3. Testing Experiences & Certifications CMS API ---');

    // 3.1 Create Experience Draft
    const { req: reqCreateExp, res: resCreateExp } = createMockReqRes({
      method: 'POST',
      url: '/api/admin/experience',
      body: {
        company: 'Distributed Labs',
        role_title: 'Systems Research Fellow',
        subtitle: 'Security & RAG Architecture',
        description: 'Engineered multi-tenant isolation and verifiable audit logs.',
        start_date: 'AUG 2024',
        end_date: null,
        sort_order: 2
      }
    });
    await experienceHandler(reqCreateExp, resCreateExp);
    const expResult = resCreateExp._getResult();
    assert(expResult.statusCode === 201, 'POST /api/admin/experience returns 201 Created');
    assert(expResult.body.experience.status === 'draft', 'Created experience has status=draft');

    // 3.2 Create Certification Draft
    const { req: reqCreateCert, res: resCreateCert } = createMockReqRes({
      method: 'POST',
      url: '/api/admin/certifications',
      body: {
        title: 'Security Certified Practitioner (SCP)',
        issuer: 'Cyber Defense Alliance',
        mark_symbol: '✳',
        credential_url: 'https://credentials.example.com/scp-101',
        sort_order: 1
      }
    });
    await certsHandler(reqCreateCert, resCreateCert);
    const certResult = resCreateCert._getResult();
    assert(certResult.statusCode === 201, 'POST /api/admin/certifications returns 201 Created');
    assert(certResult.body.certification.status === 'draft', 'Created certification has status=draft');

    // =========================================================================
    // 4. Site Settings CMS API Tests
    // =========================================================================
    console.log('\n--- 4. Testing Site Settings Modification ---');

    // 4.1 Update Site Settings Draft
    const { req: reqUpdateSettings, res: resUpdateSettings } = createMockReqRes({
      method: 'PUT',
      url: '/api/admin/settings',
      body: {
        profile_name: 'Pranav Shenoy (Updated)',
        role_title: 'AI SYSTEMS & SECURITY ENGINEER',
        cgpa: 8.95
      }
    });
    await settingsHandler(reqUpdateSettings, resUpdateSettings);
    const settingsResult = resUpdateSettings._getResult();
    assert(settingsResult.statusCode === 200 || settingsResult.statusCode === 201, 'PUT /api/admin/settings succeeds');
    assert(settingsResult.body.settings.status === 'draft', 'Settings revision staged as status=draft');

    // =========================================================================
    // 5. Unified Draft Preview Verification
    // =========================================================================
    console.log('\n--- 5. Testing Unified Content Preview ---');

    const { req: reqPreview, res: resPreview } = createMockReqRes({ method: 'GET', url: '/api/admin/content/preview' });
    await previewHandler(reqPreview, resPreview);
    const previewResult = resPreview._getResult();
    assert(previewResult.statusCode === 200, 'GET /api/admin/content/preview returns 200 OK');
    assert(previewResult.body.totalDrafts >= 5, `Preview calculates ${previewResult.body.totalDrafts} pending drafts`);
    assert(previewResult.body.preview.projects.some(p => p.entity_id === createdProjectId), 'Preview includes draft project');
    assert(previewResult.body.preview.skills.some(s => s.entity_id === createdSkillId), 'Preview includes draft skill');
    assert(previewResult.body.preview.site_settings.profile_name === 'Pranav Shenoy (Updated)', 'Preview incorporates draft settings');

    // =========================================================================
    // 6. Transactional Publication Execution
    // =========================================================================
    console.log('\n--- 6. Testing Transactional Publication Execution ---');

    const currentLiveVer = previewResult.body.liveVersion;
    const { req: reqPub, res: resPub } = createMockReqRes({
      method: 'POST',
      url: '/api/admin/publish',
      body: { expected_base_version: currentLiveVer, notes: 'Release of Phase 2 CMS draft content' }
    });
    await publishHandler(reqPub, resPub);
    const pubResult = resPub._getResult();
    assert(pubResult.statusCode === 200, 'POST /api/admin/publish returns 200 OK');
    assert(pubResult.body.publication.version === currentLiveVer + 1, `Publication version advanced to ${currentLiveVer + 1}`);
    assert(pubResult.body.publication.promoted_count >= 5, `Promoted ${pubResult.body.publication.promoted_count} draft entities`);

    // 6.1 Verify Public API Reflects Newly Published Content for Real Unauthenticated Visitors
    console.log('\n  -> Simulating unauthenticated public visitor request following publication...');
    const { req: reqVisitor, res: resVisitor } = createPublicVisitorReqRes();
    await publicContentHandler(reqVisitor, resVisitor);
    const visitorResult = resVisitor._getResult();
    assert(visitorResult.statusCode === 200, 'Public visitor request returns 200 OK');
    assert(visitorResult.body.live_version === currentLiveVer + 1, `Public visitor receives live version ${currentLiveVer + 1}`);
    assert(visitorResult.body.projects.some(p => p.entity_id === createdProjectId), 'Public visitor immediately receives newly published project');
    assert(visitorResult.body.site_settings.profile_name === 'Pranav Shenoy (Updated)', 'Public visitor immediately receives updated site settings');
    assert(visitorResult.headers['ETag'], 'Response contains ETag header');
    assert(visitorResult.headers['X-Publication-Version'] === String(currentLiveVer + 1), 'Response contains X-Publication-Version header');

    // 6.2 Test Public Visitor Conditional Revalidation (If-None-Match)
    const { req: reqVisitorCond, res: resVisitorCond } = createPublicVisitorReqRes({
      headers: { 'if-none-match': visitorResult.headers['ETag'] }
    });
    await publicContentHandler(reqVisitorCond, resVisitorCond);
    assert(resVisitorCond._getResult().statusCode === 304, 'Public visitor conditional request matching ETag returns 304 Not Modified');

    // =========================================================================
    // 7. Tombstone Deletion & Unpublishing Lifecycle
    // =========================================================================
    console.log('\n--- 7. Testing Tombstone Deletion & Unpublishing Lifecycle ---');

    // 7.1 Delete published project (should create tombstone draft)
    const { req: reqDelProj, res: resDelProj } = createMockReqRes({
      method: 'DELETE',
      url: `/api/admin/projects/${createdProjectId}`,
      query: { id: createdProjectId }
    });
    await projectByIdHandler(reqDelProj, resDelProj);
    const delProjResult = resDelProj._getResult();
    assert(delProjResult.statusCode === 200, 'DELETE /api/admin/projects/[id] stages tombstone');

    // Verify preview reflects staged tombstone
    const { req: reqPreviewTomb, res: resPreviewTomb } = createMockReqRes({ method: 'GET', url: '/api/admin/content/preview' });
    await previewHandler(reqPreviewTomb, resPreviewTomb);
    const previewTombResult = resPreviewTomb._getResult();
    assert(!previewTombResult.body.preview.projects.some(p => p.entity_id === createdProjectId), 'Preview excludes tombstoned project');

    // 7.2 Publish Tombstone
    const nextBaseVer = pubResult.body.publication.version;
    const { req: reqPubTomb, res: resPubTomb } = createMockReqRes({
      method: 'POST',
      url: '/api/admin/publish',
      body: { expected_base_version: nextBaseVer, notes: 'Publishing tombstone deletion' }
    });
    await publishHandler(reqPubTomb, resPubTomb);
    const pubTombResult = resPubTomb._getResult();
    assert(pubTombResult.statusCode === 200, 'POST /api/admin/publish promoted tombstone');

    // 7.3 Verify Public API no longer serves the deleted project
    const { req: reqPublicAfterDel, res: resPublicAfterDel } = createMockReqRes({ method: 'GET', url: '/api/public/content' });
    await publicContentHandler(reqPublicAfterDel, resPublicAfterDel);
    const publicAfterDelResult = resPublicAfterDel._getResult();
    assert(!publicAfterDelResult.body.projects.some(p => p.entity_id === createdProjectId), 'Public content no longer serves deleted project');

    // =========================================================================
    // 8. Rollback Execution
    // =========================================================================
    console.log('\n--- 8. Testing Rollback Execution ---');

    const rollbackTargetVer = 1;
    const rollbackCurVer = pubTombResult.body.publication.version;
    const { req: reqRoll, res: resRoll } = createMockReqRes({
      method: 'POST',
      url: '/api/admin/publish/rollback',
      body: {
        target_version: rollbackTargetVer,
        expected_current_version: rollbackCurVer,
        reason: 'Restoring initial baseline release'
      }
    });
    await rollbackHandler(reqRoll, resRoll);
    const rollResult = resRoll._getResult();
    assert(rollResult.statusCode === 200, 'POST /api/admin/publish/rollback returns 200 OK');
    assert(rollResult.body.rollback.new_version === rollbackCurVer + 1, `Rollback created new monotonic version ${rollbackCurVer + 1}`);

    // =========================================================================
    // 9. Immutable Audit Trail Verification
    // =========================================================================
    console.log('\n--- 9. Testing Immutable Audit Trail ---');

    const { req: reqAudit, res: resAudit } = createMockReqRes({ method: 'GET', url: '/api/admin/audit-logs' });
    await auditLogsHandler(reqAudit, resAudit);
    const auditResult = resAudit._getResult();
    assert(auditResult.statusCode === 200, 'GET /api/admin/audit-logs returns 200 OK');
    assert(Array.isArray(auditResult.body.logs) && auditResult.body.logs.length > 5, 'Audit trail captured operations');
    assert(auditResult.body.logs.some(l => l.action === 'PUBLISH'), 'Audit trail contains PUBLISH action');
    assert(auditResult.body.logs.some(l => l.action === 'ROLLBACK'), 'Audit trail contains ROLLBACK action');

    // =========================================================================
    // 10. Canonical Origin & Preview Security Verification
    // =========================================================================
    console.log('\n--- 10. Testing Canonical Origin & Preview Security ---');

    // 10.1 Allowed: Canonical production origin
    const { req: reqCanon, res: resCanon } = createMockReqRes({
      method: 'POST',
      url: '/api/admin/projects',
      headers: { origin: 'https://pranav-shenoy-portfolio.vercel.app' },
      body: { ...newProjectPayload, slug: 'canonical-origin-test', project_number: '91' }
    });
    await projectsHandler(reqCanon, resCanon);
    assert(resCanon._getResult().statusCode === 201, 'State-changing POST allowed from canonical production origin');

    // 10.2 Allowed: Project-specific Vercel preview domain
    const { req: reqPrev, res: resPrev } = createMockReqRes({
      method: 'POST',
      url: '/api/admin/projects',
      headers: { origin: 'https://pranav-shenoy-portfolio-git-antigravity-updates.vercel.app' },
      body: { ...newProjectPayload, slug: 'project-preview-test', project_number: '92' }
    });
    await projectsHandler(reqPrev, resPrev);
    assert(resPrev._getResult().statusCode === 201, 'State-changing POST allowed from project-specific preview domain');

    // 10.3 REJECTED: Unrelated Vercel deployment origin
    const { req: reqUnrelatedVercel, res: resUnrelatedVercel } = createMockReqRes({
      method: 'POST',
      url: '/api/admin/projects',
      headers: { origin: 'https://unrelated-attacker-app.vercel.app' },
      body: { ...newProjectPayload, slug: 'attacker-test', project_number: '93' }
    });
    await projectsHandler(reqUnrelatedVercel, resUnrelatedVercel);
    const unrelatedResult = resUnrelatedVercel._getResult();
    assert(unrelatedResult.statusCode === 403, 'State-changing POST from unrelated Vercel app rejected with 403 Forbidden');
    assert(unrelatedResult.body.code === 'CSRF_ORIGIN_MISMATCH', 'Rejection code is CSRF_ORIGIN_MISMATCH');

    // 10.4 REJECTED: External attacker origin
    const { req: reqAttacker, res: resAttacker } = createMockReqRes({
      method: 'POST',
      url: '/api/admin/projects',
      headers: { origin: 'https://evil-phishing-site.com' },
      body: { ...newProjectPayload, slug: 'evil-test', project_number: '94' }
    });
    await projectsHandler(reqAttacker, resAttacker);
    const attackerResult = resAttacker._getResult();
    assert(attackerResult.statusCode === 403, 'State-changing POST from external attacker origin rejected with 403');
    assert(attackerResult.body.code === 'CSRF_ORIGIN_MISMATCH', 'Rejection code is CSRF_ORIGIN_MISMATCH');

    // =========================================================================
    // 11. Testing Scheduled Vercel Cron Keepalive Endpoint
    // =========================================================================
    console.log('\n--- 11. Testing Scheduled Vercel Cron Keepalive Endpoint ---');

    // 11.1 Method not allowed on non-GET
    const { req: reqCronPost, res: resCronPost } = createMockReqRes({
      method: 'POST',
      url: '/api/cron/keepalive',
      headers: { authorization: 'Bearer some-secret' }
    });
    await cronKeepaliveHandler(reqCronPost, resCronPost);
    assert(resCronPost._getResult().statusCode === 405, 'POST to /api/cron/keepalive rejected with 405 Method Not Allowed');

    // 11.2 Server misconfiguration when CRON_SECRET is missing
    const originalCronSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    const { req: reqNoSecret, res: resNoSecret } = createMockReqRes({
      method: 'GET',
      url: '/api/cron/keepalive',
      headers: { authorization: 'Bearer any-token' }
    });
    await cronKeepaliveHandler(reqNoSecret, resNoSecret);
    assert(resNoSecret._getResult().statusCode === 500, 'Keepalive returns 500 when CRON_SECRET is not configured on server');

    // Set test CRON_SECRET
    process.env.CRON_SECRET = 'super-secret-cron-token-12345';

    // 11.3 Missing Authorization header
    const { req: reqMissingAuth, res: resMissingAuth } = createMockReqRes({
      method: 'GET',
      url: '/api/cron/keepalive',
      headers: { authorization: '' }
    });
    await cronKeepaliveHandler(reqMissingAuth, resMissingAuth);
    const missingAuthResult = resMissingAuth._getResult();
    assert(missingAuthResult.statusCode === 401, 'Keepalive without Bearer token rejected with 401 Unauthorized');
    assert(missingAuthResult.body.error === 'UNAUTHORIZED', 'Error code is UNAUTHORIZED');

    // 11.4 Invalid Bearer token
    const { req: reqWrongAuth, res: resWrongAuth } = createMockReqRes({
      method: 'GET',
      url: '/api/cron/keepalive',
      headers: { authorization: 'Bearer forged-cron-secret' }
    });
    await cronKeepaliveHandler(reqWrongAuth, resWrongAuth);
    assert(resWrongAuth._getResult().statusCode === 401, 'Keepalive with invalid Bearer token rejected with 401');

    // 11.5 Valid Bearer token triggers genuine read query via minimal anon key
    const { req: reqValidCron, res: resValidCron } = createMockReqRes({
      method: 'GET',
      url: '/api/cron/keepalive',
      headers: { authorization: 'Bearer super-secret-cron-token-12345' }
    });
    await cronKeepaliveHandler(reqValidCron, resValidCron);
    const validCronResult = resValidCron._getResult();
    assert(validCronResult.statusCode === 200, 'Keepalive with valid CRON_SECRET returns 200 OK');
    assert(validCronResult.body.ok === true, 'Response body has ok: true');
    assert(validCronResult.body.status === 'active', 'Response body confirms status: active');
    assert(typeof validCronResult.body.duration_ms === 'number', 'Response reports query latency duration_ms');
    assert(validCronResult.body.published_version !== null, 'Response reports current published version from Supabase');
    assert(/no-store/i.test(validCronResult.headers['Cache-Control']), 'Keepalive response carries Cache-Control: no-store');

    // 11.6 Validate vercel.json cron and security headers configuration
    const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const cronEntry = vercelConfig.crons?.find(c => c.path === '/api/cron/keepalive');
    assert(!!cronEntry, 'vercel.json specifies /api/cron/keepalive in crons array');
    assert(cronEntry.schedule === '0 4 * * *', 'vercel.json schedules keepalive once daily for Hobby plan compatibility (04:00 UTC)');
    const cronHeaderRule = vercelConfig.headers?.find(h => h.source === '/api/cron/(.*)');
    assert(!!cronHeaderRule, 'vercel.json defines dedicated security headers for /api/cron/(.*)');
    assert(cronHeaderRule.headers.some(h => h.key === 'Cache-Control' && /no-store/.test(h.value)), 'vercel.json blocks edge caching on cron routes');

    // Restore CRON_SECRET
    if (originalCronSecret) process.env.CRON_SECRET = originalCronSecret;
    else delete process.env.CRON_SECRET;

    // =========================================================================
    // 12. Testing Deploy Hook & Option A Static Rebuild Integration
    // =========================================================================
    console.log('\n--- 12. Testing Deploy Hook & Static Rebuild Integration ---');

    // 12.1 Deploy hook unconfigured
    delete process.env.VERCEL_DEPLOY_HOOK_URL;
    const unconfiguredHookResult = await triggerVercelDeployHook();
    assert(unconfiguredHookResult.triggered === false, 'triggerVercelDeployHook handles missing hook gracefully without throwing');

    // 12.2 Deploy hook invoked when configured
    let mockHookCalled = false;
    const mockHookServer = createServer((hookReq, hookRes) => {
      mockHookCalled = true;
      hookRes.writeHead(200, { 'Content-Type': 'application/json' });
      hookRes.end(JSON.stringify({ job: { id: 'deploy-job-123', state: 'queued' } }));
    });
    await new Promise(resolve => mockHookServer.listen(54329, resolve));

    try {
      process.env.VERCEL_DEPLOY_HOOK_URL = 'http://127.0.0.1:54329/api/deploy-hook';
      const configuredHookResult = await triggerVercelDeployHook();
      assert(configuredHookResult.triggered === true, 'triggerVercelDeployHook triggers configured build hook');
      assert(mockHookCalled === true, 'Mock deploy hook server received invocation POST');
      assert(configuredHookResult.job?.id === 'deploy-job-123', 'Job ID returned from deploy hook');
    } finally {
      mockHookServer.close();
      delete process.env.VERCEL_DEPLOY_HOOK_URL;
    }

    // 12.3 Option A static build verification with Supabase content
    const buildRes = await new Promise((resolve) => {
      const proc = spawn('node', ['scripts/build.mjs'], {
        env: {
          ...process.env,
          SUPABASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
          SUPABASE_ANON_KEY: 'mock-anon-key'
        }
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d; });
      proc.stderr.on('data', d => { stderr += d; });
      proc.on('close', code => { resolve({ status: code, stdout, stderr }); });
    });
    assert(buildRes.status === 0, 'Build script succeeds when reading published content from Supabase');

    // 12.4 Verify every published CMS content type reaches generated static HTML
    const builtHtml = readFileSync('dist/index.html', 'utf8');
    assert(builtHtml.includes('data-build-text="bio"'), 'Static HTML includes published bio container');
    assert(builtHtml.includes('data-build-piece="greeting"'), 'Static HTML includes published greeting container');
    assert(builtHtml.includes('data-build-piece="role"'), 'Static HTML includes published role container');
    assert(builtHtml.includes('data-count="8.46"'), 'Static HTML includes published education metric (CGPA)');
    assert(builtHtml.includes('data-project="ragfence"') && builtHtml.includes('RAGFENCE'), 'Static HTML includes published project card');
    assert(builtHtml.includes('data-build-piece="skills-list"') && builtHtml.includes('01 / PROGRAMMING') && builtHtml.includes('<b>Python</b>'), 'Static HTML includes published skill categories and skills');
    assert(builtHtml.includes('data-build-piece="experience-item"') && builtHtml.includes('MANIPAL TECHNOLOGIES LTD'), 'Static HTML includes published experience record');
    assert(builtHtml.includes('class="credential-grid"') && builtHtml.includes('6-Day AI Workshop'), 'Static HTML includes published certifications');

    // 12.5 Verify a failed production Supabase request stops the build
    const failedBuildRes = await new Promise((resolve) => {
      const proc = spawn('node', ['scripts/build.mjs'], {
        env: {
          ...process.env,
          SUPABASE_URL: 'http://127.0.0.1:54399', // Port where no database server is listening
          SUPABASE_ANON_KEY: 'mock-anon-key'
        }
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d; });
      proc.stderr.on('data', d => { stderr += d; });
      proc.on('close', code => { resolve({ status: code, stdout, stderr }); });
    });
    assert(failedBuildRes.status !== 0, 'Build fails and exits with non-zero code when production Supabase request fails');
    assert(failedBuildRes.stderr.includes('BUILD FAILURE'), 'Error output explicitly identifies BUILD FAILURE without deploying fallback defaults');

    // 12.6 Static verification on compliant build output
    const verifyRes = spawnSync('node', ['scripts/verify-build.mjs'], { encoding: 'utf8' });
    assert(verifyRes.status === 0, 'Static verification passes on Supabase-backed build: 0 network clients, 100% network-free frontend');

    console.log('\n========================================================================');
    console.log(`ALL CMS API & LIFECYCLE TESTS PASSED: ${passed} passed, ${failed} failed.`);
    console.log('========================================================================\n');

  } finally {
    teardown();
  }
}

runTests().catch(err => {
  console.error('\n[FATAL ERROR]:', err);
  process.exit(1);
});
