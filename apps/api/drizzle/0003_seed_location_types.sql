-- Reference data the app needs from day one; new types are added as rows by an admin.
INSERT INTO location_types (code, name, sort_order) VALUES
  ('HQ', 'Centrála', 1),
  ('STORE', 'Prodejna', 2),
  ('SITE', 'Provozovna', 3),
  ('WAREHOUSE', 'Sklad', 4);
