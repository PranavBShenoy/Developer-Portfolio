// api/admin/[...path].js
// Consolidated Serverless Function router for all /api/admin/* endpoints.
// Consolidates 16 admin functions into 1 while strictly preserving all authentication,
// authorization, rate limits, validations, HTTP methods, and response contracts.

import loginHandler from '../../lib/admin/auth/login.js';
import logoutHandler from '../../lib/admin/auth/logout.js';
import meHandler from '../../lib/admin/auth/me.js';
import refreshHandler from '../../lib/admin/auth/refresh.js';
import projectsHandler from '../../lib/admin/projects/index.js';
import projectByIdHandler from '../../lib/admin/projects/[id].js';
import skillsHandler from '../../lib/admin/skills/index.js';
import experienceHandler from '../../lib/admin/experience/index.js';
import certsHandler from '../../lib/admin/certifications/index.js';
import settingsHandler from '../../lib/admin/settings/index.js';
import mediaListHandler from '../../lib/admin/media/index.js';
import mediaUploadHandler from '../../lib/admin/media/upload.js';
import previewHandler from '../../lib/admin/content/preview.js';
import publishHandler from '../../lib/admin/publish/index.js';
import rollbackHandler from '../../lib/admin/publish/rollback.js';
import auditLogsHandler from '../../lib/admin/audit-logs/index.js';

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
      if (p.startsWith('/api/admin')) {
        p = p.slice('/api/admin'.length);
      }
      return p.replace(/^\/+|\/+$/g, '');
    } catch {}
  }

  return '';
}

export default async function handler(req, res) {
  req.query = req.query || {};
  const subpath = getSubpath(req);

  // 1. Authentication endpoints
  if (subpath === 'auth/login') return loginHandler(req, res);
  if (subpath === 'auth/logout') return logoutHandler(req, res);
  if (subpath === 'auth/me') return meHandler(req, res);
  if (subpath === 'auth/refresh') return refreshHandler(req, res);

  // 2. Projects endpoints
  if (subpath === 'projects') return projectsHandler(req, res);
  const projectMatch = subpath.match(/^projects\/([^/]+)$/);
  if (projectMatch) {
    const projId = decodeURIComponent(projectMatch[1]);
    req.query.id = projId;
    return projectByIdHandler(req, res);
  }

  // 3. Skills & Skill Categories
  if (subpath === 'skills') return skillsHandler(req, res);

  // 4. Experience
  if (subpath === 'experience') return experienceHandler(req, res);

  // 5. Certifications & Credentials
  if (subpath === 'certifications') return certsHandler(req, res);
  const certMatch = subpath.match(/^certifications\/([^/]+)$/);
  if (certMatch) {
    const certId = decodeURIComponent(certMatch[1]);
    req.query.id = certId;
    req.query.entity_id = certId;
    return certsHandler(req, res);
  }

  // 6. Site Settings
  if (subpath === 'settings') return settingsHandler(req, res);

  // 7. Media Management & Uploads
  if (subpath === 'media') return mediaListHandler(req, res);
  if (subpath === 'media/upload') return mediaUploadHandler(req, res);

  // 8. Content Preview
  if (subpath === 'content/preview') return previewHandler(req, res);

  // 9. Publishing & Atomic Rollback
  if (subpath === 'publish') return publishHandler(req, res);
  if (subpath === 'publish/rollback') return rollbackHandler(req, res);

  // 10. Audit Logs
  if (subpath === 'audit-logs') return auditLogsHandler(req, res);

  // Route not found
  return res.status(404).json({
    error: `Admin endpoint not found: ${subpath ? '/' + subpath : '/'}`,
    code: 'ROUTE_NOT_FOUND'
  });
}
