CREATE TABLE "service_record_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_record_id" uuid NOT NULL,
	"name" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "service_record_documents_storage_key_key" UNIQUE("storage_key"),
	CONSTRAINT "service_record_documents_name_not_blank" CHECK (btrim("service_record_documents"."name") <> ''),
	CONSTRAINT "service_record_documents_content_type_allowed" CHECK ("service_record_documents"."content_type" in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
	CONSTRAINT "service_record_documents_size_range" CHECK ("service_record_documents"."size_bytes" > 0 and "service_record_documents"."size_bytes" <= 20971520)
);
--> statement-breakpoint
ALTER TABLE "service_record_documents" ADD CONSTRAINT "service_record_documents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_record_documents" ADD CONSTRAINT "service_record_documents_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_record_documents" ADD CONSTRAINT "service_record_documents_record_id_fk" FOREIGN KEY ("service_record_id") REFERENCES "public"."service_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_record_documents_record_id_created_at_idx" ON "service_record_documents" USING btree ("service_record_id","created_at","id");