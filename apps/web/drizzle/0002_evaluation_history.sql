CREATE TABLE "flag_evaluation_buckets" (
	"flag_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"variant" text NOT NULL,
	"count" bigint NOT NULL,
	CONSTRAINT "flag_evaluation_buckets_flag_id_environment_id_bucket_start_variant_pk" PRIMARY KEY("flag_id","environment_id","bucket_start","variant")
);
--> statement-breakpoint
ALTER TABLE "flag_evaluation_buckets" ADD CONSTRAINT "flag_evaluation_buckets_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_evaluation_buckets" ADD CONSTRAINT "flag_evaluation_buckets_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flag_evaluation_buckets_env_bucket_idx" ON "flag_evaluation_buckets" USING btree ("environment_id","bucket_start");--> statement-breakpoint
CREATE INDEX "flag_evaluation_buckets_bucket_idx" ON "flag_evaluation_buckets" USING btree ("bucket_start");