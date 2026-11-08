// api/admin/content/preview.js
// Consolidates draft and published content for the admin live-preview container.

import { verifyAdminSession } from '../../auth.js';
import { queryServiceRole } from '../../supabase.js';

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

function normalizeExperience(e) {
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
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  try {
    await verifyAdminSession(req);
  } catch (err) {
    return res.status(err.statusCode || 401).json({ error: err.message });
  }

  try {
    // 1. Fetch current publication version
    const snapshots = await queryServiceRole('publication_snapshots?order=version.desc&limit=1');
    const liveVersion = snapshots?.[0]?.version || 1;

    // 2. Fetch all content entities
    const [settingsList, categoriesList, skillsList, projectsList, experiencesList, certsList, mediaList] = await Promise.all([
      queryServiceRole('site_settings?order=version.desc'),
      queryServiceRole('skill_categories?order=display_order.asc,version.desc'),
      queryServiceRole('skills?order=display_order.asc,version.desc'),
      queryServiceRole('projects?order=display_order.asc,version.desc'),
      queryServiceRole('experiences?order=display_order.asc,version.desc'),
      queryServiceRole('certifications?order=display_order.asc,version.desc'),
      queryServiceRole('media_assets?order=version.desc'),
    ]);

    // Merge helper: If an entity has a draft, prefer the draft; otherwise use published
    const mergeEntities = (list) => {
      const byEntity = new Map();
      for (const item of list) {
        if (!byEntity.has(item.entity_id)) {
          byEntity.set(item.entity_id, item);
        } else if (item.status === 'draft') {
          byEntity.set(item.entity_id, item); // Overwrite with draft
        }
      }
      return Array.from(byEntity.values()).filter(item => !item.is_tombstone);
    };

    const mergedSettings = mergeEntities(settingsList)[0] || null;
    const mergedCategories = mergeEntities(categoriesList);
    const mergedSkills = mergeEntities(skillsList);
    const mergedProjects = mergeEntities(projectsList).map(normalizeProject);
    const mergedExperiences = mergeEntities(experiencesList).map(normalizeExperience);
    const mergedCerts = mergeEntities(certsList).map(c => {
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
    });
    const mergedMedia = mergeEntities(mediaList);

    // Group skills under categories
    mergedCategories.forEach(cat => {
      cat.skills = mergedSkills.filter(s => s.category_entity_id === cat.entity_id || s.category_id === cat.entity_id);
    });

    const draftCounts = {
      projects: projectsList.filter(p => p.status === 'draft').length,
      skills: skillsList.filter(s => s.status === 'draft').length,
      categories: categoriesList.filter(c => c.status === 'draft').length,
      experiences: experiencesList.filter(e => e.status === 'draft').length,
      certifications: certsList.filter(c => c.status === 'draft').length,
      settings: settingsList.filter(s => s.status === 'draft').length,
      media: mediaList.filter(m => m.status === 'draft').length,
    };

    const totalDrafts = Object.values(draftCounts).reduce((a, b) => a + b, 0);

    const payload = {
      site_settings: mergedSettings,
      settings: mergedSettings,
      skill_categories: mergedCategories,
      skills: mergedSkills,
      projects: mergedProjects,
      experiences: mergedExperiences,
      certifications: mergedCerts,
      media_assets: mergedMedia,
    };

    return res.status(200).json({
      success: true,
      liveVersion,
      current_version: liveVersion,
      totalDrafts,
      pending_drafts_count: totalDrafts,
      draftCounts,
      ...payload,
      preview: payload,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to build preview: ' + err.message });
  }
}
