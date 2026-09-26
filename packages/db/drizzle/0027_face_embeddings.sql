CREATE TABLE "face_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "face_embeddings" ADD CONSTRAINT "face_embeddings_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "face_embeddings_embedding_idx" ON "face_embeddings" USING hnsw ("embedding" vector_l2_ops);