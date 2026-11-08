// api/admin/auth/logout.js
// Terminates administrative session and clears HttpOnly authentication cookies.

import { verifyAdminSession, createClearSessionCookies, recordAuditLog } from '../../auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  let adminUser = null;
  try {
    const session = await verifyAdminSession(req);
    adminUser = session.user;
  } catch {
    // If token already invalid/expired, proceed to clear cookies anyway
  }

  if (adminUser) {
    await recordAuditLog({
      authUserId: adminUser.id,
      action: 'LOGOUT',
      entityType: 'auth',
      req,
    });
  }

  res.setHeader('Set-Cookie', createClearSessionCookies());
  return res.status(200).json({ success: true, message: 'Successfully logged out.' });
}
