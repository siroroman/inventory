-- Code sequences belong to their columns (TRUNCATE ... RESTART IDENTITY resets them).
ALTER SEQUENCE location_code_seq OWNED BY locations.code;
--> statement-breakpoint
ALTER SEQUENCE item_code_seq OWNED BY items.code;
--> statement-breakpoint
ALTER SEQUENCE service_provider_code_seq OWNED BY service_providers.code;
--> statement-breakpoint

-- Least privilege for the API: no DDL, no hard deletes of records, audit log is insert-only.
-- A new table must be granted in its migration; test/db/privileges.test.ts fails until it is.
GRANT USAGE ON SCHEMA public TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON location_types, locations, items, manufacturers, service_providers, "user"
  TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON item_external_ids, item_photos, manufacturer_service_providers, session, account, verification
  TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO app_runtime;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE location_code_seq, item_code_seq, service_provider_code_seq, audit_log_id_seq
  TO app_runtime;
