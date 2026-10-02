-- Service records are archived, never deleted: no DELETE for the runtime role.
GRANT SELECT, INSERT, UPDATE ON service_records TO app_runtime;
--> statement-breakpoint
CREATE TRIGGER service_records_touch_row BEFORE UPDATE ON service_records
  FOR EACH ROW EXECUTE FUNCTION touch_row();
