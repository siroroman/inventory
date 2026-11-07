-- A contact's name is human-facing like every other name column, so it compares in Czech order (see 0008).
ALTER TABLE location_contacts ALTER COLUMN name TYPE text COLLATE cs_cz;
