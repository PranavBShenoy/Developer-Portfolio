// scripts/test-consolidated-api.mjs
// Comprehensive verification of all consolidated API routes, methods, security contracts, and parameter routing.

import adminRouter from '../api/admin/[...path].js';
import publicRouter from '../api/public/[...path].js';
import cronKeepalive from '../api/cron/keepalive.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

function createMockReqRes({ method = 'GET', url = '/', headers = {}, body = null, query = {} } = {}) {
  const req = {
    method,
    url,
    headers: { host: 'localhost:3000', ...headers },
    body,
    query: { ...query },
    rawBody: body ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : Buffer.alloc(0),
    [Symbol.asyncIterator]: async function* () {
      if (this.rawBody && this.rawBody.length > 0) {
        yield this.rawBody;
      }
    }
  };

  const res = {
    statusCode: 200,
    headersSent: false,
    _headers: {},
    _body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(k, v) {
      this._headers[k.toLowerCase()] = v;
      return this;
    },
    getHeader(k) {
      return this._headers[k.toLowerCase()];
    },
    json(data) {
      this.setHeader('content-type', 'application/json; charset=utf-8');
      this._body = data;
      this.headersSent = true;
      return this;
    },
    send(data) {
      this._body = data;
      this.headersSent = true;
      return this;
    },
    end(data) {
      if (data) this._body = data;
      this.headersSent = true;
      return this;
    }
  };

  return { req, res };
}

async function run() {
  console.log('========================================================================');
  console.log('STARTING CONSOLIDATED API ARCHITECTURE VERIFICATION');
  console.log('========================================================================\n');

  // 1. PUBLIC ROUTER TESTS
  console.log('--- 1. Testing api/public/[...path].js Router ---');

  // 1.1 GET /api/public/content
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/public/content' });
    await publicRouter(req, res);
    assert(res.statusCode === 200, 'GET /api/public/content returns 200 OK');
    assert(res._headers['cache-control']?.includes('s-maxage=300'), 'GET /api/public/content includes edge caching');
    assert(res._body && Array.isArray(res._body.projects), 'GET /api/public/content returns portfolio data');
  }

  // 1.2 GET /api/public/resume
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/public/resume' });
    await publicRouter(req, res);
    assert(res.statusCode === 200 || res.statusCode === 404, 'GET /api/public/resume executes cleanly (200 or 404)');
    assert(res._headers['cache-control']?.includes('no-store'), 'GET /api/public/resume enforces no-store');
  }

  // 1.3 GET /api/public/media/:id (local fallback asset)
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/public/media/50000000-0000-0000-0000-000000000001' });
    await publicRouter(req, res);
    assert(res.statusCode === 200, 'GET /api/public/media/:id returns 200 for local fallback portrait');
    assert(res._headers['cache-control']?.includes('no-store'), 'GET /api/public/media/:id enforces no-store');
    assert(req.query.id === '50000000-0000-0000-0000-000000000001', 'media router extracts dynamic :id parameter');
  }

  // 1.4 GET /api/public/media/:id (unknown asset)
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/public/media/nonexistent-media-uuid' });
    await publicRouter(req, res);
    assert(res.statusCode === 404, 'GET /api/public/media/:id returns 404 for nonexistent asset');
  }

  // 1.5 GET /api/public/unknown-endpoint (404)
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/public/nonexistent-route' });
    await publicRouter(req, res);
    assert(res.statusCode === 404, 'Unknown public endpoint returns 404');
    assert(res._body?.code === 'ROUTE_NOT_FOUND', 'Returns ROUTE_NOT_FOUND error code');
  }

  // 2. CRON KEEPALIVE TESTS
  console.log('\n--- 2. Testing api/cron/keepalive.js Standalone Function ---');

  // 2.1 POST method rejected (only GET allowed)
  {
    const { req, res } = createMockReqRes({ method: 'POST', url: '/api/cron/keepalive' });
    await cronKeepalive(req, res);
    assert(res.statusCode === 405, 'POST to /api/cron/keepalive rejected with 405 Method Not Allowed');
    assert(res._headers['allow'] === 'GET, HEAD', 'Sets Allow: GET, HEAD');
  }

  // 2.2 Missing Authorization header
  {
    const prevSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'test-cron-secret-12345';
    try {
      const { req, res } = createMockReqRes({ method: 'GET', url: '/api/cron/keepalive' });
      await cronKeepalive(req, res);
      assert(res.statusCode === 401, 'Keepalive without Bearer token returns 401 Unauthorized');
      assert(res._body?.error === 'UNAUTHORIZED', 'Error code is UNAUTHORIZED');
    } finally {
      if (prevSecret) process.env.CRON_SECRET = prevSecret;
      else delete process.env.CRON_SECRET;
    }
  }

  // 2.3 Invalid Authorization token
  {
    const prevSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'test-cron-secret-12345';
    try {
      const { req, res } = createMockReqRes({
        method: 'GET',
        url: '/api/cron/keepalive',
        headers: { authorization: 'Bearer wrong-secret' }
      });
      await cronKeepalive(req, res);
      assert(res.statusCode === 401, 'Keepalive with invalid Bearer token returns 401 Unauthorized');
    } finally {
      if (prevSecret) process.env.CRON_SECRET = prevSecret;
      else delete process.env.CRON_SECRET;
    }
  }

  // 3. ADMIN ROUTER TESTS
  console.log('\n--- 3. Testing api/admin/[...path].js Router & Security Gates ---');

  // 3.1 auth/login - validation & CSRF origin checks
  {
    const { req, res } = createMockReqRes({
      method: 'POST',
      url: '/api/admin/auth/login',
      headers: { origin: 'https://pranav-shenoy-portfolio.vercel.app' },
      body: {}
    });
    await adminRouter(req, res);
    assert(res.statusCode === 400, 'POST /api/admin/auth/login with empty body returns 400 Bad Request');
    assert(res._body?.error?.toLowerCase().includes('email and password'), 'Validation identifies missing email and password');
  }

  // 3.2 auth/logout - clears cookies and enforces POST
  {
    const { req: getReq, res: getRes } = createMockReqRes({ method: 'GET', url: '/api/admin/auth/logout' });
    await adminRouter(getReq, getRes);
    assert(getRes.statusCode === 405, 'GET /api/admin/auth/logout rejected with 405 Method Not Allowed');

    const { req: postReq, res: postRes } = createMockReqRes({ method: 'POST', url: '/api/admin/auth/logout' });
    await adminRouter(postReq, postRes);
    assert(postRes.statusCode === 200, 'POST /api/admin/auth/logout succeeds with 200');
    assert(Array.isArray(postRes._headers['set-cookie']), 'POST /api/admin/auth/logout returns Set-Cookie clear directives');
  }

  // 3.3 auth/me - requires auth
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/admin/auth/me' });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'GET /api/admin/auth/me unauthenticated returns 401');
    assert(res._body?.code === 'UNAUTHENTICATED', 'Code is UNAUTHENTICATED');
  }

  // 3.4 auth/refresh - requires refresh token
  {
    const { req, res } = createMockReqRes({ method: 'POST', url: '/api/admin/auth/refresh' });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'POST /api/admin/auth/refresh without cookie returns 401');
  }

  // 3.5 projects listing - requires auth
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/admin/projects' });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'GET /api/admin/projects unauthenticated returns 401');
  }

  // 3.6 projects/:id dynamic route - requires auth & extracts ID
  {
    const testId = 'test-proj-entity-123';
    const { req, res } = createMockReqRes({ method: 'PUT', url: `/api/admin/projects/${testId}`, body: { title: 'New' } });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'PUT /api/admin/projects/:id unauthenticated returns 401');
    assert(req.query.id === testId, 'projects/:id extracts dynamic ID parameter');
  }

  // 3.7 skills - requires auth
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/admin/skills' });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'GET /api/admin/skills unauthenticated returns 401');
  }

  // 3.8 experience - requires auth
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/admin/experience' });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'GET /api/admin/experience unauthenticated returns 401');
  }

  // 3.9 certifications - requires auth
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/admin/certifications' });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'GET /api/admin/certifications unauthenticated returns 401');
  }

  // 3.10 certifications/:id dynamic route - requires auth & extracts ID
  {
    const certId = 'test-cert-entity-456';
    const { req, res } = createMockReqRes({ method: 'DELETE', url: `/api/admin/certifications/${certId}` });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'DELETE /api/admin/certifications/:id unauthenticated returns 401');
    assert(req.query.id === certId && req.query.entity_id === certId, 'certifications/:id extracts dynamic ID and entity_id');
  }

  // 3.11 settings - requires auth
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/admin/settings' });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'GET /api/admin/settings unauthenticated returns 401');
  }

  // 3.12 media listing - requires auth
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/admin/media' });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'GET /api/admin/media unauthenticated returns 401');
  }

  // 3.13 media upload - requires auth
  {
    const { req, res } = createMockReqRes({ method: 'POST', url: '/api/admin/media/upload' });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'POST /api/admin/media/upload unauthenticated returns 401');
  }

  // 3.14 content preview - requires auth
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/admin/content/preview' });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'GET /api/admin/content/preview unauthenticated returns 401');
  }

  // 3.15 publish - requires auth
  {
    const { req, res } = createMockReqRes({ method: 'POST', url: '/api/admin/publish' });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'POST /api/admin/publish unauthenticated returns 401');
  }

  // 3.16 publish rollback - requires auth
  {
    const { req, res } = createMockReqRes({ method: 'POST', url: '/api/admin/publish/rollback' });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'POST /api/admin/publish/rollback unauthenticated returns 401');
  }

  // 3.17 audit logs - requires auth
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/admin/audit-logs' });
    await adminRouter(req, res);
    assert(res.statusCode === 401, 'GET /api/admin/audit-logs unauthenticated returns 401');
  }

  // 3.18 unknown admin subpath
  {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/api/admin/nonexistent-feature' });
    await adminRouter(req, res);
    assert(res.statusCode === 404, 'Unknown admin subpath returns 404');
    assert(res._body?.code === 'ROUTE_NOT_FOUND', 'Returns ROUTE_NOT_FOUND code');
  }

  console.log('\n========================================================================');
  console.log(`CONSOLIDATED API VERIFICATION COMPLETE: ${passed} passed, ${failed} failed.`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('[FATAL ERROR]:', err);
  process.exit(1);
});
