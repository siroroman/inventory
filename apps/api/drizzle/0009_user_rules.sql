-- Rules Better Auth's generated schema cannot express; kept here so `auth:generate` never drops them.
ALTER TABLE "user" ADD CONSTRAINT user_role_valid CHECK (role IN ('read', 'write', 'admin'));
--> statement-breakpoint
-- The login name is the email; two accounts must not differ only in letter case.
CREATE UNIQUE INDEX user_email_lower_key ON "user" (lower(email));
