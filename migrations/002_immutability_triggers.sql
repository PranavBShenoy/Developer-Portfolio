-- Migration 002: Immutability Triggers and Authorization Context
-- Author: Pranav Shenoy Portfolio CMS
-- Description: Unforgeable publishing context, strict version immutability, and operation-scoped token verification.

-- 1. Private security schema for transaction-bound publishing context
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO postgres;

-- 2. Transaction-bound authorization context table
CREATE TABLE IF NOT EXISTS private.authorized_publication_context (
  tx_id BIGINT PRIMARY KEY,
  authorized_admin_id UUID NOT NULL,
  token_hash BYTEA NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('PUBLISH', 'ROLLBACK')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed BOOLEAN NOT NULL DEFAULT false
);
REVOKE ALL ON TABLE private.authorized_publication_context FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE private.authorized_publication_context TO postgres;

-- 3. Content version immutability trigger function
CREATE OR REPLACE FUNCTION public.enforce_content_version_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, private, pg_temp
AS $$
DECLARE
  v_token_raw TEXT;
  v_stored_admin_id UUID;
  v_stored_hash BYTEA;
  v_operation_type TEXT;
  v_expires_at TIMESTAMPTZ;
  v_consumed BOOLEAN;
  v_caller_auth_uid UUID;
  v_is_publishing_transition BOOLEAN;
BEGIN
  -- A. Prevent physical deletion of published, archived, or tombstoned records
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published', 'archived', 'tombstone') THEN
      RAISE EXCEPTION 'DELETE_IMMUTABLE_DENIED: Published, archived, and tombstoned versions cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;

  -- B. Prevent any mutation of archived or tombstoned versions
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'archived' THEN
      RAISE EXCEPTION 'ARCHIVED_IMMUTABLE: Archived records are permanently immutable.';
    END IF;
    IF OLD.status = 'tombstone' THEN
      RAISE EXCEPTION 'TOMBSTONE_IMMUTABLE: Tombstone records are permanently immutable.';
    END IF;

    -- C. Detect transitions into or out of published/tombstone state
    v_is_publishing_transition := (
      (OLD.status != 'published' AND NEW.status = 'published') OR
      (OLD.status = 'published' AND NEW.status != 'published') OR
      (OLD.is_current_published != NEW.is_current_published) OR
      (OLD.status = 'draft' AND NEW.status = 'tombstone')
    );

    IF v_is_publishing_transition THEN
      -- 1. Fetch cryptographic context bound to current transaction
      SELECT authorized_admin_id, token_hash, operation_type, expires_at, consumed
      INTO v_stored_admin_id, v_stored_hash, v_operation_type, v_expires_at, v_consumed
      FROM private.authorized_publication_context
      WHERE tx_id = txid_current();

      IF v_stored_hash IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_PUBLISHED_MUTATION: Transitions into or out of published status require an active publication operation bound to this transaction.';
      END IF;

      -- 2. Replay check
      IF v_consumed THEN
        RAISE EXCEPTION 'TOKEN_ALREADY_CONSUMED: Publication authorization token has already been consumed.';
      END IF;

      -- 3. Expiration check
      IF clock_timestamp() > v_expires_at THEN
        RAISE EXCEPTION 'TOKEN_EXPIRED: Publication authorization token has expired.';
      END IF;

      -- 4. Token hash verification
      v_token_raw := current_setting('app.publish_auth_token', true);
      IF v_token_raw IS NULL OR v_token_raw = '' THEN
        RAISE EXCEPTION 'MISSING_TOKEN: Authorization token setting is missing.';
      END IF;

      IF extensions.digest(decode(v_token_raw, 'hex'), 'sha256') != v_stored_hash THEN
        RAISE EXCEPTION 'FORGED_TOKEN: Publishing authorization token verification failed.';
      END IF;

      -- 5. Authorized administrator identity verification
      v_caller_auth_uid := auth.uid();
      IF v_caller_auth_uid IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED: Publication operations require an authenticated admin identity.';
      END IF;

      IF v_stored_admin_id != (
        SELECT id FROM public.admin_users WHERE auth_user_id = v_caller_auth_uid AND is_active = true AND role = 'admin'
      ) THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN: Publishing token does not match the active authenticated administrator.';
      END IF;

      -- 6. Operation scope and permitted state transition check
      IF OLD.status = 'published' AND NEW.status = 'archived' THEN
        -- Demotion is permitted under either PUBLISH or ROLLBACK
        IF NEW.is_current_published != false THEN
          RAISE EXCEPTION 'INVALID_ARCHIVE_STATE: Archived records cannot remain current published.';
        END IF;

        -- Content immutability during archiving: No content fields may change
        IF (OLD.entity_id, OLD.version) IS DISTINCT FROM (NEW.entity_id, NEW.version) THEN
          RAISE EXCEPTION 'IDENTIFIER_ALTERATION_DENIED: Record entity_id and version are immutable.';
        END IF;

        -- Table-specific content columns immutability check
        IF TG_TABLE_NAME = 'projects' THEN
          IF (OLD.slug, OLD.title, OLD.category, OLD.summary, OLD.description, OLD.tags, OLD.repo_url, OLD.demo_url)
             IS DISTINCT FROM
             (NEW.slug, NEW.title, NEW.category, NEW.summary, NEW.description, NEW.tags, NEW.repo_url, NEW.demo_url) THEN
            RAISE EXCEPTION 'CONTENT_ALTERATION_DENIED: Project content columns cannot be modified when archiving.';
          END IF;
        ELSIF TG_TABLE_NAME = 'site_settings' THEN
          IF (OLD.profile_name, OLD.role_title, OLD.full_bio, OLD.email, OLD.github_url, OLD.linkedin_url)
             IS DISTINCT FROM
             (NEW.profile_name, NEW.role_title, NEW.full_bio, NEW.email, NEW.github_url, NEW.linkedin_url) THEN
            RAISE EXCEPTION 'CONTENT_ALTERATION_DENIED: Settings content columns cannot be modified when archiving.';
          END IF;
        ELSIF TG_TABLE_NAME = 'media_assets' THEN
          IF (OLD.storage_path, OLD.hash_sha256, OLD.mime_type, OLD.size_bytes, OLD.is_primary_resume)
             IS DISTINCT FROM
             (NEW.storage_path, NEW.hash_sha256, NEW.mime_type, NEW.size_bytes, NEW.is_primary_resume) THEN
            RAISE EXCEPTION 'CONTENT_ALTERATION_DENIED: Media asset content columns cannot be modified when archiving.';
          END IF;
        END IF;

      ELSIF OLD.status = 'draft' AND NEW.status = 'published' THEN
        -- Draft promotion is ONLY permitted under PUBLISH
        IF v_operation_type != 'PUBLISH' THEN
          RAISE EXCEPTION 'OPERATION_SCOPE_MISMATCH: A % token cannot authorize draft promotion. Only PUBLISH tokens are permitted.', v_operation_type;
        END IF;

        IF NEW.is_current_published != true OR NEW.is_tombstone != false THEN
          RAISE EXCEPTION 'INVALID_PUBLISHED_STATE: Published draft must have is_current_published=true and is_tombstone=false.';
        END IF;

      ELSIF OLD.status = 'draft' AND NEW.status = 'tombstone' THEN
        -- Tombstone promotion is ONLY permitted under PUBLISH
        IF v_operation_type != 'PUBLISH' THEN
          RAISE EXCEPTION 'OPERATION_SCOPE_MISMATCH: A % token cannot authorize tombstone promotion. Only PUBLISH tokens are permitted.', v_operation_type;
        END IF;

        IF NEW.is_current_published != false OR NEW.is_tombstone != true THEN
          RAISE EXCEPTION 'INVALID_TOMBSTONE_STATE: Tombstone must have is_current_published=false and is_tombstone=true.';
        END IF;

      ELSE
        RAISE EXCEPTION 'INVALID_STATE_TRANSITION: Invalid status transition from % to %.', OLD.status, NEW.status;
      END IF;

    ELSE
      -- D. Ordinary updates: Only drafts can be modified, and status must remain 'draft'
      IF OLD.status != 'draft' OR NEW.status != 'draft' OR NEW.is_current_published = true OR NEW.is_tombstone = true THEN
        RAISE EXCEPTION 'ORDINARY_UPDATE_RESTRICTION: Ordinary admin updates can only modify draft records and cannot alter publication status.';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- E. Direct inserts of published or tombstoned records (allowed ONLY during ROLLBACK restoration)
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'published' OR NEW.is_current_published = true OR NEW.status = 'tombstone' THEN
      -- Fetch cryptographic context for current transaction
      SELECT authorized_admin_id, token_hash, operation_type, expires_at, consumed
      INTO v_stored_admin_id, v_stored_hash, v_operation_type, v_expires_at, v_consumed
      FROM private.authorized_publication_context
      WHERE tx_id = txid_current();

      IF v_stored_hash IS NULL THEN
        RAISE EXCEPTION 'CANNOT_INSERT_PUBLISHED_DIRECTLY: Creating published records directly is prohibited.';
      END IF;

      -- Replay check
      IF v_consumed THEN
        RAISE EXCEPTION 'TOKEN_ALREADY_CONSUMED: Publication authorization token has already been consumed.';
      END IF;

      -- Expiration check
      IF clock_timestamp() > v_expires_at THEN
        RAISE EXCEPTION 'TOKEN_EXPIRED: Rollback authorization token has expired.';
      END IF;

      -- Token hash verification
      v_token_raw := current_setting('app.publish_auth_token', true);
      IF v_token_raw IS NULL OR v_token_raw = '' THEN
        RAISE EXCEPTION 'MISSING_TOKEN: Authorization token setting is missing.';
      END IF;

      IF extensions.digest(decode(v_token_raw, 'hex'), 'sha256') != v_stored_hash THEN
        RAISE EXCEPTION 'FORGED_TOKEN: Rollback authorization token verification failed.';
      END IF;

      -- Authorized administrator identity verification
      v_caller_auth_uid := auth.uid();
      IF v_caller_auth_uid IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED: Rollback operations require an authenticated admin identity.';
      END IF;

      IF v_stored_admin_id != (
        SELECT id FROM public.admin_users WHERE auth_user_id = v_caller_auth_uid AND is_active = true AND role = 'admin'
      ) THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN: Rollback token does not match the active authenticated administrator.';
      END IF;

      -- Operation scope check: ONLY ROLLBACK is permitted to insert published or tombstone records
      IF v_operation_type != 'ROLLBACK' THEN
        RAISE EXCEPTION 'OPERATION_SCOPE_MISMATCH: A % token cannot authorize record restoration inserts. Only ROLLBACK tokens are permitted.', v_operation_type;
      END IF;
    END IF;

    -- Direct insert of archived records is strictly prohibited under any token
    IF NEW.status = 'archived' THEN
      RAISE EXCEPTION 'CANNOT_INSERT_ARCHIVED: Direct creation of archived records is prohibited.';
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_content_version_immutability() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_content_version_immutability() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_content_version_immutability() TO postgres, authenticated, service_role;

-- 4. Attach immutability trigger to all content tables
DROP TRIGGER IF EXISTS trg_immutability_projects ON public.projects;
CREATE TRIGGER trg_immutability_projects
  BEFORE INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_content_version_immutability();

DROP TRIGGER IF EXISTS trg_immutability_skills ON public.skills;
CREATE TRIGGER trg_immutability_skills
  BEFORE INSERT OR UPDATE OR DELETE ON public.skills
  FOR EACH ROW EXECUTE FUNCTION public.enforce_content_version_immutability();

DROP TRIGGER IF EXISTS trg_immutability_categories ON public.skill_categories;
CREATE TRIGGER trg_immutability_categories
  BEFORE INSERT OR UPDATE OR DELETE ON public.skill_categories
  FOR EACH ROW EXECUTE FUNCTION public.enforce_content_version_immutability();

DROP TRIGGER IF EXISTS trg_immutability_experiences ON public.experiences;
CREATE TRIGGER trg_immutability_experiences
  BEFORE INSERT OR UPDATE OR DELETE ON public.experiences
  FOR EACH ROW EXECUTE FUNCTION public.enforce_content_version_immutability();

DROP TRIGGER IF EXISTS trg_immutability_certifications ON public.certifications;
CREATE TRIGGER trg_immutability_certifications
  BEFORE INSERT OR UPDATE OR DELETE ON public.certifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_content_version_immutability();

DROP TRIGGER IF EXISTS trg_immutability_settings ON public.site_settings;
CREATE TRIGGER trg_immutability_settings
  BEFORE INSERT OR UPDATE OR DELETE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_content_version_immutability();

DROP TRIGGER IF EXISTS trg_immutability_media ON public.media_assets;
CREATE TRIGGER trg_immutability_media
  BEFORE INSERT OR UPDATE OR DELETE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_content_version_immutability();

-- 5. Immutability trigger for audit logs and snapshots
CREATE OR REPLACE FUNCTION public.enforce_append_only_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_LOG_DENIED: Log entries and snapshots cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_immutability();

DROP TRIGGER IF EXISTS trg_snapshots_immutable ON public.publication_snapshots;
CREATE TRIGGER trg_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.publication_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_immutability();
