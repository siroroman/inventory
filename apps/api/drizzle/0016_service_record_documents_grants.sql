-- Documents are deleted for real (the row, then the file), unlike the records they belong to.
GRANT SELECT, INSERT, UPDATE, DELETE ON service_record_documents TO app_runtime;
--> statement-breakpoint
CREATE TRIGGER service_record_documents_touch_row BEFORE UPDATE ON service_record_documents
  FOR EACH ROW EXECUTE FUNCTION touch_row();
