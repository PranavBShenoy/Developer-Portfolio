// api/admin/publish/index.js
// Triggers transactional publication of all pending drafts.

import { verifyAdminSession, recordAuditLog } from '../../../lib/auth.js';
import { callAuthenticatedRpc, queryServiceRole } from '../../../lib/supabase.js';
import { checkRateLimit } from '../../../lib/rate-limit.js';
import { invalidatePublicContentCache } from '../../../lib/cache-invalidator.js';
import { triggerVercelDeployHook } from '../../../lib/deploy-hook.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  let session;
  try {
    session = await verifyAdminSession(req);
  } catch (err) {
    return res.status(err.statusCode || 401).json({ error: err.message });
  }

  const { adminRecord, user, token } = session;

  try {
    await checkRateLimit(`rl:publish:admin:${adminRecord.id}`, 10, 60, true);
  } catch (rateErr) {
    return res.status(rateErr.statusCode || 429).json({ error: rateErr.message });
  }

  const { expected_base_version, notes } = req.body || {};

  if (expected_base_version === undefined || typeof expected_base_version !== 'number') {
    return res.status(400).json({ error: 'expected_base_version (integer) is required to prevent concurrent publication conflicts.' });
  }

  try {
    // Invoke transactional RPC with caller's authenticated JWT
    const result = await callAuthenticatedRpc('publish_pending_drafts', {
      p_expected_base_version: parseInt(expected_base_version, 10),
      p_notes: notes ? String(notes).trim() : null,
    }, token);

    // Invalidate edge cache for public content catalog
    const cacheResult = await invalidatePublicContentCache(req, res, result.version);

    // Trigger Vercel static rebuild if deploy hook is configured
    const buildResult = await triggerVercelDeployHook();

    return res.status(200).json({
      success: true,
      message: 'Drafts published atomically to live site.',
      publication: result,
      cache_invalidated: cacheResult.success,
      cache_busting_url: cacheResult.cache_busting_url,
      build_triggered: buildResult.triggered,
      build_info: buildResult,
    });
  } catch (err) {
    console.error('Publication failed:', err.message);
    return res.status(400).json({ error: err.message, code: 'PUBLISH_FAILED' });
  }
}
