CREATE TABLE "memories" (
	"id" serial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "memories_embedding_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops);