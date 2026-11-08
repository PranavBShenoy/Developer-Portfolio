// api/admin/projects/index.js
// Handles listing all projects and creating new project drafts.

import { verifyAdminSession, recordAuditLog } from '../../auth.js';
import { queryServiceRole } from '../../supabase.js';
import { checkRateLimit } from '../../rate-limit.js';
import crypto from 'node:crypto';

function normalizeProject(p) {
  if (!p) return p;
  const summaryVal = p.summary || p.short_description || p.description || '';
  const tagsVal = Array.isArray(p.tags)
    ? p.tags
    : (Array.isArray(p.tech_stack)
        ? p.tech_stack
        : (typeof p.tags === 'string'
            ? p.tags.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
            : (typeof p.tech_stack === 'string'
                ? p.tech_stack.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
                : [])));

  const orderVal = p.display_order !== undefined ? p.display_order : (p.sort_order !== undefined ? p.sort_order : 0);
  const demoUrlVal = p.demo_url || p.live_url || null;
  const repoUrlVal = p.repo_url || p.github_url || null;

  return {
    ...p,
    summary: summaryVal,
    short_description: summaryVal,
    description: p.description || summaryVal,
    tags: tagsVal,
    tech_stack: tagsVal,
    display_order: orderVal,
    sort_order: orderVal,
    demo_url: demoUrlVal,
    live_url: demoUrlVal,
    repo_url: repoUrlVal,
    github_url: repoUrlVal,
  };
}

export default async function handler(req, res) {
  let session;
  try {
    session = await verifyAdminSession(req);
  } catch (err) {
    return res.status(err.statusCode || 401).json({ error: err.message, code: err.code });
  }

  const { adminRecord, user } = session;

  if (req.method === 'GET') {
    try {
      // Return all projects ordered by display_order (drafts and published)
      const records = await queryServiceRole('projects?order=display_order.asc,version.desc');
      const projects = (records || []).map(normalizeProject);
      return res.status(200).json({ success: true, projects });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch projects: ' + err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      await checkRateLimit(`rl:write:admin:${adminRecord.id}`, 60, 60, true);
    } catch (rateErr) {
      return res.status(rateErr.statusCode || 429).json({ error: rateErr.message });
    }

    const body = req.body || {};
    const title = body.title ? String(body.title).trim() : '';
    const slug = body.slug ? String(body.slug).toLowerCase().trim().replace(/[^a-z0-9-]/g, '-') : '';
    const category = body.category ? String(body.category).trim() : 'AI Systems / Architecture';

    const summaryCandidate = body.summary !== undefined ? body.summary : body.short_description;
    const summary = summaryCandidate ? String(summaryCandidate).trim() : '';
    const description = body.description ? String(body.description).trim() : summary;

    let rawTags = body.tags !== undefined ? body.tags : body.tech_stack;
    if (typeof rawTags === 'string') {
      rawTags = rawTags.split(',').map(t => t.trim()).filter(Boolean);
    }
    const tags = Array.isArray(rawTags)
      ? rawTags.map(t => String(t).trim().toUpperCase()).filter(Boolean)
      : [];

    const orderCandidate = body.display_order !== undefined ? body.display_order : body.sort_order;
    const display_order = parseInt(orderCandidate, 10) || 0;

    let project_number = body.project_number ? String(body.project_number).trim() : '';
    if (!project_number) {
      project_number = `${String(display_order || 1).padStart(2, '0')} — ${category}`;
    }

    const repo_url = (body.repo_url || body.github_url) ? String(body.repo_url || body.github_url).trim() : null;
    const demo_url = (body.demo_url || body.live_url) ? String(body.demo_url || body.live_url).trim() : null;
    const preview_type = body.preview_type || 'custom';
    const preview_data = typeof body.preview_data === 'object' && body.preview_data !== null ? body.preview_data : {};
    const is_featured = Boolean(body.is_featured);
    const is_wide = Boolean(body.is_wide);
    const is_concept = Boolean(body.is_concept);

    if (!title || !slug || !summary) {
      return res.status(400).json({ error: 'Missing required project fields (title, slug, summary/short_description).' });
    }

    const entityId = crypto.randomUUID();

    try {
      const newDraft = await queryServiceRole('projects', {
        method: 'POST',
        body: {
          entity_id: entityId,
          version: 1,
          status: 'draft',
          is_current_published: false,
          is_tombstone: false,
          slug,
          title,
          project_number,
          category,
          summary,
          description: description || null,
          tags,
          repo_url,
          demo_url,
          preview_type,
          preview_data,
          display_order,
          is_featured,
          is_wide,
          is_concept,
        },
      });

      await recordAuditLog({
        authUserId: user.id,
        action: 'CREATE',
        entityType: 'project',
        entityId: entityId,
        details: { title, slug },
        req,
      });

      return res.status(201).json({ success: true, project: normalizeProject(newDraft?.[0] || newDraft) });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to create project draft: ' + err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed.' });
}
