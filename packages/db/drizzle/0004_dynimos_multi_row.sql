ALTER TABLE identity RENAME TO dynimos;
ALTER TABLE dynimos DROP CONSTRAINT identity_singleton;

CREATE SEQUENCE dynimos_id_seq OWNED BY dynimos.id;
SELECT setval('dynimos_id_seq', COALESCE((SELECT MAX(id) FROM dynimos), 0) + 1, false);
ALTER TABLE dynimos ALTER COLUMN id SET DEFAULT nextval('dynimos_id_seq');

ALTER TABLE memories ADD COLUMN dynimo_id integer;
UPDATE memories SET dynimo_id = (SELECT id FROM dynimos ORDER BY id LIMIT 1);
ALTER TABLE memories ALTER COLUMN dynimo_id SET NOT NULL;
ALTER TABLE memories ADD CONSTRAINT memories_dynimo_id_dynimos_id_fk FOREIGN KEY (dynimo_id) REFERENCES dynimos(id) ON DELETE CASCADE;