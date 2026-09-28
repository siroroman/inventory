-- Czech sort order for every human-facing name, so a plain ORDER BY name sorts correctly
-- (Č after C, "ch" after h, Ř after R, Š after S, Ž last).
CREATE COLLATION IF NOT EXISTS cs_cz (provider = icu, locale = 'cs-CZ');
--> statement-breakpoint
ALTER TABLE location_types ALTER COLUMN name TYPE text COLLATE cs_cz;
--> statement-breakpoint
ALTER TABLE locations ALTER COLUMN name TYPE text COLLATE cs_cz;
--> statement-breakpoint
ALTER TABLE items ALTER COLUMN name TYPE text COLLATE cs_cz;
--> statement-breakpoint
ALTER TABLE manufacturers ALTER COLUMN name TYPE text COLLATE cs_cz;
--> statement-breakpoint
ALTER TABLE service_providers ALTER COLUMN name TYPE text COLLATE cs_cz;
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN name TYPE text COLLATE cs_cz;
--> statement-breakpoint

-- Diacritics- and case-insensitive substring search. Queries must use the same expression:
-- f_unaccent(lower(col)) LIKE '%' || f_unaccent(lower($q)) || '%'
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX items_name_trgm_idx ON items USING gin (f_unaccent(lower(name)) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX items_code_trgm_idx ON items USING gin (f_unaccent(lower(code)) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX items_serial_number_trgm_idx ON items USING gin (f_unaccent(lower(serial_number)) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX items_model_trgm_idx ON items USING gin (f_unaccent(lower(model)) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX item_external_ids_value_trgm_idx ON item_external_ids USING gin (f_unaccent(lower(value)) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX manufacturers_name_trgm_idx ON manufacturers USING gin (f_unaccent(lower(name)) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX locations_name_trgm_idx ON locations USING gin (f_unaccent(lower(name)) gin_trgm_ops);
