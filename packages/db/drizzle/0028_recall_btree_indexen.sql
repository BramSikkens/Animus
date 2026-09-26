CREATE INDEX "face_embeddings_person_id_idx" ON "face_embeddings" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "familiarities_person_id_idx" ON "familiarities" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "memories_dynimo_id_created_at_idx" ON "memories" USING btree ("dynimo_id","created_at");--> statement-breakpoint
CREATE INDEX "memories_person_id_idx" ON "memories" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "voice_profiles_person_id_idx" ON "voice_profiles" USING btree ("person_id");