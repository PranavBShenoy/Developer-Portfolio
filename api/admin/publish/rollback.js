// api/admin/publish/rollback.js
// Triggers transactional restoration of a historic snapshot version.

import { verifyAdminSession } from '../../../lib/auth.js';
import { callAuthenticatedRpc } from '../../../lib/supabase.js';
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

  const { adminRecord, token } = session;

  try {
    await checkRateLimit(`rl:rollback:admin:${adminRecord.id}`, 5, 60, true);
  } catch (rateErr) {
    return res.status(rateErr.statusCode || 429).json({ error: rateErr.message });
  }

  const { target_version, expected_current_version, reason } = req.body || {};

  if (!target_version || !expected_current_version) {
    return res.status(400).json({ error: 'target_version and expected_current_version are required.' });
  }

  try {
    const result = await callAuthenticatedRpc('rollback_to_snapshot', {
      p_target_version: parseInt(target_version, 10),
      p_expected_current_version: parseInt(expected_current_version, 10),
      p_reason: reason ? String(reason).trim() : null,
    }, token);

    // Invalidate edge cache for public content catalog
    const cacheResult = await invalidatePublicContentCache(req, res, result.new_version);

    // Trigger Vercel static rebuild if deploy hook is configured
    const buildResult = await triggerVercelDeployHook();

    return res.status(200).json({
      success: true,
      message: `Successfully rolled back to snapshot version ${target_version}. New live version is ${result.new_version}.`,
      rollback: result,
      cache_invalidated: cacheResult.success,
      cache_busting_url: cacheResult.cache_busting_url,
      build_triggered: buildResult.triggered,
      build_info: buildResult,
    });
  } catch (err) {
    console.error('Rollback failed:', err.message);
    return res.status(400).json({ error: err.message, code: 'ROLLBACK_FAILED' });
  }
}
