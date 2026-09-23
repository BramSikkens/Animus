ALTER TABLE "dynimos" ADD COLUMN "axis_ie" real;--> statement-breakpoint
ALTER TABLE "dynimos" ADD COLUMN "axis_sn" real;--> statement-breakpoint
ALTER TABLE "dynimos" ADD COLUMN "axis_tf" real;--> statement-breakpoint
ALTER TABLE "dynimos" ADD COLUMN "axis_jp" real;--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_axis_ie_range" CHECK ("dynimos"."axis_ie" between 0 and 1);--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_axis_sn_range" CHECK ("dynimos"."axis_sn" between 0 and 1);--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_axis_tf_range" CHECK ("dynimos"."axis_tf" between 0 and 1);--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_axis_jp_range" CHECK ("dynimos"."axis_jp" between 0 and 1);