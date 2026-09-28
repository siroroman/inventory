-- History must not be rewritten. app_runtime already lacks UPDATE/DELETE on audit_log; this trigger
-- also stops the owner (e.g. a manual fix or a buggy migration). TRUNCATE is left to the owner.
CREATE FUNCTION audit_log_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only'
    USING ERRCODE = 'restrict_violation', CONSTRAINT = 'audit_log_append_only', TABLE = 'audit_log';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
