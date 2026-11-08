// api/admin/experience/index.js
// Handles listing, draft creation, updating, and tombstoning for professional experiences.

import { verifyAdminSession, recordAuditLog } from '../../../lib/auth.js';
import { queryServiceRole } from '../../../lib/supabase.js';
import { checkRateLimit } from '../../../lib/rate-limit.js';
import crypto from 'node:crypto';

export function unpackExperience(e) {
  if (!e) return e;
  let certificate_url = e.certificate_url || null;
  let certificate_filename = e.certificate_filename || null;
  let tags = Array.isArray(e.tags) ? [...e.tags] : [];

  const certTag = tags.find(t => typeof t === 'string' && (t.startsWith('__cert:') || t.startsWith('__cert_meta:')));
  if (certTag) {
    if (certTag.startsWith('__cert_meta:')) {
      try {
        const meta = JSON.parse(certTag.slice(12));
        certificate_url = certificate_url || meta.url || null;
        certificate_filename = certificate_filename || meta.filename || null;
      } catch {}
    } else {
      certificate_url = certificate_url || certTag.slice(7);
    }
    tags = tags.filter(t => typeof t !== 'string' || (!t.startsWith('__cert:') && !t.startsWith('__cert_meta:')));
  }

  const cleanVal = (val) => {
    if (val == null) return null;
    const s = String(val).trim();
    return (s && !s.startsWith('{')) ? s : null;
  };

  return {
    ...e,
    role_title: e.role_title || e.role || '',
    symbol_mark: e.symbol_mark || e.symbol || '✳',
    certificate_url: cleanVal(certificate_url),
    certificate_filename: cleanVal(certificate_filename),
    tags,
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
      const records = await queryServiceRole('experiences?order=display_order.asc,version.desc');
      const experiences = (records || []).map(unpackExperience);
      return res.status(200).json({ success: true, experiences });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch experiences: ' + err.message });
    }
  }

  try {
    await checkRateLimit(`rl:write:admin:${adminRecord.id}`, 60, 60, true);
  } catch (rateErr) {
    return res.status(rateErr.statusCode || 429).json({ error: rateErr.message });
  }

  const cleanVal = (val) => {
    if (val == null) return null;
    const s = String(val).trim();
    return (s && !s.startsWith('{')) ? s : null;
  };

  if (req.method === 'POST') {
    // If entity_id is provided in POST, route to update logic
    if (req.body?.entity_id) {
      return handleUpdate(req, res, user);
    }

    const {
      company,
      role,
      role_title,
      subtitle,
      description,
      period_label,
      start_date,
      end_date,
      symbol,
      symbol_mark,
      tags = [],
      display_order,
      sort_order,
      certificate_url,
      certificate_filename,
    } = req.body || {};

    const expCompany = String(company || '').trim();
    const expRole = String(role || role_title || '').trim();
    const expSubtitle = String(subtitle || (expCompany ? `INTERNSHIP · ${expCompany}` : expRole)).trim();
    const expDesc = String(description || '').trim();
    const expPeriod = String(period_label || (start_date ? `${start_date}${end_date ? ` — ${end_date}` : ' — PRESENT'}` : '')).trim();
    const expSymbol = String(symbol || symbol_mark || '✳').trim();
    const expOrder = parseInt(display_order ?? sort_order ?? 0, 10) || 0;
    const certUrl = cleanVal(certificate_url);
    const certFn = cleanVal(certificate_filename);

    if (!expCompany || !expRole || !expDesc || !expPeriod) {
      return res.status(400).json({ error: 'Missing required experience fields (company, role, description, period).' });
    }

    const cleanTags = (Array.isArray(tags) ? tags : []).filter(t => typeof t === 'string' && !t.startsWith('__cert:') && !t.startsWith('__cert_meta:'));
    const certMetaTag = certUrl
      ? `__cert_meta:${JSON.stringify({ url: certUrl, filename: certFn || '' })}`
      : null;
    const fallbackTags = certMetaTag ? [...cleanTags, certMetaTag] : cleanTags;

    const entityId = crypto.randomUUID();
    try {
      let created;
      try {
        created = await queryServiceRole('experiences', {
          method: 'POST',
          body: {
            entity_id: entityId,
            version: 1,
            status: 'draft',
            is_current_published: false,
            is_tombstone: false,
            company: expCompany,
            role: expRole,
            subtitle: expSubtitle,
            description: expDesc,
            period_label: expPeriod,
            symbol: expSymbol,
            tags: cleanTags,
            display_order: expOrder,
            certificate_url: certUrl,
            certificate_filename: certFn,
          },
        });
      } catch (colErr) {
        if (colErr.message && (colErr.message.includes('column') || colErr.message.includes('does not exist'))) {
          created = await queryServiceRole('experiences', {
            method: 'POST',
            body: {
              entity_id: entityId,
              version: 1,
              status: 'draft',
              is_current_published: false,
              is_tombstone: false,
              company: expCompany,
              role: expRole,
              subtitle: expSubtitle,
              description: expDesc,
              period_label: expPeriod,
              symbol: expSymbol,
              tags: fallbackTags,
              display_order: expOrder,
            },
          });
        } else {
          throw colErr;
        }
      }

      await recordAuditLog({ authUserId: user.id, action: 'CREATE', entityType: 'experience', entityId, req });
      return res.status(201).json({ success: true, experience: unpackExperience(created?.[0] || created) });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to create experience: ' + err.message });
    }
  }

  if (req.method === 'PUT') {
    return handleUpdate(req, res, user);
  }

  if (req.method === 'DELETE') {
    const entityId = req.body?.entity_id || req.query?.entity_id;
    if (!entityId) {
      return res.status(400).json({ error: 'entity_id is required for tombstone/deletion.' });
    }

    try {
      const records = await queryServiceRole(`experiences?entity_id=eq.${entityId}&order=version.desc`);
      if (!records || records.length === 0) {
        return res.status(404).json({ error: 'Experience entry not found.' });
      }

      const existingDraft = records.find(r => r.status === 'draft');
      const hasPublished = records.some(r => r.status === 'published' || r.status === 'archived');

      if (!hasPublished && existingDraft) {
        await queryServiceRole(`experiences?id=eq.${existingDraft.id}`, { method: 'DELETE' });
        await recordAuditLog({ authUserId: user.id, action: 'DELETE', entityType: 'experience_draft', entityId, req });
        return res.status(200).json({ success: true, message: 'Unpublished experience draft purged.' });
      }

      if (existingDraft) {
        await queryServiceRole(`experiences?id=eq.${existingDraft.id}`, {
          method: 'PATCH',
          body: { is_tombstone: true, updated_at: new Date().toISOString() },
        });
      } else {
        const latest = records[0];
        await queryServiceRole('experiences', {
          method: 'POST',
          body: {
            entity_id: entityId,
            version: latest.version + 1,
            status: 'draft',
            is_current_published: false,
            is_tombstone: true,
            company: latest.company,
            role: latest.role,
            subtitle: latest.subtitle,
            description: latest.description,
            period_label: latest.period_label,
            symbol: latest.symbol,
            tags: latest.tags,
            display_order: latest.display_order,
          },
        });
      }

      await recordAuditLog({ authUserId: user.id, action: 'DELETE', entityType: 'experience_tombstone', entityId, req });
      return res.status(200).json({ success: true, message: 'Experience staged for unpublishing/deletion on next publish.' });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to unpublish experience: ' + err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  return res.status(405).json({ error: 'Method not allowed.' });
}

async function handleUpdate(req, res, user) {
  const entityId = req.body?.entity_id || req.query?.id || req.query?.entity_id;
  if (!entityId) {
    return res.status(400).json({ error: 'entity_id is required to update an experience.' });
  }

  const cleanVal = (val) => {
    if (val == null) return null;
    const s = String(val).trim();
    return (s && !s.startsWith('{')) ? s : null;
  };

  const updates = req.body || {};
  try {
    const records = await queryServiceRole(`experiences?entity_id=eq.${entityId}&order=version.desc`);
    if (!records || records.length === 0) {
      return res.status(404).json({ error: 'Experience entry not found.' });
    }

    const existingDraft = records.find(r => r.status === 'draft');
    const latestVersion = records[0].version;
    const base = existingDraft || records.find(r => r.is_current_published) || records[0];
    const unpackedBase = unpackExperience(base);

    const company = updates.company !== undefined ? String(updates.company).trim() : unpackedBase.company;
    const role = updates.role !== undefined
      ? String(updates.role).trim()
      : (updates.role_title !== undefined ? String(updates.role_title).trim() : (unpackedBase.role || unpackedBase.role_title));
    const subtitle = updates.subtitle !== undefined
      ? String(updates.subtitle).trim()
      : (company ? `INTERNSHIP · ${company}` : unpackedBase.subtitle);
    const description = updates.description !== undefined ? String(updates.description).trim() : unpackedBase.description;
    const periodLabel = updates.period_label !== undefined
      ? String(updates.period_label).trim()
      : (updates.start_date ? `${updates.start_date}${updates.end_date ? ` — ${updates.end_date}` : ' — PRESENT'}` : unpackedBase.period_label);
    const symbol = updates.symbol || updates.symbol_mark || unpackedBase.symbol || unpackedBase.symbol_mark || '✳';
    const displayOrder = parseInt(updates.display_order ?? updates.sort_order ?? unpackedBase.display_order ?? 0, 10) || 0;

    const rawTags = updates.tags !== undefined ? updates.tags : unpackedBase.tags;
    const cleanTags = (Array.isArray(rawTags) ? rawTags : []).filter(t => typeof t === 'string' && !t.startsWith('__cert:') && !t.startsWith('__cert_meta:'));

    // Preserve existing certificate if not explicitly updated
    const certificateUrl = updates.certificate_url !== undefined
      ? cleanVal(updates.certificate_url)
      : unpackedBase.certificate_url;
    const certificateFilename = updates.certificate_filename !== undefined
      ? cleanVal(updates.certificate_filename)
      : (certificateUrl ? unpackedBase.certificate_filename : null);

    const certMetaTag = certificateUrl
      ? `__cert_meta:${JSON.stringify({ url: certificateUrl, filename: certificateFilename || '' })}`
      : null;
    const fallbackTags = certMetaTag ? [...cleanTags, certMetaTag] : cleanTags;

    if (existingDraft) {
      let updated;
      try {
        updated = await queryServiceRole(`experiences?id=eq.${existingDraft.id}`, {
          method: 'PATCH',
          body: {
            company,
            role,
            subtitle,
            description,
            period_label: periodLabel,
            symbol,
            tags: cleanTags,
            display_order: displayOrder,
            certificate_url: certificateUrl,
            certificate_filename: certificateFilename,
            is_tombstone: false,
            updated_at: new Date().toISOString(),
          },
        });
      } catch (colErr) {
        if (colErr.message && (colErr.message.includes('column') || colErr.message.includes('does not exist'))) {
          updated = await queryServiceRole(`experiences?id=eq.${existingDraft.id}`, {
            method: 'PATCH',
            body: {
              company,
              role,
              subtitle,
              description,
              period_label: periodLabel,
              symbol,
              tags: fallbackTags,
              display_order: displayOrder,
              is_tombstone: false,
              updated_at: new Date().toISOString(),
            },
          });
        } else {
          throw colErr;
        }
      }

      await recordAuditLog({ authUserId: user.id, action: 'UPDATE', entityType: 'experience', entityId, req });
      return res.status(200).json({ success: true, experience: unpackExperience(updated?.[0] || updated) });
    } else {
      const newVersion = latestVersion + 1;
      let createdDraft;
      try {
        createdDraft = await queryServiceRole('experiences', {
          method: 'POST',
          body: {
            entity_id: entityId,
            version: newVersion,
            status: 'draft',
            is_current_published: false,
            is_tombstone: false,
            company,
            role,
            subtitle,
            description,
            period_label: periodLabel,
            symbol,
            tags: cleanTags,
            display_order: displayOrder,
            certificate_url: certificateUrl,
            certificate_filename: certificateFilename,
          },
        });
      } catch (colErr) {
        if (colErr.message && (colErr.message.includes('column') || colErr.message.includes('does not exist'))) {
          createdDraft = await queryServiceRole('experiences', {
            method: 'POST',
            body: {
              entity_id: entityId,
              version: newVersion,
              status: 'draft',
              is_current_published: false,
              is_tombstone: false,
              company,
              role,
              subtitle,
              description,
              period_label: periodLabel,
              symbol,
              tags: fallbackTags,
              display_order: displayOrder,
            },
          });
        } else {
          throw colErr;
        }
      }

      await recordAuditLog({ authUserId: user.id, action: 'UPDATE', entityType: 'experience', entityId, req });
      return res.status(200).json({ success: true, experience: unpackExperience(createdDraft?.[0] || createdDraft) });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update experience: ' + err.message });
  }
}
