// api/public/content.js
// Public read-only endpoint returning current published portfolio content.
// Cached at Vercel Edge CDN with zero runtime overhead on visitors.

import { queryServiceRole } from '../../lib/supabase.js';
import { checkRateLimit, getClientIp } from '../../lib/rate-limit.js';

const FALLBACK_PUBLISHED_DATA = {
  site_settings: {
    profile_name: 'Pranav Shenoy',
    role_title: 'AI Systems Engineer & Full-Stack Developer',
    eyebrow_greeting: "Hey, I'm Pranav",
    full_bio: "B.Tech Computer Science student at MIT Manipal. Specialized in AI systems engineering, retrieval architectures, and real-time distributed platforms.",
    email: 'shenoypranav2003@gmail.com',
    github_url: 'https://github.com/PranavBShenoy',
    linkedin_url: 'https://linkedin.com/in/pranav-b-shenoy',
    cgpa: 8.94,
    class_12_pct: 93.4,
    class_10_pct: 94.2,
  },
  projects: [
    { slug: 'enterprise-rag-evaluation', title: 'Enterprise RAG Evaluation & Benchmarking System', category: 'AI Systems / Architecture', short_description: 'Comparative framework measuring retrieval fidelity and latency.' },
    { slug: 'campus-connect', title: 'CampusConnect — Academic Intelligence & Q&A Assistant', category: 'Distributed Systems / RAG', short_description: 'Manipal campus intelligence agent with semantic search.' },
    { slug: 'civic-audit', title: 'CivicSpend — Municipal Budget Intelligence & Anomaly Engine', category: 'Full-Stack / Applied AI', short_description: 'Deep audit dashboard identifying municipal allocation anomalies.' },
    { slug: 'distributed-form-builder', title: 'FormEngine — Low-Latency Dynamic Schema Form Platform', category: 'Full-Stack / Systems', short_description: 'High-throughput dynamic form processing engine.' },
    { slug: 'cloud-object-storage', title: 'AetherStore — Lightweight Object Storage & File Service', category: 'Cloud Infrastructure / Go', short_description: 'S3-compatible distributed blob store with deduping.' },
    { slug: 'url-shortener-analytics', title: 'PulseLink — Distributed URL Redirection & Telemetry Platform', category: 'Distributed Systems / Edge', short_description: 'Sub-millisecond global link resolution service.' },
    { slug: 'enterprise-support-desk', title: 'SecureDesk — Role-Segregated Incident Orchestration Platform', category: 'Security / Full-Stack', short_description: 'Zero-trust ticket management system with cryptographic audit.' }
  ],
  experiences: [
    { company: 'Center for Artificial Intelligence', role_title: 'AI Research Intern', start_date: 'MAY 2024', end_date: 'JUL 2024', symbol_mark: '◈' }
  ],
  certifications: [
    { title: 'Finalist, National AI Hackathon', issuer: 'IEEE Computer Society', mark_symbol: '◉' },
    { title: 'Certified Kubernetes Administrator (CKA Prep)', issuer: 'Linux Foundation', mark_symbol: '◈' },
    { title: 'AWS Certified Solutions Architect — Associate', issuer: 'Amazon Web Services', mark_symbol: '▲' },
    { title: 'Deep Learning Specialization', issuer: 'DeepLearning.AI', mark_symbol: '■' },
    { title: 'Autonomous Systems & Robotics Workshop', issuer: 'RoboTech Labs', mark_symbol: '●' }
  ]
};

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
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const clientIp = getClientIp(req);
  await checkRateLimit(`rl:public:${clientIp}`, 100, 60, false).catch(() => {});

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(200).json(FALLBACK_PUBLISHED_DATA);
  }

  try {
    const [settingsList, categories, skills, projects, experiences, certifications, snapshots] = await Promise.all([
      queryServiceRole('site_settings?is_current_published=eq.true&is_tombstone=eq.false&limit=1'),
      queryServiceRole('skill_categories?is_current_published=eq.true&is_tombstone=eq.false&order=display_order.asc'),
      queryServiceRole('skills?is_current_published=eq.true&is_tombstone=eq.false&order=display_order.asc'),
      queryServiceRole('projects?is_current_published=eq.true&is_tombstone=eq.false&order=display_order.asc'),
      queryServiceRole('experiences?is_current_published=eq.true&is_tombstone=eq.false&order=display_order.asc'),
      queryServiceRole('certifications?is_current_published=eq.true&is_tombstone=eq.false&order=display_order.asc'),
      queryServiceRole('publication_snapshots?order=version.desc&limit=1').catch(() => []),
    ]);

    const liveVersion = snapshots?.[0]?.version || 1;
    const snapshotId = snapshots?.[0]?.id ? String(snapshots[0].id).slice(0, 8) : 'snap';
    const etag = `"v${liveVersion}-${snapshotId}"`;
    res.setHeader('ETag', etag);
    res.setHeader('X-Publication-Version', String(liveVersion));
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600, must-revalidate');

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    return res.status(200).json({
      live_version: liveVersion,
      site_settings: settingsList?.[0] || FALLBACK_PUBLISHED_DATA.site_settings,
      skill_categories: categories || [],
      skills: skills || [],
      projects: (projects?.length ? projects : FALLBACK_PUBLISHED_DATA.projects).map(normalizeProject),
      experiences: (experiences?.length ? experiences : FALLBACK_PUBLISHED_DATA.experiences).map(normalizeExperience),
      certifications: (certifications?.length ? certifications : FALLBACK_PUBLISHED_DATA.certifications).map(c => {
        if (typeof c.url === 'string' && c.url.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(c.url);
            const parsedCred = parsed.credential_url || parsed.url || null;
            return {
              ...c,
              url: (typeof parsedCred === 'string' && !parsedCred.trim().startsWith('{')) ? parsedCred.trim() : null,
              credential_url: (typeof parsedCred === 'string' && !parsedCred.trim().startsWith('{')) ? parsedCred.trim() : null,
              certificate_image_url: (typeof parsed.certificate_image_url === 'string' && !parsed.certificate_image_url.trim().startsWith('{')) ? parsed.certificate_image_url.trim() : null,
              date: (typeof parsed.date === 'string' && !parsed.date.trim().startsWith('{')) ? parsed.date.trim() : null,
            };
          } catch {
            return { ...c, url: null, credential_url: null };
          }
        }
        return c;
      }),
    });
  } catch (err) {
    console.warn('Failed to load live published content from Supabase, serving fallback snapshot:', err.message);
    return res.status(200).json(FALLBACK_PUBLISHED_DATA);
  }
}
