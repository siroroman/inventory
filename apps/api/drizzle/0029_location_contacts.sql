CREATE TABLE "location_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"role" text NOT NULL,
	"name" text,
	"phone" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "location_contacts_location_id_sort_order_key" UNIQUE("location_id","sort_order"),
	CONSTRAINT "location_contacts_role_not_blank" CHECK (btrim("location_contacts"."role") <> ''),
	CONSTRAINT "location_contacts_phone_or_email" CHECK (coalesce(btrim("location_contacts"."phone"), '') <> '' OR coalesce(btrim("location_contacts"."email"), '') <> '')
);
--> statement-breakpoint
ALTER TABLE "location_contacts" ADD CONSTRAINT "location_contacts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_contacts" ADD CONSTRAINT "location_contacts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;