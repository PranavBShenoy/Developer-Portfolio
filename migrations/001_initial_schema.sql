-- Migration 001: Initial Schema
-- Author: Pranav Shenoy Portfolio CMS
-- Description: Core tables, versioning structure, indexes, and constraints.

-- 1. Enable required extensions in the extensions schema
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO anon, authenticated, service_role;

-- 2. Administrator Registry
CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_admin_users_auth_id ON public.admin_users(auth_user_id);

-- 3. Publication Snapshots (For Audit & Rollback)
CREATE TABLE IF NOT EXISTS public.publication_snapshots (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  version INT NOT NULL UNIQUE CHECK (version > 0),
  snapshot_data JSONB NOT NULL,
  published_by UUID REFERENCES public.admin_users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_publication_snapshots_ver ON public.publication_snapshots(version DESC);

-- 4. Site Settings (Versioned Entity)
CREATE TABLE IF NOT EXISTS public.site_settings (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  entity_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid CHECK (entity_id = '00000000-0000-0000-0000-000000000001'::uuid),
  version INT NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'tombstone')),
  is_current_published BOOLEAN NOT NULL DEFAULT false,
  is_tombstone BOOLEAN NOT NULL DEFAULT false,
  profile_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  eyebrow_bio TEXT NOT NULL,
  full_bio TEXT NOT NULL,
  email TEXT NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  github_url TEXT NOT NULL,
  linkedin_url TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  resume_url TEXT NOT NULL,
  cgpa NUMERIC(4,2) NOT NULL CHECK (cgpa >= 0.00 AND cgpa <= 10.00),
  class_12_pct NUMERIC(5,2) NOT NULL CHECK (class_12_pct >= 0.00 AND class_12_pct <= 100.00),
  class_10_pct NUMERIC(5,2) NOT NULL CHECK (class_10_pct >= 0.00 AND class_10_pct <= 100.00),
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_site_settings_entity_version UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_site_settings_current ON public.site_settings (entity_id) WHERE (is_current_published = true);
CREATE UNIQUE INDEX IF NOT EXISTS uq_site_settings_draft ON public.site_settings (entity_id) WHERE (status = 'draft');

-- 5. Skill Categories (Versioned Entity)
CREATE TABLE IF NOT EXISTS public.skill_categories (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  entity_id UUID NOT NULL,
  version INT NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'tombstone')),
  is_current_published BOOLEAN NOT NULL DEFAULT false,
  is_tombstone BOOLEAN NOT NULL DEFAULT false,
  category_number TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_skill_categories_entity_version UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_categories_current ON public.skill_categories (entity_id) WHERE (is_current_published = true);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_categories_draft ON public.skill_categories (entity_id) WHERE (status = 'draft');
CREATE INDEX IF NOT EXISTS idx_skill_categories_order ON public.skill_categories(display_order) WHERE (is_current_published = true);

-- 6. Skills (Versioned Entity)
CREATE TABLE IF NOT EXISTS public.skills (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  entity_id UUID NOT NULL,
  category_entity_id UUID NOT NULL,
  version INT NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'tombstone')),
  is_current_published BOOLEAN NOT NULL DEFAULT false,
  is_tombstone BOOLEAN NOT NULL DEFAULT false,
  name TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_skills_entity_version UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skills_current ON public.skills (entity_id) WHERE (is_current_published = true);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skills_draft ON public.skills (entity_id) WHERE (status = 'draft');
CREATE INDEX IF NOT EXISTS idx_skills_category ON public.skills(category_entity_id, display_order) WHERE (is_current_published = true);

-- 7. Projects (Versioned Entity)
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  entity_id UUID NOT NULL,
  version INT NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'tombstone')),
  is_current_published BOOLEAN NOT NULL DEFAULT false,
  is_tombstone BOOLEAN NOT NULL DEFAULT false,
  slug TEXT NOT NULL CHECK (slug ~* '^[a-z0-9-]+$'),
  title TEXT NOT NULL,
  project_number TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  repo_url TEXT,
  demo_url TEXT,
  preview_type TEXT NOT NULL CHECK (preview_type IN ('rag', 'campus', 'civic', 'form', 'storage', 'url', 'secure', 'custom')),
  preview_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_order INT NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_wide BOOLEAN NOT NULL DEFAULT false,
  is_concept BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_projects_entity_version UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_current ON public.projects (entity_id) WHERE (is_current_published = true);
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_draft ON public.projects (entity_id) WHERE (status = 'draft');
CREATE INDEX IF NOT EXISTS idx_projects_order ON public.projects (display_order) WHERE (is_current_published = true);

-- 8. Experiences (Versioned Entity)
CREATE TABLE IF NOT EXISTS public.experiences (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  entity_id UUID NOT NULL,
  version INT NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'tombstone')),
  is_current_published BOOLEAN NOT NULL DEFAULT false,
  is_tombstone BOOLEAN NOT NULL DEFAULT false,
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  description TEXT NOT NULL,
  period_label TEXT NOT NULL,
  symbol TEXT NOT NULL DEFAULT '✳',
  tags TEXT[] NOT NULL DEFAULT '{}',
  display_order INT NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_experiences_entity_version UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_experiences_current ON public.experiences (entity_id) WHERE (is_current_published = true);
CREATE UNIQUE INDEX IF NOT EXISTS uq_experiences_draft ON public.experiences (entity_id) WHERE (status = 'draft');
CREATE INDEX IF NOT EXISTS idx_experiences_order ON public.experiences (display_order) WHERE (is_current_published = true);

-- 9. Certifications (Versioned Entity)
CREATE TABLE IF NOT EXISTS public.certifications (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  entity_id UUID NOT NULL,
  version INT NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'tombstone')),
  is_current_published BOOLEAN NOT NULL DEFAULT false,
  is_tombstone BOOLEAN NOT NULL DEFAULT false,
  title TEXT NOT NULL,
  issuer TEXT NOT NULL,
  mark TEXT NOT NULL DEFAULT '✳',
  url TEXT,
  display_order INT NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_certifications_entity_version UNIQUE (entity_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_certifications_current ON public.certifications (entity_id) WHERE (is_current_published = true);
CREATE UNIQUE INDEX IF NOT EXISTS uq_certifications_draft ON public.certifications (entity_id) WHERE (status = 'draft');
CREATE INDEX IF NOT EXISTS idx_certifications_order ON public.certifications (display_order) WHERE (is_current_published = true);

-- 10. Media Assets (Versioned Entity, strictly private storage by default)
CREATE TABLE IF NOT EXISTS public.media_assets (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  entity_id UUID NOT NULL,
  version INT NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'tombstone')),
  is_current_published BOOLEAN NOT NULL DEFAULT false,
  is_tombstone BOOLEAN NOT NULL DEFAULT false,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  bucket TEXT NOT NULL DEFAULT 'portfolio-storage',
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  hash_sha256 TEXT NOT NULL,
  alt_text TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  is_primary_resume BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_media_assets_entity_version UNIQUE (entity_id, version),
  CONSTRAINT chk_resume_mime_type CHECK (NOT is_primary_resume OR mime_type = 'application/pdf')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_assets_current ON public.media_assets (entity_id) WHERE (is_current_published = true);
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_assets_draft ON public.media_assets (entity_id) WHERE (status = 'draft');
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_assets_primary_published_resume ON public.media_assets (is_primary_resume) WHERE (is_primary_resume = true AND is_current_published = true AND is_tombstone = false);
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_assets_primary_draft_resume ON public.media_assets (is_primary_resume) WHERE (is_primary_resume = true AND status = 'draft');
CREATE INDEX IF NOT EXISTS idx_media_assets_path ON public.media_assets (storage_path);

-- 11. Immutable Audit Logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'PUBLISH', 'ROLLBACK', 'UPLOAD')),
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);
