-- Document names sort in Czech order like the other human-facing names (see 0008).
ALTER TABLE service_record_documents ALTER COLUMN name TYPE text COLLATE cs_cz;
