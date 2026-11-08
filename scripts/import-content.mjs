// scripts/import-content.mjs
// Idempotent migration script ensuring all public portfolio content from index.html
// is reliably populated in Supabase PostgreSQL under published status.

import { queryServiceRole, getSupabaseConfig } from '../lib/supabase.js';
import crypto from 'node:crypto';

const BASELINE_SETTINGS = {
  entity_id: '00000000-0000-0000-0000-000000000001',
  profile_name: 'Pranav Shenoy',
  role_title: 'INFORMATION SCIENCE ENGINEER',
  eyebrow_bio: 'A LITTLE ABOUT ME',
  full_bio: 'I’m an Information Science Engineering student interested in building secure, intelligent and reliable software systems. I enjoy exploring cybersecurity, AI engineering, backend development and the technologies that power modern applications.',
  email: 'nnm24is160@nmamit.in',
  github_url: 'https://github.com/PranavBShenoy',
  linkedin_url: 'https://www.linkedin.com/in/pranav-shenoy-b54288312',
  avatar_url: 'assets/pranav-shenoy.jpg',
  resume_url: 'assets/pranav-shenoy-resume.pdf',
  cgpa: 8.46,
  class_12_pct: 92.0,
  class_10_pct: 83.0,
};

const BASELINE_CATEGORIES = [
  { id: '10000000-0000-0000-0000-000000000001', name: 'PROGRAMMING', number: '01 / PROGRAMMING', order: 1 },
  { id: '10000000-0000-0000-0000-000000000002', name: 'WEB & BACKEND', number: '02 / WEB & BACKEND', order: 2 },
  { id: '10000000-0000-0000-0000-000000000003', name: 'DATA', number: '03 / DATA', order: 3 },
  { id: '10000000-0000-0000-0000-000000000004', name: 'AI & ML', number: '04 / AI & ML', order: 4 },
  { id: '10000000-0000-0000-0000-000000000005', name: 'SYSTEMS', number: '05 / SYSTEMS', order: 5 },
  { id: '10000000-0000-0000-0000-000000000006', name: 'TOOLS', number: '06 / TOOLS', order: 6 },
];

const BASELINE_SKILLS = [
  // 01 / PROGRAMMING
  { category: 'PROGRAMMING', name: 'C', order: 1 },
  { category: 'PROGRAMMING', name: 'C++', order: 2 },
  { category: 'PROGRAMMING', name: 'Java', order: 3 },
  { category: 'PROGRAMMING', name: 'Python', order: 4 },
  { category: 'PROGRAMMING', name: 'JavaScript', order: 5 },

  // 02 / WEB & BACKEND
  { category: 'WEB & BACKEND', name: 'HTML', order: 1 },
  { category: 'WEB & BACKEND', name: 'CSS', order: 2 },
  { category: 'WEB & BACKEND', name: 'React', order: 3 },
  { category: 'WEB & BACKEND', name: 'Next.js', order: 4 },
  { category: 'WEB & BACKEND', name: 'Flask', order: 5 },
  { category: 'WEB & BACKEND', name: 'FastAPI', order: 6 },
  { category: 'WEB & BACKEND', name: 'Node.js', order: 7 },

  // 03 / DATA
  { category: 'DATA', name: 'MySQL', order: 1 },
  { category: 'DATA', name: 'PostgreSQL', order: 2 },
  { category: 'DATA', name: 'SQLite', order: 3 },
  { category: 'DATA', name: 'ChromaDB', order: 4 },
  { category: 'DATA', name: 'pgvector', order: 5 },

  // 04 / AI & ML
  { category: 'AI & ML', name: 'RAG', order: 1 },
  { category: 'AI & ML', name: 'LLM integration', order: 2 },
  { category: 'AI & ML', name: 'Scikit-learn', order: 3 },
  { category: 'AI & ML', name: 'XGBoost', order: 4 },
  { category: 'AI & ML', name: 'Isolation Forest', order: 5 },

  // 05 / SYSTEMS
  { category: 'SYSTEMS', name: 'JWT authentication', order: 1 },
  { category: 'SYSTEMS', name: 'Access control', order: 2 },
  { category: 'SYSTEMS', name: 'Networking', order: 3 },
  { category: 'SYSTEMS', name: 'Linux', order: 4 },
  { category: 'SYSTEMS', name: 'System design', order: 5 },

  // 06 / TOOLS
  { category: 'TOOLS', name: 'Git', order: 1 },
  { category: 'TOOLS', name: 'GitHub', order: 2 },
  { category: 'TOOLS', name: 'Docker', order: 3 },
];

const BASELINE_PROJECTS = [
  {
    entity_id: '20000000-0000-0000-0000-000000000001',
    slug: 'ragfence',
    title: 'RAGFENCE',
    project_number: '01 — SECURITY / RAG',
    category: 'SECURITY / RAG',
    summary: 'A security-focused RAG application designed to examine malicious documents and document-based prompt injection, with JWT authentication and user-level document access.',
    description: 'Detailed security monitoring and threat vector analysis for RAG systems.',
    tags: ['PYTHON', 'FASTAPI', 'POSTGRESQL', 'PGVECTOR', 'JWT'],
    repo_url: 'https://github.com/PranavBShenoy/RAGFENCE-',
    demo_url: null,
    preview_type: 'rag',
    preview_data: { scanned: 1284, flagged: 8, events: 342 },
    display_order: 1,
    is_featured: true,
    is_wide: true,
    is_concept: false,
  },
  {
    entity_id: '20000000-0000-0000-0000-000000000002',
    slug: 'campus-ai-assistant',
    title: 'CampusAI',
    project_number: '02 — AI / EDUCATION',
    category: 'AI / EDUCATION',
    summary: 'An academic assistant that turns uploaded study materials into grounded answers, searchable knowledge and practical study plans.',
    description: 'Grounded in your notes with semantic retrieval.',
    tags: ['PYTHON', 'RAG', 'CHROMADB', 'SQLALCHEMY'],
    repo_url: 'https://github.com/PranavBShenoy/Campus-Ai-Assistant',
    demo_url: null,
    preview_type: 'campus',
    preview_data: {},
    display_order: 2,
    is_featured: true,
    is_wide: false,
    is_concept: false,
  },
  {
    entity_id: '20000000-0000-0000-0000-000000000003',
    slug: 'civic-sentinel',
    title: 'Civic Sentinel',
    project_number: '03 — CONCEPT / CIVIC DATA',
    category: 'CONCEPT / CIVIC DATA',
    summary: 'Concept for surfacing unusual expenditure and progress patterns in public infrastructure projects through explainable risk indicators.',
    description: 'Public infrastructure tracking and anomaly detection.',
    tags: ['PYTHON', 'XGBOOST', 'ISOLATION FOREST', 'DATA ANALYSIS'],
    repo_url: null,
    demo_url: null,
    preview_type: 'civic',
    preview_data: { tracked: 24, flagged: 3, variance: '+8.4%' },
    display_order: 3,
    is_featured: false,
    is_wide: false,
    is_concept: true,
  },
  {
    entity_id: '20000000-0000-0000-0000-000000000004',
    slug: 'formflow',
    title: 'FormFlow',
    project_number: '04 — CONCEPT / PRODUCTIVITY',
    category: 'CONCEPT / PRODUCTIVITY',
    summary: 'A form builder concept bringing form creation, response management and lightweight analytics into one simple workspace.',
    description: 'Dynamic responses and form analytics.',
    tags: ['FORM BUILDER', 'SUBMISSIONS', 'ANALYTICS'],
    repo_url: null,
    demo_url: null,
    preview_type: 'form',
    preview_data: { responses: 1248, rate: '86.4%' },
    display_order: 4,
    is_featured: false,
    is_wide: false,
    is_concept: true,
  },
  {
    entity_id: '20000000-0000-0000-0000-000000000005',
    slug: 'google-cloud-storage',
    title: 'Cloud Storage System',
    project_number: '05 — CLOUD / BACKEND',
    category: 'CLOUD / BACKEND',
    summary: 'A storage system inspired by Google Cloud Storage, exploring backend architecture and file storage design.',
    description: 'Object storage backend architecture.',
    tags: ['CLOUD STORAGE', 'BACKEND', 'FILE SYSTEMS'],
    repo_url: 'https://github.com/PranavBShenoy/google-cloud-storage',
    demo_url: null,
    preview_type: 'storage',
    preview_data: { used: '68.2 GB', total: '100 GB' },
    display_order: 5,
    is_featured: false,
    is_wide: false,
    is_concept: false,
  },
  {
    entity_id: '20000000-0000-0000-0000-000000000006',
    slug: 'url-shortener',
    title: 'URL Shortener',
    project_number: '06 — WEB / UTILITIES',
    category: 'WEB / UTILITIES',
    summary: 'A focused link-shortening project for creating compact URLs and tracking engagement.',
    description: 'Link management and click analytics.',
    tags: ['WEB APP', 'URLS', 'ANALYTICS'],
    repo_url: 'https://github.com/PranavBShenoy/url-shortner',
    demo_url: null,
    preview_type: 'url',
    preview_data: { clicks: 8492, active: 24 },
    display_order: 6,
    is_featured: false,
    is_wide: false,
    is_concept: false,
  },
  {
    entity_id: '20000000-0000-0000-0000-000000000007',
    slug: 'secure-communication-portal',
    title: 'Secure Communication Portal',
    project_number: '07 — EXPERIENCE / INTERNSHIP PROJECT',
    category: 'EXPERIENCE / INTERNSHIP PROJECT',
    summary: 'A ticket-based portal for internal users and external clients, with department routing, access control, audit logging and restricted internal responses.',
    description: 'Enterprise ticket portal developed during internship.',
    tags: ['REACT', 'NODE.JS', 'MARIADB / MYSQL', 'ACCESS CONTROL'],
    repo_url: 'https://github.com/Suyash00-glitch/secure-coomunication',
    demo_url: null,
    preview_type: 'secure',
    preview_data: { open_tickets: 3 },
    display_order: 7,
    is_featured: true,
    is_wide: true,
    is_concept: false,
  },
];

const BASELINE_EXPERIENCES = [
  {
    entity_id: '30000000-0000-0000-0000-000000000001',
    company: 'MANIPAL TECHNOLOGIES LTD',
    role: 'Intern',
    subtitle: 'INTERNSHIP · MANIPAL TECHNOLOGIES LTD',
    description: 'Completed an internship focused on developing a secure, ticket-based communication portal for internal users and external clients.',
    period_label: 'PROFESSIONAL EXPERIENCE',
    symbol: '✳',
    tags: ['SECURE COMMUNICATION', 'TICKET WORKFLOW', 'ACCESS CONTROL'],
    display_order: 1,
  },
];

const BASELINE_CERTIFICATIONS = [
  {
    entity_id: '40000000-0000-0000-0000-000000000001',
    title: '6-Day AI Workshop',
    issuer: 'L&T',
    mark: '✳',
    url: null,
    display_order: 1,
  },
  {
    entity_id: '40000000-0000-0000-0000-000000000002',
    title: 'Meta AI Course',
    issuer: 'Coursera',
    mark: '◉',
    url: null,
    display_order: 2,
  },
  {
    entity_id: '40000000-0000-0000-0000-000000000003',
    title: 'Agentic AI Workshop',
    issuer: 'ISE Department, NMAMIT',
    mark: '✳',
    url: null,
    display_order: 3,
  },
  {
    entity_id: '40000000-0000-0000-0000-000000000004',
    title: 'Smart India Hackathon',
    issuer: 'Participation Certificate',
    mark: '↗',
    url: null,
    display_order: 4,
  },
  {
    entity_id: '40000000-0000-0000-0000-000000000005',
    title: 'Adobe Hackathon',
    issuer: 'Participation Certificate',
    mark: '↗',
    url: null,
    display_order: 5,
  },
];

async function main() {
  const { url } = getSupabaseConfig();
  console.log('================================================================');
  console.log(`[CONTENT MIGRATION] Starting idempotent import to Supabase`);
  console.log(`[CONTENT MIGRATION] Endpoint: ${url}`);
  console.log('================================================================\n');

  // 1. Site Settings
  console.log('--- 1. Site Settings ---');
  const existingSettings = await queryServiceRole('site_settings?order=version.desc');
  if (existingSettings && existingSettings.length > 0) {
    console.log(`  ✓ Site settings already exist (${existingSettings.length} records, live version: ${existingSettings[0].version}).`);
  } else {
    console.log(`  + Inserting initial site settings...`);
    await queryServiceRole('site_settings', {
      method: 'POST',
      body: {
        ...BASELINE_SETTINGS,
        version: 1,
        status: 'published',
        is_current_published: true,
        is_tombstone: false,
        published_at: new Date().toISOString(),
      },
    });
    console.log(`  ✓ Inserted site settings (v1 published).`);
  }

  // 2. Skill Categories
  console.log('\n--- 2. Skill Categories ---');
  const existingCategories = await queryServiceRole('skill_categories?order=display_order.asc');
  const categoryMap = new Map();

  for (const cat of BASELINE_CATEGORIES) {
    const found = existingCategories.find(c => c.name === cat.name || c.entity_id === cat.id);
    if (found) {
      categoryMap.set(cat.name, found.entity_id);
      console.log(`  ✓ Category "${cat.name}" exists (entity: ${found.entity_id}).`);
    } else {
      console.log(`  + Creating category "${cat.name}"...`);
      const created = await queryServiceRole('skill_categories', {
        method: 'POST',
        body: {
          entity_id: cat.id,
          version: 1,
          status: 'published',
          is_current_published: true,
          is_tombstone: false,
          category_number: cat.number,
          name: cat.name,
          display_order: cat.order,
          published_at: new Date().toISOString(),
        },
      });
      categoryMap.set(cat.name, cat.id);
      console.log(`  ✓ Inserted category "${cat.name}".`);
    }
  }

  // 3. Skills
  console.log('\n--- 3. Skills ---');
  const existingSkills = await queryServiceRole('skills?order=display_order.asc');
  let insertedSkills = 0;

  for (const sk of BASELINE_SKILLS) {
    const catEntityId = categoryMap.get(sk.category);
    const found = existingSkills.find(s => s.name.toLowerCase() === sk.name.toLowerCase() && s.category_entity_id === catEntityId);
    if (!found) {
      await queryServiceRole('skills', {
        method: 'POST',
        body: {
          entity_id: crypto.randomUUID(),
          category_entity_id: catEntityId,
          version: 1,
          status: 'published',
          is_current_published: true,
          is_tombstone: false,
          name: sk.name,
          display_order: sk.order,
          published_at: new Date().toISOString(),
        },
      });
      insertedSkills++;
    }
  }
  console.log(`  ✓ Skills verified: ${existingSkills.length} existing, ${insertedSkills} newly inserted (total: ${existingSkills.length + insertedSkills}).`);

  // 4. Projects
  console.log('\n--- 4. Projects ---');
  const existingProjects = await queryServiceRole('projects?order=display_order.asc');
  let insertedProjects = 0;

  for (const p of BASELINE_PROJECTS) {
    const found = existingProjects.find(ep => ep.slug === p.slug || ep.entity_id === p.entity_id);
    if (found) {
      console.log(`  ✓ Project "${p.title}" exists (slug: ${p.slug}, entity: ${found.entity_id}).`);
    } else {
      console.log(`  + Inserting project "${p.title}"...`);
      await queryServiceRole('projects', {
        method: 'POST',
        body: {
          ...p,
          version: 1,
          status: 'published',
          is_current_published: true,
          is_tombstone: false,
          published_at: new Date().toISOString(),
        },
      });
      insertedProjects++;
      console.log(`  ✓ Inserted project "${p.title}".`);
    }
  }

  // 5. Experiences
  console.log('\n--- 5. Experiences ---');
  const existingExperiences = await queryServiceRole('experiences?order=display_order.asc');
  let insertedExperiences = 0;

  for (const exp of BASELINE_EXPERIENCES) {
    const found = existingExperiences.find(e => e.company === exp.company || e.entity_id === exp.entity_id);
    if (found) {
      console.log(`  ✓ Experience "${exp.company} - ${exp.role}" exists.`);
    } else {
      console.log(`  + Inserting experience "${exp.company}"...`);
      await queryServiceRole('experiences', {
        method: 'POST',
        body: {
          ...exp,
          version: 1,
          status: 'published',
          is_current_published: true,
          is_tombstone: false,
          published_at: new Date().toISOString(),
        },
      });
      insertedExperiences++;
      console.log(`  ✓ Inserted experience.`);
    }
  }

  // 6. Certifications
  console.log('\n--- 6. Certifications ---');
  const existingCertifications = await queryServiceRole('certifications?order=display_order.asc');
  let insertedCerts = 0;

  for (const cert of BASELINE_CERTIFICATIONS) {
    const found = existingCertifications.find(c => c.title === cert.title || c.entity_id === cert.entity_id);
    if (found) {
      console.log(`  ✓ Certification "${cert.title}" exists.`);
    } else {
      console.log(`  + Inserting certification "${cert.title}"...`);
      await queryServiceRole('certifications', {
        method: 'POST',
        body: {
          ...cert,
          version: 1,
          status: 'published',
          is_current_published: true,
          is_tombstone: false,
          published_at: new Date().toISOString(),
        },
      });
      insertedCerts++;
      console.log(`  ✓ Inserted certification.`);
    }
  }

  // 7. Summary
  const [finalSettings, finalCategories, finalSkills, finalProjects, finalExperiences, finalCerts] = await Promise.all([
    queryServiceRole('site_settings?is_current_published=eq.true'),
    queryServiceRole('skill_categories?is_current_published=eq.true'),
    queryServiceRole('skills?is_current_published=eq.true'),
    queryServiceRole('projects?is_current_published=eq.true'),
    queryServiceRole('experiences?is_current_published=eq.true'),
    queryServiceRole('certifications?is_current_published=eq.true'),
  ]);

  console.log('\n================================================================');
  console.log('CONTENT MIGRATION SUMMARY (CURRENT PUBLISHED COUNTS)');
  console.log('================================================================');
  console.log(`  Site Settings:     ${finalSettings.length} active`);
  console.log(`  Skill Categories:  ${finalCategories.length} categories`);
  console.log(`  Skills:            ${finalSkills.length} skills`);
  console.log(`  Projects:          ${finalProjects.length} projects`);
  console.log(`  Experiences:       ${finalExperiences.length} records`);
  console.log(`  Certifications:    ${finalCerts.length} credentials`);
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('[FATAL] Migration failed:', err);
  process.exit(1);
});
