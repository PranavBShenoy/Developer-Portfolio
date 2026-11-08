// lib/rate-limit.js
// Upstash Redis sliding-window counter rate limiter over REST with strict fail-closed behavior.

import crypto from 'node:crypto';

export class RateLimitError extends Error {
  constructor(statusCode, message, retryAfterSeconds = 60, code = 'RATE_LIMIT_EXCEEDED') {
    super(message);
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
    this.code = code;
  }
}

/**
 * Computes a privacy-preserving hash of an account identifier (email).
 */
export function hashAccountIdentifier(email) {
  const secret = process.env.RATE_LIMIT_HMAC_SECRET || 'dev-hmac-secret-placeholder-32b';
  return crypto.createHmac('sha256', secret)
    .update((email || '').toLowerCase().trim())
    .digest('hex')
    .slice(0, 32);
}

/**
 * Extracts trusted client IP from Vercel edge proxy headers.
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Executes a sliding-window rate limit check via Upstash Redis REST API.
 * 
 * @param {string} key Unique rate limit key
 * @param {number} limit Maximum permitted requests within the window
 * @param {number} windowSeconds Window duration in seconds
 * @param {boolean} failClosed Whether to reject request on Redis outage (true for auth/writes, false for public reads)
 */
export async function checkRateLimit(key, limit, windowSeconds, failClosed = true) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Local development fallback if Redis is not configured
  if (!url || !token) {
    if (process.env.NODE_ENV === 'production' && failClosed) {
      console.warn('Production environment missing Upstash Redis configuration; failing closed for safety.');
      throw new RateLimitError(503, 'Rate limiting security service is currently unavailable.', 60, 'RATE_LIMITER_UNAVAILABLE');
    }
    // Permitted in non-production local dev
    return { allowed: true, limit, remaining: limit, reset: Math.floor(Date.now() / 1000) + windowSeconds };
  }

  const now = Date.now();
  const currentWindowIndex = Math.floor(now / (windowSeconds * 1000));
  const currentWindowKey = `${key}:${currentWindowIndex}`;
  const prevWindowKey = `${key}:${currentWindowIndex - 1}`;
  const elapsedInWindow = (now % (windowSeconds * 1000)) / (windowSeconds * 1000);

  // Pipeline Redis commands over REST:
  // 1. INCR currentWindowKey
  // 2. EXPIRE currentWindowKey (windowSeconds * 2)
  // 3. GET prevWindowKey
  const pipeline = [
    ['INCR', currentWindowKey],
    ['EXPIRE', currentWindowKey, windowSeconds * 2],
    ['GET', prevWindowKey],
  ];

  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500); // Strict 1500ms timeout

    const fetchRes = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pipeline),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!fetchRes.ok) {
      throw new Error(`Upstash returned HTTP ${fetchRes.status}`);
    }
    response = await fetchRes.json();
  } catch (err) {
    console.error('Rate limiter Redis failure:', err.message);

    if (failClosed) {
      // Security-critical path: FAIL CLOSED
      throw new RateLimitError(
        503,
        'Security service temporarily unavailable. Rate limit check could not be completed.',
        60,
        'RATE_LIMITER_UNAVAILABLE'
      );
    }
    // Public read path: FAIL OPEN
    return { allowed: true, limit, remaining: 1, reset: Math.floor(Date.now() / 1000) + windowSeconds };
  }

  const currentCount = parseInt(response?.[0]?.result || 1, 10);
  const prevCount = parseInt(response?.[2]?.result || 0, 10);

  // Sliding window weighted calculation:
  const estimatedCount = currentCount + prevCount * (1 - elapsedInWindow);
  const remaining = Math.max(0, Math.floor(limit - estimatedCount));
  const resetEpoch = Math.floor(now / 1000) + Math.ceil(windowSeconds * (1 - elapsedInWindow));

  if (estimatedCount > limit) {
    const retryAfter = Math.max(1, resetEpoch - Math.floor(now / 1000));
    throw new RateLimitError(
      429,
      `Too many requests. Limit exceeded. Please try again in ${retryAfter} seconds.`,
      retryAfter,
      'RATE_LIMIT_EXCEEDED'
    );
  }

  return {
    allowed: true,
    limit,
    remaining,
    reset: resetEpoch,
  };
}

/**
 * Applies rate limit headers to a Node.js serverless response.
 */
export function setRateLimitHeaders(res, result) {
  if (!result) return;
  res.setHeader('X-RateLimit-Limit', String(result.limit));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  res.setHeader('X-RateLimit-Reset', String(result.reset));
}
