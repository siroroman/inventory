-- Objects the generated schema (0001) depends on. Later migrations add one database rule each.
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint

-- unaccent() is only STABLE; an IMMUTABLE wrapper is required for expression indexes.
CREATE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN public.unaccent('public.unaccent'::regdictionary, $1);
--> statement-breakpoint

-- Pads to at least `width` digits but never truncates: LOC-004, LOC-1000.
CREATE FUNCTION format_code(prefix text, n bigint, width integer) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN prefix || '-' || lpad(n::text, greatest(width, length(n::text)), '0');
--> statement-breakpoint

-- Roles are cluster-wide, so creation is idempotent. The app's login role is made a member outside
-- migrations (docker/db-init locally; GRANT app_runtime TO <app user> on Cloud SQL).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
END
$$;
