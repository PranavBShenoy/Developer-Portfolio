// api/admin/audit-logs/index.js
// Read-only endpoint for reviewing immutable security audit trail entries.

import { verifyAdminSession } from '../../auth.js';
import { queryServiceRole } from '../../supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  try {
    await verifyAdminSession(req);
  } catch (err) {
    return res.status(err.statusCode || 401).json({ error: err.message });
  }

  const limit = Math.min(100, parseInt(req.query?.limit || 50, 10));
  const offset = Math.max(0, parseInt(req.query?.offset || 0, 10));

  try {
    const logs = await queryServiceRole(`audit_logs?order=created_at.desc&limit=${limit}&offset=${offset}`);
    const snapshots = await queryServiceRole('publication_snapshots?order=version.desc&limit=20');
    return res.status(200).json({ success: true, logs, snapshots });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch audit logs: ' + err.message });
  }
}
