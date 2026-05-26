ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source text;
CREATE INDEX IF NOT EXISTS contacts_source_idx ON contacts(source);
UPDATE contacts SET source = 'clay' WHERE source IS NULL;
