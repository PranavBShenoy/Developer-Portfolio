// api/admin/projects/[id].js
// Handles updating existing project drafts and initiating tombstone deletion.

import { verifyAdminSession, recordAuditLog } from '../../auth.js';
import { queryServiceRole } from '../../supabase.js';
import { checkRateLimit } from '../../rate-limit.js';

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
  const entityId = req.query?.id || req.url.split('/').pop().split('?')[0];

  if (!entityId || entityId.length < 10) {
    return res.status(400).json({ error: 'Valid project entity_id is required.' });
  }

  try {
    await checkRateLimit(`rl:write:admin:${adminRecord.id}`, 60, 60, true);
  } catch (rateErr) {
    return res.status(rateErr.statusCode || 429).json({ error: rateErr.message });
  }

  if (req.method === 'PUT') {
    const updates = req.body || {};
    
    try {
      // 1. Fetch current versions for this entity
      const records = await queryServiceRole(`projects?entity_id=eq.${entityId}&order=version.desc`);
      if (!records || records.length === 0) {
        return res.status(404).json({ error: 'Project not found.' });
      }

      const existingDraft = records.find(r => r.status === 'draft');
      const latestVersion = records[0].version;
      const base = existingDraft || records.find(r => r.is_current_published) || records[0];

      // Extract fields accepting both canonical DB names and frontend aliases:
      const updatedTitle = updates.title !== undefined ? String(updates.title).trim() : base.title;
      const updatedSlug = updates.slug !== undefined ? String(updates.slug).toLowerCase().trim() : base.slug;
      const updatedCategory = updates.category !== undefined ? String(updates.category).trim() : base.category;
      
      // Summary / Short Description
      const summaryCandidate = updates.summary !== undefined ? updates.summary : updates.short_description;
      const updatedSummary = summaryCandidate !== undefined ? String(summaryCandidate).trim() : base.summary;
      
      const descriptionCandidate = updates.description !== undefined ? updates.description : updates.short_description;
      const updatedDescription = descriptionCandidate !== undefined ? String(descriptionCandidate).trim() : base.description;

      // Tags / Tech Stack
      let tagsCandidate = updates.tags !== undefined ? updates.tags : updates.tech_stack;
      if (typeof tagsCandidate === 'string') {
        tagsCandidate = tagsCandidate.split(',').map(t => t.trim()).filter(Boolean);
      }
      const updatedTags = (tagsCandidate !== undefined && Array.isArray(tagsCandidate))
        ? tagsCandidate.map(t => String(t).trim().toUpperCase()).filter(Boolean)
        : base.tags;

      // Project Number
      let updatedProjectNumber = updates.project_number !== undefined ? String(updates.project_number).trim() : base.project_number;
      if (!updatedProjectNumber) {
        updatedProjectNumber = base.project_number || `${String(base.display_order || 1).padStart(2, '0')} — ${updatedCategory}`;
      }

      // URLs
      const repoCandidate = updates.repo_url !== undefined ? updates.repo_url : updates.github_url;
      const updatedRepoUrl = repoCandidate !== undefined ? (repoCandidate ? String(repoCandidate).trim() : null) : base.repo_url;

      const demoCandidate = updates.demo_url !== undefined ? updates.demo_url : updates.live_url;
      const updatedDemoUrl = demoCandidate !== undefined ? (demoCandidate ? String(demoCandidate).trim() : null) : base.demo_url;

      // Display order
      const orderCandidate = updates.display_order !== undefined ? updates.display_order : updates.sort_order;
      const updatedDisplayOrder = orderCandidate !== undefined ? (parseInt(orderCandidate, 10) || 0) : base.display_order;

      const updatedIsWide = updates.is_wide !== undefined ? Boolean(updates.is_wide) : base.is_wide;
      const updatedIsFeatured = updates.is_featured !== undefined ? Boolean(updates.is_featured) : base.is_featured;
      const updatedIsConcept = updates.is_concept !== undefined ? Boolean(updates.is_concept) : base.is_concept;
      const updatedPreviewType = updates.preview_type || base.preview_type || 'custom';
      const updatedPreviewData = updates.preview_data || base.preview_data || {};

      if (existingDraft) {
        // Update the existing draft in-place
        const updated = await queryServiceRole(`projects?id=eq.${existingDraft.id}`, {
          method: 'PATCH',
          body: {
            title: updatedTitle,
            slug: updatedSlug,
            project_number: updatedProjectNumber,
            category: updatedCategory,
            summary: updatedSummary,
            description: updatedDescription,
            tags: updatedTags,
            repo_url: updatedRepoUrl,
            demo_url: updatedDemoUrl,
            preview_type: updatedPreviewType,
            preview_data: updatedPreviewData,
            display_order: updatedDisplayOrder,
            is_featured: updatedIsFeatured,
            is_wide: updatedIsWide,
            is_concept: updatedIsConcept,
            is_tombstone: false,
            updated_at: new Date().toISOString(),
          },
        });

        await recordAuditLog({ authUserId: user.id, action: 'UPDATE', entityType: 'project', entityId, req });
        return res.status(200).json({ success: true, project: normalizeProject(updated?.[0] || updated) });
      } else {
        // Only published/archived versions exist. Create a NEW version record with status='draft'
        const newDraftVersion = latestVersion + 1;

        const createdDraft = await queryServiceRole('projects', {
          method: 'POST',
          body: {
            entity_id: entityId,
            version: newDraftVersion,
            status: 'draft',
            is_current_published: false,
            is_tombstone: false,
            title: updatedTitle,
            slug: updatedSlug,
            project_number: updatedProjectNumber,
            category: updatedCategory,
            summary: updatedSummary,
            description: updatedDescription,
            tags: updatedTags,
            repo_url: updatedRepoUrl,
            demo_url: updatedDemoUrl,
            preview_type: updatedPreviewType,
            preview_data: updatedPreviewData,
            display_order: updatedDisplayOrder,
            is_featured: updatedIsFeatured,
            is_wide: updatedIsWide,
            is_concept: updatedIsConcept,
          },
        });

        await recordAuditLog({ authUserId: user.id, action: 'CREATE', entityType: 'project_draft_revision', entityId, req });
        return res.status(201).json({ success: true, project: normalizeProject(createdDraft?.[0] || createdDraft) });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to update project: ' + err.message });
    }
  }

  if (req.method === 'DELETE') {
    // Unpublishing / Deletion via Tombstone Draft
    try {
      const records = await queryServiceRole(`projects?entity_id=eq.${entityId}&order=version.desc`);
      if (!records || records.length === 0) {
        return res.status(404).json({ error: 'Project not found.' });
      }

      const existingDraft = records.find(r => r.status === 'draft');
      const hasPublished = records.some(r => r.status === 'published' || r.status === 'archived');

      if (!hasPublished && existingDraft) {
        // Was never published; safe to purge the draft completely
        await queryServiceRole(`projects?id=eq.${existingDraft.id}`, { method: 'DELETE' });
        await recordAuditLog({ authUserId: user.id, action: 'DELETE', entityType: 'project_draft', entityId, req });
        return res.status(200).json({ success: true, message: 'Unpublished draft purged.' });
      }

      if (existingDraft) {
        // Mark existing draft as a tombstone intent
        await queryServiceRole(`projects?id=eq.${existingDraft.id}`, {
          method: 'PATCH',
          body: { is_tombstone: true, updated_at: new Date().toISOString() },
        });
      } else {
        // Create a new tombstone draft revision
        const latest = records[0];
        await queryServiceRole('projects', {
          method: 'POST',
          body: {
            entity_id: entityId,
            version: latest.version + 1,
            status: 'draft',
            is_current_published: false,
            is_tombstone: true,
            slug: latest.slug,
            title: latest.title,
            project_number: latest.project_number,
            category: latest.category,
            summary: latest.summary,
            preview_type: latest.preview_type || 'custom',
            display_order: latest.display_order,
          },
        });
      }

      await recordAuditLog({ authUserId: user.id, action: 'DELETE', entityType: 'project_tombstone', entityId, req });
      return res.status(200).json({ success: true, message: 'Project staged for unpublishing/deletion on next publish.' });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to unpublish project: ' + err.message });
    }
  }

  res.setHeader('Allow', 'PUT, DELETE');
  return res.status(405).json({ error: 'Method not allowed.' });
}
