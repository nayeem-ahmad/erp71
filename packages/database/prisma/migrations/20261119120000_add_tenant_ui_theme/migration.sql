-- The workspace's visual style (Settings › Branding): CLASSIC | POLISHED | COLORFUL.
-- Existing workspaces keep the look they have today.
-- Production applies schema via `prisma db push`; this file is the history.

ALTER TABLE "Tenant" ADD COLUMN "ui_theme" TEXT NOT NULL DEFAULT 'CLASSIC';
