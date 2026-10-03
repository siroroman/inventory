ALTER TABLE "items" ADD COLUMN "purchase_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_purchase_price_not_negative" CHECK ("items"."purchase_price" >= 0);