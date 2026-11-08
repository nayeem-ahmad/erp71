-- Voice notes on a task keep their length so the Attachments history can show
-- who recorded, when, and for how long without probing the audio file.
ALTER TABLE "project_attachments" ADD COLUMN IF NOT EXISTS "duration_ms" INTEGER;
