-- Priority is unique per manufacturer. Deferred to COMMIT so a reorder can swap priorities or
-- replace the whole list in one transaction without tripping over intermediate duplicates.
ALTER TABLE manufacturer_service_providers
  ADD CONSTRAINT manufacturer_service_providers_manufacturer_priority_key
  UNIQUE (manufacturer_id, priority) DEFERRABLE INITIALLY DEFERRED;
