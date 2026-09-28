-- Local/test only. In Cloud SQL, create the app user separately and run: GRANT app_runtime TO <app user>;
-- app_runtime is also created (idempotently) by the first migration; its privileges are granted there.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'inventory_app') THEN
    CREATE ROLE inventory_app LOGIN PASSWORD 'inventory_app' IN ROLE app_runtime;
  END IF;
END $$;
