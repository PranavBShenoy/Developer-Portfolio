// api/cron/keepalive.js
// Lightweight scheduled database activity check for Supabase Free tier.
// Periodically invoked by Vercel Cron with CRON_SECRET authorization.
// Issues a minimal read query via PostgREST using the unprivileged anon key.

import { queryAnon } from '../../lib/supabase.js';

export default async function handler(req, res) {
  // 1. Only allow GET or HEAD requests (Vercel Cron dispatches GET)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  // 2. Protect endpoint: require valid Bearer CRON_SECRET
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[CRON_KEEPALIVE] Server configuration error: CRON_SECRET is not configured.');
    return res.status(500).json({ error: 'CRON_SECRET is not configured on this server.' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or invalid Bearer CRON_SECRET.' });
  }

  // Ensure this endpoint is never cached at edge or client
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const startTime = Date.now();

  try {
    // 3. Genuine, lightweight read query against Supabase using anon key ONLY
    // Queries single published site_settings record without mutating data or loading large blobs
    const result = await queryAnon('site_settings?is_current_published=eq.true&is_tombstone=eq.false&select=version,updated_at&limit=1');
    const durationMs = Date.now() - startTime;

    const publishedRecord = Array.isArray(result) && result.length > 0 ? result[0] : null;
    const version = publishedRecord?.version ?? null;

    // 4. Safe logging without credentials or sensitive information
    console.log(`[CRON_KEEPALIVE] Success: database active. Latency: ${durationMs}ms, published_version: ${version}`);

    return res.status(200).json({
      ok: true,
      status: 'active',
      timestamp: new Date().toISOString(),
      duration_ms: durationMs,
      published_version: version,
      message: 'Supabase keepalive check completed successfully.',
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    // Log failure reason without sensitive tokens
    console.error(`[CRON_KEEPALIVE] Database check failed after ${durationMs}ms:`, err.message);

    return res.status(502).json({
      ok: false,
      status: 'unreachable',
      timestamp: new Date().toISOString(),
      duration_ms: durationMs,
      error: 'Supabase query failed',
    });
  }
}
