// api/admin/media/index.js
// Lists media assets cataloged in private storage and supports draft tombstoning.

import { verifyAdminSession, recordAuditLog } from '../../auth.js';
import { queryServiceRole } from '../../supabase.js';
import { checkRateLimit } from '../../rate-limit.js';

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
      const assets = await queryServiceRole('media_assets?order=created_at.desc');
      return res.status(200).json({ success: true, assets });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch media catalog: ' + err.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await checkRateLimit(`rl:write:admin:${adminRecord.id}`, 60, 60, true);
    } catch (rateErr) {
      return res.status(rateErr.statusCode || 429).json({ error: rateErr.message });
    }

    const entityId = req.body?.entity_id || req.query?.entity_id;
    if (!entityId) {
      return res.status(400).json({ error: 'entity_id is required.' });
    }

    try {
      const records = await queryServiceRole(`media_assets?entity_id=eq.${entityId}&order=version.desc`);
      if (!records || records.length === 0) {
        return res.status(404).json({ error: 'Media asset not found.' });
      }

      const existingDraft = records.find(r => r.status === 'draft');
      const hasPublished = records.some(r => r.status === 'published' || r.status === 'archived');

      if (!hasPublished && existingDraft) {
        await queryServiceRole(`media_assets?id=eq.${existingDraft.id}`, { method: 'DELETE' });
        await recordAuditLog({ authUserId: user.id, action: 'DELETE', entityType: 'media_draft', entityId, req });
        return res.status(200).json({ success: true, message: 'Unpublished media draft purged.' });
      }

      if (existingDraft) {
        await queryServiceRole(`media_assets?id=eq.${existingDraft.id}`, {
          method: 'PATCH',
          body: { is_tombstone: true },
        });
      } else {
        const latest = records[0];
        await queryServiceRole('media_assets', {
          method: 'POST',
          body: {
            entity_id: entityId,
            version: latest.version + 1,
            status: 'draft',
            is_current_published: false,
            is_tombstone: true,
            is_primary_resume: false,
            filename: latest.filename,
            storage_path: latest.storage_path,
            bucket: latest.bucket,
            mime_type: latest.mime_type,
            size_bytes: latest.size_bytes,
            hash_sha256: latest.hash_sha256,
            alt_text: latest.alt_text,
            is_public: false,
          },
        });
      }

      await recordAuditLog({ authUserId: user.id, action: 'DELETE', entityType: 'media_tombstone', entityId, req });
      return res.status(200).json({ success: true, message: 'Media asset staged for unpublishing/deletion on next publish.' });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to unpublish media asset: ' + err.message });
    }
  }

  res.setHeader('Allow', 'GET, DELETE');
  return res.status(405).json({ error: 'Method not allowed.' });
}
