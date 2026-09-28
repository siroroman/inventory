-- The database owns updated_at and version, so optimistic locking cannot silently break:
-- repositories update with `WHERE version = $expected` and never set either column.
CREATE FUNCTION touch_row() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER location_types_touch_row BEFORE UPDATE ON location_types
  FOR EACH ROW EXECUTE FUNCTION touch_row();
--> statement-breakpoint
CREATE TRIGGER locations_touch_row BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION touch_row();
--> statement-breakpoint
CREATE TRIGGER items_touch_row BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION touch_row();
--> statement-breakpoint
CREATE TRIGGER manufacturers_touch_row BEFORE UPDATE ON manufacturers
  FOR EACH ROW EXECUTE FUNCTION touch_row();
--> statement-breakpoint
CREATE TRIGGER service_providers_touch_row BEFORE UPDATE ON service_providers
  FOR EACH ROW EXECUTE FUNCTION touch_row();
