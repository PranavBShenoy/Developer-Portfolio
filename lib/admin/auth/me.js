// api/admin/auth/me.js
// Returns authenticated administrator session profile and telemetry.

import { verifyAdminSession } from '../../auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  let session;
  try {
    session = await verifyAdminSession(req);
  } catch (err) {
    return res.status(err.statusCode || 401).json({ error: err.message, code: err.code || 'UNAUTHENTICATED' });
  }

  const { user, adminRecord } = session;
  return res.status(200).json({
    authenticated: true,
    user: {
      authUserId: user.id,
      adminId: adminRecord.id,
      email: adminRecord.email,
      role: adminRecord.role,
      lastLoginAt: adminRecord.last_login_at,
    },
  });
}
