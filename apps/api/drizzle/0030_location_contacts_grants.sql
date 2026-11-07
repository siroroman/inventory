-- A location's contacts are replaced as a whole list on every save (like an item's external IDs),
-- so the API deletes the old rows; the audit log keeps what they were.
GRANT SELECT, INSERT, UPDATE, DELETE ON location_contacts TO app_runtime;
