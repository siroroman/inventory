-- The Údržba list searches record titles; same expression as the other search indexes (see 0008).
CREATE INDEX service_records_title_trgm_idx ON service_records USING gin (f_unaccent(lower(title)) gin_trgm_ops);
