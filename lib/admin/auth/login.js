// api/admin/auth/login.js
// Handles administrative authentication via Supabase Auth with dual rate-limiting.

import { signInWithSupabase, queryServiceRole } from '../../supabase.js';
import { createSessionCookies, recordAuditLog, validateRequestOrigin } from '../../auth.js';
import { checkRateLimit, hashAccountIdentifier, getClientIp, setRateLimitHeaders } from '../../rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    validateRequestOrigin(req);
  } catch (err) {
    return res.status(err.statusCode || 403).json({ error: err.message, code: err.code });
  }

  const clientIp = getClientIp(req);
  const { email, password } = req.body || {};

  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Invalid request: email and password are required.' });
  }

  const accountHash = hashAccountIdentifier(email);

  // 1. Dual Rate Limiting (IP + Account Identifier) with strict Fail-Closed
  let ipLimitResult;
  try {
    ipLimitResult = await checkRateLimit(`rl:auth:ip:${clientIp}`, 5, 900, true);
    await checkRateLimit(`rl:auth:acct:${accountHash}`, 5, 900, true);
  } catch (rateErr) {
    if (rateErr.statusCode === 429) {
      res.setHeader('Retry-After', String(rateErr.retryAfterSeconds));
      await recordAuditLog({ action: 'LOGIN_FAILED', entityType: 'auth', details: { reason: 'RATE_LIMIT_EXCEEDED', email_hash: accountHash }, req });
      return res.status(429).json({ error: rateErr.message, code: 'RATE_LIMIT_EXCEEDED' });
    }
    return res.status(rateErr.statusCode || 503).json({ error: rateErr.message, code: rateErr.code || 'SERVICE_UNAVAILABLE' });
  }

  setRateLimitHeaders(res, ipLimitResult);

  // 2. Authenticate via Supabase Auth
  let authData;
  try {
    authData = await signInWithSupabase(email.trim(), password);
  } catch (authErr) {
    await recordAuditLog({ action: 'LOGIN_FAILED', entityType: 'auth', details: { reason: 'INVALID_CREDENTIALS', email_hash: accountHash }, req });
    return res.status(401).json({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
  }

  const user = authData.user;
  if (!user || !user.id) {
    return res.status(401).json({ error: 'Authentication failed.', code: 'AUTH_FAILED' });
  }

  // 3. Verify Active Administrator Status in database
  let adminRecords;
  try {
    adminRecords = await queryServiceRole(`admin_users?auth_user_id=eq.${user.id}&select=id,auth_user_id,email,role,is_active`);
  } catch (dbErr) {
    return res.status(500).json({ error: 'Failed to verify administrative permissions.' });
  }

  const admin = adminRecords?.[0];
  if (!admin || !admin.is_active || admin.role !== 'admin') {
    await recordAuditLog({ authUserId: user.id, action: 'LOGIN_FAILED', entityType: 'auth', details: { reason: 'UNAUTHORIZED_ROLE' }, req });
    return res.status(403).json({ error: 'Forbidden: User is not an active administrator.', code: 'FORBIDDEN_NOT_ADMIN' });
  }

  // 4. Update last_login_at timestamp
  queryServiceRole(`admin_users?id=eq.${admin.id}`, {
    method: 'PATCH',
    body: { last_login_at: new Date().toISOString() },
  }).catch(() => {});

  // 5. Issue HttpOnly Session Cookies
  const cookies = createSessionCookies(authData.access_token, authData.refresh_token);
  res.setHeader('Set-Cookie', cookies);

  await recordAuditLog({ authUserId: user.id, action: 'LOGIN_SUCCESS', entityType: 'auth', entityId: admin.id, req });

  return res.status(200).json({
    success: true,
    user: {
      id: user.id,
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
    },
  });
}
