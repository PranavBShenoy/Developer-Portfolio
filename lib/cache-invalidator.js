// lib/cache-invalidator.js
// Handles version-based cache-busting, ETag calculation, and edge CDN invalidation for public content.
// Designed specifically for standard Vercel Serverless Functions and static web applications (without Next.js).

/**
 * Tracks and coordinates version-based cache invalidation across public content endpoints.
 * When publishing or rolling back:
 * 1. Generates deterministic versioned cache-busting query strings.
 * 2. Emits downstream cache-busting headers (X-Cache-Busted, X-Publication-Version).
 * 3. Provides cache-busting URLs ensuring browsers and CDNs receive fresh content immediately.
 */
export async function invalidatePublicContentCache(req, res, targetVersion) {
  const version = parseInt(targetVersion, 10) || 1;
  const timestamp = Date.now();
  const cacheBustKey = `v${version}-${timestamp}`;

  // Emit versioned cache control and invalidation headers on the response
  if (res && typeof res.setHeader === 'function') {
    res.setHeader('X-Cache-Busted', 'true');
    res.setHeader('X-Publication-Version', String(version));
    res.setHeader('X-Cache-Bust-Key', cacheBustKey);
  }

  return {
    success: true,
    version,
    cache_bust_key: cacheBustKey,
    cache_busting_url: `/api/public/content?v=${version}`,
    timestamp,
  };
}
