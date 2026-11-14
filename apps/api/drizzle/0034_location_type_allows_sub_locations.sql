ALTER TABLE "location_types" ADD COLUMN "allows_sub_locations" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Only the headquarters and a site are divided into sub-locations (floors, rooms, cabinets); a store
-- and a warehouse are one place, so the app hides sub-locations there. An admin can change it per type.
UPDATE "location_types" SET "allows_sub_locations" = true WHERE "code" IN ('HQ', 'SITE');
