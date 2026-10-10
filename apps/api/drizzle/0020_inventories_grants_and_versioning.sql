-- Runs and their rows are never deleted (a run ends as finished or cancelled, an unticked row stays
-- hidden): no DELETE for the runtime role. UPDATE is also what SELECT ... FOR UPDATE needs.
GRANT SELECT, INSERT, UPDATE ON inventories, inventory_items TO app_runtime;
--> statement-breakpoint
-- Only the run is versioned (finish and cancel send the version). Checks update inventory_items
-- and must not bump it, so that table has no trigger.
CREATE TRIGGER inventories_touch_row BEFORE UPDATE ON inventories
  FOR EACH ROW EXECUTE FUNCTION touch_row();
