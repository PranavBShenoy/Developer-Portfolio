// api/admin/settings/index.js
// Handles reading and draft modification of singleton site settings and profile metadata.

import { verifyAdminSession, recordAuditLog } from '../../auth.js';
import { queryServiceRole } from '../../supabase.js';

const SETTINGS_ENTITY_ID = '00000000-0000-0000-0000-000000000001';

export default async function handler(req, res) {
  let session;
  try {
    session = await verifyAdminSession(req);
  } catch (err) {
    return res.status(err.statusCode || 401).json({ error: err.message });
  }

  const { user } = session;

  if (req.method === 'GET') {
    try {
      const records = await queryServiceRole(`site_settings?entity_id=eq.${SETTINGS_ENTITY_ID}&order=version.desc`);
      const published = records?.find(r => r.is_current_published);
      const draft = records?.find(r => r.status === 'draft');
      return res.status(200).json({ success: true, published, draft });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch settings: ' + err.message });
    }
  }

  if (req.method === 'PUT') {
    const updates = req.body || {};
    const eyebrow = updates.eyebrow_bio || updates.eyebrow_greeting;
    const email = updates.email || updates.contact_email;
    const class12 = updates.class_12_pct !== undefined ? parseFloat(updates.class_12_pct) : (updates.class_12_percentage !== undefined ? parseFloat(updates.class_12_percentage) : undefined);
    const class10 = updates.class_10_pct !== undefined ? parseFloat(updates.class_10_pct) : (updates.class_10_percentage !== undefined ? parseFloat(updates.class_10_percentage) : undefined);

    try {
      const records = await queryServiceRole(`site_settings?entity_id=eq.${SETTINGS_ENTITY_ID}&order=version.desc`);
      const existingDraft = records?.find(r => r.status === 'draft');
      const latestVersion = records?.[0]?.version || 1;
      const base = records?.find(r => r.is_current_published) || records?.[0] || {};

      if (existingDraft) {
        const updated = await queryServiceRole(`site_settings?id=eq.${existingDraft.id}`, {
          method: 'PATCH',
          body: {
            profile_name: updates.profile_name || existingDraft.profile_name,
            role_title: updates.role_title || existingDraft.role_title,
            eyebrow_bio: eyebrow || existingDraft.eyebrow_bio,
            full_bio: updates.full_bio || existingDraft.full_bio,
            email: email || existingDraft.email,
            github_url: updates.github_url || existingDraft.github_url,
            linkedin_url: updates.linkedin_url || existingDraft.linkedin_url,
            avatar_url: updates.avatar_url || existingDraft.avatar_url,
            resume_url: updates.resume_url || existingDraft.resume_url,
            cgpa: updates.cgpa !== undefined ? parseFloat(updates.cgpa) : existingDraft.cgpa,
            class_12_pct: class12 !== undefined ? class12 : existingDraft.class_12_pct,
            class_10_pct: class10 !== undefined ? class10 : existingDraft.class_10_pct,
            updated_at: new Date().toISOString(),
          },
        });

        await recordAuditLog({ authUserId: user.id, action: 'UPDATE', entityType: 'site_settings', req });
        return res.status(200).json({ success: true, settings: updated?.[0] || updated });
      } else {
        const createdDraft = await queryServiceRole('site_settings', {
          method: 'POST',
          body: {
            entity_id: SETTINGS_ENTITY_ID,
            version: latestVersion + 1,
            status: 'draft',
            is_current_published: false,
            is_tombstone: false,
            profile_name: updates.profile_name || base.profile_name,
            role_title: updates.role_title || base.role_title,
            eyebrow_bio: eyebrow || base.eyebrow_bio,
            full_bio: updates.full_bio || base.full_bio,
            email: email || base.email,
            github_url: updates.github_url || base.github_url,
            linkedin_url: updates.linkedin_url || base.linkedin_url,
            avatar_url: updates.avatar_url || base.avatar_url,
            resume_url: updates.resume_url || base.resume_url,
            cgpa: updates.cgpa !== undefined ? parseFloat(updates.cgpa) : base.cgpa,
            class_12_pct: class12 !== undefined ? class12 : base.class_12_pct,
            class_10_pct: class10 !== undefined ? class10 : base.class_10_pct,
          },
        });

        await recordAuditLog({ authUserId: user.id, action: 'CREATE', entityType: 'site_settings_draft', req });
        return res.status(201).json({ success: true, settings: createdDraft?.[0] || createdDraft });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to update settings: ' + err.message });
    }
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'Method not allowed.' });
}
