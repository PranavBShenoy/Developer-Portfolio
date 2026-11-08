-- Migration 005: Baseline Seed Data (Version 1)
-- Author: Pranav Shenoy Portfolio CMS
-- Description: Seeds initial published portfolio content and creates Snapshot Version 1.

DO $$
DECLARE
  v_admin_id UUID := '00000000-0000-0000-0000-000000000001'::uuid;
  v_settings_id UUID := '00000000-0000-0000-0000-000000000001'::uuid;
  v_cat_prog UUID := '10000000-0000-0000-0000-000000000001'::uuid;
  v_cat_web  UUID := '10000000-0000-0000-0000-000000000002'::uuid;
  v_cat_data UUID := '10000000-0000-0000-0000-000000000003'::uuid;
  v_cat_ai   UUID := '10000000-0000-0000-0000-000000000004'::uuid;
  v_cat_sys  UUID := '10000000-0000-0000-0000-000000000005'::uuid;
  v_cat_tool UUID := '10000000-0000-0000-0000-000000000006'::uuid;
  v_snapshot JSONB;
  v_token BYTEA;
BEGIN
  -- A. Ensure initial baseline administrator exists in registry
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000001'::uuid) THEN
    INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'admin@shenoypranav.com');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_admin_id) THEN
    INSERT INTO public.admin_users (id, auth_user_id, email, role, is_active)
    VALUES (v_admin_id, '00000000-0000-0000-0000-000000000001'::uuid, 'admin@shenoypranav.com', 'admin', true);
  END IF;

  -- B. Establish authenticated publication token context for initial baseline snapshot
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_token := extensions.gen_random_bytes(32);
  INSERT INTO private.authorized_publication_context (
    tx_id, authorized_admin_id, token_hash, operation_type, expires_at
  ) VALUES (
    txid_current(), v_admin_id, extensions.digest(v_token, 'sha256'), 'ROLLBACK', clock_timestamp() + interval '60 seconds'
  );
  PERFORM set_config('app.publish_auth_token', encode(v_token, 'hex'), true);
  -- 1. Site Settings (Version 1 Published)
  INSERT INTO public.site_settings (
    entity_id, version, status, is_current_published, is_tombstone,
    profile_name, role_title, eyebrow_bio, full_bio, email, github_url, linkedin_url,
    avatar_url, resume_url, cgpa, class_12_pct, class_10_pct, published_at
  ) VALUES (
    v_settings_id, 1, 'published', true, false,
    'Pranav Shenoy', 'INFORMATION SCIENCE ENGINEER',
    'A LITTLE ABOUT ME',
    'I’m an Information Science Engineering student interested in building secure, intelligent and reliable software systems. I enjoy exploring cybersecurity, AI engineering, backend development and the technologies that power modern applications.',
    'nnm24is160@nmamit.in',
    'https://github.com/PranavBShenoy',
    'https://www.linkedin.com/in/pranav-shenoy-b54288312',
    'assets/pranav-shenoy.jpg',
    'assets/pranav-shenoy-resume.pdf',
    8.46, 92.00, 83.00, clock_timestamp()
  ) ON CONFLICT (entity_id, version) DO NOTHING;

  -- 2. Skill Categories
  INSERT INTO public.skill_categories (entity_id, version, status, is_current_published, is_tombstone, category_number, name, display_order, published_at)
  VALUES
    (v_cat_prog, 1, 'published', true, false, '01 / PROGRAMMING', 'PROGRAMMING', 1, clock_timestamp()),
    (v_cat_web,  1, 'published', true, false, '02 / WEB & BACKEND', 'WEB & BACKEND', 2, clock_timestamp()),
    (v_cat_data, 1, 'published', true, false, '03 / DATA', 'DATA', 3, clock_timestamp()),
    (v_cat_ai,   1, 'published', true, false, '04 / AI & ML', 'AI & ML', 4, clock_timestamp()),
    (v_cat_sys,  1, 'published', true, false, '05 / SYSTEMS', 'SYSTEMS', 5, clock_timestamp()),
    (v_cat_tool, 1, 'published', true, false, '06 / TOOLS', 'TOOLS', 6, clock_timestamp())
  ON CONFLICT (entity_id, version) DO NOTHING;

  -- 3. Skills
  INSERT INTO public.skills (entity_id, category_entity_id, version, status, is_current_published, is_tombstone, name, display_order, published_at)
  VALUES
    (extensions.gen_random_uuid(), v_cat_prog, 1, 'published', true, false, 'C', 1, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_prog, 1, 'published', true, false, 'C++', 2, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_prog, 1, 'published', true, false, 'Java', 3, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_prog, 1, 'published', true, false, 'Python', 4, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_prog, 1, 'published', true, false, 'JavaScript', 5, clock_timestamp()),

    (extensions.gen_random_uuid(), v_cat_web, 1, 'published', true, false, 'HTML', 1, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_web, 1, 'published', true, false, 'CSS', 2, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_web, 1, 'published', true, false, 'React', 3, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_web, 1, 'published', true, false, 'Next.js', 4, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_web, 1, 'published', true, false, 'Flask', 5, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_web, 1, 'published', true, false, 'FastAPI', 6, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_web, 1, 'published', true, false, 'Node.js', 7, clock_timestamp()),

    (extensions.gen_random_uuid(), v_cat_data, 1, 'published', true, false, 'MySQL', 1, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_data, 1, 'published', true, false, 'PostgreSQL', 2, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_data, 1, 'published', true, false, 'SQLite', 3, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_data, 1, 'published', true, false, 'ChromaDB', 4, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_data, 1, 'published', true, false, 'pgvector', 5, clock_timestamp()),

    (extensions.gen_random_uuid(), v_cat_ai, 1, 'published', true, false, 'RAG', 1, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_ai, 1, 'published', true, false, 'LLM integration', 2, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_ai, 1, 'published', true, false, 'Scikit-learn', 3, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_ai, 1, 'published', true, false, 'XGBoost', 4, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_ai, 1, 'published', true, false, 'Isolation Forest', 5, clock_timestamp()),

    (extensions.gen_random_uuid(), v_cat_sys, 1, 'published', true, false, 'JWT authentication', 1, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_sys, 1, 'published', true, false, 'Access control', 2, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_sys, 1, 'published', true, false, 'Networking', 3, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_sys, 1, 'published', true, false, 'Linux', 4, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_sys, 1, 'published', true, false, 'System design', 5, clock_timestamp()),

    (extensions.gen_random_uuid(), v_cat_tool, 1, 'published', true, false, 'Git', 1, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_tool, 1, 'published', true, false, 'GitHub', 2, clock_timestamp()),
    (extensions.gen_random_uuid(), v_cat_tool, 1, 'published', true, false, 'Docker', 3, clock_timestamp())
  ON CONFLICT DO NOTHING;

  -- 4. Projects (All 7 initial projects)
  INSERT INTO public.projects (
    entity_id, version, status, is_current_published, is_tombstone,
    slug, title, project_number, category, summary, description,
    tags, repo_url, demo_url, preview_type, preview_data,
    display_order, is_featured, is_wide, is_concept, published_at
  ) VALUES
    ('20000000-0000-0000-0000-000000000001'::uuid, 1, 'published', true, false,
     'ragfence', 'RAGFENCE', '01 — SECURITY / RAG', 'SECURITY / RAG',
     'A security-focused RAG application designed to examine malicious documents and document-based prompt injection, with JWT authentication and user-level document access.',
     'Detailed security monitoring and threat vector analysis for RAG systems.',
     ARRAY['PYTHON','FASTAPI','POSTGRESQL','PGVECTOR','JWT'],
     'https://github.com/PranavBShenoy/RAGFENCE-', NULL, 'rag',
     '{"scanned": 1284, "flagged": 8, "events": 342}'::jsonb,
     1, true, true, false, clock_timestamp()),

    ('20000000-0000-0000-0000-000000000002'::uuid, 1, 'published', true, false,
     'campus-ai-assistant', 'CampusAI', '02 — AI / EDUCATION', 'AI / EDUCATION',
     'An academic assistant that turns uploaded study materials into grounded answers, searchable knowledge and practical study plans.',
     'Grounded in your notes with semantic retrieval.',
     ARRAY['PYTHON','RAG','CHROMADB','SQLALCHEMY'],
     'https://github.com/PranavBShenoy/Campus-Ai-Assistant', NULL, 'campus',
     '{}'::jsonb,
     2, true, false, false, clock_timestamp()),

    ('20000000-0000-0000-0000-000000000003'::uuid, 1, 'published', true, false,
     'civic-sentinel', 'Civic Sentinel', '03 — CONCEPT / CIVIC DATA', 'CONCEPT / CIVIC DATA',
     'Concept for surfacing unusual expenditure and progress patterns in public infrastructure projects through explainable risk indicators.',
     'Public infrastructure tracking and anomaly detection.',
     ARRAY['PYTHON','XGBOOST','ISOLATION FOREST','DATA ANALYSIS'],
     NULL, NULL, 'civic',
     '{"tracked": 24, "flagged": 3, "variance": "+8.4%"}'::jsonb,
     3, false, false, true, clock_timestamp()),

    ('20000000-0000-0000-0000-000000000004'::uuid, 1, 'published', true, false,
     'formflow', 'FormFlow', '04 — CONCEPT / PRODUCTIVITY', 'CONCEPT / PRODUCTIVITY',
     'A form builder concept bringing form creation, response management and lightweight analytics into one simple workspace.',
     'Dynamic responses and form analytics.',
     ARRAY['FORM BUILDER','SUBMISSIONS','ANALYTICS'],
     NULL, NULL, 'form',
     '{"responses": 1248, "rate": "86.4%"}'::jsonb,
     4, false, false, true, clock_timestamp()),

    ('20000000-0000-0000-0000-000000000005'::uuid, 1, 'published', true, false,
     'google-cloud-storage', 'Cloud Storage System', '05 — CLOUD / BACKEND', 'CLOUD / BACKEND',
     'A storage system inspired by Google Cloud Storage, exploring backend architecture and file storage design.',
     'Object storage backend architecture.',
     ARRAY['CLOUD STORAGE','BACKEND','FILE SYSTEMS'],
     'https://github.com/PranavBShenoy/google-cloud-storage', NULL, 'storage',
     '{"used": "68.2 GB", "total": "100 GB"}'::jsonb,
     5, false, false, false, clock_timestamp()),

    ('20000000-0000-0000-0000-000000000006'::uuid, 1, 'published', true, false,
     'url-shortener', 'URL Shortener', '06 — WEB / UTILITIES', 'WEB / UTILITIES',
     'A focused link-shortening project for creating compact URLs and tracking engagement.',
     'Link management and click analytics.',
     ARRAY['WEB APP','URLS','ANALYTICS'],
     'https://github.com/PranavBShenoy/url-shortner', NULL, 'url',
     '{"clicks": 8492, "active": 24}'::jsonb,
     6, false, false, false, clock_timestamp()),

    ('20000000-0000-0000-0000-000000000007'::uuid, 1, 'published', true, false,
     'secure-communication-portal', 'Secure Communication Portal', '07 — EXPERIENCE / INTERNSHIP PROJECT', 'EXPERIENCE / INTERNSHIP PROJECT',
     'A ticket-based portal for internal users and external clients, with department routing, access control, audit logging and restricted internal responses.',
     'Enterprise ticket portal developed during internship.',
     ARRAY['REACT','NODE.JS','MARIADB / MYSQL','ACCESS CONTROL'],
     'https://github.com/Suyash00-glitch/secure-coomunication', NULL, 'secure',
     '{"open_tickets": 3}'::jsonb,
     7, true, true, false, clock_timestamp())
  ON CONFLICT (entity_id, version) DO NOTHING;

  -- 5. Experiences
  INSERT INTO public.experiences (
    entity_id, version, status, is_current_published, is_tombstone,
    company, role, subtitle, description, period_label, symbol, tags, display_order, published_at
  ) VALUES (
    '30000000-0000-0000-0000-000000000001'::uuid, 1, 'published', true, false,
    'MANIPAL TECHNOLOGIES LTD', 'Intern', 'INTERNSHIP · MANIPAL TECHNOLOGIES LTD',
    'Completed an internship focused on developing a secure, ticket-based communication portal for internal users and external clients.',
    'PROFESSIONAL EXPERIENCE', '✳',
    ARRAY['SECURE COMMUNICATION','TICKET WORKFLOW','ACCESS CONTROL'],
    1, clock_timestamp()
  ) ON CONFLICT (entity_id, version) DO NOTHING;

  -- 6. Certifications
  INSERT INTO public.certifications (
    entity_id, version, status, is_current_published, is_tombstone,
    title, issuer, mark, url, display_order, published_at
  ) VALUES
    ('40000000-0000-0000-0000-000000000001'::uuid, 1, 'published', true, false, '6-Day AI Workshop', 'L&T', '✳', NULL, 1, clock_timestamp()),
    ('40000000-0000-0000-0000-000000000002'::uuid, 1, 'published', true, false, 'Meta AI Course', 'Coursera', '◉', NULL, 2, clock_timestamp()),
    ('40000000-0000-0000-0000-000000000003'::uuid, 1, 'published', true, false, 'Agentic AI Workshop', 'ISE Department, NMAMIT', '✳', NULL, 3, clock_timestamp()),
    ('40000000-0000-0000-0000-000000000004'::uuid, 1, 'published', true, false, 'Smart India Hackathon', 'Participation Certificate', '↗', NULL, 4, clock_timestamp()),
    ('40000000-0000-0000-0000-000000000005'::uuid, 1, 'published', true, false, 'Adobe Hackathon', 'Participation Certificate', '↗', NULL, 5, clock_timestamp())
  ON CONFLICT (entity_id, version) DO NOTHING;

  -- 7. Media Assets (Initial portrait and resume)
  INSERT INTO public.media_assets (
    entity_id, version, status, is_current_published, is_tombstone, is_primary_resume,
    filename, storage_path, bucket, mime_type, size_bytes, hash_sha256, alt_text, is_public, published_at
  ) VALUES
    ('50000000-0000-0000-0000-000000000001'::uuid, 1, 'published', true, false, false,
     'pranav-shenoy.jpg', 'media/pranav-shenoy.jpg', 'portfolio-storage', 'image/jpeg', 290610,
     'initial-portrait-hash', 'Portrait of Pranav Shenoy', true, clock_timestamp()),
    ('50000000-0000-0000-0000-000000000002'::uuid, 1, 'published', true, false, true,
     'pranav-shenoy-resume.pdf', 'resumes/pranav-shenoy-resume.pdf', 'portfolio-storage', 'application/pdf', 101241,
     'initial-resume-hash', 'Pranav Shenoy Resume', true, clock_timestamp())
  ON CONFLICT (entity_id, version) DO NOTHING;

  -- 8. Capture Initial Publication Snapshot (Version 1)
  SELECT jsonb_build_object(
    'version', 1,
    'site_settings', (SELECT row_to_json(s) FROM public.site_settings s WHERE is_current_published = true),
    'projects', (SELECT jsonb_agg(row_to_json(p)) FROM public.projects p WHERE is_current_published = true),
    'skills', (SELECT jsonb_agg(row_to_json(sk)) FROM public.skills sk WHERE is_current_published = true),
    'skill_categories', (SELECT jsonb_agg(row_to_json(sc)) FROM public.skill_categories sc WHERE is_current_published = true),
    'experiences', (SELECT jsonb_agg(row_to_json(e)) FROM public.experiences e WHERE is_current_published = true),
    'certifications', (SELECT jsonb_agg(row_to_json(c)) FROM public.certifications c WHERE is_current_published = true),
    'media_assets', (SELECT jsonb_agg(row_to_json(m)) FROM public.media_assets m WHERE is_current_published = true)
  ) INTO v_snapshot;

  INSERT INTO public.publication_snapshots (version, snapshot_data, published_by, notes)
  VALUES (1, v_snapshot, v_admin_id, 'Initial baseline portfolio content snapshot')
  ON CONFLICT (version) DO NOTHING;

  -- C. Consume and clear authorization token
  UPDATE private.authorized_publication_context SET consumed = true WHERE tx_id = txid_current();
  PERFORM set_config('app.publish_auth_token', '', true);

END $$;
