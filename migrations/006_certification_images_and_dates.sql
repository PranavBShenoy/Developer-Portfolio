-- Migration 006: Certification Images, Dates, and Credential URLs
-- Author: Pranav Shenoy Portfolio CMS
-- Description: Adds certificate_image_url, date, and credential_url columns to public.certifications
--              and updates rollback_to_snapshot to restore these fields on snapshot rollback.

-- 1. Add columns to public.certifications
ALTER TABLE public.certifications
  ADD COLUMN IF NOT EXISTS certificate_image_url TEXT,
  ADD COLUMN IF NOT EXISTS date TEXT,
  ADD COLUMN IF NOT EXISTS credential_url TEXT;

COMMENT ON COLUMN public.certifications.certificate_image_url IS 'Internal storage or public media reference for the uploaded certificate image';
COMMENT ON COLUMN public.certifications.date IS 'Issuance date or period (e.g. MAY 2024, JAN 2024)';
COMMENT ON COLUMN public.certifications.credential_url IS 'External verification or credential link';

-- 2. Update rollback_to_snapshot RPC to support restoring certificate image and date
CREATE OR REPLACE FUNCTION public.rollback_to_snapshot(
  p_target_version INT,
  p_expected_current_version INT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, private, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_admin_user_id UUID;
  v_current_version INT;
  v_new_version INT;
  v_snapshot JSONB;
  v_token BYTEA;
  v_new_snapshot_data JSONB;
  r RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Direct service-role or unauthenticated execution is forbidden.';
  END IF;

  SELECT id INTO v_admin_user_id
  FROM public.admin_users
  WHERE auth_user_id = v_caller_id AND is_active = true AND role IN ('admin', 'superadmin');

  IF v_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Current session does not hold active administrator privileges.';
  END IF;

  SELECT snapshot_data INTO v_snapshot
  FROM public.publication_snapshots
  WHERE version = p_target_version;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_FOUND: Publication snapshot version % does not exist.', p_target_version;
  END IF;

  SELECT COALESCE(MAX(version), 0) INTO v_current_version FROM public.publication_snapshots;
  IF v_current_version != p_expected_current_version THEN
    RAISE EXCEPTION 'STALE_BASE_VERSION: Current live version is %, but client expected %', v_current_version, p_expected_current_version;
  END IF;

  v_token := extensions.gen_random_bytes(32);
  INSERT INTO private.authorized_publication_context (
    tx_id, authorized_admin_id, token_hash, operation_type, expires_at
  ) VALUES (
    txid_current(), v_admin_user_id, extensions.digest(v_token, 'sha256'), 'ROLLBACK', clock_timestamp() + interval '60 seconds'
  );
  PERFORM set_config('app.publish_auth_token', encode(v_token, 'hex'), true);

  UPDATE public.projects SET is_current_published = false, status = 'archived', updated_at = clock_timestamp() WHERE is_current_published = true;
  UPDATE public.skills SET is_current_published = false, status = 'archived', updated_at = clock_timestamp() WHERE is_current_published = true;
  UPDATE public.skill_categories SET is_current_published = false, status = 'archived', updated_at = clock_timestamp() WHERE is_current_published = true;
  UPDATE public.experiences SET is_current_published = false, status = 'archived', updated_at = clock_timestamp() WHERE is_current_published = true;
  UPDATE public.certifications SET is_current_published = false, status = 'archived', updated_at = clock_timestamp() WHERE is_current_published = true;
  UPDATE public.site_settings SET is_current_published = false, status = 'archived', updated_at = clock_timestamp() WHERE is_current_published = true;
  UPDATE public.media_assets SET is_current_published = false, status = 'archived' WHERE is_current_published = true;

  -- Restore Site Settings
  IF v_snapshot->'site_settings' IS NOT NULL THEN
    FOR r IN SELECT * FROM jsonb_to_record(v_snapshot->'site_settings') AS (
      entity_id UUID, profile_name TEXT, role_title TEXT, eyebrow_bio TEXT, full_bio TEXT,
      email TEXT, github_url TEXT, linkedin_url TEXT, avatar_url TEXT, resume_url TEXT,
      cgpa NUMERIC, class_12_pct NUMERIC, class_10_pct NUMERIC
    ) LOOP
      INSERT INTO public.site_settings (
        entity_id, version, status, is_current_published, is_tombstone,
        profile_name, role_title, eyebrow_bio, full_bio, email, github_url, linkedin_url,
        avatar_url, resume_url, cgpa, class_12_pct, class_10_pct, published_at, updated_at
      ) VALUES (
        r.entity_id, (SELECT COALESCE(MAX(version), 0) + 1 FROM public.site_settings WHERE entity_id = r.entity_id),
        'published', true, false,
        r.profile_name, r.role_title, r.eyebrow_bio, r.full_bio, r.email, r.github_url, r.linkedin_url,
        r.avatar_url, r.resume_url, r.cgpa, r.class_12_pct, r.class_10_pct, clock_timestamp(), clock_timestamp()
      );
    END LOOP;
  END IF;

  -- Restore Skill Categories
  IF v_snapshot->'skill_categories' IS NOT NULL THEN
    FOR r IN SELECT * FROM jsonb_to_recordset(v_snapshot->'skill_categories') AS (
      entity_id UUID, category_number TEXT, name TEXT, display_order INT
    ) LOOP
      INSERT INTO public.skill_categories (
        entity_id, version, status, is_current_published, is_tombstone,
        category_number, name, display_order, published_at, updated_at
      ) VALUES (
        r.entity_id, (SELECT COALESCE(MAX(version), 0) + 1 FROM public.skill_categories WHERE entity_id = r.entity_id),
        'published', true, false,
        r.category_number, r.name, r.display_order, clock_timestamp(), clock_timestamp()
      );
    END LOOP;
  END IF;

  -- Restore Skills
  IF v_snapshot->'skills' IS NOT NULL THEN
    FOR r IN SELECT * FROM jsonb_to_recordset(v_snapshot->'skills') AS (
      entity_id UUID, category_entity_id UUID, name TEXT, display_order INT
    ) LOOP
      INSERT INTO public.skills (
        entity_id, category_entity_id, version, status, is_current_published, is_tombstone,
        name, display_order, published_at, updated_at
      ) VALUES (
        r.entity_id, r.category_entity_id, (SELECT COALESCE(MAX(version), 0) + 1 FROM public.skills WHERE entity_id = r.entity_id),
        'published', true, false,
        r.name, r.display_order, clock_timestamp(), clock_timestamp()
      );
    END LOOP;
  END IF;

  -- Restore Projects
  IF v_snapshot->'projects' IS NOT NULL THEN
    FOR r IN SELECT * FROM jsonb_to_recordset(v_snapshot->'projects') AS (
      entity_id UUID, slug TEXT, title TEXT, project_number TEXT, category TEXT, summary TEXT,
      description TEXT, tags TEXT[], repo_url TEXT, demo_url TEXT, preview_type TEXT, preview_data JSONB,
      display_order INT, is_featured BOOLEAN, is_wide BOOLEAN, is_concept BOOLEAN
    ) LOOP
      INSERT INTO public.projects (
        entity_id, version, status, is_current_published, is_tombstone,
        slug, title, project_number, category, summary, description,
        tags, repo_url, demo_url, preview_type, preview_data,
        display_order, is_featured, is_wide, is_concept, published_at, updated_at
      ) VALUES (
        r.entity_id, (SELECT COALESCE(MAX(version), 0) + 1 FROM public.projects WHERE entity_id = r.entity_id),
        'published', true, false,
        r.slug, r.title, r.project_number, r.category, r.summary, r.description,
        r.tags, r.repo_url, r.demo_url, r.preview_type, r.preview_data,
        r.display_order, r.is_featured, r.is_wide, r.is_concept, clock_timestamp(), clock_timestamp()
      );
    END LOOP;
  END IF;

  -- Restore Experiences
  IF v_snapshot->'experiences' IS NOT NULL THEN
    FOR r IN SELECT * FROM jsonb_to_recordset(v_snapshot->'experiences') AS (
      entity_id UUID, company TEXT, role TEXT, subtitle TEXT, description TEXT,
      period_label TEXT, symbol TEXT, tags TEXT[], display_order INT
    ) LOOP
      INSERT INTO public.experiences (
        entity_id, version, status, is_current_published, is_tombstone,
        company, role, subtitle, description, period_label, symbol, tags, display_order, published_at, updated_at
      ) VALUES (
        r.entity_id, (SELECT COALESCE(MAX(version), 0) + 1 FROM public.experiences WHERE entity_id = r.entity_id),
        'published', true, false,
        r.company, r.role, r.subtitle, r.description, r.period_label, r.symbol, r.tags, r.display_order, clock_timestamp(), clock_timestamp()
      );
    END LOOP;
  END IF;

  -- Restore Certifications (with certificate_image_url, date, credential_url support)
  IF v_snapshot->'certifications' IS NOT NULL THEN
    FOR r IN SELECT * FROM jsonb_to_recordset(v_snapshot->'certifications') AS (
      entity_id UUID, title TEXT, issuer TEXT, mark TEXT, url TEXT, display_order INT,
      certificate_image_url TEXT, date TEXT, credential_url TEXT
    ) LOOP
      INSERT INTO public.certifications (
        entity_id, version, status, is_current_published, is_tombstone,
        title, issuer, mark, url, display_order, certificate_image_url, date, credential_url, published_at, updated_at
      ) VALUES (
        r.entity_id, (SELECT COALESCE(MAX(version), 0) + 1 FROM public.certifications WHERE entity_id = r.entity_id),
        'published', true, false,
        r.title, r.issuer, r.mark, r.url, r.display_order, r.certificate_image_url, r.date, r.credential_url, clock_timestamp(), clock_timestamp()
      );
    END LOOP;
  END IF;

  -- Restore Media Assets
  IF v_snapshot->'media_assets' IS NOT NULL THEN
    FOR r IN SELECT * FROM jsonb_to_recordset(v_snapshot->'media_assets') AS (
      entity_id UUID, filename TEXT, storage_path TEXT, bucket TEXT, mime_type TEXT,
      size_bytes BIGINT, hash_sha256 TEXT, alt_text TEXT, is_public BOOLEAN, is_primary_resume BOOLEAN
    ) LOOP
      INSERT INTO public.media_assets (
        entity_id, version, status, is_current_published, is_tombstone, is_primary_resume,
        filename, storage_path, bucket, mime_type, size_bytes, hash_sha256, alt_text, is_public, published_at
      ) VALUES (
        r.entity_id, (SELECT COALESCE(MAX(version), 0) + 1 FROM public.media_assets WHERE entity_id = r.entity_id),
        'published', true, false, COALESCE(r.is_primary_resume, false),
        r.filename, r.storage_path, r.bucket, r.mime_type, r.size_bytes, r.hash_sha256, r.alt_text, r.is_public, clock_timestamp()
      );
    END LOOP;
  END IF;

  -- Tombstone records created after snapshot
  INSERT INTO public.projects (entity_id, version, status, is_current_published, is_tombstone, slug, title, project_number, category, summary, preview_type, display_order)
  SELECT p.entity_id, (SELECT COALESCE(MAX(version), 0) + 1 FROM public.projects WHERE entity_id = p.entity_id),
         'tombstone', false, true, p.slug, p.title, p.project_number, p.category, p.summary, p.preview_type, p.display_order
  FROM (SELECT DISTINCT entity_id, slug, title, project_number, category, summary, preview_type, display_order FROM public.projects) p
  WHERE p.entity_id NOT IN (SELECT (x->>'entity_id')::uuid FROM jsonb_array_elements(v_snapshot->'projects') x)
    AND NOT EXISTS (SELECT 1 FROM public.projects curr WHERE curr.entity_id = p.entity_id AND curr.is_tombstone = true AND curr.is_current_published = false);

  -- Capture new monotonic snapshot
  v_new_version := v_current_version + 1;
  SELECT jsonb_build_object(
    'version', v_new_version,
    'site_settings', (SELECT row_to_json(s) FROM public.site_settings s WHERE is_current_published = true AND is_tombstone = false),
    'projects', (SELECT jsonb_agg(row_to_json(p)) FROM public.projects p WHERE is_current_published = true AND is_tombstone = false),
    'skills', (SELECT jsonb_agg(row_to_json(sk)) FROM public.skills sk WHERE is_current_published = true AND is_tombstone = false),
    'skill_categories', (SELECT jsonb_agg(row_to_json(sc)) FROM public.skill_categories sc WHERE is_current_published = true AND is_tombstone = false),
    'experiences', (SELECT jsonb_agg(row_to_json(e)) FROM public.experiences e WHERE is_current_published = true AND is_tombstone = false),
    'certifications', (SELECT jsonb_agg(row_to_json(c)) FROM public.certifications c WHERE is_current_published = true AND is_tombstone = false),
    'media_assets', (SELECT jsonb_agg(row_to_json(m)) FROM public.media_assets m WHERE is_current_published = true AND is_tombstone = false)
  ) INTO v_new_snapshot_data;

  INSERT INTO public.publication_snapshots (version, snapshot_data, published_by, notes)
  VALUES (v_new_version, v_new_snapshot_data, v_admin_user_id, format('Rollback to version %s: %s', p_target_version, COALESCE(p_reason, 'No reason specified')));

  INSERT INTO public.audit_logs (auth_user_id, action, entity_type, entity_id, details)
  VALUES (
    v_admin_user_id, 'ROLLBACK', 'publication_snapshot', v_new_version::text,
    jsonb_build_object('restored_from_version', p_target_version, 'new_version', v_new_version, 'reason', p_reason)
  );

  UPDATE private.authorized_publication_context SET consumed = true WHERE tx_id = txid_current();
  PERFORM set_config('app.publish_auth_token', '', true);

  RETURN jsonb_build_object(
    'success', true,
    'previous_version', v_current_version,
    'new_version', v_new_version,
    'restored_from_version', p_target_version
  );
END;
$$;
