// api/public/[...path].js
// Consolidated Serverless Function router for all /api/public/* endpoints.
// Consolidates 3 public functions into 1 while preserving all public caching,
// content aggregation, resume selection, and revocable media delivery contracts.

import publicContentHandler from '../../lib/public/content.js';
import resumeHandler from '../../lib/public/resume.js';
import mediaByIdHandler from '../../lib/public/media/[id].js';

function getSubpath(req) {
  if (req.query?.path) {
    if (Array.isArray(req.query.path)) {
      const joined = req.query.path.filter(Boolean).join('/');
      if (joined) return joined;
    } else if (typeof req.query.path === 'string') {
      const clean = req.query.path.replace(/^\/+|\/+$/g, '');
      if (clean) return clean;
    }
  }

  if (req.url) {
    try {
      const url = new URL(req.url, 'http://localhost');
      let p = url.pathname;
      if (p.startsWith('/api/public')) {
        p = p.slice('/api/public'.length);
      }
      return p.replace(/^\/+|\/+$/g, '');
    } catch {}
  }

  return '';
}

export default async function handler(req, res) {
  req.query = req.query || {};
  const subpath = getSubpath(req);

  // 1. Public Content
  if (subpath === 'content') return publicContentHandler(req, res);

  // 2. Designated Primary Resume
  if (subpath === 'resume') return resumeHandler(req, res);

  // 3. Media Asset by ID
  const mediaMatch = subpath.match(/^media\/([^/]+)$/);
  if (mediaMatch) {
    const mediaId = decodeURIComponent(mediaMatch[1]);
    req.query.id = mediaId;
    return mediaByIdHandler(req, res);
  }

  return res.status(404).json({
    error: `Public endpoint not found: ${subpath ? '/' + subpath : '/'}`,
    code: 'ROUTE_NOT_FOUND'
  });
}
