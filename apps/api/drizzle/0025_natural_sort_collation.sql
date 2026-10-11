-- Czech order with numbers compared by value (kn = numeric ordering), for IDs such as INV-9-100
-- and INV-73-2023016: INV-9-100 comes before INV-73-... instead of after it. Used in ORDER BY only.
CREATE COLLATION IF NOT EXISTS cs_cz_numeric (provider = icu, locale = 'cs-CZ-u-kn-true', deterministic = true);
