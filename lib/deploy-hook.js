// lib/deploy-hook.js
// Handles triggering Vercel build hooks following transactional publication or rollback.

export async function triggerVercelDeployHook() {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) {
    return {
      triggered: false,
      reason: 'VERCEL_DEPLOY_HOOK_URL not configured. Static rebuild must be triggered manually.',
    };
  }

  try {
    const response = await fetch(hookUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'Pranav-Shenoy-Portfolio-CMS/1.0',
      },
    });

    if (!response.ok) {
      console.warn(`[DEPLOY_HOOK] Vercel build trigger returned HTTP ${response.status}`);
      return {
        triggered: false,
        status: response.status,
        error: `Deploy hook returned HTTP ${response.status}`,
      };
    }

    const data = await response.json().catch(() => ({}));
    return {
      triggered: true,
      status: response.status,
      job: data.job || null,
    };
  } catch (err) {
    console.warn('[DEPLOY_HOOK] Failed to invoke Vercel deploy hook:', err.message);
    return {
      triggered: false,
      error: err.message,
    };
  }
}
