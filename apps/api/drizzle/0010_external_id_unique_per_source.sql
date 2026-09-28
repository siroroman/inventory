ALTER TABLE "item_external_ids" DROP CONSTRAINT "item_external_ids_item_source_value_key";--> statement-breakpoint
CREATE UNIQUE INDEX "item_external_ids_source_value_key" ON "item_external_ids" USING btree (lower("source"),lower("value"));--> statement-breakpoint
CREATE INDEX "item_external_ids_item_id_idx" ON "item_external_ids" USING btree ("item_id");