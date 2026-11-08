// api/admin/auth/refresh.js
// Rotates admin access and refresh tokens.

import { refreshSupabaseSession, queryServiceRole } from '../../../lib/supabase.js';
import { parseCookies, createSessionCookies, createClearSessionCookies } from '../../../lib/auth.js';
import { checkRateLimit, getClientIp } from '../../../lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const clientIp = getClientIp(req);

  try {
    await checkRateLimit(`rl:auth:refresh:${clientIp}`, 20, 900, true);
  } catch (rateErr) {
    return res.status(rateErr.statusCode || 429).json({ error: rateErr.message, code: rateErr.code });
  }

  const cookies = parseCookies(req);
  const refreshToken = cookies.admin_rt;

  if (!refreshToken) {
    res.setHeader('Set-Cookie', createClearSessionCookies());
    return res.status(401).json({ error: 'No refresh token provided.', code: 'NO_REFRESH_TOKEN' });
  }

  let newSession;
  try {
    newSession = await refreshSupabaseSession(refreshToken);
  } catch (err) {
    res.setHeader('Set-Cookie', createClearSessionCookies());
    return res.status(401).json({ error: 'Failed to refresh session: ' + err.message, code: 'REFRESH_FAILED' });
  }

  // Re-verify that user remains active in admin_users
  const userId = newSession.user?.id;
  if (!userId) {
    res.setHeader('Set-Cookie', createClearSessionCookies());
    return res.status(401).json({ error: 'Unresolved identity on refresh.', code: 'UNRESOLVED_USER' });
  }

  const adminRecords = await queryServiceRole(`admin_users?auth_user_id=eq.${userId}&select=id,is_active,role`).catch(() => []);
  const admin = adminRecords?.[0];
  if (!admin || !admin.is_active || admin.role !== 'admin') {
    res.setHeader('Set-Cookie', createClearSessionCookies());
    return res.status(403).json({ error: 'Administrator access revoked.', code: 'FORBIDDEN' });
  }

  const newCookies = createSessionCookies(newSession.access_token, newSession.refresh_token);
  res.setHeader('Set-Cookie', newCookies);

  return res.status(200).json({
    success: true,
    user: {
      authUserId: userId,
      email: newSession.user.email,
    },
  });
}
