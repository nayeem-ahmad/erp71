-- Demo-data batches record what was asked for and which anomalies were planted.
ALTER TABLE "demo_data_batches" ADD COLUMN IF NOT EXISTS "options" JSONB;
ALTER TABLE "demo_data_batches" ADD COLUMN IF NOT EXISTS "anomalies" JSONB;
