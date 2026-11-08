-- Migration 003: Row Level Security & Authorization Policies
-- Author: Pranav Shenoy Portfolio CMS
-- Description: Strict RLS on all tables and private storage bucket policies.

-- 1. Helper function: is_admin()
-- Evaluates without recursion because admin_users RLS does not invoke is_admin().
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE auth_user_id = auth.uid()
      AND is_active = true
      AND role = 'admin'
  );
END;
$$;

ALTER FUNCTION public.is_admin() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- 2. Enable RLS on all tables
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Grant schema and table privileges to roles (RLS governs all access)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;

-- 3. Policies: admin_users (Self-read only; client mutations blocked)
DROP POLICY IF EXISTS admin_users_select ON public.admin_users;
CREATE POLICY admin_users_select ON public.admin_users
  FOR SELECT TO authenticated USING (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS admin_users_insert_deny ON public.admin_users;
CREATE POLICY admin_users_insert_deny ON public.admin_users
  FOR INSERT TO anon, authenticated WITH CHECK (false);

DROP POLICY IF EXISTS admin_users_update_deny ON public.admin_users;
CREATE POLICY admin_users_update_deny ON public.admin_users
  FOR UPDATE TO anon, authenticated USING (false);

DROP POLICY IF EXISTS admin_users_delete_deny ON public.admin_users;
CREATE POLICY admin_users_delete_deny ON public.admin_users
  FOR DELETE TO anon, authenticated USING (false);

-- 4. Policies: Content Tables (projects, skills, categories, experiences, certifications, settings)

-- PROJECTS
DROP POLICY IF EXISTS projects_public_select ON public.projects;
CREATE POLICY projects_public_select ON public.projects
  FOR SELECT TO anon, authenticated
  USING (is_current_published = true AND is_tombstone = false);

DROP POLICY IF EXISTS projects_admin_select ON public.projects;
CREATE POLICY projects_admin_select ON public.projects
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS projects_admin_insert ON public.projects;
CREATE POLICY projects_admin_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND status = 'draft');

DROP POLICY IF EXISTS projects_admin_update ON public.projects;
CREATE POLICY projects_admin_update ON public.projects
  FOR UPDATE TO authenticated
  USING (public.is_admin() AND status = 'draft')
  WITH CHECK (public.is_admin() AND status = 'draft');

DROP POLICY IF EXISTS projects_admin_delete ON public.projects;
CREATE POLICY projects_admin_delete ON public.projects
  FOR DELETE TO authenticated
  USING (public.is_admin() AND status = 'draft');

-- SKILL CATEGORIES
DROP POLICY IF EXISTS categories_public_select ON public.skill_categories;
CREATE POLICY categories_public_select ON public.skill_categories
  FOR SELECT TO anon, authenticated
  USING (is_current_published = true AND is_tombstone = false);

DROP POLICY IF EXISTS categories_admin_select ON public.skill_categories;
CREATE POLICY categories_admin_select ON public.skill_categories
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS categories_admin_insert ON public.skill_categories;
CREATE POLICY categories_admin_insert ON public.skill_categories
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND status = 'draft');

DROP POLICY IF EXISTS categories_admin_update ON public.skill_categories;
CREATE POLICY categories_admin_update ON public.skill_categories
  FOR UPDATE TO authenticated
  USING (public.is_admin() AND status = 'draft')
  WITH CHECK (public.is_admin() AND status = 'draft');

DROP POLICY IF EXISTS categories_admin_delete ON public.skill_categories;
CREATE POLICY categories_admin_delete ON public.skill_categories
  FOR DELETE TO authenticated
  USING (public.is_admin() AND status = 'draft');

-- SKILLS
DROP POLICY IF EXISTS skills_public_select ON public.skills;
CREATE POLICY skills_public_select ON public.skills
  FOR SELECT TO anon, authenticated
  USING (is_current_published = true AND is_tombstone = false);

DROP POLICY IF EXISTS skills_admin_select ON public.skills;
CREATE POLICY skills_admin_select ON public.skills
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS skills_admin_insert ON public.skills;
CREATE POLICY skills_admin_insert ON public.skills
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND status = 'draft');

DROP POLICY IF EXISTS skills_admin_update ON public.skills;
CREATE POLICY skills_admin_update ON public.skills
  FOR UPDATE TO authenticated
  USING (public.is_admin() AND status = 'draft')
  WITH CHECK (public.is_admin() AND status = 'draft');

DROP POLICY IF EXISTS skills_admin_delete ON public.skills;
CREATE POLICY skills_admin_delete ON public.skills
  FOR DELETE TO authenticated
  USING (public.is_admin() AND status = 'draft');

-- EXPERIENCES
DROP POLICY IF EXISTS experiences_public_select ON public.experiences;
CREATE POLICY experiences_public_select ON public.experiences
  FOR SELECT TO anon, authenticated
  USING (is_current_published = true AND is_tombstone = false);

DROP POLICY IF EXISTS experiences_admin_select ON public.experiences;
CREATE POLICY experiences_admin_select ON public.experiences
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS experiences_admin_insert ON public.experiences;
CREATE POLICY experiences_admin_insert ON public.experiences
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND status = 'draft');

DROP POLICY IF EXISTS experiences_admin_update ON public.experiences;
CREATE POLICY experiences_admin_update ON public.experiences
  FOR UPDATE TO authenticated
  USING (public.is_admin() AND status = 'draft')
  WITH CHECK (public.is_admin() AND status = 'draft');

DROP POLICY IF EXISTS experiences_admin_delete ON public.experiences;
CREATE POLICY experiences_admin_delete ON public.experiences
  FOR DELETE TO authenticated
  USING (public.is_admin() AND status = 'draft');

-- CERTIFICATIONS
DROP POLICY IF EXISTS certifications_public_select ON public.certifications;
CREATE POLICY certifications_public_select ON public.certifications
  FOR SELECT TO anon, authenticated
  USING (is_current_published = true AND is_tombstone = false);

DROP POLICY IF EXISTS certifications_admin_select ON public.certifications;
CREATE POLICY certifications_admin_select ON public.certifications
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS certifications_admin_insert ON public.certifications;
CREATE POLICY certifications_admin_insert ON public.certifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND status = 'draft');

DROP POLICY IF EXISTS certifications_admin_update ON public.certifications;
CREATE POLICY certifications_admin_update ON public.certifications
  FOR UPDATE TO authenticated
  USING (public.is_admin() AND status = 'draft')
  WITH CHECK (public.is_admin() AND status = 'draft');

DROP POLICY IF EXISTS certifications_admin_delete ON public.certifications;
CREATE POLICY certifications_admin_delete ON public.certifications
  FOR DELETE TO authenticated
  USING (public.is_admin() AND status = 'draft');

-- SITE SETTINGS
DROP POLICY IF EXISTS settings_public_select ON public.site_settings;
CREATE POLICY settings_public_select ON public.site_settings
  FOR SELECT TO anon, authenticated
  USING (is_current_published = true AND is_tombstone = false);

DROP POLICY IF EXISTS settings_admin_select ON public.site_settings;
CREATE POLICY settings_admin_select ON public.site_settings
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS settings_admin_insert ON public.site_settings;
CREATE POLICY settings_admin_insert ON public.site_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND status = 'draft');

DROP POLICY IF EXISTS settings_admin_update ON public.site_settings;
CREATE POLICY settings_admin_update ON public.site_settings
  FOR UPDATE TO authenticated
  USING (public.is_admin() AND status = 'draft')
  WITH CHECK (public.is_admin() AND status = 'draft');

DROP POLICY IF EXISTS settings_admin_delete ON public.site_settings;
CREATE POLICY settings_admin_delete ON public.site_settings
  FOR DELETE TO authenticated
  USING (false); -- Singleton entity cannot be deleted

-- MEDIA ASSETS (Private storage model)
DROP POLICY IF EXISTS media_public_select ON public.media_assets;
CREATE POLICY media_public_select ON public.media_assets
  FOR SELECT TO anon, authenticated
  USING (is_current_published = true AND is_public = true AND is_tombstone = false);

DROP POLICY IF EXISTS media_admin_select ON public.media_assets;
CREATE POLICY media_admin_select ON public.media_assets
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS media_admin_insert ON public.media_assets;
CREATE POLICY media_admin_insert ON public.media_assets
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND status = 'draft');

DROP POLICY IF EXISTS media_admin_update ON public.media_assets;
CREATE POLICY media_admin_update ON public.media_assets
  FOR UPDATE TO authenticated
  USING (public.is_admin() AND status = 'draft')
  WITH CHECK (public.is_admin() AND status = 'draft');

DROP POLICY IF EXISTS media_admin_delete ON public.media_assets;
CREATE POLICY media_admin_delete ON public.media_assets
  FOR DELETE TO authenticated
  USING (public.is_admin() AND status = 'draft');

-- 5. Policies: publication_snapshots (Managed strictly via RPCs)
DROP POLICY IF EXISTS snapshots_select ON public.publication_snapshots;
CREATE POLICY snapshots_select ON public.publication_snapshots
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS snapshots_insert_deny ON public.publication_snapshots;
CREATE POLICY snapshots_insert_deny ON public.publication_snapshots
  FOR INSERT TO anon, authenticated WITH CHECK (false);

DROP POLICY IF EXISTS snapshots_update_deny ON public.publication_snapshots;
CREATE POLICY snapshots_update_deny ON public.publication_snapshots
  FOR UPDATE TO anon, authenticated USING (false);

DROP POLICY IF EXISTS snapshots_delete_deny ON public.publication_snapshots;
CREATE POLICY snapshots_delete_deny ON public.publication_snapshots
  FOR DELETE TO anon, authenticated USING (false);

-- 6. Policies: audit_logs (Strictly append-only; client direct modifications blocked)
DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS audit_logs_insert_deny ON public.audit_logs;
CREATE POLICY audit_logs_insert_deny ON public.audit_logs
  FOR INSERT TO anon, authenticated WITH CHECK (false);

DROP POLICY IF EXISTS audit_logs_update_deny ON public.audit_logs;
CREATE POLICY audit_logs_update_deny ON public.audit_logs
  FOR UPDATE TO anon, authenticated USING (false);

DROP POLICY IF EXISTS audit_logs_delete_deny ON public.audit_logs;
CREATE POLICY audit_logs_delete_deny ON public.audit_logs
  FOR DELETE TO anon, authenticated USING (false);

-- 7. Storage Policies: private bucket 'portfolio-storage'
-- Direct public anonymous access is completely blocked (public = false).
-- Only active administrators can read or write directly to the bucket.
DROP POLICY IF EXISTS "storage_admin_select" ON storage.objects;
CREATE POLICY "storage_admin_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'portfolio-storage' AND public.is_admin());

DROP POLICY IF EXISTS "storage_admin_insert" ON storage.objects;
CREATE POLICY "storage_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'portfolio-storage' AND public.is_admin());

DROP POLICY IF EXISTS "storage_admin_update" ON storage.objects;
CREATE POLICY "storage_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'portfolio-storage' AND public.is_admin());

DROP POLICY IF EXISTS "storage_admin_delete" ON storage.objects;
CREATE POLICY "storage_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'portfolio-storage' AND public.is_admin());
