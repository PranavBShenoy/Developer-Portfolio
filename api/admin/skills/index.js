// api/admin/skills/index.js
// Handles listing, creating, updating, and tombstoning skills and categories in draft.

import { verifyAdminSession, recordAuditLog } from '../../../lib/auth.js';
import { queryServiceRole } from '../../../lib/supabase.js';
import { checkRateLimit } from '../../../lib/rate-limit.js';
import crypto from 'node:crypto';

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
      const categories = await queryServiceRole('skill_categories?order=display_order.asc,version.desc');
      const skills = await queryServiceRole('skills?order=display_order.asc,version.desc');
      return res.status(200).json({ success: true, categories, skills });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch skills: ' + err.message });
    }
  }

  try {
    await checkRateLimit(`rl:write:admin:${adminRecord.id}`, 60, 60, true);
  } catch (rateErr) {
    return res.status(rateErr.statusCode || 429).json({ error: rateErr.message });
  }

  if (req.method === 'POST') {
    const {
      type,
      name,
      category_number,
      slug,
      category_entity_id,
      category_id,
      display_order,
      sort_order
    } = req.body || {};

    const sortVal = parseInt(display_order ?? sort_order ?? 0, 10) || 0;

    if (type === 'category') {
      const catNum = String(category_number || slug || `07 / ${name || 'CUSTOM'}`).trim();
      const catName = String(name || '').trim().toUpperCase();

      if (!catName) {
        return res.status(400).json({ error: 'Category name is required.' });
      }

      const entityId = crypto.randomUUID();
      try {
        const created = await queryServiceRole('skill_categories', {
          method: 'POST',
          body: {
            entity_id: entityId,
            version: 1,
            status: 'draft',
            is_current_published: false,
            is_tombstone: false,
            category_number: catNum,
            name: catName,
            display_order: sortVal,
          },
        });

        await recordAuditLog({ authUserId: user.id, action: 'CREATE', entityType: 'skill_category', entityId, req });
        return res.status(201).json({ success: true, category: created?.[0] || created });
      } catch (err) {
        return res.status(500).json({ error: 'Failed to create skill category: ' + err.message });
      }
    }

    if (type === 'skill') {
      const catId = category_entity_id || category_id;
      const skillName = String(name || '').trim();

      if (!skillName || !catId) {
        return res.status(400).json({ error: 'Skill name and category ID are required.' });
      }

      const entityId = crypto.randomUUID();
      try {
        const created = await queryServiceRole('skills', {
          method: 'POST',
          body: {
            entity_id: entityId,
            category_entity_id: catId,
            version: 1,
            status: 'draft',
            is_current_published: false,
            is_tombstone: false,
            name: skillName,
            display_order: sortVal,
          },
        });

        await recordAuditLog({ authUserId: user.id, action: 'CREATE', entityType: 'skill', entityId, req });
        return res.status(201).json({ success: true, skill: created?.[0] || created });
      } catch (err) {
        return res.status(500).json({ error: 'Failed to create skill: ' + err.message });
      }
    }

    return res.status(400).json({ error: 'Invalid type parameter. Expected "category" or "skill".' });
  }

  if (req.method === 'DELETE') {
    const entityId = req.body?.entity_id || req.query?.entity_id;
    if (!entityId) {
      return res.status(400).json({ error: 'entity_id is required for tombstone/deletion.' });
    }

    try {
      // 1. Check if it's a skill
      const skillRecords = await queryServiceRole(`skills?entity_id=eq.${entityId}&order=version.desc`);
      if (skillRecords && skillRecords.length > 0) {
        const existingDraft = skillRecords.find(r => r.status === 'draft');
        const hasPublished = skillRecords.some(r => r.status === 'published' || r.status === 'archived');

        if (!hasPublished && existingDraft) {
          await queryServiceRole(`skills?id=eq.${existingDraft.id}`, { method: 'DELETE' });
          await recordAuditLog({ authUserId: user.id, action: 'DELETE', entityType: 'skill_draft', entityId, req });
          return res.status(200).json({ success: true, message: 'Unpublished skill draft purged.' });
        }

        if (existingDraft) {
          await queryServiceRole(`skills?id=eq.${existingDraft.id}`, {
            method: 'PATCH',
            body: { is_tombstone: true, updated_at: new Date().toISOString() },
          });
        } else {
          const latest = skillRecords[0];
          await queryServiceRole('skills', {
            method: 'POST',
            body: {
              entity_id: entityId,
              category_entity_id: latest.category_entity_id,
              version: latest.version + 1,
              status: 'draft',
              is_current_published: false,
              is_tombstone: true,
              name: latest.name,
              display_order: latest.display_order,
            },
          });
        }

        await recordAuditLog({ authUserId: user.id, action: 'DELETE', entityType: 'skill_tombstone', entityId, req });
        return res.status(200).json({ success: true, message: 'Skill staged for unpublishing/deletion on next publish.' });
      }

      // 2. Check if it's a category
      const catRecords = await queryServiceRole(`skill_categories?entity_id=eq.${entityId}&order=version.desc`);
      if (catRecords && catRecords.length > 0) {
        const existingDraft = catRecords.find(r => r.status === 'draft');
        const hasPublished = catRecords.some(r => r.status === 'published' || r.status === 'archived');

        if (!hasPublished && existingDraft) {
          await queryServiceRole(`skill_categories?id=eq.${existingDraft.id}`, { method: 'DELETE' });
          await recordAuditLog({ authUserId: user.id, action: 'DELETE', entityType: 'skill_category_draft', entityId, req });
          return res.status(200).json({ success: true, message: 'Unpublished category draft purged.' });
        }

        if (existingDraft) {
          await queryServiceRole(`skill_categories?id=eq.${existingDraft.id}`, {
            method: 'PATCH',
            body: { is_tombstone: true, updated_at: new Date().toISOString() },
          });
        } else {
          const latest = catRecords[0];
          await queryServiceRole('skill_categories', {
            method: 'POST',
            body: {
              entity_id: entityId,
              version: latest.version + 1,
              status: 'draft',
              is_current_published: false,
              is_tombstone: true,
              category_number: latest.category_number,
              name: latest.name,
              display_order: latest.display_order,
            },
          });
        }

        await recordAuditLog({ authUserId: user.id, action: 'DELETE', entityType: 'skill_category_tombstone', entityId, req });
        return res.status(200).json({ success: true, message: 'Skill category staged for unpublishing/deletion on next publish.' });
      }

      return res.status(404).json({ error: 'Skill or category entity not found.' });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to unpublish skill/category: ' + err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed.' });
}
