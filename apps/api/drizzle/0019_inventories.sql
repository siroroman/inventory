CREATE TABLE "inventories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"note" text,
	"committee" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "inventories_status_valid" CHECK ("inventories"."status" in ('in_progress', 'finished', 'cancelled')),
	CONSTRAINT "inventories_ended_when_closed" CHECK (("inventories"."status" = 'in_progress') = ("inventories"."ended_at" is null) and ("inventories"."status" = 'in_progress') = ("inventories"."ended_by" is null))
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"location_id" uuid NOT NULL,
	"registered_location_id" uuid,
	"checked_at" timestamp with time zone,
	"checked_by" uuid,
	"method" text,
	"was_missing" boolean DEFAULT false NOT NULL,
	"moved_at" timestamp with time zone,
	"moved_by" uuid,
	"outcome" text,
	CONSTRAINT "inventory_items_inventory_id_item_id_key" UNIQUE("inventory_id","item_id"),
	CONSTRAINT "inventory_items_kind_valid" CHECK ("inventory_items"."kind" in ('expected', 'elsewhere', 'new')),
	CONSTRAINT "inventory_items_method_valid" CHECK ("inventory_items"."method" in ('scan', 'manual')),
	CONSTRAINT "inventory_items_outcome_valid" CHECK ("inventory_items"."outcome" in ('missing', 'skipped')),
	CONSTRAINT "inventory_items_checked_together" CHECK (("inventory_items"."checked_at" is null) = ("inventory_items"."checked_by" is null) and ("inventory_items"."checked_at" is null) = ("inventory_items"."method" is null)),
	CONSTRAINT "inventory_items_outcome_unchecked_expected" CHECK ("inventory_items"."outcome" is null or ("inventory_items"."kind" = 'expected' and "inventory_items"."checked_at" is null))
);
--> statement-breakpoint
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_inventory_id_inventories_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."inventories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_registered_location_id_locations_id_fk" FOREIGN KEY ("registered_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_checked_by_user_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_moved_by_user_id_fk" FOREIGN KEY ("moved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventories_location_id_created_at_idx" ON "inventories" USING btree ("location_id","created_at","id");--> statement-breakpoint
CREATE INDEX "inventories_in_progress_location_id_idx" ON "inventories" USING btree ("location_id") WHERE "inventories"."status" = 'in_progress';--> statement-breakpoint
CREATE INDEX "inventories_status_created_at_idx" ON "inventories" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "inventories_status_ended_at_idx" ON "inventories" USING btree ("status","ended_at","id");--> statement-breakpoint
CREATE INDEX "inventory_items_item_id_idx" ON "inventory_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "inventory_items_location_id_idx" ON "inventory_items" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "inventory_items_registered_location_id_idx" ON "inventory_items" USING btree ("registered_location_id");