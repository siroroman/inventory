-- Better Auth counts sign-in attempts per client address here and deletes the rows of windows
-- that have passed, so the API may delete too. The counts are not records: nothing is archived.
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit TO app_runtime;
