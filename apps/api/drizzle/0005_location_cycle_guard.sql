-- A location must never become its own ancestor: a cycle would make every recursive tree query
-- loop. The service checks this too; the trigger also covers concurrent moves and direct SQL.
-- Relies on READ COMMITTED: after taking the lock, the ancestor walk sees moves committed meanwhile.
CREATE FUNCTION prevent_location_cycle() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NULL OR NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN
    RETURN NEW;
  END IF;

  -- Serializes tree moves, so two concurrent moves cannot each pass the check and form a cycle.
  PERFORM pg_advisory_xact_lock(hashtext('locations_tree'));

  IF EXISTS (
    WITH RECURSIVE ancestors (id, parent_id) AS (
      SELECT l.id, l.parent_id FROM locations l WHERE l.id = NEW.parent_id
      UNION
      SELECT l.id, l.parent_id FROM locations l JOIN ancestors a ON l.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE ancestors.id = NEW.id
  ) THEN
    RAISE EXCEPTION 'location % cannot move under its own descendant %', NEW.id, NEW.parent_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'locations_no_cycle', TABLE = 'locations';
  END IF;

  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER locations_prevent_cycle BEFORE UPDATE OF parent_id ON locations
  FOR EACH ROW EXECUTE FUNCTION prevent_location_cycle();
