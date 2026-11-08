import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const sourceFiles = [
  'style.css',
  'script.js',
  'assets/pranav-shenoy.jpg',
  'assets/pranav-shenoy-resume.pdf'
];

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function fingerprintedName(file, buffer) {
  const extension = path.extname(file);
  return `${path.basename(file, extension)}.${digest(buffer).slice(0, 16)}${extension}`;
}

function stripDevOnly(source, startMarker, endMarker) {
  let result = '';
  let cursor = 0;
  while (true) {
    const start = source.indexOf(startMarker, cursor);
    if (start < 0) break;
    const end = source.indexOf(endMarker, start + startMarker.length);
    if (end < 0) throw new Error(`Missing development-only end marker: ${endMarker}`);
    result += source.slice(cursor, start);
    cursor = end + endMarker.length;
  }
  result += source.slice(cursor);
  if (result.includes(startMarker) || result.includes(endMarker)) throw new Error('Development-only markers were not fully removed.');
  return result;
}

function productionStyle(source) {
  return stripDevOnly(source, '/* DEV_ONLY_START:PROFILE_EDITOR */', '/* DEV_ONLY_END:PROFILE_EDITOR */');
}

function productionScript(source) {
  return stripDevOnly(source, '/* DEV_ONLY_START:PROFILE_EDITOR */', '/* DEV_ONLY_END:PROFILE_EDITOR */');
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchPublishedContent() {
  if (process.env.CMS_MOCK_PAYLOAD) {
    const raw = process.env.CMS_MOCK_PAYLOAD.trim();
    const mockData = raw.startsWith('{') ? JSON.parse(raw) : JSON.parse(await readFile(raw, 'utf8'));
    return {
      settings: mockData.settings || null,
      projects: mockData.projects || [],
      categories: mockData.categories || mockData.skillCategories || [],
      skills: mockData.skills || [],
      experiences: mockData.experiences || [],
      certifications: mockData.certifications || [],
      mediaAssets: mockData.mediaAssets || [],
      cleanUrl: null,
      headers: {},
      storageHeaders: {},
    };
  }

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;

  if (!url) {
    console.log('[BUILD] SUPABASE_URL not configured. Retaining baseline repository content for offline/development build.');
    return null;
  }

  if (!anonKey) {
    throw new Error('[BUILD FAILURE] SUPABASE_URL is configured but SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) is missing. Refusing to deploy without valid credentials.');
  }

  const cleanUrl = url.replace(/\/$/, '');
  const headers = {
    'apikey': anonKey,
    'Authorization': `Bearer ${anonKey}`,
  };
  const storageHeaders = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
  };

  async function getTable(endpoint) {
    let res;
    try {
      res = await fetch(`${cleanUrl}/rest/v1/${endpoint}`, { headers });
    } catch (netErr) {
      throw new Error(`[BUILD FAILURE] Network error fetching from Supabase endpoint "${endpoint}": ${netErr.message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[BUILD FAILURE] Supabase endpoint "${endpoint}" returned HTTP ${res.status} (${res.statusText}): ${body}`);
    }
    try {
      return await res.json();
    } catch (parseErr) {
      throw new Error(`[BUILD FAILURE] Failed to parse JSON from Supabase endpoint "${endpoint}": ${parseErr.message}`);
    }
  }

  console.log(`[BUILD] Fetching published CMS content from Supabase (${cleanUrl})...`);
  const [settingsList, projects, categories, skills, experiences, certifications, mediaAssets] = await Promise.all([
    getTable('site_settings?is_current_published=eq.true&is_tombstone=eq.false&limit=1'),
    getTable('projects?is_current_published=eq.true&is_tombstone=eq.false&order=display_order.asc,published_at.desc'),
    getTable('skill_categories?is_current_published=eq.true&is_tombstone=eq.false&order=display_order.asc'),
    getTable('skills?is_current_published=eq.true&is_tombstone=eq.false&order=display_order.asc'),
    getTable('experiences?is_current_published=eq.true&is_tombstone=eq.false&order=display_order.asc'),
    getTable('certifications?is_current_published=eq.true&is_tombstone=eq.false&order=display_order.asc'),
    getTable('media_assets?is_current_published=eq.true&is_tombstone=eq.false').catch(() => []),
  ]);

  return {
    settings: settingsList?.[0] || null,
    projects: projects || [],
    categories: categories || [],
    skills: skills || [],
    experiences: experiences || [],
    certifications: certifications || [],
    mediaAssets: mediaAssets || [],
    cleanUrl,
    headers,
    storageHeaders,
  };
}

function extractBaselinePreviews(htmlSource) {
  const previewMap = new Map();
  const cardRegex = /<article class="project-card[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  for (const match of htmlSource.matchAll(cardRegex)) {
    const inner = match[1];
    const typeMatch = inner.match(/class="preview preview-([a-z0-9-]+)"/);
    const slugMatch = match[0].match(/data-project="([^"]+)"/);
    const previewMatch = inner.match(/(<(?:a|div) class="preview [^"]*"[\s\S]*?<\/(?:a|div)>)\s*<div class="project-info"/);
    if (previewMatch) {
      if (typeMatch) previewMap.set(typeMatch[1], previewMatch[1]);
      if (slugMatch) previewMap.set(slugMatch[1], previewMatch[1]);
    }
  }
  return previewMap;
}

function renderProjectCard(p, previewMap) {
  const isWide = p.is_wide ? ' wide' : '';
  const slug = escapeHtml(p.slug || '');
  const projNo = escapeHtml(p.project_number || '01');
  const title = escapeHtml(p.title || '');
  const summary = escapeHtml(p.summary || p.short_description || p.description || '');
  const tags = Array.isArray(p.tags) ? p.tags : (Array.isArray(p.tech_stack) ? p.tech_stack : []);
  const tagsHtml = tags.map(t => `<span>${escapeHtml(t)}</span>`).join('');
  const repoUrl = p.repo_url || p.github_url;
  const demoUrl = p.demo_url || p.live_url || p.live_demo_url;

  let linkHtml = '';
  if (repoUrl) {
    linkHtml = `<a class="repo-link mono" href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener noreferrer">VIEW REPOSITORY ↗</a>`;
  } else if (p.is_concept) {
    linkHtml = `<span class="concept-label mono">CONCEPT PREVIEW</span>`;
  } else if (demoUrl) {
    linkHtml = `<a class="repo-link mono" href="${escapeHtml(demoUrl)}" target="_blank" rel="noopener noreferrer">LIVE DEMO ↗</a>`;
  }

  let previewBlock = previewMap.get(p.preview_type) || previewMap.get(p.slug);
  if (previewBlock) {
    if (repoUrl && previewBlock.startsWith('<a ')) {
      previewBlock = previewBlock.replace(/href="[^"]*"/, `href="${escapeHtml(repoUrl)}"`);
    }
  } else if (p.image_url || p.preview_image || p.cover_image || p.preview_data?.image_url) {
    const imgUrl = escapeHtml(p.image_url || p.preview_image || p.cover_image || p.preview_data?.image_url);
    const wrapStart = repoUrl ? `<a class="preview preview-custom" href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${title} repository">` : `<div class="preview preview-custom" aria-label="${title} project preview">`;
    const wrapEnd = repoUrl ? `</a>` : `</div>`;
    previewBlock = `${wrapStart}<img src="${imgUrl}" alt="${title} project preview" class="project-preview-img" width="400" height="325" loading="lazy" decoding="async">${wrapEnd}`;
  } else {
    previewBlock = `<div class="preview preview-civic" aria-label="${title} project preview"><div class="civic-top"><b>${escapeHtml((p.slug || 'PROJECT').toUpperCase())}</b><span>${escapeHtml(p.category || 'PROJECT')}</span><span>● LIVE VIEW</span></div><div class="civic-body"><div class="civic-title"><div><small>PORTFOLIO CMS</small><h4>${title}</h4></div></div><div class="civic-stats"><div><small>STATUS</small><b>ACTIVE</b></div></div></div></div>`;
  }

  return `        <article class="project-card${isWide}" data-project="${slug}" data-build-piece="project-card">
          ${previewBlock}
          <div class="project-info"><div><span class="project-no mono">${projNo}</span><h3>${title}</h3><p>${summary}</p><div class="tags mono">${tagsHtml}</div></div>${linkHtml}</div>
        </article>`;
}


const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
if (config.buildCommand !== 'node scripts/build.mjs' || config.outputDirectory !== 'dist') {
  throw new Error('Vercel build configuration must use this script and the dist output directory.');
}

const sourceHtml = await readFile(path.join(root, 'index.html'), 'utf8');
const inlineScripts = [...sourceHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
if (inlineScripts.length !== 1) throw new Error('Expected only the single CSP-hashed early JavaScript bootstrap.');

const cspRule = config.headers.find(rule => rule.source === '/(.*)');
const csp = cspRule?.headers.find(header => header.key.toLowerCase() === 'content-security-policy')?.value || '';
const bootstrapHash = `sha256-${createHash('sha256').update(inlineScripts[0]).digest('base64')}`;
if (!csp.includes(bootstrapHash) || /unsafe-(?:inline|eval)/i.test(csp)) {
  throw new Error('CSP must allow the exact bootstrap hash and must not allow unsafe-inline or unsafe-eval.');
}

const assetNames = new Map();
const outputs = [];
for (const file of sourceFiles) {
  let contents = await readFile(path.join(root, file));
  if (file === 'script.js') contents = Buffer.from(productionScript(contents.toString('utf8')));
  if (file === 'style.css') contents = Buffer.from(productionStyle(contents.toString('utf8')));
  const name = fingerprintedName(file, contents);
  const destination = path.join('assets', name);
  assetNames.set(file, destination.replaceAll(path.sep, '/'));
  outputs.push({ destination, contents });
}

let html = stripDevOnly(sourceHtml, '<!-- DEV_ONLY_START:PROFILE_EDITOR -->', '<!-- DEV_ONLY_END:PROFILE_EDITOR -->')
  .replaceAll('href="style.css"', `href="${assetNames.get('style.css')}"`)
  .replaceAll('src="script.js"', `src="${assetNames.get('script.js')}"`)
  .replaceAll('assets/pranav-shenoy.jpg', assetNames.get('assets/pranav-shenoy.jpg'))
  .replaceAll('assets/pranav-shenoy-resume.pdf', assetNames.get('assets/pranav-shenoy-resume.pdf'));

const publishedContent = await fetchPublishedContent();
if (publishedContent) {
  const { settings, projects, categories, skills, experiences, certifications, mediaAssets, cleanUrl, headers, storageHeaders } = publishedContent;
  console.log(`[BUILD] Rendering published Supabase CMS content into static HTML (settings: ${settings ? 'yes' : 'no'}, projects: ${projects.length}, categories: ${categories.length}, skills: ${skills.length}, experiences: ${experiences.length}, certs: ${certifications.length}).`);

  // 1. Site Settings & Profile
  if (settings) {
    if (settings.full_bio) {
      html = html.replace(
        /<p class="intro" data-build-text="bio">[\s\S]*?<\/p>/,
        `<p class="intro" data-build-text="bio">${escapeHtml(settings.full_bio)}</p>`
      );
    }
    if (settings.eyebrow_greeting || settings.eyebrow_bio) {
      const greeting = settings.eyebrow_greeting || settings.eyebrow_bio;
      html = html.replace(
        /<p class="hello" data-build-piece="greeting">[\s\S]*?<\/p>/,
        `<p class="hello" data-build-piece="greeting">${escapeHtml(greeting)}</p>`
      );
    }
    if (settings.role_title) {
      html = html.replace(
        /<div class="hero-meta mono" data-build-piece="role">[\s\S]*?<\/div>/,
        `<div class="hero-meta mono" data-build-piece="role"><span>${escapeHtml(settings.role_title)}</span><span>INDIA · 2026</span></div>`
      );
    }
    if (settings.cgpa !== undefined && settings.cgpa !== null) {
      html = html.replace(
        /<strong data-count="[^"]*" data-suffix="">/,
        `<strong data-count="${escapeHtml(String(settings.cgpa))}" data-suffix="">`
      );
    }
    if (settings.class_12_pct !== undefined && settings.class_12_pct !== null) {
      html = html.replace(
        /(<span>CLASS XII · EXPERT PU COLLEGE<\/span><b data-count=")[^"]*(")/,
        `$1${escapeHtml(String(settings.class_12_pct))}$2`
      );
    }
    if (settings.class_10_pct !== undefined && settings.class_10_pct !== null) {
      html = html.replace(
        /(<span>CLASS X · CANARA HIGH SCHOOL<\/span><b data-count=")[^"]*(")/,
        `$1${escapeHtml(String(settings.class_10_pct))}$2`
      );
    }
    if (settings.email) {
      html = html.replaceAll('nnm24is160@nmamit.in', escapeHtml(settings.email));
      html = html.replaceAll('NNM24IS160@NMAMIT.IN', escapeHtml(settings.email.toUpperCase()));
    }
    if (settings.github_url) {
      html = html.replaceAll('https://github.com/PranavBShenoy', escapeHtml(settings.github_url));
    }
    if (settings.linkedin_url) {
      html = html.replaceAll('https://www.linkedin.com/in/pranav-shenoy-b54288312', escapeHtml(settings.linkedin_url));
    }
  }

  // 2. Published Projects
  if (projects && projects.length > 0) {
    const previewMap = extractBaselinePreviews(sourceHtml);
    const renderedProjectsHtml = projects.map(p => renderProjectCard(p, previewMap)).join('\n');
    html = html.replace(
      /<div class="project-grid" data-build-piece="project-grid">[\s\S]*?<\/div>\s*<p class="project-foot mono">/,
      `<div class="project-grid" data-build-piece="project-grid">\n${renderedProjectsHtml}\n      </div>\n      <p class="project-foot mono">`
    );
  }

  // 3. Published Skill Categories & Skills
  if (categories && categories.length > 0) {
    const renderedSkillsHtml = categories.map(cat => {
      const catSkills = (skills || []).filter(s => (s.category_entity_id && s.category_entity_id === cat.entity_id) || (s.category_id && s.category_id === cat.entity_id));
      const catNumber = cat.category_number || `0${cat.display_order} / ${cat.name}`;
      const skillTags = catSkills.map(s => `<b>${escapeHtml(s.name)}</b>`).join('');
      return `<div class="skill-row"><span class="mono">${escapeHtml(catNumber)}</span><div>${skillTags}</div></div>`;
    }).join('\n        ');

    html = html.replace(
      /<div class="skills-list" data-build-piece="skills-list">[\s\S]*?<\/div>\s*<div class="credentials"/,
      `<div class="skills-list" data-build-piece="skills-list">\n        ${renderedSkillsHtml}\n      </div>\n      <div class="credentials"`
    );
  }

  // 4. Published Certifications
  if (certifications && certifications.length > 0) {
    const certElements = [];
    for (const c of certifications) {
      const mark = c.mark || c.mark_symbol || '✳';
      let certImageUrl = c.certificate_image_url;
      let certDate = c.date;
      let credentialUrl = c.credential_url;

      if (typeof c.url === 'string' && c.url.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(c.url);
          credentialUrl = credentialUrl || parsed.credential_url || parsed.url;
          certImageUrl = certImageUrl || parsed.certificate_image_url;
          certDate = certDate || parsed.date;
        } catch {}
      } else if (c.url && !credentialUrl) {
        credentialUrl = c.url;
      }

      if (typeof credentialUrl === 'string' && credentialUrl.trim().startsWith('{')) {
        credentialUrl = null;
      }
      if (typeof certImageUrl === 'string' && certImageUrl.trim().startsWith('{')) {
        certImageUrl = null;
      }
      if (typeof certDate === 'string' && certDate.trim().startsWith('{')) {
        certDate = null;
      }

      let imgHtml = '';
      if (certImageUrl) {
        try {
          let imgBuffer = null;
          let ext = '.jpg';

          const isMediaRoute = certImageUrl.startsWith('/api/public/media/');
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(certImageUrl);

          if (isMediaRoute || isUuid) {
            const mediaId = isMediaRoute ? certImageUrl.replace('/api/public/media/', '').split('?')[0] : certImageUrl;
            let matchingAsset = (mediaAssets || []).find(m =>
              m.entity_id === mediaId ||
              m.id === mediaId ||
              (m.storage_path && m.storage_path.includes(mediaId))
            );

            if (!matchingAsset && cleanUrl) {
              try {
                const qRes = await fetch(`${cleanUrl}/rest/v1/media_assets?or=(entity_id.eq.${mediaId},id.eq.${mediaId})&limit=1`, { headers: storageHeaders });
                if (qRes.ok) {
                  const found = await qRes.json();
                  if (found && found.length > 0) matchingAsset = found[0];
                }
              } catch {}
            }

            if (matchingAsset && cleanUrl) {
              ext = path.extname(matchingAsset.filename || matchingAsset.storage_path) || '.jpg';
              const bucket = matchingAsset.bucket || matchingAsset.bucket_id || 'portfolio-storage';
              const fileRes = await fetch(`${cleanUrl}/storage/v1/object/${bucket}/${matchingAsset.storage_path}`, { headers: storageHeaders });
              if (fileRes.ok) {
                imgBuffer = Buffer.from(await fileRes.arrayBuffer());
              } else {
                console.warn(`[BUILD] Failed to download media asset ${matchingAsset.storage_path}: HTTP ${fileRes.status}`);
              }
            }
          } else if (certImageUrl.startsWith('data:')) {
            const parts = certImageUrl.split(',');
            imgBuffer = Buffer.from(parts[1], 'base64');
            const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
            ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
          } else if (cleanUrl && certImageUrl.startsWith(cleanUrl) && certImageUrl.includes('/storage/v1/object/')) {
            const fileRes = await fetch(certImageUrl, { headers: storageHeaders });
            if (fileRes.ok) {
              imgBuffer = Buffer.from(await fileRes.arrayBuffer());
              ext = path.extname(certImageUrl.split('?')[0]) || '.jpg';
            }
          } else if (existsSync(certImageUrl)) {
            imgBuffer = await readFile(certImageUrl);
            ext = path.extname(certImageUrl) || '.jpg';
          } else if (existsSync(path.join(root, certImageUrl))) {
            imgBuffer = await readFile(path.join(root, certImageUrl));
            ext = path.extname(certImageUrl) || '.jpg';
          } else if (certImageUrl.startsWith('http://') || certImageUrl.startsWith('https://')) {
            try {
              const fileRes = await fetch(certImageUrl);
              if (fileRes.ok) {
                imgBuffer = Buffer.from(await fileRes.arrayBuffer());
                ext = path.extname(new URL(certImageUrl).pathname) || '.jpg';
              }
            } catch (extErr) {
              console.warn(`[BUILD] Failed to download external cert image ${certImageUrl}:`, extErr.message);
            }
          }

          if (imgBuffer && imgBuffer.length > 0) {
            const baseFileName = `cert-${(c.entity_id || 'cert').slice(0, 8)}${ext}`;
            const fName = fingerprintedName(baseFileName, imgBuffer);
            const destination = path.join('assets', fName);
            outputs.push({ destination, contents: imgBuffer });
            const publicPath = destination.replaceAll(path.sep, '/');
            imgHtml = `<a class="credential-img-link" href="${escapeHtml(publicPath)}" target="_blank" rel="noopener noreferrer" title="View Certificate"><img src="${escapeHtml(publicPath)}" alt="${escapeHtml(c.title)} Certificate" class="credential-thumb" width="36" height="26" loading="lazy" decoding="async"></a>`;
          }
        } catch (imgErr) {
          console.warn(`[BUILD] Could not bundle image for cert "${c.title}":`, imgErr.message);
        }
      }

      const dateStr = certDate ? ` · ${escapeHtml(certDate)}` : '';
      const credLink = credentialUrl ? ` · <a href="${escapeHtml(credentialUrl)}" target="_blank" rel="noopener noreferrer">VERIFY ↗</a>` : '';
      certElements.push(`<div><span class="credential-mark">${escapeHtml(mark)}</span><p><b>${escapeHtml(c.title)}</b><small>${escapeHtml(c.issuer)}${dateStr}${credLink}</small></p>${imgHtml}</div>`);
    }

    const renderedCertsHtml = certElements.join('');

    html = html.replace(
      /<div class="credential-grid">[\s\S]*?<\/div>\s*<\/div>\s*(?=<\/section>)/,
      `<div class="credential-grid">${renderedCertsHtml}</div></div>\n      `
    );
  }

  // 5. Published Experiences
  if (experiences && experiences.length > 0) {
    const renderedExperiencesHtml = [];
    for (const exp of experiences) {
      const symbol = exp.symbol || exp.symbol_mark || '✳';
      const subtitle = exp.subtitle || `INTERNSHIP · ${exp.company}`;
      const role = exp.role || exp.role_title || 'Intern';
      const desc = exp.description || '';
      const period = exp.period_label || 'PROFESSIONAL EXPERIENCE';
      let tags = Array.isArray(exp.tags) ? [...exp.tags] : [];

      let certUrl = exp.certificate_url || null;
      let certFn = exp.certificate_filename || null;
      const certTag = tags.find(t => typeof t === 'string' && (t.startsWith('__cert:') || t.startsWith('__cert_meta:')));
      if (certTag) {
        if (certTag.startsWith('__cert_meta:')) {
          try {
            const meta = JSON.parse(certTag.slice(12));
            certUrl = certUrl || meta.url;
            certFn = certFn || meta.filename;
          } catch {}
        } else {
          certUrl = certUrl || certTag.slice(7);
        }
        tags = tags.filter(t => typeof t !== 'string' || (!t.startsWith('__cert:') && !t.startsWith('__cert_meta:')));
      }

      let certLinkHtml = '';
      if (certUrl) {
        try {
          let certBuffer = null;
          let ext = '.pdf';

          const isMediaRoute = certUrl.startsWith('/api/public/media/');
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(certUrl);

          if (isMediaRoute || isUuid) {
            const mediaId = isMediaRoute ? certUrl.replace('/api/public/media/', '').split('?')[0] : certUrl;
            let matchingAsset = (mediaAssets || []).find(m =>
              m.entity_id === mediaId ||
              m.id === mediaId ||
              (m.storage_path && m.storage_path.includes(mediaId))
            );

            if (!matchingAsset && cleanUrl) {
              try {
                const qRes = await fetch(`${cleanUrl}/rest/v1/media_assets?or=(entity_id.eq.${mediaId},id.eq.${mediaId})&limit=1`, { headers: storageHeaders });
                if (qRes.ok) {
                  const found = await qRes.json();
                  if (found && found.length > 0) matchingAsset = found[0];
                }
              } catch {}
            }

            if (matchingAsset && cleanUrl) {
              ext = path.extname(matchingAsset.filename || matchingAsset.storage_path) || (matchingAsset.mime_type === 'application/pdf' ? '.pdf' : '.jpg');
              const bucket = matchingAsset.bucket || matchingAsset.bucket_id || 'portfolio-storage';
              const fileRes = await fetch(`${cleanUrl}/storage/v1/object/${bucket}/${matchingAsset.storage_path}`, { headers: storageHeaders });
              if (fileRes.ok) {
                certBuffer = Buffer.from(await fileRes.arrayBuffer());
              } else {
                console.warn(`[BUILD] Failed to download experience certificate ${matchingAsset.storage_path}: HTTP ${fileRes.status}`);
              }
            }
          } else if (certUrl.startsWith('data:')) {
            const parts = certUrl.split(',');
            certBuffer = Buffer.from(parts[1], 'base64');
            const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/pdf';
            ext = mime.includes('pdf') ? '.pdf' : mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
          } else if (cleanUrl && certUrl.startsWith(cleanUrl) && certUrl.includes('/storage/v1/object/')) {
            const fileRes = await fetch(certUrl, { headers: storageHeaders });
            if (fileRes.ok) {
              certBuffer = Buffer.from(await fileRes.arrayBuffer());
              ext = path.extname(certUrl.split('?')[0]) || '.pdf';
            }
          } else if (existsSync(certUrl)) {
            certBuffer = await readFile(certUrl);
            ext = path.extname(certUrl) || '.pdf';
          } else if (existsSync(path.join(root, certUrl))) {
            certBuffer = await readFile(path.join(root, certUrl));
            ext = path.extname(certUrl) || '.pdf';
          } else if (certUrl.startsWith('http://') || certUrl.startsWith('https://')) {
            try {
              const fileRes = await fetch(certUrl);
              if (fileRes.ok) {
                certBuffer = Buffer.from(await fileRes.arrayBuffer());
                ext = path.extname(new URL(certUrl).pathname) || '.pdf';
              }
            } catch (extErr) {
              console.warn(`[BUILD] Failed to download external experience certificate ${certUrl}:`, extErr.message);
            }
          }

          if (certBuffer && certBuffer.length > 0) {
            const baseFileName = `exp-cert-${(exp.entity_id || 'exp').slice(0, 8)}${ext}`;
            const fName = fingerprintedName(baseFileName, certBuffer);
            const destination = path.join('assets', fName);
            outputs.push({ destination, contents: certBuffer });
            const publicPath = destination.replaceAll(path.sep, '/');
            certLinkHtml = `<a class="exp-cert-link mono" href="${escapeHtml(publicPath)}" target="_blank" rel="noopener noreferrer">CERTIFICATE ↗</a>`;
          }
        } catch (err) {
          console.warn(`[BUILD] Could not bundle certificate for experience "${exp.company}":`, err.message);
        }
      }

      const tagsHtml = tags.map(t => `<span>${escapeHtml(t)}</span>`).join('');
      renderedExperiencesHtml.push(`<div class="experience-item" data-build-piece="experience-item"><span class="experience-symbol">${escapeHtml(symbol)}</span><div><span class="mono">${escapeHtml(subtitle)}</span><h3>${escapeHtml(role)}</h3><p data-build-text="experience">${escapeHtml(desc)}</p><div class="tags mono">${tagsHtml}${certLinkHtml}</div></div><span class="mono experience-date">${escapeHtml(period)}</span></div>`);
    }

    html = html.replace(
      /<h2>Experience<br><i>in practice\.<\/i><\/h2>[\s\S]*?<\/section>/,
      `<h2>Experience<br><i>in practice.</i></h2>\n${renderedExperiencesHtml.join('\n')}\n    </section>`
    );
  }
}

const publicAssetText = outputs.filter(item => /(?:script|style)\.[a-f0-9]+\.(?:js|css)$/.test(item.destination)).map(item => item.contents.toString('utf8')).join('\n');
if (/CUSTOMIZE|inspect-toggle|inspect-drawer|profile-form|profileForm|updateProfile|apply-profile|replay-build|sound-toggle|motion-mode|activity-collapse|data-count-choice|data-mode-choice|canvas-dock|agent-activity-panel|construction-status/.test(html + publicAssetText)) {
  throw new Error('A development-only or developer testing control leaked into the production output.');
}

if (html.includes('href="style.css"') || html.includes('src="script.js"')) {
  throw new Error('A source CSS or JavaScript reference was not fingerprinted.');
}

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'assets'), { recursive: true });
await writeFile(path.join(output, 'index.html'), html);
for (const item of outputs) {
  const destination = path.join(output, item.destination);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, item.contents);
}

const adminFiles = ['index.html', 'admin.css', 'admin.js'];
await mkdir(path.join(output, 'admin'), { recursive: true });
for (const file of adminFiles) {
  const contents = await readFile(path.join(root, 'admin', file));
  await writeFile(path.join(output, 'admin', file), contents);
}

console.log(`Built static portfolio to dist/ (${outputs.length} fingerprinted assets, admin console bundled).`);
