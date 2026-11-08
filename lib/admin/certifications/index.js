// api/admin/certifications/index.js
// Handles listing, draft creation, updating, and tombstoning for credentials and certificates.

import { verifyAdminSession, recordAuditLog } from '../../auth.js';
import { queryServiceRole } from '../../supabase.js';
import { checkRateLimit } from '../../rate-limit.js';
import crypto from 'node:crypto';

function unpackCert(c) {
  if (!c) return c;
  const cert = { ...c };
  if (typeof cert.url === 'string' && cert.url.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(cert.url);
      const parsedCred = parsed.credential_url || parsed.url || null;
      cert.credential_url = (typeof parsedCred === 'string' && !parsedCred.trim().startsWith('{')) ? parsedCred.trim() : null;
      const parsedImg = cert.certificate_image_url || parsed.certificate_image_url || null;
      cert.certificate_image_url = (typeof parsedImg === 'string' && !parsedImg.trim().startsWith('{')) ? parsedImg.trim() : null;
      const parsedDate = cert.date || parsed.date || null;
      cert.date = (typeof parsedDate === 'string' && !parsedDate.trim().startsWith('{')) ? parsedDate.trim() : null;
    } catch {
      cert.credential_url = null;
    }
    // Requirement 5: Never leave serialized JSON in url
    cert.url = cert.credential_url || null;
  } else if (cert.url) {
    const rawUrl = String(cert.url).trim();
    if (rawUrl.startsWith('{')) {
      cert.url = null;
      cert.credential_url = null;
    } else {
      cert.credential_url = rawUrl;
    }
  }

  // Safety sanitization against corrupt/nested JSON strings and normalize missing optional fields to null
  if (typeof cert.credential_url === 'string' && cert.credential_url.trim().startsWith('{')) {
    cert.credential_url = null;
  }
  if (typeof cert.url === 'string' && cert.url.trim().startsWith('{')) {
    cert.url = null;
  }
  if (typeof cert.certificate_image_url === 'string' && cert.certificate_image_url.trim().startsWith('{')) {
    cert.certificate_image_url = null;
  }
  if (typeof cert.date === 'string' && cert.date.trim().startsWith('{')) {
    cert.date = null;
  }

  cert.credential_url = cert.credential_url || null;
  cert.certificate_image_url = cert.certificate_image_url || null;
  cert.date = cert.date || null;
  cert.url = cert.credential_url || null;

  return cert;
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
      const records = await queryServiceRole('certifications?order=display_order.asc,version.desc');
      const certifications = (records || []).map(unpackCert);
      return res.status(200).json({ success: true, certifications });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch certifications: ' + err.message });
    }
  }

  try {
    await checkRateLimit(`rl:write:admin:${adminRecord.id}`, 60, 60, true);
  } catch (rateErr) {
    return res.status(rateErr.statusCode || 429).json({ error: rateErr.message });
  }

  if (req.method === 'POST') {
    const {
      title,
      issuer,
      mark,
      mark_symbol,
      url,
      credential_url,
      certificate_image_url,
      date,
      display_order,
      sort_order
    } = req.body || {};

    const certTitle = String(title || '').trim();
    const certIssuer = String(issuer || '').trim();
    const certMark = String(mark || mark_symbol || '✳').trim();
    const cleanVal = (val) => {
      if (val == null) return null;
      const s = String(val).trim();
      return (s && !s.startsWith('{')) ? s : null;
    };

    const certCredentialUrl = cleanVal(credential_url) || cleanVal(url) || null;
    const certImageUrl = cleanVal(certificate_image_url) || null;
    const certDate = cleanVal(date) || null;
    const certOrder = parseInt(display_order ?? sort_order ?? 0, 10) || 0;

    if (!certTitle || !certIssuer) {
      return res.status(400).json({ error: 'Title and issuer are required.' });
    }

    const entityId = crypto.randomUUID();
    const fallbackUrlValue = (certImageUrl || certDate)
      ? JSON.stringify({ credential_url: certCredentialUrl, certificate_image_url: certImageUrl, date: certDate })
      : certCredentialUrl;

    try {
      let created;
      try {
        created = await queryServiceRole('certifications', {
          method: 'POST',
          body: {
            entity_id: entityId,
            version: 1,
            status: 'draft',
            is_current_published: false,
            is_tombstone: false,
            title: certTitle,
            issuer: certIssuer,
            mark: certMark,
            url: certCredentialUrl,
            display_order: certOrder,
            certificate_image_url: certImageUrl,
            date: certDate,
          },
        });
      } catch (colErr) {
        if (colErr.message && (colErr.message.includes('column') || colErr.message.includes('does not exist'))) {
          created = await queryServiceRole('certifications', {
            method: 'POST',
            body: {
              entity_id: entityId,
              version: 1,
              status: 'draft',
              is_current_published: false,
              is_tombstone: false,
              title: certTitle,
              issuer: certIssuer,
              mark: certMark,
              url: fallbackUrlValue,
              display_order: certOrder,
            },
          });
        } else {
          throw colErr;
        }
      }

      await recordAuditLog({ authUserId: user.id, action: 'CREATE', entityType: 'certification', entityId, req });
      return res.status(201).json({ success: true, certification: unpackCert(created?.[0] || created) });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to create certification: ' + err.message });
    }
  }

  if (req.method === 'PUT') {
    const entityId = req.body?.entity_id || req.query?.id || req.query?.entity_id;
    if (!entityId) {
      return res.status(400).json({ error: 'entity_id is required to update a certification.' });
    }

    const updates = req.body || {};
    try {
      const records = await queryServiceRole(`certifications?entity_id=eq.${entityId}&order=version.desc`);
      if (!records || records.length === 0) {
        return res.status(404).json({ error: 'Certification not found.' });
      }

      const existingDraft = records.find(r => r.status === 'draft');
      const latestVersion = records[0].version;
      const base = existingDraft || records.find(r => r.is_current_published) || records[0];
      const unpackedBase = unpackCert(base);

      const title = updates.title !== undefined ? String(updates.title).trim() : unpackedBase.title;
      const issuer = updates.issuer !== undefined ? String(updates.issuer).trim() : unpackedBase.issuer;
      const mark = updates.mark || updates.mark_symbol || unpackedBase.mark || '✳';
      const cleanVal = (val) => {
        if (val == null) return null;
        const s = String(val).trim();
        return (s && !s.startsWith('{')) ? s : null;
      };

      const credentialUrl = updates.credential_url !== undefined
        ? cleanVal(updates.credential_url)
        : (cleanVal(unpackedBase.credential_url) || null);
      const certificateImageUrl = updates.certificate_image_url !== undefined
        ? cleanVal(updates.certificate_image_url)
        : (cleanVal(unpackedBase.certificate_image_url) || null);
      const date = updates.date !== undefined
        ? cleanVal(updates.date)
        : (cleanVal(unpackedBase.date) || null);
      const displayOrder = parseInt(updates.display_order ?? updates.sort_order ?? unpackedBase.display_order ?? 0, 10) || 0;

      const fallbackUrlValue = (certificateImageUrl || date)
        ? JSON.stringify({ credential_url: credentialUrl, certificate_image_url: certificateImageUrl, date })
        : credentialUrl;

      if (existingDraft) {
        let updated;
        try {
          updated = await queryServiceRole(`certifications?id=eq.${existingDraft.id}`, {
            method: 'PATCH',
            body: {
              title,
              issuer,
              mark,
              url: credentialUrl,
              display_order: displayOrder,
              certificate_image_url: certificateImageUrl,
              date,
              is_tombstone: false,
              updated_at: new Date().toISOString(),
            },
          });
        } catch (colErr) {
          if (colErr.message && (colErr.message.includes('column') || colErr.message.includes('does not exist'))) {
            updated = await queryServiceRole(`certifications?id=eq.${existingDraft.id}`, {
              method: 'PATCH',
              body: {
                title,
                issuer,
                mark,
                url: fallbackUrlValue,
                display_order: displayOrder,
                is_tombstone: false,
                updated_at: new Date().toISOString(),
              },
            });
          } else {
            throw colErr;
          }
        }

        await recordAuditLog({ authUserId: user.id, action: 'UPDATE', entityType: 'certification', entityId, req });
        return res.status(200).json({ success: true, certification: unpackCert(updated?.[0] || updated) });
      } else {
        const newVersion = latestVersion + 1;
        let createdDraft;
        try {
          createdDraft = await queryServiceRole('certifications', {
            method: 'POST',
            body: {
              entity_id: entityId,
              version: newVersion,
              status: 'draft',
              is_current_published: false,
              is_tombstone: false,
              title,
              issuer,
              mark,
              url: credentialUrl,
              display_order: displayOrder,
              certificate_image_url: certificateImageUrl,
              date,
            },
          });
        } catch (colErr) {
          if (colErr.message && (colErr.message.includes('column') || colErr.message.includes('does not exist'))) {
            createdDraft = await queryServiceRole('certifications', {
              method: 'POST',
              body: {
                entity_id: entityId,
                version: newVersion,
                status: 'draft',
                is_current_published: false,
                is_tombstone: false,
                title,
                issuer,
                mark,
                url: fallbackUrlValue,
                display_order: displayOrder,
              },
            });
          } else {
            throw colErr;
          }
        }

        await recordAuditLog({ authUserId: user.id, action: 'CREATE', entityType: 'certification_draft_revision', entityId, req });
        return res.status(200).json({ success: true, certification: unpackCert(createdDraft?.[0] || createdDraft) });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to update certification draft: ' + err.message });
    }
  }

  if (req.method === 'DELETE') {
    const entityId = req.body?.entity_id || req.query?.entity_id;
    if (!entityId) {
      return res.status(400).json({ error: 'entity_id is required for tombstone/deletion.' });
    }

    try {
      const records = await queryServiceRole(`certifications?entity_id=eq.${entityId}&order=version.desc`);
      if (!records || records.length === 0) {
        return res.status(404).json({ error: 'Certification entry not found.' });
      }

      const existingDraft = records.find(r => r.status === 'draft');
      const hasPublished = records.some(r => r.status === 'published' || r.status === 'archived');

      if (!hasPublished && existingDraft) {
        await queryServiceRole(`certifications?id=eq.${existingDraft.id}`, { method: 'DELETE' });
        await recordAuditLog({ authUserId: user.id, action: 'DELETE', entityType: 'certification_draft', entityId, req });
        return res.status(200).json({ success: true, message: 'Unpublished certification draft purged.' });
      }

      if (existingDraft) {
        await queryServiceRole(`certifications?id=eq.${existingDraft.id}`, {
          method: 'PATCH',
          body: { is_tombstone: true, updated_at: new Date().toISOString() },
        });
      } else {
        const latest = records[0];
        await queryServiceRole('certifications', {
          method: 'POST',
          body: {
            entity_id: entityId,
            version: latest.version + 1,
            status: 'draft',
            is_current_published: false,
            is_tombstone: true,
            title: latest.title,
            issuer: latest.issuer,
            mark: latest.mark,
            url: latest.url,
            display_order: latest.display_order,
          },
        });
      }

      await recordAuditLog({ authUserId: user.id, action: 'DELETE', entityType: 'certification_tombstone', entityId, req });
      return res.status(200).json({ success: true, message: 'Certification staged for unpublishing/deletion on next publish.' });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to unpublish certification: ' + err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  return res.status(405).json({ error: 'Method not allowed.' });
}
