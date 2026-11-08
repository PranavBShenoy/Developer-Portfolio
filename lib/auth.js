// lib/auth.js
// Authentication middleware, cookie management, active administrator validation, and audit logging.

import { verifySupabaseToken, queryServiceRole } from './supabase.js';

export class AuthError extends Error {
  constructor(statusCode, message, code = 'AUTH_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Parses cookies from incoming HTTP request headers.
 */
export function parseCookies(req) {
  const header = req.headers.cookie || req.headers.Cookie || '';
  const cookies = {};
  header.split(';').forEach(pair => {
    const [name, ...rest] = pair.split('=');
    if (name) {
      cookies[name.trim()] = decodeURIComponent(rest.join('=').trim());
    }
  });
  return cookies;
}

/**
 * Generates secure Set-Cookie headers for admin session tokens.
 */
export function createSessionCookies(accessToken, refreshToken) {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  const secureFlag = isProduction ? '; Secure' : '';

  const cookies = [
    `admin_at=${accessToken}; HttpOnly${secureFlag}; SameSite=Strict; Path=/api/admin; Max-Age=3600`,
  ];

  if (refreshToken) {
    cookies.push(
      `admin_rt=${refreshToken}; HttpOnly${secureFlag}; SameSite=Strict; Path=/api/admin/auth/refresh; Max-Age=604800`
    );
  }

  return cookies;
}

/**
 * Generates cookie clearance headers on logout.
 */
export function createClearSessionCookies() {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  const secureFlag = isProduction ? '; Secure' : '';

  return [
    `admin_at=; HttpOnly${secureFlag}; SameSite=Strict; Path=/api/admin; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    `admin_rt=; HttpOnly${secureFlag}; SameSite=Strict; Path=/api/admin/auth/refresh; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  ];
}

const CANONICAL_HOSTS = new Set([
  'pranav-shenoy-portfolio.vercel.app',
  'shenoypranav.com',
  'www.shenoypranav.com',
]);

function getCanonicalHosts() {
  const hosts = new Set(CANONICAL_HOSTS);
  if (process.env.CANONICAL_ORIGIN) {
    try {
      hosts.add(new URL(process.env.CANONICAL_ORIGIN).host.toLowerCase());
    } catch {}
  }
  if (process.env.VERCEL_URL) {
    hosts.add(process.env.VERCEL_URL.toLowerCase().replace(/^https?:\/\//, ''));
  }
  if (process.env.ADMIN_ALLOWED_ORIGINS) {
    process.env.ADMIN_ALLOWED_ORIGINS.split(',').forEach(o => {
      try {
        hosts.add(new URL(o.trim()).host.toLowerCase());
      } catch {
        hosts.add(o.trim().toLowerCase());
      }
    });
  }
  return hosts;
}

export function isAuthorizedOrigin(originUrlString) {
  if (!originUrlString) return false;
  try {
    const url = new URL(originUrlString);
    const host = url.host.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    const canonicalHosts = getCanonicalHosts();

    // 1. Direct match with configured canonical hosts
    if (canonicalHosts.has(host) || canonicalHosts.has(hostname)) {
      return true;
    }

    // 2. Allow explicitly trusted portfolio preview deployment pattern strictly scoped to this project
    // Tightly validated regex matching pranav-shenoy-portfolio.vercel.app or pranav-shenoy-portfolio-<branch/hash>.vercel.app
    const portfolioPreviewPattern = /^pranav-shenoy-portfolio(-[a-z0-9-]+)?\.vercel\.app$/i;
    if (portfolioPreviewPattern.test(hostname)) {
      return true;
    }

    // Explicitly trusted preview domains configured in environment
    if (process.env.TRUSTED_PREVIEW_DOMAINS) {
      const trusted = process.env.TRUSTED_PREVIEW_DOMAINS.split(',').map(d => d.trim().toLowerCase());
      if (trusted.includes(hostname) || trusted.includes(host)) {
        return true;
      }
    }

    // 3. Allow local development & local test runner loopbacks
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]'
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Validates Origin and Referer headers for state-changing requests (POST, PUT, PATCH, DELETE).
 * Enforces validation against configured canonical site origins rather than trusting client Host headers.
 */
export function validateRequestOrigin(req) {
  const method = (req.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return true;
  }

  const origin = req.headers?.origin || req.headers?.Origin;
  const referer = req.headers?.referer || req.headers?.Referer;

  // 1. Strict validation if Origin header is present
  if (origin) {
    if (!isAuthorizedOrigin(origin)) {
      throw new AuthError(
        403,
        `Cross-origin request blocked: Origin '${origin}' is not an authorized canonical site origin.`,
        'CSRF_ORIGIN_MISMATCH'
      );
    }
    return true;
  }

  // 2. Fallback validation if Referer header is present
  if (referer) {
    if (!isAuthorizedOrigin(referer)) {
      throw new AuthError(
        403,
        `Cross-origin request blocked: Referer '${referer}' is not an authorized canonical site origin.`,
        'CSRF_REFERER_MISMATCH'
      );
    }
    return true;
  }

  // 3. If neither Origin nor Referer is present:
  // Browser requests using session cookies MUST provide an authorized Origin or Referer.
  const cookies = parseCookies(req);
  if (cookies.admin_at && !req.headers?.authorization) {
    throw new AuthError(
      403,
      'State-changing request using session cookies requires an authorized Origin or Referer header.',
      'MISSING_ORIGIN_HEADER'
    );
  }

  return true;
}

/**
 * Mandatory server-side authorization middleware for all /api/admin/* endpoints.
 * Extracts token, verifies with Supabase Auth, and validates active admin record in DB.
 */
export async function verifyAdminSession(req) {
  validateRequestOrigin(req);

  const cookies = parseCookies(req);
  let token = cookies.admin_at;

  // Support Authorization: Bearer <token> for programmatic clients/tests
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }

  if (!token) {
    throw new AuthError(401, 'Authentication required. No active session token found.', 'UNAUTHENTICATED');
  }

  // 1. Verify token with Supabase Auth
  let authUser;
  try {
    authUser = await verifySupabaseToken(token);
  } catch (err) {
    throw new AuthError(401, err.message || 'Invalid or expired session token.', 'TOKEN_INVALID');
  }

  if (!authUser || !authUser.id) {
    throw new AuthError(401, 'Failed to resolve user identity from token.', 'IDENTITY_UNRESOLVED');
  }

  // 2. Query admin_users table using service role to check active admin status
  let adminRecords;
  try {
    adminRecords = await queryServiceRole(`admin_users?auth_user_id=eq.${authUser.id}&select=id,auth_user_id,email,role,is_active`);
  } catch (err) {
    throw new AuthError(500, 'Database error while verifying administrator role.', 'DB_AUTH_ERROR');
  }

  const admin = adminRecords?.[0];
  if (!admin || !admin.is_active || admin.role !== 'admin') {
    throw new AuthError(403, 'Forbidden: Active administrator privileges required.', 'FORBIDDEN_NOT_ADMIN');
  }

  return {
    user: authUser,
    adminRecord: admin,
    token,
  };
}

/**
 * Records an immutable audit log entry via service-role query.
 */
export async function recordAuditLog({ authUserId, action, entityType, entityId, details = {}, req }) {
  try {
    const clientIp = req ? (req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown') : 'system';
    const userAgent = req ? (req.headers['user-agent'] || 'unknown') : 'system';

    // Scrub any sensitive fields before persisting
    const sanitizedDetails = { ...details };
    delete sanitizedDetails.password;
    delete sanitizedDetails.token;
    delete sanitizedDetails.accessToken;
    delete sanitizedDetails.refreshToken;
    delete sanitizedDetails.cookie;

    await queryServiceRole('audit_logs', {
      method: 'POST',
      body: {
        auth_user_id: authUserId || null,
        action,
        entity_type: entityType,
        entity_id: entityId ? String(entityId) : null,
        details: sanitizedDetails,
        ip_address: clientIp,
        user_agent: userAgent.slice(0, 500),
      },
    });
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}
